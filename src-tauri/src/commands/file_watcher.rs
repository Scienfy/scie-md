use notify::{recommended_watcher, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::Serialize;
use std::{
    collections::BTreeSet,
    ffi::OsString,
    path::{Path, PathBuf},
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};

use super::{
    path_grants::{assert_directory_read_allowed, assert_file_read_allowed},
    path_utils::external_safe_path,
};

static ACTIVE_WATCHER: OnceLock<Mutex<Option<ActiveFileWatcher>>> = OnceLock::new();

struct ActiveFileWatcher {
    _watcher: RecommendedWatcher,
    _targets: Vec<WatchTarget>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct WatchTarget {
    path: PathBuf,
    watch_path: PathBuf,
    file_name: Option<OsString>,
    is_directory: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWatchChangeEvent {
    paths: Vec<String>,
    kind: String,
    changed_at_ms: u128,
}

#[tauri::command]
pub fn watch_files_for_changes(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    let targets = normalize_watch_paths(paths)?;
    if targets.is_empty() {
        clear_active_watcher();
        return Ok(());
    }

    let app_for_events = app.clone();
    let event_targets = targets.clone();
    let mut watcher = recommended_watcher(move |result: notify::Result<Event>| {
        let Ok(event) = result else {
            return;
        };
        if !is_relevant_event(&event.kind) {
            return;
        }
        let changed_paths = matching_target_paths(&event_targets, &event.paths);
        if changed_paths.is_empty() {
            return;
        }
        let payload = FileWatchChangeEvent {
            paths: changed_paths
                .iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect(),
            kind: format!("{:?}", event.kind),
            changed_at_ms: timestamp_ms(),
        };
        let _ = app_for_events.emit("scienfy-file-watch-change", payload);
    })
    .map_err(|error| format!("Could not create file watcher: {error}"))?;

    let watch_paths: BTreeSet<PathBuf> = targets
        .iter()
        .map(|target| target.watch_path.clone())
        .collect();
    for path in &watch_paths {
        watcher
            .watch(path, RecursiveMode::NonRecursive)
            .map_err(|error| format!("Could not watch {}: {error}", path.to_string_lossy()))?;
    }

    // Replace only after every new target is successfully registered. If any
    // path fails, the existing watcher remains active.
    *watcher_state().lock() = Some(ActiveFileWatcher {
        _watcher: watcher,
        _targets: targets,
    });
    Ok(())
}

#[tauri::command]
pub fn unwatch_files_for_changes() -> Result<(), String> {
    clear_active_watcher();
    Ok(())
}

fn watcher_state() -> &'static Mutex<Option<ActiveFileWatcher>> {
    ACTIVE_WATCHER.get_or_init(|| Mutex::new(None))
}

fn clear_active_watcher() {
    *watcher_state().lock() = None;
}

fn normalize_watch_paths(paths: Vec<String>) -> Result<Vec<WatchTarget>, String> {
    let mut unique = BTreeSet::new();
    let mut normalized = Vec::new();
    let mut requested = false;
    for raw in paths {
        if raw.trim().is_empty() {
            continue;
        }
        requested = true;
        let path = PathBuf::from(raw);
        if !path.exists() {
            continue;
        }
        if path.is_dir() {
            assert_directory_read_allowed(&path)?;
        } else {
            assert_file_read_allowed(&path)?;
        }
        let path = external_safe_path(&path.canonicalize().unwrap_or(path));
        let key = comparable_path(&path);
        if unique.insert(key) {
            normalized.push(watch_target_for_path(path)?);
        }
    }
    if requested && normalized.is_empty() {
        return Err("No readable file watcher paths are currently available.".to_string());
    }
    Ok(normalized)
}

fn watch_target_for_path(path: PathBuf) -> Result<WatchTarget, String> {
    if path.is_dir() {
        return Ok(WatchTarget {
            watch_path: path.clone(),
            path,
            file_name: None,
            is_directory: true,
        });
    }
    let watch_path = path
        .parent()
        .ok_or_else(|| "File watcher target has no parent directory.".to_string())?
        .to_path_buf();
    let file_name = path
        .file_name()
        .ok_or_else(|| "File watcher target has no file name.".to_string())?
        .to_os_string();
    Ok(WatchTarget {
        path,
        watch_path,
        file_name: Some(file_name),
        is_directory: false,
    })
}

fn matching_target_paths(targets: &[WatchTarget], event_paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut changed = BTreeSet::new();
    for target in targets {
        if event_paths
            .iter()
            .any(|path| event_path_matches_target(path, target))
        {
            changed.insert(target.path.clone());
        }
    }
    changed.into_iter().collect()
}

fn event_path_matches_target(event_path: &Path, target: &WatchTarget) -> bool {
    if target.is_directory {
        return same_path(event_path, &target.path) || path_is_under(event_path, &target.path);
    }
    if same_path(event_path, &target.path) {
        return true;
    }
    event_path.file_name() == target.file_name.as_deref()
        && event_path
            .parent()
            .is_some_and(|parent| same_path(parent, &target.watch_path))
}

#[cfg(windows)]
fn same_path(left: &Path, right: &Path) -> bool {
    normalized_comparable_path(left) == normalized_comparable_path(right)
}

#[cfg(not(windows))]
fn same_path(left: &Path, right: &Path) -> bool {
    left == right
}

#[cfg(windows)]
fn path_is_under(path: &Path, parent: &Path) -> bool {
    let path = normalized_comparable_path(path);
    let parent = normalized_comparable_path(parent);
    path.strip_prefix(&parent)
        .is_some_and(|suffix| suffix.starts_with('/'))
}

#[cfg(not(windows))]
fn path_is_under(path: &Path, parent: &Path) -> bool {
    path.starts_with(parent)
}

#[cfg(windows)]
fn comparable_path(path: &Path) -> String {
    let mut value = path.to_string_lossy().replace('\\', "/");
    if let Some(rest) = value.strip_prefix("//?/UNC/") {
        value = format!("//{rest}");
    } else if let Some(rest) = value.strip_prefix("//?/") {
        value = rest.to_string();
    }
    let is_unc = value.starts_with("//");
    while value.contains("//") {
        value = value.replace("//", "/");
    }
    if is_unc && !value.starts_with("//") {
        value = format!("/{value}");
    }
    value.trim_end_matches('/').to_ascii_lowercase()
}

#[cfg(windows)]
fn normalized_comparable_path(path: &Path) -> String {
    let path = path
        .canonicalize()
        .map(|canonical| external_safe_path(&canonical))
        .unwrap_or_else(|_| path.to_path_buf());
    comparable_path(&path)
}

#[cfg(not(windows))]
fn comparable_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn is_relevant_event(kind: &EventKind) -> bool {
    use notify::event::{CreateKind, ModifyKind, RemoveKind, RenameMode};
    matches!(
        kind,
        EventKind::Create(CreateKind::File)
            | EventKind::Create(CreateKind::Any)
            | EventKind::Modify(ModifyKind::Data(_))
            | EventKind::Modify(ModifyKind::Metadata(_))
            | EventKind::Modify(ModifyKind::Name(
                RenameMode::Any | RenameMode::Both | RenameMode::From | RenameMode::To
            ))
            | EventKind::Modify(ModifyKind::Any)
            | EventKind::Remove(RemoveKind::File)
            | EventKind::Remove(RemoveKind::Any)
            | EventKind::Any
    )
}

fn timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(test)]
mod tests {
    use super::{is_relevant_event, matching_target_paths, normalize_watch_paths, same_path};
    use crate::commands::path_grants::{
        grant_directory, grant_file_and_parent, isolate_test_path_grants,
    };
    use notify::event::{DataChange, EventKind, ModifyKind};
    use std::{env, fs};

    #[test]
    fn file_watcher_filters_empty_or_missing_paths() {
        assert!(normalize_watch_paths(vec!["".into()]).unwrap().is_empty());
        let error = normalize_watch_paths(vec!["Z:/definitely/missing.md".into()]).unwrap_err();
        assert!(error.contains("No readable file watcher paths"));
    }

    #[test]
    fn file_watcher_treats_data_changes_as_relevant() {
        assert!(is_relevant_event(&EventKind::Modify(ModifyKind::Data(
            DataChange::Content
        ))));
    }

    #[test]
    fn file_watcher_watches_parent_directory_for_file_targets() {
        let _grants = isolate_test_path_grants();
        let root = env::temp_dir().join(format!("scie-md-watch-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let file = root.join("paper.md");
        fs::write(&file, "# Paper").unwrap();
        grant_file_and_parent(&file).unwrap();

        let targets = normalize_watch_paths(vec![file.to_string_lossy().to_string()]).unwrap();

        assert_eq!(targets.len(), 1);
        assert!(same_path(&targets[0].path, &file));
        assert!(same_path(&targets[0].watch_path, &root));
        assert!(!targets[0].is_directory);
        let _ = fs::remove_dir_all(targets[0].watch_path.clone());
    }

    #[test]
    fn file_watcher_accepts_directory_targets_only_after_directory_grant() {
        let _grants = isolate_test_path_grants();
        let root = env::temp_dir().join(format!("scie-md-watch-dir-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();

        let denied = normalize_watch_paths(vec![root.to_string_lossy().to_string()]).unwrap_err();
        assert!(denied.contains("File access denied"));

        grant_directory(&root).unwrap();
        let targets = normalize_watch_paths(vec![root.to_string_lossy().to_string()]).unwrap();

        assert_eq!(targets.len(), 1);
        assert!(targets[0].is_directory);
        assert!(same_path(&targets[0].path, &root));
        assert!(same_path(&targets[0].watch_path, &root));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn file_watcher_filters_directory_events_to_requested_file() {
        let root = env::temp_dir().join(format!("scie-md-watch-filter-{}", std::process::id()));
        let target = root.join("paper.md");
        let temp = root.join(".paper.md.tmp");
        let targets = vec![super::WatchTarget {
            path: target.clone(),
            watch_path: root,
            file_name: Some("paper.md".into()),
            is_directory: false,
        }];

        assert_eq!(
            matching_target_paths(&targets, std::slice::from_ref(&temp)),
            Vec::<std::path::PathBuf>::new()
        );
        assert_eq!(
            matching_target_paths(&targets, std::slice::from_ref(&target)),
            vec![target]
        );
    }

    #[cfg(windows)]
    #[test]
    fn file_watcher_matches_windows_verbatim_and_unc_variants() {
        let drive_target = std::path::PathBuf::from(r"C:\Lab\paper.md");
        let drive_event = std::path::PathBuf::from(r"\\?\C:\Lab\paper.md");
        let unc_target = std::path::PathBuf::from(r"\\server\share\paper.md");
        let unc_event = std::path::PathBuf::from(r"\\?\UNC\server\share\paper.md");
        let targets = vec![
            super::WatchTarget {
                path: drive_target.clone(),
                watch_path: std::path::PathBuf::from(r"C:\Lab"),
                file_name: Some("paper.md".into()),
                is_directory: false,
            },
            super::WatchTarget {
                path: unc_target.clone(),
                watch_path: std::path::PathBuf::from(r"\\server\share"),
                file_name: Some("paper.md".into()),
                is_directory: false,
            },
        ];

        let mut expected = vec![drive_target, unc_target];
        expected.sort();
        assert_eq!(
            matching_target_paths(&targets, &[drive_event, unc_event]),
            expected
        );
    }
}
