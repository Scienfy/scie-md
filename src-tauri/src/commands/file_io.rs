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
    assert_directory_read_allowed, assert_file_read_allowed, assert_file_write_allowed, grant_file,
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
    grant_file(&path)?;
    let metadata =
        fs::metadata(&path).map_err(|error| format!("Could not read file metadata: {error}"))?;
    if metadata.len() > MAX_TEXT_IPC_BYTES {
        return Err("Text file is too large to open safely in ScieMD.".to_string());
    }
    let bytes = fs::read(&path).map_err(|error| format!("Could not read file: {error}"))?;
    let decoded = decode_text_bytes(&bytes)?;
    let line_endings = detect_line_endings(&decoded.raw);
    let content = normalize_to_lf(&decoded.raw);
    let metadata = metadata_from_path(
        &path,
        line_endings.line_ending,
        decoded.encoding,
        decoded.has_bom,
        line_endings.has_mixed_line_endings,
        true,
    )?;

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
    let mut file = fs::File::open(&path).map_err(|error| format!("Could not read file: {error}"))?;
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
    let parent = path
        .parent()
        .ok_or_else(|| "Target file has no parent directory.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create parent directory: {error}"))?;

    let bytes = markdown_to_bytes(&markdown, &line_ending, &encoding, has_bom)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| format!("Could not create file without overwriting: {error}"))?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Could not write file: {error}"))?;
    drop(file);
    sync_file(&path)?;
    sync_parent_dir(parent)?;
    metadata_from_path(&path, line_ending, encoding, has_bom, false, true)
}

fn verify_expected_metadata(
    path: &Path,
    expected_mtime_ms: Option<u64>,
    expected_size_bytes: Option<u64>,
    expected_content_hash: Option<&str>,
) -> Result<(), String> {
    let (Some(expected_mtime_ms), Some(expected_size_bytes), Some(expected_content_hash)) = (
        expected_mtime_ms,
        expected_size_bytes,
        expected_content_hash,
    ) else {
        return Ok(());
    };

    let bytes = fs::read(path)
        .map_err(|error| format!("Could not verify target before saving: {error}"))?;
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not verify target metadata before saving: {error}"))?;
    let current_mtime_ms = metadata_mtime_ms(&metadata);
    let current_hash = content_hash(&bytes);
    if current_mtime_ms != expected_mtime_ms
        || metadata.len() != expected_size_bytes
        || current_hash != expected_content_hash
    {
        return Err(
            "The file changed on disk before ScieMD could save. Reload or save as a new file."
                .to_string(),
        );
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
    let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    let last_known_mtime_ms = modified
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64;

    Ok(FileMetadata {
        line_ending,
        encoding,
        has_bom,
        has_mixed_line_endings,
        last_known_mtime_ms,
        last_known_size_bytes: metadata.len(),
        content_hash: if include_content_hash {
            content_hash_from_path(path, metadata.len())
        } else {
            None
        },
        cloud_state: cloud_file_state(path),
    })
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

    if attributes & (FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS | FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_UNPINNED) != 0 {
        "cloud-placeholder"
    } else if attributes & FILE_ATTRIBUTE_RECALL_ON_OPEN != 0 {
        "cloud-recall-on-open"
    } else if attributes & FILE_ATTRIBUTE_PINNED != 0 {
        "cloud-pinned"
    } else {
        "local"
    }
}

struct LineEndingDetection {
    line_ending: String,
    has_mixed_line_endings: bool,
}

fn detect_line_endings(content: &str) -> LineEndingDetection {
    let crlf = content.matches("\r\n").count();
    let lf = content.matches('\n').count().saturating_sub(crlf);
    let cr = content.matches('\r').count().saturating_sub(crlf);
    let styles = [crlf > 0, lf > 0, cr > 0]
        .into_iter()
        .filter(|style_present| *style_present)
        .count();

    LineEndingDetection {
        line_ending: if crlf > lf + cr {
            "crlf".to_string()
        } else {
            "lf".to_string()
        },
        has_mixed_line_endings: styles > 1,
    }
}

fn normalize_to_lf(content: &str) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n")
}

fn readable_file_kind(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "md" | "markdown" => Some("markdown"),
        _ => None,
    }
}

