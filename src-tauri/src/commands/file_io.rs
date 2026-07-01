use base64::{engine::general_purpose::STANDARD, Engine as _};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::OnceLock,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use super::path_grants::{
    assert_directory_read_allowed, assert_file_read_allowed, assert_file_write_allowed,
    clear_document_image_grants_for_document, grant_file, grant_file_and_parent,
    sync_document_image_grants_for_markdown,
};

mod text_encoding;

use text_encoding::{
    content_hash, decode_text_bytes, decode_text_bytes_lossy, detect_line_endings,
    markdown_to_bytes, metadata_mtime_ms, normalize_to_lf, readable_file_kind,
    unix_timestamp_for_file_name,
};

static LAST_TEMP_CLEANUP_AT: OnceLock<Mutex<Option<SystemTime>>> = OnceLock::new();
const MAX_BINARY_IPC_BYTES: u64 = 25 * 1024 * 1024;
const MAX_TEXT_IPC_BYTES: u64 = 25 * 1024 * 1024;
const MAX_TEXT_HASH_BYTES: u64 = 25 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub line_ending: String,
    pub encoding: String,
    pub has_bom: bool,
    pub has_mixed_line_endings: bool,
    pub last_known_mtime_ms: u64,
    pub last_known_size_bytes: u64,
    pub content_hash: Option<String>,
    pub cloud_state: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadTextFileResponse {
    pub content: String,
    pub metadata: FileMetadata,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedSiblingArtifactResponse {
    pub path: String,
    pub metadata: FileMetadata,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadTextFilePreviewResponse {
    pub content: String,
    pub modified_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileExplorerEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size_bytes: u64,
    pub modified_ms: u64,
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<ReadTextFileResponse, String> {
    let path = PathBuf::from(path);
    assert_file_read_allowed(&path)?;
    read_text_file_checked(&path)
}

#[tauri::command]
pub fn read_text_file_for_edit(path: String) -> Result<ReadTextFileResponse, String> {
    let path = PathBuf::from(path);
    assert_file_read_allowed(&path)?;
    grant_file(&path)?;
    read_text_file_checked(&path)
}

fn read_text_file_checked(path: &Path) -> Result<ReadTextFileResponse, String> {
    let file_metadata =
        fs::metadata(path).map_err(|error| format!("Could not read file metadata: {error}"))?;
    if file_metadata.len() > MAX_TEXT_IPC_BYTES {
        return Err("Text file is too large to open safely in ScieMD.".to_string());
    }
    let bytes = fs::read(path).map_err(|error| format!("Could not read file: {error}"))?;
    let decoded = decode_text_bytes(&bytes)?;
    let line_endings = detect_line_endings(&decoded.raw);
    let content = normalize_to_lf(&decoded.raw);
    sync_markdown_image_grants_if_markdown(path, &content)?;
    let metadata = metadata_from_file_metadata(
        path,
        &file_metadata,
        line_endings.line_ending,
        decoded.encoding,
        decoded.has_bom,
        line_endings.has_mixed_line_endings,
        Some(content_hash(&bytes)),
    );

    Ok(ReadTextFileResponse { content, metadata })
}

#[tauri::command]
pub fn read_text_file_preview(
    path: String,
    max_bytes: Option<usize>,
) -> Result<ReadTextFilePreviewResponse, String> {
    let path = PathBuf::from(path);
    assert_file_read_allowed(&path)?;
    let metadata =
        fs::metadata(&path).map_err(|error| format!("Could not read file metadata: {error}"))?;
    let byte_limit = max_bytes.unwrap_or(8192).clamp(512, 65_536);
    let mut file =
        fs::File::open(&path).map_err(|error| format!("Could not read file: {error}"))?;
    let mut bytes = Vec::with_capacity(byte_limit);
    Read::by_ref(&mut file)
        .take(byte_limit as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read file preview: {error}"))?;
    let decoded = decode_text_bytes_lossy(&bytes);
    let content = normalize_to_lf(&decoded.raw);

    Ok(ReadTextFilePreviewResponse {
        content,
        modified_ms: metadata_mtime_ms(&metadata),
    })
}

#[tauri::command]
pub fn stat_file(path: String, include_content_hash: Option<bool>) -> Result<FileMetadata, String> {
    let path = PathBuf::from(path);
    assert_file_read_allowed(&path)?;
    let include_hash = include_content_hash.unwrap_or(false);
    let metadata =
        fs::metadata(&path).map_err(|error| format!("Could not read file metadata: {error}"))?;
    if !include_hash {
        return metadata_from_path(
            &path,
            "lf".to_string(),
            "utf8".to_string(),
            false,
            false,
            false,
        );
    }
    if metadata.len() > MAX_TEXT_HASH_BYTES {
        return metadata_from_path(
            &path,
            "lf".to_string(),
            "utf8".to_string(),
            false,
            false,
            false,
        );
    }
    let bytes = fs::read(&path).map_err(|error| format!("Could not stat file: {error}"))?;
    let decoded = decode_text_bytes_lossy(&bytes);
    let line_endings = detect_line_endings(&decoded.raw);
    metadata_from_path(
        &path,
        line_endings.line_ending,
        decoded.encoding,
        decoded.has_bom,
        line_endings.has_mixed_line_endings,
        true,
    )
}

#[tauri::command]
pub fn read_binary_file_base64(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    assert_file_read_allowed(&path)?;
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Could not read binary file metadata: {error}"))?;
    if metadata.len() > MAX_BINARY_IPC_BYTES {
        return Err("Image is too large to embed in a self-contained HTML export.".to_string());
    }
    let bytes = fs::read(&path).map_err(|error| format!("Could not read binary file: {error}"))?;
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
pub fn list_readable_files(path: String) -> Result<Vec<FileExplorerEntry>, String> {
    let directory = PathBuf::from(path);
    assert_directory_read_allowed(&directory)?;
    let entries =
        fs::read_dir(&directory).map_err(|error| format!("Could not read folder: {error}"))?;
    let mut visible_entries = Vec::new();

    for entry in entries.flatten() {
        let entry_path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Some(name) = entry_path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }

        let kind = if metadata.is_dir() {
            "directory"
        } else if let Some(kind) = readable_file_kind(&entry_path) {
            kind
        } else {
            continue;
        };

        visible_entries.push(FileExplorerEntry {
            name: name.to_string(),
            path: entry_path.to_string_lossy().to_string(),
            kind: kind.to_string(),
            size_bytes: metadata.len(),
            modified_ms: metadata_mtime_ms(&metadata),
        });
    }

    visible_entries.sort_by(|left, right| {
        let left_is_dir = left.kind == "directory";
        let right_is_dir = right.kind == "directory";
        right_is_dir
            .cmp(&left_is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(visible_entries)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn write_text_file_atomic(
    path: String,
    markdown: String,
    line_ending: String,
    encoding: String,
    has_bom: bool,
    expected_mtime_ms: Option<u64>,
    expected_size_bytes: Option<u64>,
    expected_content_hash: Option<String>,
) -> Result<FileMetadata, String> {
    let path = PathBuf::from(path);
    assert_file_write_allowed(&path)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Target file has no parent directory.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create parent directory: {error}"))?;

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document.md");
    cleanup_stale_temp_files_throttled(parent, file_name, Duration::from_secs(60 * 60));
    verify_expected_metadata(
        &path,
        expected_mtime_ms,
        expected_size_bytes,
        expected_content_hash.as_deref(),
    )?;

    let temp_path = temp_path_for(&path);
    let bytes = markdown_to_bytes(&markdown, &line_ending, &encoding, has_bom)?;

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp_path)
        .map_err(|error| format!("Could not create temporary file: {error}"))?;

    if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&temp_path);
        return Err(format!("Could not write temporary file: {error}"));
    }

    drop(file);

    if let Err(error) = verify_expected_metadata(
        &path,
        expected_mtime_ms,
        expected_size_bytes,
        expected_content_hash.as_deref(),
    ) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    if let Err(error) = atomic_replace(&temp_path, &path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    sync_file(&path)?;
    sync_parent_dir(parent)?;
    sync_markdown_image_grants_if_markdown(&path, &markdown)?;
    metadata_from_path(&path, line_ending, encoding, has_bom, false, true)
}

#[tauri::command]
pub fn write_text_file_create_new(
    path: String,
    markdown: String,
    line_ending: String,
    encoding: String,
    has_bom: bool,
) -> Result<FileMetadata, String> {
    let path = PathBuf::from(path);
    assert_file_write_allowed(&path)?;
    let metadata = create_new_text_file(&path, &markdown, &line_ending, &encoding, has_bom)?;
    sync_markdown_image_grants_if_markdown(&path, &markdown)?;
    Ok(metadata)
}

#[tauri::command]
pub fn create_generated_sibling_artifact(
    document_path: String,
    artifact_kind: String,
    markdown: String,
    line_ending: String,
    encoding: String,
    has_bom: bool,
) -> Result<GeneratedSiblingArtifactResponse, String> {
    let document_path = PathBuf::from(document_path);
    assert_file_read_allowed(&document_path)?;
    let document = document_path
        .canonicalize()
        .map_err(|error| format!("Could not resolve document path: {error}"))?;
    if !document.is_file() {
        return Err("Expected a saved Markdown document.".to_string());
    }
    let parent = document
        .parent()
        .ok_or_else(|| "Markdown document has no parent directory.".to_string())?;
    let file_name = generated_artifact_file_name(&artifact_kind)?;
    let target = next_available_generated_sibling_path(parent, file_name);
    let metadata = create_new_text_file(&target, &markdown, &line_ending, &encoding, has_bom)?;
    grant_file_and_parent(&target)?;
    Ok(GeneratedSiblingArtifactResponse {
        path: target.to_string_lossy().to_string(),
        metadata,
    })
}

fn create_new_text_file(
    path: &Path,
    markdown: &str,
    line_ending: &str,
    encoding: &str,
    has_bom: bool,
) -> Result<FileMetadata, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Target file has no parent directory.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create parent directory: {error}"))?;

    let bytes = markdown_to_bytes(markdown, line_ending, encoding, has_bom)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("Could not create file without overwriting: {error}"))?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Could not write file: {error}"))?;
    drop(file);
    sync_file(path)?;
    sync_parent_dir(parent)?;
    metadata_from_path(
        path,
        line_ending.to_string(),
        encoding.to_string(),
        has_bom,
        false,
        true,
    )
}

fn sync_markdown_image_grants_if_markdown(path: &Path, content: &str) -> Result<usize, String> {
    if readable_file_kind(path) == Some("markdown") {
        return sync_document_image_grants_for_markdown(path, content);
    }
    clear_document_image_grants_for_document(path)
}

fn generated_artifact_file_name(artifact_kind: &str) -> Result<&'static str, String> {
    match artifact_kind.trim() {
        "llm-skill" => Ok("ScieMD_LLM_skill.md"),
        "submission-readiness" => Ok("SCIENFY_SUBMISSION_READINESS.md"),
        _ => Err("Unsupported generated artifact type.".to_string()),
    }
}

fn next_available_generated_sibling_path(parent: &Path, file_name: &str) -> PathBuf {
    let base = parent.join(file_name);
    if !base.exists() {
        return base;
    }
    let stem = file_name.strip_suffix(".md").unwrap_or(file_name);
    for index in 2..1000 {
        let candidate = parent.join(format!("{stem}-{index}.md"));
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!("{stem}-{}.md", unix_timestamp_for_file_name()))
}

fn verify_expected_metadata(
    path: &Path,
    expected_mtime_ms: Option<u64>,
    expected_size_bytes: Option<u64>,
    expected_content_hash: Option<&str>,
) -> Result<(), String> {
    if expected_mtime_ms.is_none()
        && expected_size_bytes.is_none()
        && expected_content_hash.is_none()
    {
        return if path.exists() {
            Err(
                "The target file appeared on disk before ScieMD could save. Choose another name or reload it first."
                    .to_string(),
            )
        } else {
            Ok(())
        };
    }

    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not verify target metadata before saving: {error}"))?;
    let current_mtime_ms = metadata_mtime_ms(&metadata);
    if expected_mtime_ms.is_some_and(|expected| current_mtime_ms != expected)
        || expected_size_bytes.is_some_and(|expected| metadata.len() != expected)
    {
        return Err(
            "The file changed on disk before ScieMD could save. Reload or save as a new file."
                .to_string(),
        );
    }
    if let Some(expected_content_hash) = expected_content_hash {
        let bytes = fs::read(path)
            .map_err(|error| format!("Could not verify target before saving: {error}"))?;
        if content_hash(&bytes) != expected_content_hash {
            return Err(
                "The file changed on disk before ScieMD could save. Reload or save as a new file."
                    .to_string(),
            );
        }
    }
    Ok(())
}

#[tauri::command]
pub fn cleanup_stale_temp_files_for_paths(paths: Vec<String>) -> Result<(), String> {
    for path in paths {
        let path = PathBuf::from(path);
        if assert_file_write_allowed(&path).is_err() {
            continue;
        }
        let Some(parent) = path.parent() else {
            continue;
        };
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        cleanup_stale_temp_files(parent, file_name, Duration::from_secs(60 * 60));
    }
    Ok(())
}

pub fn metadata_from_path(
    path: &Path,
    line_ending: String,
    encoding: String,
    has_bom: bool,
    has_mixed_line_endings: bool,
    include_content_hash: bool,
) -> Result<FileMetadata, String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("Could not read file metadata: {error}"))?;
    let content_hash = if include_content_hash {
        content_hash_from_path(path, metadata.len())
    } else {
        None
    };

    Ok(metadata_from_file_metadata(
        path,
        &metadata,
        line_ending,
        encoding,
        has_bom,
        has_mixed_line_endings,
        content_hash,
    ))
}

fn metadata_from_file_metadata(
    path: &Path,
    metadata: &fs::Metadata,
    line_ending: String,
    encoding: String,
    has_bom: bool,
    has_mixed_line_endings: bool,
    content_hash: Option<String>,
) -> FileMetadata {
    let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    let last_known_mtime_ms = modified
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64;

    FileMetadata {
        line_ending,
        encoding,
        has_bom,
        has_mixed_line_endings,
        last_known_mtime_ms,
        last_known_size_bytes: metadata.len(),
        content_hash,
        cloud_state: cloud_file_state(path),
    }
}

fn content_hash_from_path(path: &Path, size_bytes: u64) -> Option<String> {
    if size_bytes > MAX_TEXT_HASH_BYTES {
        return None;
    }
    fs::read(path).ok().map(|bytes| content_hash(&bytes))
}

#[cfg(windows)]
fn cloud_file_state(path: &Path) -> String {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetFileAttributesW;

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let attributes = unsafe { GetFileAttributesW(wide.as_ptr()) };
    if attributes == u32::MAX {
        return "unknown".to_string();
    }
    classify_cloud_attributes(attributes).to_string()
}

#[cfg(not(windows))]
fn cloud_file_state(_path: &Path) -> String {
    "local".to_string()
}

#[cfg(windows)]
fn classify_cloud_attributes(attributes: u32) -> &'static str {
    const FILE_ATTRIBUTE_OFFLINE: u32 = 0x0000_1000;
    const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x0004_0000;
    const FILE_ATTRIBUTE_PINNED: u32 = 0x0008_0000;
    const FILE_ATTRIBUTE_UNPINNED: u32 = 0x0010_0000;
    const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;

    if attributes
        & (FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS | FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_UNPINNED)
        != 0
    {
        "cloud-placeholder"
    } else if attributes & FILE_ATTRIBUTE_RECALL_ON_OPEN != 0 {
        "cloud-recall-on-open"
    } else if attributes & FILE_ATTRIBUTE_PINNED != 0 {
        "cloud-pinned"
    } else {
        "local"
    }
}

