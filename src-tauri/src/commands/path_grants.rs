use parking_lot::{Mutex, MutexGuard};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::OnceLock,
    time::UNIX_EPOCH,
};
#[cfg(not(test))]
use std::{
    fs::{self, OpenOptions},
    io::Write,
    time::SystemTime,
};

use serde::{Deserialize, Serialize};

use super::path_utils::external_safe_path_string;

const MAX_GRANTED_FILES: usize = 512;
const MAX_GRANTED_DIRECTORIES: usize = 256;

#[derive(Default, Serialize, Deserialize)]
struct PathGrantRegistry {
    files: HashSet<PathBuf>,
    #[serde(default)]
    pending_files: HashSet<PathBuf>,
    directories: HashSet<PathBuf>,
}

static PATH_GRANTS: OnceLock<Mutex<PathGrantRegistry>> = OnceLock::new();
#[cfg(test)]
static TEST_PATH_GRANTS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[cfg(test)]
pub(crate) struct TestPathGrantIsolation {
    _guard: MutexGuard<'static, ()>,
}

#[cfg(test)]
pub(crate) fn isolate_test_path_grants() -> TestPathGrantIsolation {
    let guard = TEST_PATH_GRANTS_LOCK.get_or_init(|| Mutex::new(())).lock();
    if let Ok(mut registry) = registry() {
        *registry = PathGrantRegistry::default();
    }
    TestPathGrantIsolation { _guard: guard }
}

#[cfg(test)]
impl Drop for TestPathGrantIsolation {
    fn drop(&mut self) {
        if let Ok(mut registry) = registry() {
            *registry = PathGrantRegistry::default();
        }
    }
}

pub fn grant_file(path: &Path) -> Result<(), String> {
    let granted = normalize_file_target(path)?;
    let mut registry = registry()?;
    if granted.is_file() {
        registry.files.insert(granted);
    } else {
        registry.pending_files.insert(granted);
    }
    compact_registry(&mut registry);
    persist_registry(&registry)?;
    Ok(())
}

pub fn grant_directory(path: &Path) -> Result<(), String> {
    let granted = normalize_existing_directory(path)?;
    let mut registry = registry()?;
    registry.directories.insert(granted);
    compact_registry(&mut registry);
    persist_registry(&registry)?;
    Ok(())
}

pub fn grant_file_and_parent(path: &Path) -> Result<(), String> {
    grant_file(path)?;
    if let Some(parent) = path.parent() {
        let _ = grant_directory(parent);
    }
    Ok(())
}

#[tauri::command]
pub fn grant_external_path(path: String, kind: String) -> Result<String, String> {
    let raw = PathBuf::from(path);
    let normalized_kind = kind.trim().to_ascii_lowercase();
    match normalized_kind.as_str() {
        "document" => Err(
            "Markdown files must be opened through the file picker, folder explorer, or OS file association."
                .to_string(),
        ),
        "image" => {
            validate_supported_extension(
                &raw,
                &["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"],
                "Unsupported image type.",
            )?;
            let canonical = normalize_existing_file(&raw)?;
            grant_file(&canonical)?;
            Ok(external_safe_path_string(&canonical))
        }
        "directory" => Err("Directory access must be granted through the folder picker.".to_string()),
        _ => Err("Unsupported external path grant type.".to_string()),
    }
}

pub fn assert_file_read_allowed(path: &Path) -> Result<(), String> {
    assert_path_allowed(path, false)
}

pub fn assert_file_write_allowed(path: &Path) -> Result<(), String> {
    assert_path_allowed(path, true)
}

pub fn assert_generated_asset_write_allowed(
    document_path: &Path,
    asset_path: &Path,
) -> Result<(), String> {
    assert_file_read_allowed(document_path)?;
    let document = normalize_file_target(document_path)?;
    let document_parent = document
        .parent()
        .ok_or_else(|| "Markdown document has no parent directory.".to_string())?;
    let generated_dir =
        normalize_existing_directory(&document_parent.join("assets").join("generated"))?;
    let target = normalize_file_target(asset_path)?;
    if target.starts_with(&generated_dir) {
        Ok(())
    } else {
        Err(access_denied())
    }
}

pub fn assert_directory_read_allowed(path: &Path) -> Result<(), String> {
    let target = normalize_existing_directory(path)?;
    let registry = registry()?;
    if registry
        .directories
        .iter()
        .any(|directory| target.starts_with(directory))
    {
        Ok(())
    } else {
        Err(access_denied())
    }
}

