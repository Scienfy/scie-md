mod commands;

use std::{
    collections::VecDeque,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

static PENDING_DOCUMENT_OPEN: OnceLock<Mutex<VecDeque<PathBuf>>> = OnceLock::new();
const LAUNCH_DOCUMENT_EXTENSIONS: &[&str] = &[
    "md", "markdown", "json", "jsonl", "ndjson", "yaml", "yml", "toml", "xml", "tsv", "txt",
    "text",
];

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::{Emitter, Manager};

    let builder = tauri::Builder::default()
        .register_uri_scheme_protocol("scie-md-local-image", |_ctx, request| {
            commands::local_image_protocol::serve_local_image_request(request)
        });
    let builder = if std::env::var_os("SCIEMD_DESKTOP_SMOKE_DISABLE_SINGLE_INSTANCE").is_some() {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
                if let Some(path) = document_path_from_args(&argv, &cwd) {
                    queue_document_open(&path);
                    let _ = window.emit(
                        "single-instance-open",
                        commands::path_utils::external_safe_path_string(&path),
                    );
                }
            }
        }))
    };

    builder
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Some(path) = startup_document_path_from_env() {
                queue_document_open(&path);
            }
            if let Some(report_path) = desktop_smoke_report_path() {
                let exit_code =
                    match run_desktop_smoke_self_test(app.handle().clone(), &report_path) {
                        Ok(()) => 0,
                        Err(error) => {
                            let _ = write_desktop_smoke_report(
                                &report_path,
                                &DesktopSmokeReport {
                                    ok: false,
                                    scenario: desktop_smoke_scenario(),
                                    error: Some(error),
                                    ..DesktopSmokeReport::default()
                                },
                            );
                            1
                        }
                    };
                app.handle().exit(exit_code);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            initial_document_path,
            initial_markdown_path,
            peek_pending_document_open,
            peek_pending_markdown_open,
            take_pending_document_open,
            take_pending_markdown_open,
            clear_pending_document_open,
            clear_pending_markdown_open,
            commands::dialogs::pick_markdown_file,
            commands::dialogs::pick_document_file,
            commands::dialogs::pick_json_schema_file,
            commands::dialogs::pick_image_file,
            commands::dialogs::pick_citation_style_file,
            commands::dialogs::pick_folder,
            commands::dialogs::pick_save_path,
            commands::dialogs::pick_html_save_path,
            commands::dialogs::pick_pandoc_export_save_path,
            commands::diagnostics::append_diagnostics_event,
            commands::diagnostics::clear_recovery_snapshot,
            commands::diagnostics::export_diagnostics_bundle,
            commands::diagnostics::mark_renderer_clean_shutdown,
            commands::diagnostics::read_recovery_snapshot,
            commands::diagnostics::record_renderer_heartbeat,
            commands::diagnostics::write_recovery_snapshot,
            commands::path_grants::grant_external_path,
            commands::path_grants::sync_document_image_grants,
            commands::file_io::read_text_file,
            commands::file_io::read_text_file_for_edit,
            commands::file_io::read_text_file_preview,
            commands::file_io::read_binary_file_base64,
            commands::file_io::list_readable_files,
            commands::file_io::stat_file,
            commands::file_io::write_text_file_atomic,
            commands::file_io::write_text_file_create_new,
            commands::file_io::create_generated_sibling_artifact,
            commands::file_io::cleanup_stale_temp_files_for_paths,
            commands::file_watcher::watch_files_for_changes,
            commands::file_watcher::unwatch_files_for_changes,
            commands::assets::copy_image_to_assets,
            commands::assets::save_image_bytes_to_assets,
            commands::backups::create_backup_snapshot,
            commands::backups::list_backups,
            commands::export::check_pandoc_available,
            commands::export::export_with_pandoc,
            commands::export::export_html_with_pandoc,
            commands::export::export_html_to_docx_native,
            commands::export::export_styled_html_to_pdf,
            commands::inkscape::check_inkscape_available,
            commands::inkscape::open_svg_in_inkscape,
            commands::inkscape::stat_inkscape_svg_session,
            commands::inkscape::read_inkscape_svg_session,
            commands::inkscape::cleanup_inkscape_svg_session,
            commands::inkscape::export_svg_with_inkscape,
            commands::reveal::reveal_in_file_manager,
            commands::toml_source_map::inspect_toml_source_map,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ScieMD");
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSmokeReport {
    ok: bool,
    scenario: String,
    initial_path: Option<String>,
    startup_path: Option<String>,
    structured_files: Vec<DesktopStructuredSmokeFileReport>,
    saved_size_bytes: Option<u64>,
    recovery_bytes: Option<usize>,
    recovery_path: Option<String>,
    docx_output_path: Option<String>,
    docx_bytes: Option<u64>,
    pdf_output_path: Option<String>,
    pdf_bytes: Option<u64>,
    pdf_skipped_reason: Option<String>,
    diagnostics_dir: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStructuredSmokeCase {
    format: String,
    path: String,
    expected_contains: String,
    updated_content: String,
    updated_contains: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStructuredSmokeFileReport {
    format: String,
    path: String,
    before_size_bytes: u64,
    after_size_bytes: u64,
    content_hash_changed: bool,
}

fn desktop_smoke_report_path() -> Option<PathBuf> {
    std::env::var_os("SCIEMD_DESKTOP_SMOKE_SELF_TEST")
        .filter(|value| value == "1")
        .and_then(|_| std::env::var_os("SCIEMD_DESKTOP_SMOKE_REPORT"))
        .map(PathBuf::from)
}

fn desktop_smoke_scenario() -> String {
    std::env::var("SCIEMD_DESKTOP_SMOKE_SCENARIO").unwrap_or_else(|_| "unknown".into())
}

fn run_desktop_smoke_self_test(app: tauri::AppHandle, report_path: &Path) -> Result<(), String> {
    let scenario = desktop_smoke_scenario();
    let mut report = DesktopSmokeReport {
        scenario: scenario.clone(),
        initial_path: startup_document_path_from_env()
            .map(|path| commands::path_utils::external_safe_path_string(&path)),
        ..DesktopSmokeReport::default()
    };

    let heartbeat = commands::diagnostics::record_renderer_heartbeat(
        app.clone(),
        commands::diagnostics::RendererHeartbeatPayload {
            session_id: format!("desktop-smoke-{scenario}"),
            document_path: report.initial_path.clone(),
            mode: Some("desktop-smoke".into()),
            markdown_bytes: 0,
            line_count: 0,
            image_count: 0,
            math_count: 0,
            visual_atom_count: 0,
            warning_count: 0,
            error_count: 0,
            active_background_job_count: 0,
            stuck_background_job_count: 0,
            oldest_background_job_ms: None,
            background_job_labels: Vec::new(),
            stuck_background_job_labels: Vec::new(),
        },
    )?;
    report.diagnostics_dir = Some(heartbeat.diagnostics_dir);

    if scenario == "no-file" {
        if report.initial_path.is_some() {
            return Err(format!(
                "Expected no-file startup but found initial path {:?}",
                report.initial_path
            ));
        }
        report.ok = true;
        write_desktop_smoke_report(report_path, &report)?;
        return Ok(());
    }

    if scenario == "structured-file-launch" {
        if report.initial_path.is_none() {
            return Err("Expected structured file launch startup path but found none.".into());
        }
        report.ok = true;
        write_desktop_smoke_report(report_path, &report)?;
        return Ok(());
    }

    if scenario == "structured-manual-open" {
        report.structured_files = run_desktop_structured_smoke_cases()?;
        report.ok = true;
        write_desktop_smoke_report(report_path, &report)?;
        return Ok(());
    }

    let startup_path = std::env::var_os("SCIEMD_DESKTOP_SMOKE_STARTUP_PATH")
        .map(PathBuf::from)
        .or_else(startup_document_path_from_env)
        .ok_or_else(|| "Desktop smoke startup path was not provided.".to_string())?;
    report.startup_path = Some(commands::path_utils::external_safe_path_string(
        &startup_path,
    ));

    commands::path_grants::grant_file_and_parent(&startup_path)?;
    let opened =
        commands::file_io::read_text_file_for_edit(startup_path.to_string_lossy().to_string())?;
    if !opened.content.contains("ScieMD Desktop Smoke") {
        return Err("Packaged app could not read the startup Markdown document.".into());
    }

    let saved_markdown = format!(
        "{}\n\nSaved by packaged desktop smoke.\n",
        opened.content.trim_end()
    );
    let saved_metadata = commands::file_io::write_text_file_atomic(
        startup_path.to_string_lossy().to_string(),
        saved_markdown,
        opened.metadata.line_ending,
        opened.metadata.encoding,
        opened.metadata.has_bom,
        Some(opened.metadata.last_known_mtime_ms),
        Some(opened.metadata.last_known_size_bytes),
        opened.metadata.content_hash,
    )?;
    report.saved_size_bytes = Some(saved_metadata.last_known_size_bytes);

    let reread =
        commands::file_io::read_text_file_for_edit(startup_path.to_string_lossy().to_string())?;
    if !reread.content.contains("Saved by packaged desktop smoke.") {
        return Err("Atomic save did not persist the smoke edit.".into());
    }

    let recovery_markdown = "# Recovery Smoke\n\nNative recovery snapshot round-trip.\n";
    let recovery = commands::diagnostics::write_recovery_snapshot(
        app.clone(),
        commands::diagnostics::RecoverySnapshotPayload {
            schema_version: Some(2),
            markdown: recovery_markdown.into(),
            file_path: report.startup_path.clone(),
            format: Some("markdown".into()),
            updated_at_ms: timestamp_ms(),
        },
    )?;
    let restored = commands::diagnostics::read_recovery_snapshot(app.clone(), report.startup_path.clone(), Some(false))?
        .ok_or_else(|| "Native recovery snapshot was not restored.".to_string())?;
    if restored.markdown != recovery_markdown || restored.file_path != report.startup_path {
        return Err("Native recovery snapshot did not round-trip.".into());
    }
    commands::diagnostics::clear_recovery_snapshot(app.clone(), report.startup_path.clone(), Some(false))?;
    if commands::diagnostics::read_recovery_snapshot(app.clone(), report.startup_path.clone(), Some(false))?.is_some() {
        return Err("Native recovery snapshot was not cleared.".into());
    }
    report.recovery_bytes = Some(recovery.markdown_bytes);
    report.recovery_path = Some(recovery.path);

    let export_path = std::env::var_os("SCIEMD_DESKTOP_SMOKE_EXPORT_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| startup_path.with_file_name("desktop-smoke-export.docx"));
    let html = "<!doctype html><html><head><meta charset=\"utf-8\"><title>ScieMD Desktop Smoke Export</title></head><body><h1>ScieMD Desktop Smoke Export</h1><p>Packaged export command validation.</p></body></html>";
    commands::path_grants::grant_file(&export_path)?;
    let docx_export = commands::export::export_html_to_docx_native(
        html.into(),
        export_path.to_string_lossy().to_string(),
    )?;
    let docx_metadata = fs::metadata(&docx_export.output_path)
        .map_err(|error| format!("Could not stat DOCX smoke export: {error}"))?;
    report.docx_output_path = Some(docx_export.output_path);
    report.docx_bytes = Some(docx_metadata.len());

    let pdf_path = export_path.with_extension("pdf");
    commands::path_grants::grant_file(&pdf_path)?;
    match commands::export::export_styled_html_to_pdf(
        html.into(),
        pdf_path.to_string_lossy().to_string(),
    ) {
        Ok(pdf_export) => {
            let pdf_metadata = fs::metadata(&pdf_export.output_path)
                .map_err(|error| format!("Could not stat PDF smoke export: {error}"))?;
            report.pdf_output_path = Some(pdf_export.output_path);
            report.pdf_bytes = Some(pdf_metadata.len());
        }
        Err(error) => {
            report.pdf_skipped_reason = Some(error);
        }
    }

    report.ok = true;
    write_desktop_smoke_report(report_path, &report)
}

fn run_desktop_structured_smoke_cases() -> Result<Vec<DesktopStructuredSmokeFileReport>, String> {
    let manifest_path = std::env::var_os("SCIEMD_DESKTOP_SMOKE_STRUCTURED_MANIFEST")
        .map(PathBuf::from)
        .ok_or_else(|| "Desktop structured smoke manifest was not provided.".to_string())?;
    let manifest_raw = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("Could not read desktop structured smoke manifest: {error}"))?;
    let cases: Vec<DesktopStructuredSmokeCase> = serde_json::from_str(&manifest_raw)
        .map_err(|error| format!("Could not parse desktop structured smoke manifest: {error}"))?;
    if cases.is_empty() {
        return Err("Desktop structured smoke manifest did not include any files.".into());
    }

    let mut reports = Vec::with_capacity(cases.len());
    for case in cases {
        let path = PathBuf::from(&case.path);
        commands::path_grants::grant_file_and_parent(&path)?;
        let opened = commands::file_io::read_text_file_for_edit(case.path.clone())?;
        if !opened.content.contains(&case.expected_contains) {
            return Err(format!(
                "Packaged app could not read expected {} structured smoke marker in {}.",
                case.format, case.path
            ));
        }

        let saved_metadata = commands::file_io::write_text_file_atomic(
            case.path.clone(),
            case.updated_content,
            opened.metadata.line_ending,
            opened.metadata.encoding,
            opened.metadata.has_bom,
            Some(opened.metadata.last_known_mtime_ms),
            Some(opened.metadata.last_known_size_bytes),
            opened.metadata.content_hash.clone(),
        )?;
        let reread = commands::file_io::read_text_file_for_edit(case.path.clone())?;
        if !reread.content.contains(&case.updated_contains) {
            return Err(format!(
                "Atomic save did not persist the {} structured smoke edit in {}.",
                case.format, case.path
            ));
        }

        reports.push(DesktopStructuredSmokeFileReport {
            format: case.format,
            path: commands::path_utils::external_safe_path_string(&path),
            before_size_bytes: opened.metadata.last_known_size_bytes,
            after_size_bytes: saved_metadata.last_known_size_bytes,
            content_hash_changed: opened.metadata.content_hash != reread.metadata.content_hash,
        });
    }

    Ok(reports)
}

fn write_desktop_smoke_report(path: &Path, report: &DesktopSmokeReport) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create desktop smoke report directory: {error}"))?;
    }
    let raw = serde_json::to_string_pretty(report)
        .map_err(|error| format!("Could not serialize desktop smoke report: {error}"))?;
    fs::write(path, raw).map_err(|error| format!("Could not write desktop smoke report: {error}"))
}

fn timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[tauri::command]
fn initial_document_path() -> Option<String> {
    initial_document_path_value()
}

#[tauri::command]
fn initial_markdown_path() -> Option<String> {
    initial_document_path_value()
}

fn initial_document_path_value() -> Option<String> {
    let path = peek_pending_document_open_path().or_else(startup_document_path_from_env)?;
    grant_document_launch_path(&path)
}

#[tauri::command]
fn peek_pending_document_open() -> Option<String> {
    peek_pending_document_open_value()
}

#[tauri::command]
fn peek_pending_markdown_open() -> Option<String> {
    peek_pending_document_open_value()
}

fn peek_pending_document_open_value() -> Option<String> {
    let path = peek_pending_document_open_path()?;
    grant_document_launch_path(&path)
}

#[tauri::command]
fn take_pending_document_open() -> Option<String> {
    take_pending_document_open_value()
}

#[tauri::command]
fn take_pending_markdown_open() -> Option<String> {
    take_pending_document_open_value()
}

fn take_pending_document_open_value() -> Option<String> {
    let path = take_pending_document_open_path()?;
    grant_document_launch_path(&path)
}

#[tauri::command]
fn clear_pending_document_open(path: String) {
    clear_pending_document_open_value(path);
}

#[tauri::command]
fn clear_pending_markdown_open(path: String) {
    clear_pending_document_open_value(path);
}

fn clear_pending_document_open_value(path: String) {
    let requested = commands::path_utils::external_safe_path_string(&PathBuf::from(path));
    let Ok(mut pending) = pending_document_open_slot().lock() else {
        return;
    };
    pending.retain(|value| commands::path_utils::external_safe_path_string(value) != requested);
}

fn grant_document_launch_path(path: &Path) -> Option<String> {
    let _ = commands::path_grants::grant_file_and_parent(path);
    Some(commands::path_utils::external_safe_path_string(path))
}

fn document_path_from_args(argv: &[String], cwd: &str) -> Option<PathBuf> {
    let cwd = Path::new(cwd);
    argv.iter()
        .flat_map(|arg| candidate_paths_from_launch_arg(arg))
        .filter_map(|path| resolve_supported_document_launch_path(path, cwd))
        .find(|path| path.is_file())
        .or_else(|| document_path_from_joined_args(argv, cwd))
}

fn startup_document_path_from_env() -> Option<PathBuf> {
    let args: Vec<OsString> = std::env::args_os().collect();
    let cwd = std::env::current_dir().ok()?;
    document_path_from_os_args(&args, &cwd)
}

fn document_path_from_os_args(argv: &[OsString], cwd: &Path) -> Option<PathBuf> {
    argv.iter()
        .flat_map(candidate_paths_from_launch_os_arg)
        .filter_map(|path| resolve_supported_document_launch_path(path, cwd))
        .find(|path| path.is_file())
        .or_else(|| {
            let argv: Vec<String> = argv
                .iter()
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect();
            document_path_from_joined_args(&argv, cwd)
        })
}

fn document_path_from_joined_args(argv: &[String], cwd: &Path) -> Option<PathBuf> {
    if argv.len() < 3 {
        return None;
    }
    for start in 1..argv.len() {
        for end in (start + 1)..=argv.len() {
            let joined = argv[start..end].join(" ");
            if let Some(path) = candidate_paths_from_launch_arg(&joined)
                .into_iter()
                .filter_map(|path| resolve_supported_document_launch_path(path, cwd))
                .find(|path| path.is_file())
            {
                return Some(path);
            }
        }
    }
    None
}

fn candidate_paths_from_launch_os_arg(arg: &OsString) -> Vec<PathBuf> {
    let raw = arg.to_string_lossy();
    let mut candidates = if raw.trim().starts_with("file://") {
        candidate_paths_from_launch_arg(raw.as_ref())
    } else {
        vec![PathBuf::from(arg)]
    };
    for candidate in candidate_paths_from_launch_arg(raw.as_ref()) {
        if !candidates.iter().any(|existing| existing == &candidate) {
            candidates.push(candidate);
        }
    }
    candidates
}

fn resolve_supported_document_launch_path(path: PathBuf, cwd: &Path) -> Option<PathBuf> {
    if !is_supported_document_path(&path) {
        return None;
    }
    Some(if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    })
}