fn temp_path_for(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document.md");
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    path.with_file_name(format!(".{file_name}.{timestamp}.tmp"))
}

fn cleanup_stale_temp_files_throttled(parent: &Path, file_name: &str, max_age: Duration) {
    let now = SystemTime::now();
    let mutex = LAST_TEMP_CLEANUP_AT.get_or_init(|| Mutex::new(None));
    let mut last_cleanup_at = mutex.lock();
    if last_cleanup_at
        .and_then(|last| now.duration_since(last).ok())
        .is_some_and(|elapsed| elapsed < Duration::from_secs(60))
    {
        return;
    }
    *last_cleanup_at = Some(now);
    drop(last_cleanup_at);
    cleanup_stale_temp_files(parent, file_name, max_age);
}

fn cleanup_stale_temp_files(parent: &Path, file_name: &str, max_age: Duration) {
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    let now = SystemTime::now();

    for entry in entries.flatten() {
        let path = entry.path();
        let Some(candidate) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !is_temp_file_for_target(candidate, file_name) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        if now.duration_since(modified).unwrap_or_default() > max_age {
            let _ = fs::remove_file(path);
        }
    }
}

fn is_temp_file_for_target(candidate: &str, file_name: &str) -> bool {
    let prefix = format!(".{file_name}.");
    candidate.starts_with(&prefix) && candidate.ends_with(".tmp")
}