fn metadata_mtime_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .unwrap_or(SystemTime::UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

struct DecodedText {
    raw: String,
    encoding: String,
    has_bom: bool,
}

fn decode_text_bytes(bytes: &[u8]) -> Result<DecodedText, String> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        let raw = String::from_utf8(bytes[3..].to_vec())
            .map_err(|error| format!("File has a UTF-8 BOM but contains invalid UTF-8: {error}"))?;
        return Ok(DecodedText {
            raw,
            encoding: "utf8".to_string(),
            has_bom: true,
        });
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return Ok(DecodedText {
            raw: decode_utf16(&bytes[2..], true),
            encoding: "utf16le".to_string(),
            has_bom: true,
        });
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return Ok(DecodedText {
            raw: decode_utf16(&bytes[2..], false),
            encoding: "utf16be".to_string(),
            has_bom: true,
        });
    }
    if let Ok(raw) = String::from_utf8(bytes.to_vec()) {
        return Ok(DecodedText {
            raw,
            encoding: "utf8".to_string(),
            has_bom: false,
        });
    }
    if looks_like_utf16(bytes, true) {
        return Ok(DecodedText {
            raw: decode_utf16(bytes, true),
            encoding: "utf16le".to_string(),
            has_bom: false,
        });
    }
    if looks_like_utf16(bytes, false) {
        return Ok(DecodedText {
            raw: decode_utf16(bytes, false),
            encoding: "utf16be".to_string(),
            has_bom: false,
        });
    }
    Ok(DecodedText {
        raw: decode_windows_1252(bytes),
        encoding: "windows1252".to_string(),
        has_bom: false,
    })
}

fn decode_text_bytes_lossy(bytes: &[u8]) -> DecodedText {
    decode_text_bytes(bytes).unwrap_or_else(|_| DecodedText {
        raw: decode_windows_1252(bytes),
        encoding: "windows1252".to_string(),
        has_bom: false,
    })
}

fn decode_utf16(bytes: &[u8], little_endian: bool) -> String {
    let units = bytes.chunks_exact(2).map(|chunk| {
        if little_endian {
            u16::from_le_bytes([chunk[0], chunk[1]])
        } else {
            u16::from_be_bytes([chunk[0], chunk[1]])
        }
    });
    std::char::decode_utf16(units)
        .map(|result| result.unwrap_or(char::REPLACEMENT_CHARACTER))
        .collect()
}

fn looks_like_utf16(bytes: &[u8], little_endian: bool) -> bool {
    if bytes.len() < 8 || !bytes.len().is_multiple_of(2) {
        return false;
    }
    let pairs = bytes.len() / 2;
    let nul_position = if little_endian { 1 } else { 0 };
    let nul_count = bytes
        .chunks_exact(2)
        .filter(|chunk| chunk[nul_position] == 0)
        .count();
    nul_count * 2 >= pairs
}

fn decode_windows_1252(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| match *byte {
            0x80 => '\u{20AC}',
            0x82 => '\u{201A}',
            0x83 => '\u{0192}',
            0x84 => '\u{201E}',
            0x85 => '\u{2026}',
            0x86 => '\u{2020}',
            0x87 => '\u{2021}',
            0x88 => '\u{02C6}',
            0x89 => '\u{2030}',
            0x8A => '\u{0160}',
            0x8B => '\u{2039}',
            0x8C => '\u{0152}',
            0x8E => '\u{017D}',
            0x91 => '\u{2018}',
            0x92 => '\u{2019}',
            0x93 => '\u{201C}',
            0x94 => '\u{201D}',
            0x95 => '\u{2022}',
            0x96 => '\u{2013}',
            0x97 => '\u{2014}',
            0x98 => '\u{02DC}',
            0x99 => '\u{2122}',
            0x9A => '\u{0161}',
            0x9B => '\u{203A}',
            0x9C => '\u{0153}',
            0x9E => '\u{017E}',
            0x9F => '\u{0178}',
            value => char::from(value),
        })
        .collect()
}

fn markdown_to_bytes(
    markdown: &str,
    line_ending: &str,
    encoding: &str,
    has_bom: bool,
) -> Result<Vec<u8>, String> {
    let normalized = normalize_to_lf(markdown);
    let output = if line_ending == "crlf" {
        normalized.replace('\n', "\r\n")
    } else {
        normalized
    };

    match encoding {
        "utf8" => {
            let mut bytes = Vec::with_capacity(output.len() + if has_bom { 3 } else { 0 });
            if has_bom {
                bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
            }
            bytes.extend_from_slice(output.as_bytes());
            Ok(bytes)
        }
        "utf16le" => Ok(encode_utf16_bytes(&output, true, has_bom)),
        "utf16be" => Ok(encode_utf16_bytes(&output, false, has_bom)),
        "windows1252" => encode_windows_1252(&output),
        other => Err(format!("Unsupported text encoding: {other}")),
    }
}