fn candidate_paths_from_launch_arg(arg: &str) -> Vec<PathBuf> {
    let trimmed = arg.trim();
    let mut candidates = vec![path_from_launch_arg(trimmed)];
    for token in split_launch_arg_tokens(trimmed) {
        if token != trimmed {
            candidates.push(path_from_launch_arg(&token));
        }
    }
    candidates
}

fn path_from_launch_arg(arg: &str) -> PathBuf {
    let trimmed = arg.trim().trim_matches('"').trim_matches('\'');
    if let Some(file_url) = trimmed.strip_prefix("file://") {
        return PathBuf::from(decode_file_url_path(file_url));
    }
    PathBuf::from(trimmed)
}

fn split_launch_arg_tokens(value: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;

    for character in value.chars() {
        if quote == Some(character) {
            quote = None;
            continue;
        }
        if quote.is_none() && (character == '"' || character == '\'') {
            quote = Some(character);
            continue;
        }
        if quote.is_none() && character.is_whitespace() {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
            continue;
        }
        current.push(character);
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn decode_file_url_path(value: &str) -> String {
    let decoded = decode_percent_escapes(value);
    if !cfg!(windows) {
        return decoded;
    }

    let without_windows_drive_slash =
        if decoded.len() >= 3 && decoded.as_bytes()[0] == b'/' && decoded.as_bytes()[2] == b':' {
            decoded[1..].replace('/', "\\")
        } else if decoded.to_ascii_lowercase().starts_with("localhost/") {
            decoded["localhost/".len()..].replace('/', "\\")
        } else if decoded.starts_with("//") {
            decoded.replace('/', "\\")
        } else if !is_windows_drive_url_path(&decoded)
            && !decoded.starts_with('/')
            && decoded.split('/').count() >= 2
        {
            format!("\\\\{}", decoded.replace('/', "\\"))
        } else {
            decoded.replace('/', "\\")
        };
    without_windows_drive_slash
}

fn is_windows_drive_url_path(value: &str) -> bool {
    value.len() >= 2 && value.as_bytes()[1] == b':' && value.as_bytes()[0].is_ascii_alphabetic()
}

fn decode_percent_escapes(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) =
                (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
            {
                decoded.push((high << 4) | low);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn is_supported_document_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            let normalized = extension.to_ascii_lowercase();
            LAUNCH_DOCUMENT_EXTENSIONS.contains(&normalized.as_str())
        })
        .unwrap_or(false)
}

fn pending_document_open_slot() -> &'static Mutex<VecDeque<PathBuf>> {
    PENDING_DOCUMENT_OPEN.get_or_init(|| Mutex::new(VecDeque::new()))
}

