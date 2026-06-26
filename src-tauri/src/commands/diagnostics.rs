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
const MAX_DIAGNOSTICS_LOG_BYTES: u64 = 2 * 1024 * 1024;
const MAX_RECOVERY_SNAPSHOT_BYTES: usize = 64 * 1024 * 1024;
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
    pub active_background_job_count: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererHeartbeatStatus {
    pub previous_session_suspected_crash: bool,
    pub previous_session_last_seen_ms: Option<u128>,
    pub diagnostics_dir: String,
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
        append_diagnostics_event_to_dir, read_heartbeat, write_json_atomically,
        DiagnosticsEventPayload, RendererHeartbeatPayload, StoredHeartbeat,
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