fn encode_utf16_bytes(content: &str, little_endian: bool, has_bom: bool) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(content.len() * 2 + if has_bom { 2 } else { 0 });
    if has_bom {
        bytes.extend_from_slice(if little_endian {
            &[0xFF, 0xFE]
        } else {
            &[0xFE, 0xFF]
        });
    }
    for unit in content.encode_utf16() {
        let encoded = if little_endian {
            unit.to_le_bytes()
        } else {
            unit.to_be_bytes()
        };
        bytes.extend_from_slice(&encoded);
    }
    bytes
}

fn encode_windows_1252(content: &str) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::with_capacity(content.len());
    for character in content.chars() {
        let encoded = match character {
            '\u{20AC}' => 0x80,
            '\u{201A}' => 0x82,
            '\u{0192}' => 0x83,
            '\u{201E}' => 0x84,
            '\u{2026}' => 0x85,
            '\u{2020}' => 0x86,
            '\u{2021}' => 0x87,
            '\u{02C6}' => 0x88,
            '\u{2030}' => 0x89,
            '\u{0160}' => 0x8A,
            '\u{2039}' => 0x8B,
            '\u{0152}' => 0x8C,
            '\u{017D}' => 0x8E,
            '\u{2018}' => 0x91,
            '\u{2019}' => 0x92,
            '\u{201C}' => 0x93,
            '\u{201D}' => 0x94,
            '\u{2022}' => 0x95,
            '\u{2013}' => 0x96,
            '\u{2014}' => 0x97,
            '\u{02DC}' => 0x98,
            '\u{2122}' => 0x99,
            '\u{0161}' => 0x9A,
            '\u{203A}' => 0x9B,
            '\u{0153}' => 0x9C,
            '\u{017E}' => 0x9E,
            '\u{0178}' => 0x9F,
            value if u32::from(value) <= 0xFF => value as u8,
            value => {
                return Err(format!(
                    "Character U+{:04X} cannot be saved using Windows-1252 encoding.",
                    u32::from(value)
                ));
            }
        };
        bytes.push(encoded);
    }
    Ok(bytes)
}

fn content_hash(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
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
        let _ = fs::remove_file(&copy_path);
        return Err(format!(
            "Could not copy replacement file onto the target volume: {error}"
        ));
    }
    drop(copy);
    let copy: Vec<u16> = copy_path.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target_path.as_os_str().encode_wide().chain(Some(0)).collect();
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
        grant_directory, grant_file, grant_file_and_parent, isolate_test_path_grants,
    };
    use std::{env, fs};

    #[cfg(windows)]
    #[test]
    fn cloud_attribute_classification_marks_placeholders() {
        assert_eq!(classify_cloud_attributes(0), "local");
        assert_eq!(classify_cloud_attributes(0x0008_0000), "cloud-pinned");
        assert_eq!(classify_cloud_attributes(0x0004_0000), "cloud-recall-on-open");
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

        let preview =
            read_text_file_preview(path.to_string_lossy().to_string(), Some(24)).unwrap();

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
    fn list_readable_files_returns_directories_and_markdown_files_only() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-explorer-{}", temp_suffix()));
        fs::create_dir_all(dir.join("notes")).unwrap();
        fs::write(dir.join("a.md"), b"# A").unwrap();
        fs::write(dir.join("a.markdown"), b"# A2").unwrap();
        fs::write(dir.join("b.txt"), b"B").unwrap();
        fs::write(dir.join("c.png"), [1_u8, 2, 3]).unwrap();
        fs::write(dir.join("d.pdf"), b"PDF").unwrap();
        grant_directory(&dir).unwrap();

        let entries = list_readable_files(dir.to_string_lossy().to_string()).unwrap();
        let names: Vec<String> = entries.into_iter().map(|entry| entry.name).collect();

        assert_eq!(names, vec!["notes", "a.markdown", "a.md"]);

        let _ = fs::remove_dir_all(dir);
    }

    fn temp_suffix() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    }
}