#[cfg(windows)]
fn atomic_replace(temp_path: &Path, target_path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, ReplaceFileW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        REPLACEFILE_WRITE_THROUGH,
    };

    let temp: Vec<u16> = temp_path.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target_path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = if target_path.exists() {
        unsafe {
            ReplaceFileW(
                target.as_ptr(),
                temp.as_ptr(),
                null(),
                REPLACEFILE_WRITE_THROUGH,
                null(),
                null(),
            )
        }
    } else {
        unsafe {
            MoveFileExW(
                temp.as_ptr(),
                target.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        }
    };
    if result == 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(17) {
            return copy_sync_and_replace_windows(temp_path, target_path);
        }
        Err(format!(
            "Could not replace target file atomically: {}",
            error
        ))
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn copy_sync_and_replace_windows(temp_path: &Path, target_path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let copy_path = temp_path_for(target_path);
    let mut source = fs::File::open(temp_path).map_err(|error| {
        format!("Could not reopen temporary file for cross-device replace: {error}")
    })?;
    let mut copy = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&copy_path)
        .map_err(|error| format!("Could not create same-volume replacement file: {error}"))?;
    if let Err(error) = std::io::copy(&mut source, &mut copy).and_then(|_| copy.sync_all()) {
        drop(copy);
        let _ = fs::remove_file(&copy_path);
        return Err(format!(
            "Could not copy replacement file onto the target volume: {error}"
        ));
    }
    drop(copy);
    let copy: Vec<u16> = copy_path.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target_path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            copy.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        let _ = fs::remove_file(&copy_path);
        return Err(format!(
            "Could not install same-volume replacement file: {}",
            std::io::Error::last_os_error()
        ));
    }
    let _ = fs::remove_file(temp_path);
    Ok(())
}

