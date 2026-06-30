use serde::{Deserialize, Serialize};
#[cfg(not(windows))]
use std::io::Read;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const DIAGNOSTICS_DIR: &str = "diagnostics";
const HEARTBEAT_FILE: &str = "renderer-heartbeat.json";
const DIAGNOSTICS_LOG_FILE: &str = "diagnostics.jsonl";
const RECOVERY_SNAPSHOT_FILE: &str = "latest-recovery-snapshot.json";
const DIAGNOSTICS_BUNDLE_PREFIX: &str = "diagnostics-bundle";
const MAX_DIAGNOSTICS_LOG_BYTES: u64 = 2 * 1024 * 1024;
const MAX_RECOVERY_SNAPSHOT_BYTES: usize = 64 * 1024 * 1024;
const MAX_BUNDLE_LOG_TAIL_BYTES: usize = 512 * 1024;
const PREVIOUS_SESSION_CRASH_WINDOW_MS: u128 = 15_000;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererHeartbeatPayload {
    pub session_id: String,
    pub document_path: Option<String>,
    pub mode: Option<String>,
    pub markdown_bytes: u64,
    pub line_count: u64,
    pub image_count: u64,
    pub math_count: u64,
    pub visual_atom_count: u64,
    pub warning_count: u64,
    pub error_count: u64,
    #[serde(default)]
    pub active_background_job_count: u64,
    #[serde(default)]
    pub stuck_background_job_count: u64,
    #[serde(default)]
    pub oldest_background_job_ms: Option<u64>,
    #[serde(default)]
    pub background_job_labels: Vec<String>,
    #[serde(default)]
    pub stuck_background_job_labels: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererHeartbeatStatus {
    pub previous_session_suspected_crash: bool,
    pub previous_session_last_seen_ms: Option<u128>,
    pub diagnostics_dir: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsBundleMetadata {
    pub path: String,
    pub diagnostics_dir: String,
    pub created_at_ms: u128,
    pub event_count: u64,
    pub log_bytes: u64,
    pub recovery_snapshot_bytes: Option<usize>,
    pub heartbeat_seen_at_ms: Option<u128>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsEventPayload {
    pub event_type: String,
    pub message: String,
    pub document_path: Option<String>,
    pub mode: Option<String>,
    pub markdown_bytes: Option<u64>,
    pub component_stack: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySnapshotPayload {
    pub markdown: String,
    pub file_path: Option<String>,
    pub updated_at_ms: u128,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySnapshot {
    pub markdown: String,
    pub file_path: Option<String>,
    pub updated_at_ms: u128,
    pub markdown_bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySnapshotMetadata {
    pub updated_at_ms: u128,
    pub markdown_bytes: usize,
    pub path: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredHeartbeat {
    session_id: String,
    seen_at_ms: u128,
    clean_shutdown: bool,
    payload: RendererHeartbeatPayload,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredDiagnosticsEvent<'a> {
    timestamp_ms: u128,
    event: &'a DiagnosticsEventPayload,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsBundle {
    created_at_ms: u128,
    app_version: &'static str,
    diagnostics_dir: String,
    heartbeat: Option<StoredHeartbeat>,
    diagnostics_log: DiagnosticsLogBundle,
    recovery_snapshot: Option<RecoverySnapshotBundle>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsLogBundle {
    path: String,
    bytes: u64,
    tail: String,
    tail_event_count: u64,
    tail_truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoverySnapshotBundle {
    path: String,
    file_path: Option<String>,
    updated_at_ms: u128,
    markdown_bytes: usize,
    markdown_omitted_reason: &'static str,
}

#[tauri::command]
pub fn record_renderer_heartbeat(
    app: AppHandle,
    payload: RendererHeartbeatPayload,
) -> Result<RendererHeartbeatStatus, String> {
    let dir = diagnostics_dir(&app)?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create diagnostics dir: {error}"))?;
    let heartbeat_path = dir.join(HEARTBEAT_FILE);
    let previous = read_heartbeat(&heartbeat_path).ok().flatten();
    let now = timestamp_ms();
    let previous_session_suspected_crash = previous.as_ref().is_some_and(|heartbeat| {
        heartbeat.session_id != payload.session_id
            && !heartbeat.clean_shutdown
            && now.saturating_sub(heartbeat.seen_at_ms) >= PREVIOUS_SESSION_CRASH_WINDOW_MS
    });
    let previous_session_last_seen_ms = previous
        .as_ref()
        .filter(|heartbeat| heartbeat.session_id != payload.session_id)
        .map(|heartbeat| heartbeat.seen_at_ms);
    let stored = StoredHeartbeat {
        session_id: payload.session_id.clone(),
        seen_at_ms: now,
        clean_shutdown: false,
        payload,
    };
    write_json_atomically(&heartbeat_path, &stored)?;
    if previous_session_suspected_crash {
        let previous_payload = previous.as_ref().map(|heartbeat| &heartbeat.payload);
        append_diagnostics_event_to_dir(
            &dir,
            &DiagnosticsEventPayload {
                event_type: "previous-renderer-session-suspected-crash".into(),
                message: "Previous renderer session stopped without a clean shutdown marker."
                    .into(),
                document_path: previous_payload.and_then(|payload| payload.document_path.clone()),
                mode: previous_payload.and_then(|payload| payload.mode.clone()),
                markdown_bytes: previous_payload.map(|payload| payload.markdown_bytes),
                component_stack: None,
            },
        )?;
    }
    Ok(RendererHeartbeatStatus {
        previous_session_suspected_crash,
        previous_session_last_seen_ms,
        diagnostics_dir: dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn mark_renderer_clean_shutdown(app: AppHandle, session_id: String) -> Result<(), String> {
    let heartbeat_path = diagnostics_dir(&app)?.join(HEARTBEAT_FILE);
    let Some(mut heartbeat) = read_heartbeat(&heartbeat_path)? else {
        return Ok(());
    };
    if heartbeat.session_id == session_id {
        heartbeat.clean_shutdown = true;
        heartbeat.seen_at_ms = timestamp_ms();
        write_json_atomically(&heartbeat_path, &heartbeat)?;
    }
    Ok(())
}

#[tauri::command]
pub fn append_diagnostics_event(
    app: AppHandle,
    payload: DiagnosticsEventPayload,
) -> Result<(), String> {
    let dir = diagnostics_dir(&app)?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create diagnostics dir: {error}"))?;
    append_diagnostics_event_to_dir(&dir, &payload)
}

#[tauri::command]
pub fn export_diagnostics_bundle(app: AppHandle) -> Result<DiagnosticsBundleMetadata, String> {
    let dir = diagnostics_dir(&app)?;
    export_diagnostics_bundle_to_dir(&dir)
}

#[tauri::command]
pub fn write_recovery_snapshot(
    app: AppHandle,
    payload: RecoverySnapshotPayload,
) -> Result<RecoverySnapshotMetadata, String> {
    let markdown_bytes = payload.markdown.len();
    if markdown_bytes > MAX_RECOVERY_SNAPSHOT_BYTES {
        return Err(format!(
            "Recovery snapshot is too large: {markdown_bytes} bytes exceeds {MAX_RECOVERY_SNAPSHOT_BYTES} bytes."
        ));
    }
    let dir = diagnostics_dir(&app)?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create diagnostics dir: {error}"))?;
    let snapshot = RecoverySnapshot {
        markdown: payload.markdown,
        file_path: payload.file_path,
        updated_at_ms: payload.updated_at_ms,
        markdown_bytes,
    };
    let path = dir.join(RECOVERY_SNAPSHOT_FILE);
    write_json_atomically(&path, &snapshot)?;
    Ok(RecoverySnapshotMetadata {
        updated_at_ms: snapshot.updated_at_ms,
        markdown_bytes,
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn read_recovery_snapshot(app: AppHandle) -> Result<Option<RecoverySnapshot>, String> {
    let path = diagnostics_dir(&app)?.join(RECOVERY_SNAPSHOT_FILE);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read recovery snapshot: {error}"))?;
    let snapshot: RecoverySnapshot = serde_json::from_str(&raw)
        .map_err(|error| format!("Could not parse recovery snapshot: {error}"))?;
    Ok(Some(snapshot))
}

#[tauri::command]
pub fn clear_recovery_snapshot(app: AppHandle) -> Result<(), String> {
    let path = diagnostics_dir(&app)?.join(RECOVERY_SNAPSHOT_FILE);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Could not clear recovery snapshot: {error}")),
    }
}

fn diagnostics_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(root) = std::env::var_os("SCIEMD_APP_DATA_DIR_OVERRIDE") {
        return Ok(PathBuf::from(root).join(DIAGNOSTICS_DIR));
    }
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data dir: {error}"))?;
    Ok(base.join(DIAGNOSTICS_DIR))
}

fn read_heartbeat(path: &Path) -> Result<Option<StoredHeartbeat>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Could not read renderer heartbeat: {error}"))?;
    let heartbeat = serde_json::from_str(&raw)
        .map_err(|error| format!("Could not parse renderer heartbeat: {error}"))?;
    Ok(Some(heartbeat))
}

fn export_diagnostics_bundle_to_dir(dir: &Path) -> Result<DiagnosticsBundleMetadata, String> {
    fs::create_dir_all(dir)
        .map_err(|error| format!("Could not create diagnostics dir: {error}"))?;
    let created_at_ms = timestamp_ms();
    let heartbeat_path = dir.join(HEARTBEAT_FILE);
    let log_path = dir.join(DIAGNOSTICS_LOG_FILE);
    let recovery_path = dir.join(RECOVERY_SNAPSHOT_FILE);
    let heartbeat = read_heartbeat(&heartbeat_path).ok().flatten();
    let diagnostics_log = read_diagnostics_log_bundle(&log_path)?;
    let recovery_snapshot = read_recovery_snapshot_bundle(&recovery_path)?;
    let metadata = DiagnosticsBundleMetadata {
        path: dir
            .join(format!("{DIAGNOSTICS_BUNDLE_PREFIX}-{created_at_ms}.json"))
            .to_string_lossy()
            .to_string(),
        diagnostics_dir: dir.to_string_lossy().to_string(),
        created_at_ms,
        event_count: diagnostics_log.tail_event_count,
        log_bytes: diagnostics_log.bytes,
        recovery_snapshot_bytes: recovery_snapshot
            .as_ref()
            .map(|snapshot| snapshot.markdown_bytes),
        heartbeat_seen_at_ms: heartbeat.as_ref().map(|value| value.seen_at_ms),
    };
    let bundle = DiagnosticsBundle {
        created_at_ms,
        app_version: env!("CARGO_PKG_VERSION"),
        diagnostics_dir: metadata.diagnostics_dir.clone(),
        heartbeat,
        diagnostics_log,
        recovery_snapshot,
    };
    write_json_atomically(Path::new(&metadata.path), &bundle)?;
    Ok(metadata)
}

fn read_diagnostics_log_bundle(path: &Path) -> Result<DiagnosticsLogBundle, String> {
    let (tail, bytes, tail_truncated) = read_text_tail(path, MAX_BUNDLE_LOG_TAIL_BYTES)?;
    let tail_event_count = tail
        .lines()
        .filter(|line| line.trim_start().starts_with('{'))
        .count() as u64;
    Ok(DiagnosticsLogBundle {
        path: path.to_string_lossy().to_string(),
        bytes,
        tail,
        tail_event_count,
        tail_truncated,
    })
}

fn read_recovery_snapshot_bundle(path: &Path) -> Result<Option<RecoverySnapshotBundle>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Could not read recovery snapshot metadata: {error}"))?;
    let snapshot: RecoverySnapshot = serde_json::from_str(&raw)
        .map_err(|error| format!("Could not parse recovery snapshot metadata: {error}"))?;
    Ok(Some(RecoverySnapshotBundle {
        path: path.to_string_lossy().to_string(),
        file_path: snapshot.file_path,
        updated_at_ms: snapshot.updated_at_ms,
        markdown_bytes: snapshot.markdown_bytes,
        markdown_omitted_reason: "Raw Markdown is stored in the recovery snapshot file and omitted from diagnostics bundles to keep bundles small.",
    }))
}

fn read_text_tail(path: &Path, max_bytes: usize) -> Result<(String, u64, bool), String> {
    if !path.exists() {
        return Ok(("".into(), 0, false));
    }
    let bytes =
        fs::read(path).map_err(|error| format!("Could not read diagnostics log: {error}"))?;
    let total_bytes = bytes.len() as u64;
    if bytes.len() <= max_bytes {
        return Ok((
            String::from_utf8_lossy(&bytes).to_string(),
            total_bytes,
            false,
        ));
    }
    let start = bytes.len().saturating_sub(max_bytes);
    let mut tail = String::from_utf8_lossy(&bytes[start..]).to_string();
    if let Some(next_line_index) = tail.find('\n') {
        tail = tail[next_line_index + 1..].to_string();
    }
    Ok((tail, total_bytes, true))
}

fn append_diagnostics_event_to_dir(
    dir: &Path,
    payload: &DiagnosticsEventPayload,
) -> Result<(), String> {
    fs::create_dir_all(dir)
        .map_err(|error| format!("Could not create diagnostics dir: {error}"))?;
    let path = dir.join(DIAGNOSTICS_LOG_FILE);
    rotate_if_too_large(&path)?;
    let event = StoredDiagnosticsEvent {
        timestamp_ms: timestamp_ms(),
        event: payload,
    };
    let mut line = serde_json::to_string(&event)
        .map_err(|error| format!("Could not serialize diagnostics event: {error}"))?;
    line.push('\n');
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("Could not open diagnostics log: {error}"))?;
    file.write_all(line.as_bytes())
        .and_then(|_| file.sync_data())
        .map_err(|error| format!("Could not append diagnostics event: {error}"))
}

fn rotate_if_too_large(path: &Path) -> Result<(), String> {
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(());
    };
    if metadata.len() < MAX_DIAGNOSTICS_LOG_BYTES {
        return Ok(());
    }
    let rotated = path.with_extension("jsonl.old");
    let _ = fs::remove_file(&rotated);
    fs::rename(path, rotated).map_err(|error| format!("Could not rotate diagnostics log: {error}"))
}

fn write_json_atomically<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Diagnostics path has no parent directory.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create diagnostics dir: {error}"))?;
    let temp_path = temp_path_for(path);
    let mut temp = fs::File::create(&temp_path)
        .map_err(|error| format!("Could not create temporary diagnostics file: {error}"))?;
    serde_json::to_writer(&mut temp, value)
        .map_err(|error| format!("Could not serialize diagnostics file: {error}"))?;
    temp.write_all(b"\n")
        .and_then(|_| temp.sync_all())
        .map_err(|error| format!("Could not flush diagnostics file: {error}"))?;
    drop(temp);
    match atomic_replace(&temp_path, path) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            Err(error)
        }
    }
}

fn temp_path_for(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("diagnostics");
    path.with_file_name(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        timestamp_ms()
    ))
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
        Err(format!(
            "Could not replace diagnostics file atomically: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn atomic_replace(temp_path: &Path, target_path: &Path) -> Result<(), String> {
    match fs::rename(temp_path, target_path) {
        Ok(()) => Ok(()),
        Err(error) if error.raw_os_error() == Some(libc::EXDEV) => {
            copy_sync_and_rename(temp_path, target_path)
        }
        Err(error) => Err(format!(
            "Could not replace diagnostics file atomically: {error}"
        )),
    }
}

#[cfg(not(windows))]
fn copy_sync_and_rename(temp_path: &Path, target_path: &Path) -> Result<(), String> {
    let copy_path = temp_path_for(target_path);
    let mut source = fs::File::open(temp_path)
        .map_err(|error| format!("Could not reopen temporary diagnostics file: {error}"))?;
    let mut copy = fs::File::create(&copy_path)
        .map_err(|error| format!("Could not create same-volume diagnostics file: {error}"))?;
    let mut buffer = Vec::new();
    source
        .read_to_end(&mut buffer)
        .and_then(|_| copy.write_all(&buffer))
        .and_then(|_| copy.sync_all())
        .map_err(|error| format!("Could not copy diagnostics file onto target volume: {error}"))?;
    drop(copy);
    fs::rename(&copy_path, target_path)
        .map_err(|error| format!("Could not install same-volume diagnostics file: {error}"))?;
    let _ = fs::remove_file(temp_path);
    Ok(())
}

fn timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(test)]
mod tests {
    use super::{
        append_diagnostics_event_to_dir, export_diagnostics_bundle_to_dir, read_heartbeat,
        write_json_atomically, DiagnosticsEventPayload, RecoverySnapshot, RendererHeartbeatPayload,
        StoredHeartbeat,
    };
    use std::{fs, path::Path};

    #[test]
    fn diagnostics_atomic_json_round_trips() {
        let dir = test_dir("atomic-json");
        let path = dir.join("heartbeat.json");
        let payload = StoredHeartbeat {
            session_id: "session-a".into(),
            seen_at_ms: 1234,
            clean_shutdown: false,
            payload: heartbeat_payload("session-a"),
        };

        write_json_atomically(&path, &payload).unwrap();
        let restored = read_heartbeat(&path).unwrap().unwrap();

        assert_eq!(restored.session_id, "session-a");
        assert_eq!(restored.payload.markdown_bytes, 42);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn diagnostics_log_rotates_when_large() {
        let dir = test_dir("log-rotate");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("diagnostics.jsonl");
        fs::write(
            &path,
            "x".repeat(super::MAX_DIAGNOSTICS_LOG_BYTES as usize + 1),
        )
        .unwrap();

        append_diagnostics_event_to_dir(
            &dir,
            &DiagnosticsEventPayload {
                event_type: "test".into(),
                message: "message".into(),
                document_path: None,
                mode: None,
                markdown_bytes: None,
                component_stack: None,
            },
        )
        .unwrap();

        assert!(path.exists());
        assert!(dir.join("diagnostics.jsonl.old").exists());
        assert!(fs::metadata(path).unwrap().len() < 1024);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn diagnostics_bundle_contains_events_and_recovery_metadata_without_raw_markdown() {
        let dir = test_dir("bundle");
        let heartbeat = StoredHeartbeat {
            session_id: "session-bundle".into(),
            seen_at_ms: 2345,
            clean_shutdown: false,
            payload: heartbeat_payload("session-bundle"),
        };
        write_json_atomically(&dir.join(super::HEARTBEAT_FILE), &heartbeat).unwrap();
        append_diagnostics_event_to_dir(
            &dir,
            &DiagnosticsEventPayload {
                event_type: "save-failed".into(),
                message: "Disk write failed.".into(),
                document_path: Some("C:/lab/paper.md".into()),
                mode: Some("visual".into()),
                markdown_bytes: Some(4096),
                component_stack: None,
            },
        )
        .unwrap();
        write_json_atomically(
            &dir.join(super::RECOVERY_SNAPSHOT_FILE),
            &RecoverySnapshot {
                markdown: "# private draft".into(),
                file_path: Some("C:/lab/paper.md".into()),
                updated_at_ms: 3456,
                markdown_bytes: 15,
            },
        )
        .unwrap();

        let metadata = export_diagnostics_bundle_to_dir(&dir).unwrap();
        let bundle = fs::read_to_string(&metadata.path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&bundle).unwrap();

        assert_eq!(metadata.event_count, 1);
        assert_eq!(metadata.recovery_snapshot_bytes, Some(15));
        assert_eq!(parsed["heartbeat"]["sessionId"], "session-bundle");
        assert!(parsed["diagnosticsLog"]["tail"]
            .as_str()
            .unwrap()
            .contains("save-failed"));
        assert_eq!(parsed["recoverySnapshot"]["markdownBytes"], 15);
        assert!(!bundle.contains("# private draft"));
        let _ = fs::remove_dir_all(dir);
    }

    fn heartbeat_payload(session_id: &str) -> RendererHeartbeatPayload {
        RendererHeartbeatPayload {
            session_id: session_id.into(),
            document_path: Some("C:/lab/paper.md".into()),
            mode: Some("visual".into()),
            markdown_bytes: 42,
            line_count: 3,
            image_count: 1,
            math_count: 2,
            visual_atom_count: 0,
            warning_count: 0,
            error_count: 0,
            active_background_job_count: 1,
            stuck_background_job_count: 0,
            oldest_background_job_ms: Some(250),
            background_job_labels: vec!["Document parser".into()],
            stuck_background_job_labels: vec![],
        }
    }

    fn test_dir(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("scie-md-diagnostics-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[allow(dead_code)]
    fn assert_path_exists(path: &Path) {
        assert!(path.exists(), "expected path to exist: {}", path.display());
    }
}