fn assert_path_allowed(path: &Path, allow_new_file: bool) -> Result<(), String> {
    let target = if allow_new_file {
        normalize_file_target(path)?
    } else {
        normalize_existing_file(path)?
    };
    let registry = registry()?;
    let exact_file_allowed = registry.files.contains(&target)
        || (allow_new_file && registry.pending_files.contains(&target));
    let directory_read_allowed = !allow_new_file
        && registry
            .directories
            .iter()
            .any(|directory| target.starts_with(directory));
    if exact_file_allowed || directory_read_allowed {
        Ok(())
    } else {
        Err(access_denied())
    }
}

fn registry() -> Result<MutexGuard<'static, PathGrantRegistry>, String> {
    Ok(PATH_GRANTS
        .get_or_init(|| Mutex::new(load_registry()))
        .lock())
}

#[cfg(test)]
fn load_registry() -> PathGrantRegistry {
    PathGrantRegistry::default()
}

#[cfg(not(test))]
fn load_registry() -> PathGrantRegistry {
    let Some(path) = grant_store_path() else {
        return PathGrantRegistry::default();
    };
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return PathGrantRegistry::default();
    };
    match serde_json::from_str::<PathGrantRegistry>(&raw) {
        Ok(mut registry) => {
            compact_registry(&mut registry);
            registry.directories.clear();
            registry
        }
        Err(error) => {
            let backup =
                path.with_file_name(format!("path-grants.corrupt-{}.json", unix_timestamp_ms()));
            let _ = fs::rename(&path, &backup);
            eprintln!(
                "ScieMD ignored a corrupt access grant store at {}: {error}",
                path.to_string_lossy()
            );
            PathGrantRegistry::default()
        }
    }
}

#[cfg(test)]
fn persist_registry(_registry: &PathGrantRegistry) -> Result<(), String> {
    Ok(())
}

#[cfg(not(test))]
fn persist_registry(registry: &PathGrantRegistry) -> Result<(), String> {
    let Some(path) = grant_store_path() else {
        return Ok(());
    };
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create access grant store: {error}"))?;
    let temp = path.with_extension("json.tmp");
    let persisted_registry = PathGrantRegistry {
        files: registry.files.clone(),
        pending_files: registry.pending_files.clone(),
        directories: HashSet::new(),
    };
    let raw = serde_json::to_string_pretty(&persisted_registry)
        .map_err(|error| format!("Could not serialize access grants: {error}"))?;
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&temp)
        .map_err(|error| format!("Could not write access grants: {error}"))?;
    if let Err(error) = file.write_all(raw.as_bytes()).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&temp);
        return Err(format!("Could not flush access grants: {error}"));
    }
    drop(file);
    replace_file(&temp, &path).map_err(|error| {
        let _ = fs::remove_file(&temp);
        format!("Could not update access grants: {error}")
    })?;
    if let Err(error) = sync_parent_dir(parent) {
        eprintln!(
            "Access grants were written, but ScieMD could not fsync the grant directory {}: {error}",
            parent.to_string_lossy()
        );
    }
    Ok(())
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain([0]).collect();
    let destination_wide: Vec<u16> = destination.as_os_str().encode_wide().chain([0]).collect();
    let moved = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    std::fs::rename(source, destination).map_err(|error| error.to_string())
}

#[cfg(windows)]
#[allow(dead_code)]
fn sync_parent_dir(_parent: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
#[allow(dead_code)]
fn sync_parent_dir(parent: &Path) -> Result<(), String> {
    let directory =
        std::fs::File::open(parent).map_err(|error| format!("open directory failed: {error}"))?;
    directory
        .sync_all()
        .map_err(|error| format!("sync directory failed: {error}"))
}

#[cfg(not(test))]
fn grant_store_path() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .map(|root| root.join("ScieMD").join("path-grants.json"))
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(PathBuf::from).map(|root| {
            root.join("Library")
                .join("Application Support")
                .join("ScieMD")
                .join("path-grants.json")
        })
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME")
                    .map(|home| PathBuf::from(home).join(".local").join("share"))
            })
            .map(|root| root.join("ScieMD").join("path-grants.json"))
    }
    #[cfg(not(any(windows, unix)))]
    {
        None
    }
}