#[cfg(not(windows))]
fn atomic_replace(temp_path: &Path, target_path: &Path) -> Result<(), String> {
    match fs::rename(temp_path, target_path) {
        Ok(()) => Ok(()),
        Err(error) if error.raw_os_error() == Some(libc::EXDEV) => {
            copy_sync_and_rename(temp_path, target_path)
        }
        Err(error) => Err(format!("Could not replace target file atomically: {error}")),
    }
}

#[cfg(not(windows))]
fn copy_sync_and_rename(temp_path: &Path, target_path: &Path) -> Result<(), String> {
    let parent = target_path
        .parent()
        .ok_or_else(|| "Target file has no parent directory.".to_string())?;
    let copy_path = temp_path_for(target_path);
    let mut source = fs::File::open(temp_path).map_err(|error| {
        format!("Could not reopen temporary file for cross-device replace: {error}")
    })?;
    let mut copy = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&copy_path)
        .map_err(|error| format!("Could not create cross-device replacement file: {error}"))?;
    if let Err(error) = std::io::copy(&mut source, &mut copy).and_then(|_| copy.sync_all()) {
        drop(copy);
        let _ = fs::remove_file(&copy_path);
        return Err(format!(
            "Could not copy replacement file across file systems: {error}"
        ));
    }
    drop(copy);
    fs::rename(&copy_path, target_path).map_err(|error| {
        let _ = fs::remove_file(&copy_path);
        format!("Could not install cross-device replacement file: {error}")
    })?;
    let _ = fs::remove_file(temp_path);
    sync_parent_dir(parent)?;
    Ok(())
}

