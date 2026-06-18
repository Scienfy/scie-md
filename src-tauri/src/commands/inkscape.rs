use parking_lot::{Mutex, MutexGuard};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        OnceLock,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use super::{
    path_grants::{assert_file_read_allowed, assert_file_write_allowed},
    process::{output_quiet, spawn_quiet, terminate_child_tree},
};

static SVG_SESSION_COUNTER: AtomicU64 = AtomicU64::new(0);
static SVG_SESSIONS: OnceLock<Mutex<HashMap<String, SvgSession>>> = OnceLock::new();
const MAX_SVG_SESSIONS: usize = 64;
const SVG_SESSION_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

#[derive(Debug, Clone)]
struct SvgSession {
    path: PathBuf,
    opened_modified_ms: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InkscapeInfo {
    pub path: String,
    pub version: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InkscapeSessionResponse {
    pub session_id: String,
    pub temp_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SvgExportResponse {
    pub output_path: String,
    pub format: String,
    pub cached: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InkscapeSessionStatus {
    pub session_id: String,
    pub temp_path: String,
    pub modified_ms: u64,
    pub changed: bool,
}

#[tauri::command]
pub fn check_inkscape_available(custom_path: Option<String>) -> Result<InkscapeInfo, String> {
    let path = resolve_inkscape_executable(custom_path.as_deref())?;
    let version = inkscape_version(&path)?;
    Ok(InkscapeInfo {
        path: path.to_string_lossy().to_string(),
        version,
    })
}

#[tauri::command]
pub fn open_svg_in_inkscape(
    svg_source: String,
    document_path: Option<String>,
    custom_path: Option<String>,
) -> Result<InkscapeSessionResponse, String> {
    validate_svg_source(&svg_source)?;
    if let Some(path) = document_path.as_deref() {
        let document = PathBuf::from(path);
        if document.exists() {
            assert_file_read_allowed(&document)?;
        }
    }

    let directory = svg_session_directory(document_path.as_deref())?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not prepare SVG session directory: {error}"))?;
    cleanup_stale_svg_session_files(&directory, Duration::from_secs(7 * 24 * 60 * 60));
    let session_id = next_session_id();
    let temp_path = directory.join(format!("svg-{session_id}.svg"));
    write_text_file(&temp_path, &svg_source, "SVG session")?;
    let opened_modified_ms = file_modified_ms(&temp_path).unwrap_or(0);

    let inkscape = resolve_inkscape_executable(custom_path.as_deref())?;
    let mut command = Command::new(&inkscape);
    command
        .arg(&temp_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = spawn_quiet(&mut command)
        .map_err(|error| format!("Could not open SVG in Inkscape: {error}"))?;
    thread::spawn(move || {
        let _ = child.wait();
    });

    let mut sessions = sessions()?;
    prune_svg_sessions(&mut sessions, SVG_SESSION_MAX_AGE);
    sessions.insert(
        session_id.clone(),
        SvgSession {
            path: temp_path.clone(),
            opened_modified_ms,
        },
    );
    limit_svg_sessions(&mut sessions, MAX_SVG_SESSIONS);
    Ok(InkscapeSessionResponse {
        session_id,
        temp_path: temp_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn stat_inkscape_svg_session(session_id: String) -> Result<InkscapeSessionStatus, String> {
    let session = sessions()?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "SVG editing session was not found.".to_string())?;
    let modified_ms = file_modified_ms(&session.path)?;
    Ok(InkscapeSessionStatus {
        session_id,
        temp_path: session.path.to_string_lossy().to_string(),
        modified_ms,
        changed: modified_ms > session.opened_modified_ms,
    })
}

#[tauri::command]
pub fn read_inkscape_svg_session(session_id: String) -> Result<String, String> {
    let session = sessions()?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "SVG editing session was not found.".to_string())?;
    let svg = fs::read_to_string(&session.path)
        .map_err(|error| format!("Could not read edited SVG: {error}"))?;
    validate_svg_source(&svg)?;
    Ok(svg)
}

#[tauri::command]
pub fn cleanup_inkscape_svg_session(session_id: String) -> Result<(), String> {
    let session = sessions()?.remove(&session_id);
    if let Some(session) = session {
        match fs::remove_file(&session.path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Could not remove SVG session file: {error}")),
        }
    }
    Ok(())
}

#[tauri::command]
pub fn export_svg_with_inkscape(
    svg_source: String,
    document_path: String,
    format: String,
    custom_path: Option<String>,
) -> Result<SvgExportResponse, String> {
    validate_svg_source(&svg_source)?;
    let target = svg_export_format(&format)?;
    let document = PathBuf::from(document_path);
    if document.exists() {
        assert_file_read_allowed(&document)?;
    }
    let parent = document
        .parent()
        .ok_or_else(|| "Save the Markdown document before exporting SVG assets.".to_string())?;
    let output_dir = parent.join("assets").join("generated");
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Could not prepare generated asset directory: {error}"))?;

    let digest = stable_hash(&svg_source, target);
    let input_path = output_dir.join(format!(".svg-{digest}.svg"));
    let output_path = output_dir.join(format!("svg-{digest}.{target}"));
    assert_file_write_allowed(&input_path)?;
    assert_file_write_allowed(&output_path)?;
    if output_path.is_file() {
        return Ok(SvgExportResponse {
            output_path: output_path.to_string_lossy().to_string(),
            format: target.to_string(),
            cached: true,
        });
    }

    write_text_file(&input_path, &svg_source, "SVG export input")?;
    let inkscape = resolve_inkscape_executable(custom_path.as_deref())?;
    run_inkscape_export(&inkscape, &input_path, &output_path, target)?;
    Ok(SvgExportResponse {
        output_path: output_path.to_string_lossy().to_string(),
        format: target.to_string(),
        cached: false,
    })
}

fn sessions() -> Result<MutexGuard<'static, HashMap<String, SvgSession>>, String> {
    Ok(SVG_SESSIONS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock())
}

fn prune_svg_sessions(sessions: &mut HashMap<String, SvgSession>, max_age: Duration) {
    let now = SystemTime::now();
    sessions.retain(|_, session| {
        let Ok(metadata) = fs::metadata(&session.path) else {
            return false;
        };
        let Ok(modified) = metadata.modified() else {
            return false;
        };
        now.duration_since(modified).unwrap_or_default() < max_age
    });
}

fn limit_svg_sessions(sessions: &mut HashMap<String, SvgSession>, limit: usize) {
    if sessions.len() <= limit {
        return;
    }
    let mut ranked: Vec<(String, u64)> = sessions
        .iter()
        .map(|(id, session)| (id.clone(), session.opened_modified_ms))
        .collect();
    ranked.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    let keep: std::collections::HashSet<String> = ranked
        .into_iter()
        .take(limit)
        .map(|entry| entry.0)
        .collect();
    sessions.retain(|id, session| {
        let keep_session = keep.contains(id);
        if !keep_session {
            let _ = fs::remove_file(&session.path);
        }
        keep_session
    });
}

fn resolve_inkscape_executable(custom_path: Option<&str>) -> Result<PathBuf, String> {
    if let Some(path) = custom_path.map(str::trim).filter(|path| !path.is_empty()) {
        let candidate = PathBuf::from(path);
        if candidate.is_absolute() && candidate.is_file() && looks_like_inkscape(&candidate) {
            return Ok(candidate);
        }
    }

    for candidate in common_inkscape_paths() {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    resolve_inkscape_from_path().ok_or_else(|| {
        "Inkscape was not found. Install Inkscape or set the Inkscape path in ScieMD settings."
            .to_string()
    })
}

fn common_inkscape_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    #[cfg(windows)]
    {
        for root in [
            std::env::var_os("ProgramFiles"),
            std::env::var_os("ProgramFiles(x86)"),
            std::env::var_os("LOCALAPPDATA")
                .map(|path| PathBuf::from(path).join("Programs").into_os_string()),
        ]
        .into_iter()
        .flatten()
        {
            let root = PathBuf::from(root);
            candidates.push(root.join("Inkscape").join("bin").join("inkscape.exe"));
            candidates.push(root.join("Inkscape").join("inkscape.exe"));
        }
        if let Some(root) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(
                PathBuf::from(root)
                    .join("Microsoft")
                    .join("WindowsApps")
                    .join("inkscape.exe"),
            );
        }
    }
    #[cfg(not(windows))]
    {
        candidates.push(PathBuf::from("/usr/bin/inkscape"));
        candidates.push(PathBuf::from("/usr/local/bin/inkscape"));
        candidates.push(PathBuf::from("/snap/bin/inkscape"));
        candidates.push(PathBuf::from(
            "/var/lib/flatpak/exports/bin/org.inkscape.Inkscape",
        ));
        candidates.push(PathBuf::from("/var/lib/snapd/snap/bin/inkscape"));
        if let Some(home) = std::env::var_os("HOME") {
            candidates.push(
                PathBuf::from(&home).join(".local/share/flatpak/exports/bin/org.inkscape.Inkscape"),
            );
            candidates.push(
                PathBuf::from(&home)
                    .join("Applications")
                    .join("Inkscape.AppImage"),
            );
            candidates.push(
                PathBuf::from(&home)
                    .join("Downloads")
                    .join("Inkscape.AppImage"),
            );
        }
        candidates.push(PathBuf::from("/opt/homebrew/bin/inkscape"));
        candidates.push(PathBuf::from("/opt/local/bin/inkscape"));
        candidates.push(PathBuf::from(
            "/Applications/Inkscape.app/Contents/MacOS/inkscape",
        ));
    }
    candidates
}

fn resolve_inkscape_from_path() -> Option<PathBuf> {
    #[cfg(windows)]
    let mut command = Command::new("where.exe");
    command
        .arg("inkscape")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let output = output_quiet(&mut command).ok()?;

    #[cfg(not(windows))]
    let output = {
        let mut command = Command::new("which");
        command
            .arg("inkscape")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        output_quiet(&mut command).ok()?
    };

    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .map(PathBuf::from)
        .find(|candidate| {
            candidate.is_absolute() && candidate.is_file() && looks_like_inkscape(candidate)
        })
}

fn looks_like_inkscape(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    name == "inkscape"
        || name == "inkscape.exe"
        || (name.ends_with(".appimage") && name.contains("inkscape"))
}

fn inkscape_version(path: &Path) -> Result<String, String> {
    let mut command = Command::new(path);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output =
        output_quiet(&mut command).map_err(|error| format!("Could not run Inkscape: {error}"))?;
    if !output.status.success() {
        return Err("Inkscape did not respond to --version.".to_string());
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(if version.is_empty() {
        "Inkscape".to_string()
    } else {
        version
    })
}

fn run_inkscape_export(
    inkscape_path: &Path,
    input_path: &Path,
    output_path: &Path,
    format: &'static str,
) -> Result<(), String> {
    let version = inkscape_version(inkscape_path).unwrap_or_else(|_| "Inkscape".to_string());
    let mut command = Command::new(inkscape_path);
    command.arg(input_path);
    append_inkscape_export_args(&mut command, output_path, format, &version);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = spawn_quiet(&mut command)
        .map_err(|error| format!("Could not run Inkscape export: {error}"))?;

    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if Instant::now() >= deadline {
                    terminate_child_tree(&mut child);
                    return Err("Inkscape export timed out after 120 seconds.".to_string());
                }
                thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(format!("Could not monitor Inkscape export: {error}")),
        }
    }

    let status = child
        .wait()
        .map_err(|error| format!("Could not collect Inkscape export status: {error}"))?;
    if !status.success() {
        return Err(format!("Inkscape export failed with status {status}."));
    }
    if !output_path.is_file() {
        return Err("Inkscape export finished but no output file was created.".to_string());
    }
    Ok(())
}

fn append_inkscape_export_args(
    command: &mut Command,
    output_path: &Path,
    format: &'static str,
    version: &str,
) {
    if uses_legacy_inkscape_cli(version) {
        match format {
            "pdf" => {
                command.arg(format!("--export-pdf={}", output_path.to_string_lossy()));
            }
            "png" => {
                command.arg(format!("--export-png={}", output_path.to_string_lossy()));
            }
            _ => {
                command.arg(format!(
                    "--export-filename={}",
                    output_path.to_string_lossy()
                ));
            }
        }
        return;
    }
    command.arg(format!("--export-type={format}")).arg(format!(
        "--export-filename={}",
        output_path.to_string_lossy()
    ));
}

fn uses_legacy_inkscape_cli(version: &str) -> bool {
    let Some(captures) = regex::Regex::new(r"(?i)inkscape\s+(\d+)\.(\d+)")
        .ok()
        .and_then(|pattern| pattern.captures(version))
    else {
        return false;
    };
    let major = captures
        .get(1)
        .and_then(|value| value.as_str().parse::<u32>().ok())
        .unwrap_or(1);
    major == 0
}

fn svg_session_directory(document_path: Option<&str>) -> Result<PathBuf, String> {
    if let Some(path) = document_path {
        if let Some(parent) = Path::new(path).parent() {
            return Ok(parent.join(".scie-md-svg-sessions"));
        }
    }
    Ok(std::env::temp_dir().join("scie-md-svg-sessions"))
}

fn file_modified_ms(path: &Path) -> Result<u64, String> {
    let modified = fs::metadata(path)
        .map_err(|error| format!("Could not read SVG session metadata: {error}"))?
        .modified()
        .map_err(|error| format!("Could not read SVG session modification time: {error}"))?;
    Ok(modified
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64)
}

fn cleanup_stale_svg_session_files(directory: &Path, max_age: Duration) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.starts_with("svg-")
            || path.extension().and_then(|value| value.to_str()) != Some("svg")
        {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        if now.duration_since(modified).unwrap_or_default() >= max_age {
            let _ = fs::remove_file(path);
        }
    }
}

fn validate_svg_source(svg: &str) -> Result<(), String> {
    const MAX_SVG_BYTES: usize = 2_000_000;
    if svg.trim().is_empty() {
        return Err("SVG source is empty.".to_string());
    }
    if svg.len() > MAX_SVG_BYTES {
        return Err("SVG source is too large for inline editing.".to_string());
    }
    let lower = svg.to_ascii_lowercase();
    if !lower.contains("<svg") || !(lower.contains("</svg>") || lower.contains("/>")) {
        return Err("SVG source must contain an <svg> root.".to_string());
    }
    for forbidden in [
        "<script",
        "<foreignobject",
        "javascript:",
        "vbscript:",
        "onload=",
        "onclick=",
        "onerror=",
        " style=",
        "href=\"http",
        "href='http",
        "xlink:href=\"http",
        "xlink:href='http",
        "href=\"file:",
        "href='file:",
    ] {
        if lower.contains(forbidden) {
            return Err(
                "SVG contains unsafe content. Clean it before opening or exporting.".to_string(),
            );
        }
    }
    if contains_external_href(&lower, "href=\"")
        || contains_external_href(&lower, "href='")
        || contains_external_href(&lower, "xlink:href=\"")
        || contains_external_href(&lower, "xlink:href='")
    {
        return Err(
            "SVG contains external references. Use internal #id references only.".to_string(),
        );
    }
    Ok(())
}

fn contains_external_href(source: &str, marker: &str) -> bool {
    let mut start = 0;
    while let Some(index) = source[start..].find(marker) {
        let value_start = start + index + marker.len();
        if !source[value_start..].starts_with('#') {
            return true;
        }
        start = value_start + 1;
    }
    false
}

fn svg_export_format(format: &str) -> Result<&'static str, String> {
    match format {
        "png" => Ok("png"),
        "pdf" => Ok("pdf"),
        _ => Err("Unsupported SVG export format.".to_string()),
    }
}

fn write_text_file(path: &Path, contents: &str, label: &str) -> Result<(), String> {
    let mut file = fs::File::create(path)
        .map_err(|error| format!("Could not create {label} file: {error}"))?;
    file.write_all(contents.as_bytes())
        .map_err(|error| format!("Could not write {label} file: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("Could not flush {label} file: {error}"))
}

fn next_session_id() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let counter = SVG_SESSION_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}-{}-{}", std::process::id(), timestamp, counter)
}

fn stable_hash(source: &str, format: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(source.as_bytes());
    hasher.update([0]);
    hasher.update(format.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::{
        append_inkscape_export_args, cleanup_stale_svg_session_files, looks_like_inkscape,
        limit_svg_sessions, prune_svg_sessions, stable_hash, svg_export_format,
        uses_legacy_inkscape_cli, validate_svg_source, SvgSession,
    };
    use std::{
        collections::HashMap,
        fs,
        path::Path,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn validates_svg_export_formats() {
        assert_eq!(svg_export_format("png").unwrap(), "png");
        assert_eq!(svg_export_format("pdf").unwrap(), "pdf");
        assert!(svg_export_format("html").is_err());
    }

    #[test]
    fn rejects_obviously_unsafe_svg() {
        assert!(validate_svg_source("<svg><rect /></svg>").is_ok());
        assert!(validate_svg_source("<svg><script>alert(1)</script></svg>").is_err());
        assert!(validate_svg_source("<svg onload=\"alert(1)\"></svg>").is_err());
        assert!(
            validate_svg_source("<svg><image href=\"https://example.com/a.png\" /></svg>").is_err()
        );
        assert!(validate_svg_source(
            "<svg><rect style=\"background:url(https://example.com/x)\" /></svg>"
        )
        .is_err());
        assert!(validate_svg_source("<svg><use href=\"#safe\" /></svg>").is_ok());
        assert!(validate_svg_source("<svg><use href=\"external.svg#payload\" /></svg>").is_err());
    }

    #[test]
    fn accepts_only_inkscape_executable_names() {
        assert!(looks_like_inkscape(Path::new("inkscape.exe")));
        assert!(looks_like_inkscape(Path::new("inkscape")));
        assert!(looks_like_inkscape(Path::new("Inkscape.AppImage")));
        assert!(!looks_like_inkscape(Path::new("cmd.exe")));
    }

    #[test]
    fn detects_legacy_inkscape_export_cli() {
        assert!(uses_legacy_inkscape_cli(
            "Inkscape 0.92.5 (2060ec1f9f, 2020-04-08)"
        ));
        assert!(!uses_legacy_inkscape_cli("Inkscape 1.3.2"));
    }

    #[test]
    fn builds_inkscape_export_args_for_legacy_and_modern_cli() {
        let output = Path::new("figure.pdf");
        let mut legacy = std::process::Command::new("inkscape");
        append_inkscape_export_args(&mut legacy, output, "pdf", "Inkscape 0.92.5");
        let legacy_args: Vec<String> = legacy
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect();
        assert_eq!(legacy_args, vec!["--export-pdf=figure.pdf"]);

        let mut modern = std::process::Command::new("inkscape");
        append_inkscape_export_args(&mut modern, output, "pdf", "Inkscape 1.3.2");
        let modern_args: Vec<String> = modern
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect();
        assert_eq!(
            modern_args,
            vec!["--export-type=pdf", "--export-filename=figure.pdf"]
        );
    }

    #[test]
    fn svg_export_hashes_include_format() {
        assert_ne!(
            stable_hash("<svg></svg>", "png"),
            stable_hash("<svg></svg>", "pdf")
        );
        assert_eq!(stable_hash("<svg></svg>", "png").len(), 64);
    }

    #[test]
    fn cleanup_stale_svg_sessions_removes_only_svg_session_files() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("scie-md-svg-cleanup-{suffix}"));
        fs::create_dir_all(&dir).unwrap();
        let stale = dir.join("svg-stale.svg");
        let keep = dir.join("notes.svg");
        fs::write(&stale, "<svg></svg>").unwrap();
        fs::write(&keep, "<svg></svg>").unwrap();

        cleanup_stale_svg_session_files(&dir, Duration::ZERO);

        assert!(!stale.exists());
        assert!(keep.exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn svg_session_registry_prunes_missing_entries_and_caps_size() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("scie-md-svg-registry-{suffix}"));
        fs::create_dir_all(&dir).unwrap();
        let live = dir.join("svg-live.svg");
        fs::write(&live, "<svg></svg>").unwrap();

        let mut sessions = HashMap::from([
            ("live".to_string(), SvgSession { path: live.clone(), opened_modified_ms: 2 }),
            ("missing".to_string(), SvgSession { path: dir.join("missing.svg"), opened_modified_ms: 1 }),
        ]);
        prune_svg_sessions(&mut sessions, Duration::from_secs(60));
        assert!(sessions.contains_key("live"));
        assert!(!sessions.contains_key("missing"));

        for index in 0..4 {
            let path = dir.join(format!("svg-{index}.svg"));
            fs::write(&path, "<svg></svg>").unwrap();
            sessions.insert(format!("session-{index}"), SvgSession { path, opened_modified_ms: index });
        }
        limit_svg_sessions(&mut sessions, 2);
        assert_eq!(sessions.len(), 2);
        assert!(sessions.contains_key("session-3"));

        let _ = fs::remove_dir_all(dir);
    }
}