fn queue_document_open(path: &Path) {
    let _ = commands::path_grants::grant_file_and_parent(path);
    set_pending_document_open(path);
}

fn set_pending_document_open(path: &Path) {
    if let Ok(mut pending) = pending_document_open_slot().lock() {
        let next = commands::path_utils::external_safe_path_string(path);
        pending.retain(|value| commands::path_utils::external_safe_path_string(value) != next);
        pending.push_back(path.to_path_buf());
    }
}

fn peek_pending_document_open_path() -> Option<PathBuf> {
    pending_document_open_slot().lock().ok()?.front().cloned()
}

fn take_pending_document_open_path() -> Option<PathBuf> {
    pending_document_open_slot().lock().ok()?.pop_front()
}

#[cfg(test)]
mod tests {
    use super::{
        document_path_from_args, document_path_from_os_args, path_from_launch_arg,
        split_launch_arg_tokens,
    };
    use std::ffi::OsString;
    use std::fs;

    #[test]
    fn finds_markdown_file_from_second_instance_args() {
        let directory = std::env::temp_dir().join(format!(
            "scie-md-single-instance-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("paper.md");
        fs::write(&file, "# Paper\n").unwrap();

        let cwd = directory.to_string_lossy();
        let found = document_path_from_args(&["sciemd".into(), "paper.md".into()], cwd.as_ref());

        assert_eq!(found, Some(file));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn finds_plain_text_file_from_second_instance_args() {
        let directory = std::env::temp_dir().join(format!(
            "scie-md-single-instance-text-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("paper.txt");
        fs::write(&file, "# Paper\n").unwrap();

        let cwd = directory.to_string_lossy();
        let found = document_path_from_args(&["sciemd".into(), "paper.txt".into()], cwd.as_ref());

        assert_eq!(found, Some(file));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn finds_structured_files_from_second_instance_args() {
        let directory = std::env::temp_dir().join(format!(
            "scie-md-single-instance-structured-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let files = [
            ("results.json", "{}"),
            ("records.jsonl", "{\"id\":1}\n"),
            ("records.ndjson", "{\"id\":2}\n"),
            ("config.yaml", "title: A\n"),
            ("config.yml", "title: B\n"),
            ("settings.toml", "title = \"A\"\n"),
            ("metadata.xml", "<root/>\n"),
            ("table.tsv", "a\tb\n1\t2\n"),
            ("notes.text", "plain text\n"),
        ];
        let cwd = directory.to_string_lossy();

        for (name, content) in files {
            let file = directory.join(name);
            fs::write(&file, content).unwrap();
            let found = document_path_from_args(&["sciemd".into(), name.into()], cwd.as_ref());

            assert_eq!(found, Some(file), "{name} should be a launch/open-with document");
        }

        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn finds_structured_files_from_os_startup_args() {
        let directory = std::env::temp_dir().join(format!(
            "scie-md-os-startup-structured-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let files = [
            ("startup.json", "{}"),
            ("startup.jsonl", "{\"id\":1}\n"),
            ("startup.ndjson", "{\"id\":2}\n"),
            ("startup.yaml", "title: A\n"),
            ("startup.yml", "title: B\n"),
            ("startup.toml", "title = \"A\"\n"),
            ("startup.xml", "<root/>\n"),
            ("startup.tsv", "a\tb\n1\t2\n"),
            ("startup.txt", "plain text\n"),
        ];

        for (name, content) in files {
            let file = directory.join(name);
            fs::write(&file, content).unwrap();
            let found = document_path_from_os_args(
                &[OsString::from("sciemd"), file.clone().into_os_string()],
                &std::env::temp_dir(),
            );

            assert_eq!(found, Some(file), "{name} should be an OS startup document");
        }

        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn ignores_csv_from_startup_and_open_with_launch_args() {
        let directory = std::env::temp_dir().join(format!(
            "scie-md-single-instance-csv-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("table.csv");
        fs::write(&file, "a,b\n1,2\n").unwrap();

        let cwd = directory.to_string_lossy();
        let from_second_instance =
            document_path_from_args(&["sciemd".into(), "table.csv".into()], cwd.as_ref());
        let from_os_startup = document_path_from_os_args(
            &[OsString::from("sciemd"), file.clone().into_os_string()],
            &std::env::temp_dir(),
        );

        assert_eq!(from_second_instance, None);
        assert_eq!(from_os_startup, None);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn finds_absolute_markdown_file_from_startup_args() {
        let directory = std::env::temp_dir().join(format!(
            "scie-md-startup-instance-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("startup-paper.markdown");
        fs::write(&file, "# Startup Paper\n").unwrap();

        let cwd = std::env::temp_dir();
        let found = document_path_from_args(
            &["sciemd".into(), file.to_string_lossy().to_string()],
            cwd.to_string_lossy().as_ref(),
        );

        assert_eq!(found, Some(file));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn finds_markdown_file_from_os_startup_args() {
        let directory = std::env::temp_dir().join(format!(
            "scie-md-os-startup-instance-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("startup paper.md");
        fs::write(&file, "# OS Startup Paper\n").unwrap();

        let found = document_path_from_os_args(
            &[OsString::from("sciemd"), file.clone().into_os_string()],
            &std::env::temp_dir(),
        );

        assert_eq!(found, Some(file));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn reconstructs_unquoted_split_markdown_path_from_startup_args() {
        let directory = std::env::temp_dir().join(format!(
            "scie md split startup instance test {}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("startup paper.md");
        fs::write(&file, "# Split Startup Paper\n").unwrap();

        let mut argv = vec!["sciemd".to_string()];
        argv.extend(
            file.to_string_lossy()
                .split_whitespace()
                .map(str::to_string),
        );
        let found = document_path_from_args(&argv, std::env::temp_dir().to_string_lossy().as_ref());

        assert_eq!(found, Some(file));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn reconstructs_unquoted_split_markdown_path_from_os_startup_args() {
        let directory = std::env::temp_dir().join(format!(
            "scie md split os startup instance test {}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("startup paper.md");
        fs::write(&file, "# Split OS Startup Paper\n").unwrap();

        let mut argv = vec![OsString::from("sciemd")];
        argv.extend(
            file.to_string_lossy()
                .split_whitespace()
                .map(OsString::from),
        );
        let found = document_path_from_os_args(&argv, &std::env::temp_dir());

        assert_eq!(found, Some(file));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn finds_quoted_markdown_file_from_launch_args() {
        let directory =
            std::env::temp_dir().join(format!("scie-md-quoted-launch-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("quoted paper.md");
        fs::write(&file, "# Quoted Paper\n").unwrap();

        let cwd = std::env::temp_dir();
        let found = document_path_from_args(
            &["sciemd".into(), format!("\"{}\"", file.to_string_lossy())],
            cwd.to_string_lossy().as_ref(),
        );

        assert_eq!(found, Some(file));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn finds_file_url_markdown_file_from_launch_args() {
        let directory = std::env::temp_dir().join(format!(
            "scie-md-file-url-launch-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("url paper.md");
        fs::write(&file, "# URL Paper\n").unwrap();

        let cwd = std::env::temp_dir();
        let file_url = format!(
            "file://{}",
            file.to_string_lossy()
                .replace('\\', "/")
                .replace(' ', "%20")
        );
        let found =
            document_path_from_args(&["sciemd".into(), file_url], cwd.to_string_lossy().as_ref());

        assert_eq!(found, Some(file));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn finds_markdown_file_embedded_in_quoted_command_line_blob() {
        let directory = std::env::temp_dir().join(format!(
            "scie-md-command-line-blob-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("command line paper.md");
        fs::write(&file, "# Command Line Paper\n").unwrap();

        let cwd = std::env::temp_dir();
        let command_line = format!(
            "\"C:\\Program Files\\ScieMD\\ScieMD.exe\" \"{}\"",
            file.to_string_lossy()
        );
        let found = document_path_from_args(
            &["sciemd".into(), command_line],
            cwd.to_string_lossy().as_ref(),
        );

        assert_eq!(found, Some(file));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn split_launch_arg_tokens_preserves_spaces_inside_quotes() {
        assert_eq!(
            split_launch_arg_tokens(
                "\"C:\\Program Files\\ScieMD\\ScieMD.exe\" \"C:\\Lab Notes\\paper.md\""
            ),
            vec![
                "C:\\Program Files\\ScieMD\\ScieMD.exe".to_string(),
                "C:\\Lab Notes\\paper.md".to_string(),
            ]
        );
    }

    #[cfg(windows)]
    #[test]
    fn decodes_unc_file_url_launch_args() {
        let path = path_from_launch_arg("file://server/share/url%20paper.md");

        assert_eq!(path.to_string_lossy(), r"\\server\share\url paper.md");
    }

    #[cfg(windows)]
    #[test]
    fn decodes_localhost_file_url_launch_args_as_local_paths() {
        let path = path_from_launch_arg("file://localhost/C:/Lab/url%20paper.md");

        assert_eq!(path.to_string_lossy(), r"C:\Lab\url paper.md");
    }
}
