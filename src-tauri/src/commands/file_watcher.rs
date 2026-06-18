use notify::{recommended_watcher, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::Serialize;
use std::{
    collections::BTreeSet,
    path::PathBuf,
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};

use super::path_grants::{assert_directory_read_allowed, assert_file_read_allowed};

static ACTIVE_WATCHER: OnceLock<Mutex<Option<ActiveFileWatcher>>> = OnceLock::new();

struct ActiveFileWatcher {
    _watcher: RecommendedWatcher,
    _paths: Vec<PathBuf>,
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
    let paths = normalize_watch_paths(paths)?;
    if paths.is_empty() {
        clear_active_watcher();
        return Ok(());
    }

    let app_for_events = app.clone();
    let mut watcher = recommended_watcher(move |result: notify::Result<Event>| {
        let Ok(event) = result else {
            return;
        };
        if !is_relevant_event(&event.kind) {
            return;
        }
        let payload = FileWatchChangeEvent {
            paths: event.paths.iter().map(|path| path.to_string_lossy().to_string()).collect(),
            kind: format!("{:?}", event.kind),
            changed_at_ms: timestamp_ms(),
        };
        let _ = app_for_events.emit("scienfy-file-watch-change", payload);
    })
    .map_err(|error| format!("Could not create file watcher: {error}"))?;

    for path in &paths {
        watcher
            .watch(path, RecursiveMode::NonRecursive)
            .map_err(|error| format!("Could not watch {}: {error}", path.to_string_lossy()))?;
    }

    *watcher_state().lock() = Some(ActiveFileWatcher {
        _watcher: watcher,
        _paths: paths,
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

fn normalize_watch_paths(paths: Vec<String>) -> Result<Vec<PathBuf>, String> {
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
        let key = path.to_string_lossy().to_string();
        if unique.insert(key) {
            normalized.push(path);
        }
    }
    if requested && normalized.is_empty() {
        return Err("No readable file watcher paths are currently available.".to_string());
    }
    Ok(normalized)
}

fn is_relevant_event(kind: &EventKind) -> bool {
    use notify::event::{CreateKind, ModifyKind, RemoveKind, RenameMode};
    matches!(
        kind,
        EventKind::Create(CreateKind::File)
            | EventKind::Create(CreateKind::Any)
            | EventKind::Modify(ModifyKind::Data(_))
            | EventKind::Modify(ModifyKind::Metadata(_))
            | EventKind::Modify(ModifyKind::Name(RenameMode::Any | RenameMode::Both | RenameMode::From | RenameMode::To))
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
    use super::{is_relevant_event, normalize_watch_paths};
    use notify::event::{DataChange, EventKind, ModifyKind};

    #[test]
    fn file_watcher_filters_empty_or_missing_paths() {
        assert!(normalize_watch_paths(vec!["".into()]).unwrap().is_empty());
        let error = normalize_watch_paths(vec!["Z:/definitely/missing.md".into()]).unwrap_err();
        assert!(error.contains("No readable file watcher paths"));
    }

    #[test]
    fn file_watcher_treats_data_changes_as_relevant() {
        assert!(is_relevant_event(&EventKind::Modify(ModifyKind::Data(DataChange::Content))));
    }
}