fn sync_file(path: &Path) -> Result<(), String> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("Could not reopen saved file for durability sync: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("Could not flush saved file to disk: {error}"))
}

#[cfg(windows)]
fn sync_parent_dir(_parent: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
fn sync_parent_dir(parent: &Path) -> Result<(), String> {
    let directory = std::fs::File::open(parent)
        .map_err(|error| format!("Could not open parent directory for durability sync: {error}"))?;
    directory
        .sync_all()
        .map_err(|error| format!("Could not flush parent directory to disk: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::path_grants::{
        assert_file_read_allowed, assert_file_write_allowed, grant_directory,
        grant_document_image_asset, grant_file, grant_file_and_parent, isolate_test_path_grants,
    };
    use filetime::{set_file_mtime, FileTime};
    use std::{env, fs};

    #[cfg(windows)]
    #[test]
    fn cloud_attribute_classification_marks_placeholders() {
        assert_eq!(classify_cloud_attributes(0), "local");
        assert_eq!(classify_cloud_attributes(0x0008_0000), "cloud-pinned");
        assert_eq!(
            classify_cloud_attributes(0x0004_0000),
            "cloud-recall-on-open"
        );
        assert_eq!(classify_cloud_attributes(0x0010_0000), "cloud-placeholder");
        assert_eq!(classify_cloud_attributes(0x0040_0000), "cloud-placeholder");
        assert_eq!(classify_cloud_attributes(0x0000_1000), "cloud-placeholder");
    }

    #[test]
    fn atomic_write_and_read_preserve_line_ending_and_bom_policy() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-file-{}", temp_suffix()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("document.md");
        grant_file_and_parent(&path).unwrap();

        let metadata = write_text_file_atomic(
            path.to_string_lossy().to_string(),
            "alpha\nbeta\n".to_string(),
            "crlf".to_string(),
            "utf8".to_string(),
            true,
            None,
            None,
            None,
        )
        .unwrap();

        let raw = fs::read(&path).unwrap();
        assert!(raw.starts_with(&[0xEF, 0xBB, 0xBF]));
        assert!(String::from_utf8_lossy(&raw).contains("alpha\r\nbeta\r\n"));
        assert_eq!(metadata.line_ending, "crlf");
        assert_eq!(metadata.encoding, "utf8");
        assert!(metadata.has_bom);

        let read = read_text_file(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(read.content, "alpha\nbeta\n");
        assert_eq!(read.metadata.line_ending, "crlf");
        assert_eq!(read.metadata.encoding, "utf8");
        assert!(read.metadata.has_bom);
        assert_eq!(read.metadata.content_hash, Some(content_hash(&raw)));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn atomic_write_rejects_stale_expected_metadata() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-stale-{}", temp_suffix()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("document.md");
        fs::write(&path, b"old").unwrap();
        grant_file_and_parent(&path).unwrap();
        let metadata = fs::metadata(&path).unwrap();
        let hash = content_hash(&fs::read(&path).unwrap());

        let error = write_text_file_atomic(
            path.to_string_lossy().to_string(),
            "new\n".to_string(),
            "lf".to_string(),
            "utf8".to_string(),
            false,
            Some(metadata_mtime_ms(&metadata)),
            Some(metadata.len() + 1),
            Some(hash),
        )
        .unwrap_err();

        assert!(error.contains("changed on disk"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "old");

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn atomic_write_rejects_existing_file_when_expected_metadata_is_empty() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-appeared-{}", temp_suffix()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("document.md");
        fs::write(&path, b"appeared").unwrap();
        grant_file_and_parent(&path).unwrap();

        let error = write_text_file_atomic(
            path.to_string_lossy().to_string(),
            "new\n".to_string(),
            "lf".to_string(),
            "utf8".to_string(),
            false,
            None,
            None,
            None,
        )
        .unwrap_err();

        assert!(error.contains("target file appeared"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "appeared");

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn create_new_write_refuses_to_overwrite_existing_file() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-create-new-{}", temp_suffix()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("generated.md");
        fs::write(&path, b"existing").unwrap();
        grant_file_and_parent(&path).unwrap();

        let error = write_text_file_create_new(
            path.to_string_lossy().to_string(),
            "new".to_string(),
            "lf".to_string(),
            "utf8".to_string(),
            false,
        )
        .unwrap_err();

        assert!(error.contains("Could not create file without overwriting"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "existing");

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn generated_sibling_artifacts_are_allowlisted_and_create_new() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-generated-sibling-{}", temp_suffix()));
        fs::create_dir_all(&dir).unwrap();
        let document = dir.join("paper.md");
        fs::write(&document, b"# Paper").unwrap();
        fs::write(dir.join("ScieMD_LLM_skill.md"), b"existing").unwrap();
        grant_file(&document).unwrap();

        let created = create_generated_sibling_artifact(
            document.to_string_lossy().to_string(),
            "llm-skill".to_string(),
            "# Skill\n".to_string(),
            "lf".to_string(),
            "utf8".to_string(),
            false,
        )
        .unwrap();
        let created_path = PathBuf::from(&created.path);

        assert_eq!(
            created_path.file_name().and_then(|value| value.to_str()),
            Some("ScieMD_LLM_skill-2.md")
        );
        assert_eq!(fs::read_to_string(&created_path).unwrap(), "# Skill\n");
        assert!(assert_file_write_allowed(&created_path).is_ok());
        assert!(assert_file_write_allowed(&dir.join("not-allowlisted.md")).is_err());

        let report = create_generated_sibling_artifact(
            document.to_string_lossy().to_string(),
            "submission-readiness".to_string(),
            "# Readiness\n".to_string(),
            "lf".to_string(),
            "utf8".to_string(),
            false,
        )
        .unwrap();

        assert_eq!(
            PathBuf::from(report.path)
                .file_name()
                .and_then(|value| value.to_str()),
            Some("SCIENFY_SUBMISSION_READINESS.md")
        );

        let error = create_generated_sibling_artifact(
            document.to_string_lossy().to_string(),
            "arbitrary".to_string(),
            "no".to_string(),
            "lf".to_string(),
            "utf8".to_string(),
            false,
        )
        .unwrap_err();
        assert!(error.contains("Unsupported generated artifact type"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn read_binary_file_base64_encodes_file_bytes() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-binary-{}", temp_suffix()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("image.png");
        fs::write(&path, [1_u8, 2, 3, 4]).unwrap();
        grant_file(&path).unwrap();

        assert_eq!(
            read_binary_file_base64(path.to_string_lossy().to_string()).unwrap(),
            "AQIDBA=="
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn file_reads_require_a_registered_grant() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-denied-{}", temp_suffix()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("private.md");
        fs::write(&path, b"# Private").unwrap();

        let error = read_text_file(path.to_string_lossy().to_string()).unwrap_err();

        assert!(error.contains("File access denied"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn read_text_file_does_not_upgrade_directory_read_grants_to_file_write_grants() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-read-only-{}", temp_suffix()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("paper.md");
        fs::write(&path, b"# Paper").unwrap();
        grant_directory(&dir).unwrap();

        let read = read_text_file(path.to_string_lossy().to_string()).unwrap();

        assert_eq!(read.content, "# Paper");
        assert!(assert_file_write_allowed(&path).is_err());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn read_text_file_for_edit_grants_only_the_opened_file_for_writes() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-edit-open-{}", temp_suffix()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("paper.md");
        let sibling = dir.join("sibling.md");
        fs::write(&path, b"# Paper").unwrap();
        fs::write(&sibling, b"# Sibling").unwrap();
        grant_directory(&dir).unwrap();

        let read = read_text_file_for_edit(path.to_string_lossy().to_string()).unwrap();

        assert_eq!(read.content, "# Paper");
        assert!(assert_file_write_allowed(&path).is_ok());
        assert!(assert_file_write_allowed(&sibling).is_err());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn read_text_file_for_edit_grants_referenced_images_exactly() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-edit-images-{}", temp_suffix()));
        let assets = dir.join("assets");
        fs::create_dir_all(&assets).unwrap();
        let path = dir.join("paper.md");
        let referenced = assets.join("figure.png");
        let unreferenced = assets.join("private.png");
        fs::write(&path, b"# Paper\n\n![Figure](assets/figure.png)\n").unwrap();
        fs::write(
            &referenced,
            [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
        )
        .unwrap();
        fs::write(
            &unreferenced,
            [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
        )
        .unwrap();
        grant_file(&path).unwrap();

        let read = read_text_file_for_edit(path.to_string_lossy().to_string()).unwrap();

        assert!(read.content.contains("assets/figure.png"));
        assert!(assert_file_read_allowed(&referenced).is_ok());
        assert!(assert_file_read_allowed(&unreferenced).is_err());
        assert!(assert_file_write_allowed(&referenced).is_err());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn read_text_file_for_edit_clears_document_image_grants_for_json() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-json-edit-images-{}", temp_suffix()));
        let assets = dir.join("assets");
        fs::create_dir_all(&assets).unwrap();
        let path = dir.join("results.json");
        let referenced = assets.join("figure.png");
        fs::write(&path, br#"{"preview":"![Figure](assets/figure.png)"}"#).unwrap();
        fs::write(
            &referenced,
            [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
        )
        .unwrap();
        grant_file(&path).unwrap();
        grant_document_image_asset(&path, &referenced).unwrap();
        assert!(assert_file_read_allowed(&referenced).is_ok());

        let read = read_text_file_for_edit(path.to_string_lossy().to_string()).unwrap();

        assert!(read.content.contains("assets/figure.png"));
        assert!(assert_file_read_allowed(&referenced).is_err());
        assert!(assert_file_write_allowed(&path).is_ok());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn atomic_write_replaces_document_image_grants() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-write-images-{}", temp_suffix()));
        let assets = dir.join("assets");
        fs::create_dir_all(&assets).unwrap();
        let path = dir.join("paper.md");
        let first = assets.join("first.png");
        let second = assets.join("second.png");
        fs::write(&path, b"# Paper\n\n![First](assets/first.png)\n").unwrap();
        fs::write(&first, [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]).unwrap();
        fs::write(&second, [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]).unwrap();
        grant_file_and_parent(&path).unwrap();
        let opened = read_text_file(path.to_string_lossy().to_string()).unwrap();
        assert!(assert_file_read_allowed(&first).is_ok());

        write_text_file_atomic(
            path.to_string_lossy().to_string(),
            "# Paper\n\n![Second](assets/second.png)\n".to_string(),
            opened.metadata.line_ending.clone(),
            opened.metadata.encoding.clone(),
            opened.metadata.has_bom,
            Some(opened.metadata.last_known_mtime_ms),
            Some(opened.metadata.last_known_size_bytes),
            opened.metadata.content_hash.clone(),
        )
        .unwrap();

        assert!(assert_file_read_allowed(&first).is_err());
        assert!(assert_file_read_allowed(&second).is_ok());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn create_new_write_does_not_grant_document_images_for_json() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-json-write-images-{}", temp_suffix()));
        let assets = dir.join("assets");
        fs::create_dir_all(&assets).unwrap();
        let path = dir.join("results.json");
        let referenced = assets.join("figure.png");
        fs::write(
            &referenced,
            [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
        )
        .unwrap();
        grant_file_and_parent(&path).unwrap();

        write_text_file_create_new(
            path.to_string_lossy().to_string(),
            "{\"preview\":\"![Figure](assets/figure.png)\"}\n".to_string(),
            "lf".to_string(),
            "utf8".to_string(),
            false,
        )
        .unwrap();

        assert!(assert_file_read_allowed(&referenced).is_err());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn read_text_file_reports_mixed_line_endings() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-mixed-{}", temp_suffix()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("mixed.md");
        fs::write(&path, b"alpha\r\nbeta\ngamma\r\n").unwrap();
        grant_file(&path).unwrap();

        let read = read_text_file(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(read.content, "alpha\nbeta\ngamma\n");
        assert!(read.metadata.has_mixed_line_endings);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn read_text_file_preview_reads_only_a_bounded_prefix() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-preview-{}", temp_suffix()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("preview.md");
        let content = format!("# Preview\n\nThis should appear.\n\n{}", "tail".repeat(300));
        fs::write(&path, content.as_bytes()).unwrap();
        grant_file(&path).unwrap();

        let preview = read_text_file_preview(path.to_string_lossy().to_string(), Some(24)).unwrap();

        assert!(preview.content.starts_with("# Preview"));
        assert!(preview.content.len() <= 512);
        assert!(preview.content.len() < content.len());
        assert!(preview.modified_ms > 0);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn read_text_file_detects_utf16_and_windows_1252() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-encoding-{}", temp_suffix()));
        fs::create_dir_all(&dir).unwrap();
        let utf16_path = dir.join("utf16.md");
        let mut utf16_bytes = vec![0xFF, 0xFE];
        for unit in "alpha\r\nbeta".encode_utf16() {
            utf16_bytes.extend_from_slice(&unit.to_le_bytes());
        }
        fs::write(&utf16_path, utf16_bytes).unwrap();
        grant_file_and_parent(&utf16_path).unwrap();

        let utf16 = read_text_file(utf16_path.to_string_lossy().to_string()).unwrap();
        assert_eq!(utf16.content, "alpha\nbeta");
        assert_eq!(utf16.metadata.encoding, "utf16le");
        assert!(utf16.metadata.has_bom);

        let cp1252_path = dir.join("cp1252.md");
        fs::write(&cp1252_path, b"caf\xe9 \x97 quote").unwrap();
        grant_file_and_parent(&cp1252_path).unwrap();

        let cp1252 = read_text_file(cp1252_path.to_string_lossy().to_string()).unwrap();
        assert_eq!(cp1252.content, "café — quote");
        assert_eq!(cp1252.metadata.encoding, "windows1252");

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn cleanup_stale_temp_files_removes_only_matching_target_temps() {
        let dir = env::temp_dir().join(format!("scie-md-temp-cleanup-{}", temp_suffix()));
        fs::create_dir_all(&dir).unwrap();
        let matching = dir.join(".document.md.123.tmp");
        let other = dir.join(".other.md.123.tmp");
        fs::write(&matching, b"temp").unwrap();
        fs::write(&other, b"temp").unwrap();
        std::thread::sleep(Duration::from_millis(5));

        cleanup_stale_temp_files(&dir, "document.md", Duration::ZERO);

        assert!(!matching.exists());
        assert!(other.exists());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn cleanup_stale_temp_files_respects_age_threshold() {
        let dir = env::temp_dir().join(format!("scie-md-temp-age-{}", temp_suffix()));
        fs::create_dir_all(&dir).unwrap();
        let stale = dir.join(".document.md.stale.tmp");
        let fresh = dir.join(".document.md.fresh.tmp");
        let sibling = dir.join(".other.md.stale.tmp");
        fs::write(&stale, b"stale").unwrap();
        fs::write(&fresh, b"fresh").unwrap();
        fs::write(&sibling, b"sibling").unwrap();
        let old_time = SystemTime::now() - Duration::from_secs(2 * 60 * 60);
        set_file_mtime(&stale, FileTime::from_system_time(old_time)).unwrap();
        set_file_mtime(&sibling, FileTime::from_system_time(old_time)).unwrap();

        cleanup_stale_temp_files(&dir, "document.md", Duration::from_secs(60 * 60));

        assert!(!stale.exists());
        assert!(fresh.exists());
        assert!(sibling.exists());

        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    #[test]
    fn atomic_write_reports_locked_target_without_replacing_original() {
        use std::os::windows::fs::OpenOptionsExt;

        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-locked-{}", temp_suffix()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("document.md");
        fs::write(&path, b"original").unwrap();
        grant_file_and_parent(&path).unwrap();
        let metadata = fs::metadata(&path).unwrap();
        let _lock = OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(&path)
            .unwrap();

        let error = write_text_file_atomic(
            path.to_string_lossy().to_string(),
            "new\n".to_string(),
            "lf".to_string(),
            "utf8".to_string(),
            false,
            Some(metadata_mtime_ms(&metadata)),
            Some(metadata.len()),
            None,
        )
        .unwrap_err();

        assert!(error.contains("Could not replace target file atomically"));
        drop(_lock);
        assert_eq!(fs::read_to_string(&path).unwrap(), "original");
        assert_eq!(
            fs::read_dir(&dir)
                .unwrap()
                .flatten()
                .filter(|entry| entry
                    .path()
                    .file_name()
                    .and_then(|value| value.to_str())
                    .is_some_and(|name| is_temp_file_for_target(name, "document.md")))
                .count(),
            0
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn temp_path_for_uses_hidden_sibling_file_name() {
        let dir = env::temp_dir().join(format!("scie-md-temp-path-{}", temp_suffix()));
        let target = dir.join("document.md");

        let temp_path = temp_path_for(&target);
        let temp_name = temp_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap();

        assert_eq!(temp_path.parent(), Some(dir.as_path()));
        assert!(temp_name.starts_with(".document.md."));
        assert!(temp_name.ends_with(".tmp"));
    }

    #[test]
    fn list_readable_files_returns_supported_text_documents() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-explorer-{}", temp_suffix()));
        fs::create_dir_all(dir.join("notes")).unwrap();
        fs::write(dir.join("a.md"), b"# A").unwrap();
        fs::write(dir.join("a.markdown"), b"# A2").unwrap();
        fs::write(dir.join("b.txt"), b"B").unwrap();
        fs::write(dir.join("c.json"), b"{}").unwrap();
        fs::write(dir.join("d.jsonl"), br#"{"a":1}"#).unwrap();
        fs::write(dir.join("e.ndjson"), br#"{"a":2}"#).unwrap();
        fs::write(dir.join("f.yaml"), b"title: A").unwrap();
        fs::write(dir.join("g.yml"), b"title: B").unwrap();
        fs::write(dir.join("h.toml"), b"title = \"A\"").unwrap();
        fs::write(dir.join("i.xml"), b"<root/>").unwrap();
        fs::write(dir.join("j.csv"), b"id,count\n1,2").unwrap();
        fs::write(dir.join("k.tsv"), b"id\tcount\n1\t2").unwrap();
        fs::write(dir.join("c.png"), [1_u8, 2, 3]).unwrap();
        fs::write(dir.join("l.pdf"), b"PDF").unwrap();
        grant_directory(&dir).unwrap();

        let entries = list_readable_files(dir.to_string_lossy().to_string()).unwrap();
        let names_and_kinds: Vec<(String, String)> = entries
            .into_iter()
            .map(|entry| (entry.name, entry.kind))
            .collect();

        assert_eq!(
            names_and_kinds,
            vec![
                ("notes".to_string(), "directory".to_string()),
                ("a.markdown".to_string(), "markdown".to_string()),
                ("a.md".to_string(), "markdown".to_string()),
                ("b.txt".to_string(), "plainText".to_string()),
                ("c.json".to_string(), "json".to_string()),
                ("d.jsonl".to_string(), "jsonl".to_string()),
                ("e.ndjson".to_string(), "jsonl".to_string()),
                ("f.yaml".to_string(), "yaml".to_string()),
                ("g.yml".to_string(), "yaml".to_string()),
                ("h.toml".to_string(), "toml".to_string()),
                ("i.xml".to_string(), "xml".to_string()),
                ("j.csv".to_string(), "csv".to_string()),
                ("k.tsv".to_string(), "tsv".to_string()),
            ]
        );

        let _ = fs::remove_dir_all(dir);
    }

    fn temp_suffix() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    }
}