fn normalize_existing_file(path: &Path) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Could not resolve file path: {error}"))?;
    if canonical.is_file() {
        Ok(canonical)
    } else {
        Err("Expected a file path.".to_string())
    }
}

fn normalize_existing_directory(path: &Path) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Could not resolve folder path: {error}"))?;
    if canonical.is_dir() {
        Ok(canonical)
    } else {
        Err("Expected a folder path.".to_string())
    }
}

fn normalize_file_target(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return normalize_existing_file(path);
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Target file has no parent directory.".to_string())?
        .canonicalize()
        .map_err(|error| format!("Could not resolve target folder: {error}"))?;
    let name = path
        .file_name()
        .ok_or_else(|| "Target file has no file name.".to_string())?;
    Ok(parent.join(name))
}

fn access_denied() -> String {
    "File access denied. Open, save, or choose the file/folder through ScieMD first.".to_string()
}

fn validate_supported_extension(
    path: &Path,
    allowed: &[&str],
    message: &str,
) -> Result<(), String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if allowed.contains(&extension.as_str()) {
        Ok(())
    } else {
        Err(message.to_string())
    }
}

fn compact_registry(registry: &mut PathGrantRegistry) {
    registry.files.retain(|path| path.is_file());
    let mut promoted = Vec::new();
    registry.pending_files.retain(|path| {
        if path.is_file() {
            promoted.push(path.clone());
            return false;
        }
        path.parent().is_some_and(|parent| parent.is_dir())
    });
    registry.files.extend(promoted);
    registry.directories.retain(|path| path.is_dir());
    limit_path_set(&mut registry.files, MAX_GRANTED_FILES);
    limit_path_set(&mut registry.pending_files, MAX_GRANTED_FILES);
    limit_path_set(&mut registry.directories, MAX_GRANTED_DIRECTORIES);
}

fn limit_path_set(paths: &mut HashSet<PathBuf>, limit: usize) {
    if paths.len() <= limit {
        return;
    }
    let mut ranked: Vec<(PathBuf, u128)> = paths
        .iter()
        .map(|path| (path.clone(), path_modified_ms(path)))
        .collect();
    ranked.sort_by(|left, right| {
        right
            .1
            .cmp(&left.1)
            .then_with(|| left.0.to_string_lossy().cmp(&right.0.to_string_lossy()))
    });
    *paths = ranked
        .into_iter()
        .take(limit)
        .map(|entry| entry.0)
        .collect();
}

