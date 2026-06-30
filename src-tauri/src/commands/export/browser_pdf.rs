use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use crate::commands::{path_utils::external_safe_path, process::output_quiet};

pub(super) fn browser_headless_arg(browser_path: &Path) -> &'static str {
    let mut command = Command::new(browser_path);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let Ok(output) = output_quiet(&mut command) else {
        return "--headless";
    };
    if !output.status.success() {
        return "--headless";
    }
    let version = String::from_utf8_lossy(&output.stdout);
    match parse_chromium_major_version(&version) {
        Some(major) if major >= 109 => "--headless=new",
        _ => "--headless",
    }
}

pub(super) fn parse_chromium_major_version(output: &str) -> Option<u32> {
    output
        .split_whitespace()
        .find_map(|token| token.split('.').next()?.parse::<u32>().ok())
}

pub(super) fn resolve_browser_executable() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        let candidates = [
            std::env::var_os("ProgramFiles(x86)").map(|root| {
                PathBuf::from(root)
                    .join("Microsoft")
                    .join("Edge")
                    .join("Application")
                    .join("msedge.exe")
            }),
            std::env::var_os("ProgramFiles").map(|root| {
                PathBuf::from(root)
                    .join("Microsoft")
                    .join("Edge")
                    .join("Application")
                    .join("msedge.exe")
            }),
            std::env::var_os("LOCALAPPDATA").map(|root| {
                PathBuf::from(root)
                    .join("Microsoft")
                    .join("Edge")
                    .join("Application")
                    .join("msedge.exe")
            }),
            std::env::var_os("ProgramFiles").map(|root| {
                PathBuf::from(root)
                    .join("Google")
                    .join("Chrome")
                    .join("Application")
                    .join("chrome.exe")
            }),
            std::env::var_os("ProgramFiles(x86)").map(|root| {
                PathBuf::from(root)
                    .join("Google")
                    .join("Chrome")
                    .join("Application")
                    .join("chrome.exe")
            }),
            std::env::var_os("LOCALAPPDATA").map(|root| {
                PathBuf::from(root)
                    .join("Google")
                    .join("Chrome")
                    .join("Application")
                    .join("chrome.exe")
            }),
        ];
        for candidate in candidates.into_iter().flatten() {
            if candidate.is_file() {
                return Ok(candidate);
            }
        }

        for executable in ["msedge.exe", "chrome.exe"] {
            let mut command = Command::new("where.exe");
            command
                .arg(executable)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null());
            let output = output_quiet(&mut command).ok();
            let Some(output) = output else {
                continue;
            };
            if !output.status.success() {
                continue;
            }
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let candidate = PathBuf::from(line.trim());
                if candidate.is_absolute() && candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        #[cfg(target_os = "macos")]
        {
            for candidate in [
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
                "/Applications/Chromium.app/Contents/MacOS/Chromium",
            ] {
                let candidate = PathBuf::from(candidate);
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }

        for executable in [
            "microsoft-edge",
            "google-chrome",
            "chromium",
            "chromium-browser",
        ] {
            let mut command = Command::new("which");
            command
                .arg(executable)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null());
            let output = output_quiet(&mut command).ok();
            let Some(output) = output else {
                continue;
            };
            if output.status.success() {
                let candidate = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
                if candidate.is_absolute() && candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
    }

    Err("Could not find Microsoft Edge, Google Chrome, or Chromium for PDF export.".to_string())
}

pub(super) fn validate_browser_pdf_output(
    path: &Path,
    expected_title: Option<&str>,
) -> Result<(), String> {
    let bytes = fs::read(path).map_err(|error| format!("Could not inspect PDF output: {error}"))?;
    let pdf_text = String::from_utf8_lossy(&bytes);
    if pdf_text.contains("/Title (New tab)") || pdf_text.contains("ntp.msn.com") {
        return Err(
            "PDF export produced the browser New Tab page instead of the ScieMD document."
                .to_string(),
        );
    }

    if let Some(title) = expected_title
        .map(str::trim)
        .filter(|title| !title.is_empty())
    {
        if !pdf_contains_plain_title(&bytes, title) {
            eprintln!(
                "ScieMD PDF validation warning: expected title was not visible as plain PDF bytes ({title}). Continuing because Chromium may encode text streams."
            );
        }
    }
    Ok(())
}

fn pdf_contains_plain_title(bytes: &[u8], title: &str) -> bool {
    bytes
        .windows(title.len())
        .any(|window| window == title.as_bytes())
}

pub(super) fn html_document_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title>")? + "<title>".len();
    let end = lower[start..].find("</title>")? + start;
    let title = decode_basic_html_entities(&html[start..end])
        .trim()
        .to_string();
    (!title.is_empty()).then_some(title)
}

pub(super) fn decode_basic_html_entities(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&#34;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

pub(super) fn path_to_file_url(path: &Path) -> String {
    let absolute = external_safe_path(&path.canonicalize().unwrap_or_else(|_| path.to_path_buf()))
        .to_string_lossy()
        .to_string();
    let absolute = absolute.replace('\\', "/");
    let encoded = percent_encode_file_path(&absolute);
    if encoded.starts_with('/') {
        format!("file://{encoded}")
    } else {
        format!("file:///{encoded}")
    }
}

fn percent_encode_file_path(path: &str) -> String {
    let mut output = String::with_capacity(path.len());
    for byte in path.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b':' | b'-' | b'_' | b'.' | b'~' => {
                output.push(byte as char);
            }
            _ => output.push_str(&format!("%{byte:02X}")),
        }
    }
    output
}