fn path_modified_ms(path: &Path) -> u128 {
    path.metadata()
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(not(test))]
fn unix_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        env, fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn directory_grant_allows_read_children_but_not_write_or_siblings() {
        let _grants = isolate_test_path_grants();
        let root = env::temp_dir().join(format!("scie-md-grants-{}", suffix()));
        let granted = root.join("granted");
        let sibling = root.join("sibling");
        fs::create_dir_all(&granted).unwrap();
        fs::create_dir_all(&sibling).unwrap();
        let child = granted.join("paper.md");
        let outside = sibling.join("paper.md");
        fs::write(&child, "# ok").unwrap();
        fs::write(&outside, "# no").unwrap();

        grant_directory(&granted).unwrap();

        assert!(assert_file_read_allowed(&child).is_ok());
        assert!(assert_file_write_allowed(&child).is_err());
        assert!(assert_file_read_allowed(&outside).is_err());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn file_grant_allows_only_exact_file_write() {
        let _grants = isolate_test_path_grants();
        let root = env::temp_dir().join(format!("scie-md-grants-{}", suffix()));
        fs::create_dir_all(&root).unwrap();
        let granted = root.join("paper.md");
        let sibling = root.join("other.md");
        fs::write(&granted, "# ok").unwrap();
        fs::write(&sibling, "# no").unwrap();

        grant_file(&granted).unwrap();

        assert!(assert_file_write_allowed(&granted).is_ok());
        assert!(assert_file_write_allowed(&sibling).is_err());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn missing_save_target_grant_is_exact_file_only() {
        let _grants = isolate_test_path_grants();
        let root = env::temp_dir().join(format!("scie-md-grants-{}", suffix()));
        fs::create_dir_all(&root).unwrap();
        let granted = root.join("new-paper.md");
        let sibling = root.join("other-new-paper.md");

        grant_file(&granted).unwrap();

        assert!(assert_file_write_allowed(&granted).is_ok());
        assert!(assert_file_write_allowed(&sibling).is_err());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn generated_asset_write_is_allowed_under_granted_document_assets_only() {
        let _grants = isolate_test_path_grants();
        let root = env::temp_dir().join(format!("scie-md-generated-assets-{}", suffix()));
        let generated = root.join("assets").join("generated");
        fs::create_dir_all(&generated).unwrap();
        let document = root.join("paper.md");
        fs::write(&document, "# Paper").unwrap();
        grant_file_and_parent(&document).unwrap();

        let output = generated.join("svg-export.png");
        let sibling = root.join("assets").join("sibling.png");

        assert!(assert_generated_asset_write_allowed(&document, &output).is_ok());
        assert!(assert_generated_asset_write_allowed(&document, &sibling).is_err());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn external_path_command_does_not_grant_directories_by_string() {
        let _grants = isolate_test_path_grants();
        let root = env::temp_dir().join(format!("scie-md-grants-{}", suffix()));
        fs::create_dir_all(&root).unwrap();

        let error =
            grant_external_path(root.to_string_lossy().to_string(), "directory".to_string())
                .unwrap_err();

        assert!(error.contains("folder picker"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn external_path_command_does_not_grant_documents_by_string() {
        let _grants = isolate_test_path_grants();
        let root = env::temp_dir().join(format!("scie-md-grants-{}", suffix()));
        fs::create_dir_all(&root).unwrap();
        let document = root.join("paper.md");
        fs::write(&document, "# Paper").unwrap();

        let error = grant_external_path(
            document.to_string_lossy().to_string(),
            "document".to_string(),
        )
        .unwrap_err();

        assert!(error.contains("file picker"));
        assert!(assert_file_write_allowed(&document).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn external_image_grant_returns_tool_safe_path_for_verbatim_windows_input() {
        let _grants = isolate_test_path_grants();
        let root = env::temp_dir().join(format!("scie-md-grants-verbatim-{}", suffix()));
        fs::create_dir_all(&root).unwrap();
        let image = root.join("figure.png");
        fs::write(&image, [1_u8, 2, 3]).unwrap();
        let verbatim = format!(r"\\?\{}", image.to_string_lossy());

        let granted = grant_external_path(verbatim, "image".to_string()).unwrap();

        assert!(!granted.starts_with(r"\\?\"));
        assert!(granted.ends_with(r"\figure.png"));
        assert!(assert_file_read_allowed(&image).is_ok());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn compact_registry_drops_missing_paths_and_enforces_caps() {
        let _grants = isolate_test_path_grants();
        let root = env::temp_dir().join(format!("scie-md-grants-{}", suffix()));
        fs::create_dir_all(&root).unwrap();
        let kept_file = root.join("kept.md");
        fs::write(&kept_file, "# ok").unwrap();
        let kept_dir = root.join("kept-dir");
        fs::create_dir_all(&kept_dir).unwrap();

        let mut registry = PathGrantRegistry::default();
        registry.files.insert(kept_file.clone());
        registry.files.insert(root.join("missing.md"));
        registry.pending_files.insert(root.join("pending.md"));
        registry.directories.insert(kept_dir.clone());
        registry.directories.insert(root.join("missing-dir"));

        compact_registry(&mut registry);

        assert!(registry.files.contains(&kept_file));
        assert!(!registry.files.contains(&root.join("missing.md")));
        assert!(registry.pending_files.contains(&root.join("pending.md")));
        assert!(registry.directories.contains(&kept_dir));
        assert!(!registry.directories.contains(&root.join("missing-dir")));
        assert!(registry.files.len() <= MAX_GRANTED_FILES);
        assert!(registry.pending_files.len() <= MAX_GRANTED_FILES);
        assert!(registry.directories.len() <= MAX_GRANTED_DIRECTORIES);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn replace_file_overwrites_existing_destination() {
        let root = env::temp_dir().join(format!("scie-md-grant-replace-{}", suffix()));
        fs::create_dir_all(&root).unwrap();
        let destination = root.join("path-grants.json");
        let source = root.join("path-grants.json.tmp");
        fs::write(&destination, "old").unwrap();
        fs::write(&source, "new").unwrap();

        replace_file(&source, &destination).unwrap();

        assert_eq!(fs::read_to_string(&destination).unwrap(), "new");
        assert!(!source.exists());
        let _ = fs::remove_dir_all(root);
    }

    fn suffix() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    }
}
