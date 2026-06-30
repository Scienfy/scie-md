use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use super::{
    path_grants::{assert_file_read_allowed, assert_file_write_allowed},
    path_utils::{external_safe_path, external_safe_path_string},
    process::{output_quiet, spawn_quiet, terminate_child_tree},
};

mod browser_pdf;
mod native_docx;
mod output_files;
mod temp_artifacts;

#[cfg(test)]
use browser_pdf::parse_chromium_major_version;
use browser_pdf::{
    browser_headless_arg, html_document_title, path_to_file_url, resolve_browser_executable,
    validate_browser_pdf_output,
};
use native_docx::write_native_docx_from_html;
#[cfg(test)]
use output_files::create_conflict_output_path;
use output_files::{
    create_temp_output_path, reject_directory_output, replace_export_output, validate_export_output,
};
use temp_artifacts::{
    cleanup_stale_export_temp_files, create_temp_browser_profile_path, create_temp_export_path,
    create_temp_html_path, create_temp_markdown_path, write_temp_markdown, write_temp_text,
    TempPathGuard,
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PandocExportResponse {
    pub output_path: String,
    pub stderr: String,
}

#[tauri::command]
pub fn check_pandoc_available() -> Result<String, String> {
    resolve_pandoc_executable().map(|path| external_safe_path_string(&path))
}

#[tauri::command]
pub fn export_with_pandoc(
    markdown: String,
    document_path: Option<String>,
    output_path: String,
    format: String,
    citation_style_path: Option<String>,
    extra_args: Option<Vec<String>>,
) -> Result<PandocExportResponse, String> {
    let target = pandoc_target_format(&format)?;
    let output = PathBuf::from(output_path);
    reject_directory_output(&output, target)?;
    assert_file_write_allowed(&output)?;
    if let Some(document_path) = document_path.as_deref() {
        let document = PathBuf::from(document_path);
        if document.exists() {
            assert_file_read_allowed(&document)?;
        }
    }
    let working_dir = working_directory(document_path.as_deref(), &output)?;
    fs::create_dir_all(&working_dir)
        .map_err(|error| format!("Could not prepare export directory: {error}"))?;
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not prepare output directory: {error}"))?;
    }

    let temp_path = create_temp_markdown_path(&working_dir);
    let _temp_guard = TempPathGuard::file(temp_path.clone());
    write_temp_markdown(&temp_path, &markdown)?;

    let pandoc_path = resolve_pandoc_executable()?;
    let pandoc_options = PandocRunOptions::new(citation_style_path, extra_args)?;
    run_pandoc(
        &pandoc_path,
        &temp_path,
        &output,
        target,
        &working_dir,
        &pandoc_options,
    )
}

#[tauri::command]
pub fn export_html_with_pandoc(
    html: String,
    document_path: Option<String>,
    output_path: String,
    format: String,
    citation_style_path: Option<String>,
    extra_args: Option<Vec<String>>,
) -> Result<PandocExportResponse, String> {
    let target = pandoc_target_format(&format)?;
    let output = PathBuf::from(output_path);
    reject_directory_output(&output, target)?;
    assert_file_write_allowed(&output)?;
    if let Some(document_path) = document_path.as_deref() {
        let document = PathBuf::from(document_path);
        if document.exists() {
            assert_file_read_allowed(&document)?;
        }
    }
    let working_dir = working_directory(document_path.as_deref(), &output)?;
    fs::create_dir_all(&working_dir)
        .map_err(|error| format!("Could not prepare export directory: {error}"))?;
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not prepare output directory: {error}"))?;
    }

    let temp_path = create_temp_html_path(&working_dir);
    let _temp_guard = TempPathGuard::file(temp_path.clone());
    write_temp_text(&temp_path, &html, "HTML")?;

    let pandoc_path = resolve_pandoc_executable()?;
    let pandoc_options = PandocRunOptions::new(citation_style_path, extra_args)?;
    run_pandoc_with_source(
        &pandoc_path,
        &temp_path,
        &output,
        "html",
        target,
        &working_dir,
        &pandoc_options,
    )
}

#[tauri::command]
pub fn export_styled_html_to_pdf(
    html: String,
    output_path: String,
) -> Result<PandocExportResponse, String> {
    let output = PathBuf::from(output_path);
    reject_directory_output(&output, "pdf")?;
    assert_file_write_allowed(&output)?;
    let parent = output
        .parent()
        .ok_or_else(|| "Could not determine PDF export directory.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not prepare PDF output directory: {error}"))?;
    cleanup_stale_export_temp_files(parent, Duration::from_secs(60 * 60));

    let temp_path = create_temp_html_path(parent);
    let _temp_guard = TempPathGuard::file(temp_path.clone());
    write_temp_text(&temp_path, &html, "HTML")?;

    let expected_title = html_document_title(&html);
    run_browser_pdf_export(&temp_path, &output, expected_title.as_deref())
        .map_err(|error| format!("ScieMD browser PDF export failed: {error}"))
}

fn run_browser_pdf_export(
    input_path: &Path,
    output_path: &Path,
    expected_title: Option<&str>,
) -> Result<PandocExportResponse, String> {
    let temp_output = create_temp_output_path(output_path, "pdf")?;
    let _temp_output_guard = TempPathGuard::file(temp_output.clone());
    let stderr_path = create_temp_export_path(
        output_path
            .parent()
            .ok_or_else(|| "Could not determine PDF export directory.".to_string())?,
        "log",
    );
    let _stderr_guard = TempPathGuard::file(stderr_path.clone());
    let stderr_file = fs::File::create(&stderr_path)
        .map_err(|error| format!("Could not create browser PDF log file: {error}"))?;
    let browser_path = resolve_browser_executable()?;
    let browser_profile = create_temp_browser_profile_path(
        output_path
            .parent()
            .ok_or_else(|| "Could not determine PDF export directory.".to_string())?,
    );
    let _browser_profile_guard = TempPathGuard::dir(browser_profile.clone());
    fs::create_dir_all(&browser_profile)
        .map_err(|error| format!("Could not prepare browser PDF profile: {error}"))?;

    let file_url = path_to_file_url(input_path);
    let headless_arg = browser_headless_arg(&browser_path);
    let mut command = Command::new(external_safe_path(&browser_path));
    command
        .arg(headless_arg)
        .arg("--disable-gpu")
        .arg("--no-first-run")
        .arg("--disable-extensions")
        .arg("--disable-popup-blocking")
        .arg("--disable-background-networking")
        .arg(format!(
            "--user-data-dir={}",
            external_safe_path_string(&browser_profile)
        ))
        .arg(format!(
            "--print-to-pdf={}",
            external_safe_path_string(&temp_output)
        ))
        .arg(file_url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(stderr_file));

    let mut child = match spawn_quiet(&mut command) {
        Ok(child) => child,
        Err(error) => {
            return Err(format!(
                "Could not start browser PDF renderer at {}: {error}",
                external_safe_path_string(&browser_path)
            ));
        }
    };

    let status = wait_for_child(&mut child, Duration::from_secs(90), "Browser PDF renderer");
    let stderr = read_process_log(&stderr_path);

    match status {
        Ok(status) if status.success() => {}
        Ok(status) => {
            return Err(if stderr.is_empty() {
                format!("Browser PDF renderer failed with status {status}.")
            } else {
                format!("Browser PDF renderer failed: {stderr}")
            });
        }
        Err(error) => {
            return Err(error);
        }
    }

    wait_for_stable_output_file(&temp_output, Duration::from_secs(10), "Browser PDF output")?;
    validate_export_output(&temp_output, "pdf")?;
    validate_browser_pdf_output(&temp_output, expected_title)?;
    let final_output = replace_export_output(&temp_output, output_path)?;
    let mut stderr = if stderr.is_empty() {
        "PDF exported with the ScieMD browser renderer.".to_string()
    } else {
        stderr
    };
    if final_output.as_path() != output_path {
        stderr.push_str(&format!(
            "\nThe selected PDF was open or locked, so ScieMD saved this export as {} instead.",
            external_safe_path_string(&final_output)
        ));
    }

    Ok(PandocExportResponse {
        output_path: external_safe_path_string(&final_output),
        stderr,
    })
}

#[tauri::command]
pub fn export_html_to_docx_native(
    html: String,
    output_path: String,
) -> Result<PandocExportResponse, String> {
    let output = PathBuf::from(output_path);
    reject_directory_output(&output, "docx")?;
    assert_file_write_allowed(&output)?;
    let parent = output
        .parent()
        .ok_or_else(|| "Could not determine DOCX export directory.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not prepare DOCX output directory: {error}"))?;

    let temp_output = create_temp_output_path(&output, "docx")?;
    let _temp_output_guard = TempPathGuard::file(temp_output.clone());
    write_native_docx_from_html(&html, &temp_output)?;
    validate_export_output(&temp_output, "docx")?;
    let final_output = replace_export_output(&temp_output, &output)?;

    Ok(PandocExportResponse {
        output_path: external_safe_path_string(&final_output),
        stderr: "DOCX exported with ScieMD built-in WordprocessingML fallback because Pandoc was unavailable."
            .to_string(),
    })
}

struct PandocRunOptions {
    citation_style_path: Option<PathBuf>,
    extra_args: Vec<String>,
}

impl PandocRunOptions {
    fn new(
        citation_style_path: Option<String>,
        extra_args: Option<Vec<String>>,
    ) -> Result<Self, String> {
        let citation_style_path = citation_style_path
            .filter(|value| !value.trim().is_empty())
            .map(|value| {
                let path = PathBuf::from(value);
                assert_file_read_allowed(&path)?;
                if !path.is_file() {
                    return Err(
                        "Citation style path does not point to a readable .csl file.".to_string(),
                    );
                }
                if path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .map(|extension| !extension.eq_ignore_ascii_case("csl"))
                    .unwrap_or(true)
                {
                    return Err("Citation style path must point to a .csl file.".to_string());
                }
                Ok(path)
            })
            .transpose()?;
        Ok(Self {
            citation_style_path,
            extra_args: validate_extra_pandoc_args(extra_args.unwrap_or_default())?,
        })
    }
}

fn validate_extra_pandoc_args(args: Vec<String>) -> Result<Vec<String>, String> {
    const BLOCKED: &[&str] = &[
        "--output",
        "-o",
        "--from",
        "-f",
        "--to",
        "-t",
        "--sandbox",
        "--csl",
        "--data-dir",
        "--lua-filter",
        "--filter",
        "--pdf-engine-opt",
    ];
    const PATH_BEARING: &[&str] = &[
        "--metadata-file",
        "--template",
        "--reference-doc",
        "--bibliography",
        "--include-in-header",
        "--include-before-body",
        "--include-after-body",
        "--resource-path",
        "--extract-media",
        "--epub-cover-image",
        "--epub-metadata",
        "--defaults",
    ];
    let mut index = 0;
    while index < args.len() {
        let argument = args[index].trim();
        if BLOCKED
            .iter()
            .any(|blocked| argument == *blocked || argument.starts_with(&format!("{blocked}=")))
        {
            return Err(format!("Pandoc argument {argument} is managed by ScieMD and cannot be set by an export profile."));
        }
        if PATH_BEARING
            .iter()
            .any(|blocked| argument == *blocked || argument.starts_with(&format!("{blocked}=")))
        {
            return Err(format!(
                "Pandoc argument {argument} reads or writes additional paths and cannot be set by an export profile."
            ));
        }
        if argument.to_ascii_lowercase().contains("shell-escape") {
            return Err(
                "Pandoc export profiles cannot pass shell-escape options to PDF engines."
                    .to_string(),
            );
        }
        if let Some(value) = argument.strip_prefix("--pdf-engine=") {
            validate_pdf_engine_arg(value)?;
        } else if argument == "--pdf-engine" {
            let value = args.get(index + 1).ok_or_else(|| {
                "Pandoc argument --pdf-engine requires an engine name.".to_string()
            })?;
            validate_pdf_engine_arg(value)?;
            index += 1;
        }
        index += 1;
    }
    Ok(args)
}

fn validate_pdf_engine_arg(value: &str) -> Result<(), String> {
    let engine = non_empty_engine_name(value)
        .ok_or_else(|| "Pandoc argument --pdf-engine requires an engine name.".to_string())?;
    if engine.contains('/') || engine.contains('\\') || Path::new(&engine).is_absolute() {
        return Err(
            "Pandoc PDF engine must be a trusted engine name, not a local executable path."
                .to_string(),
        );
    }
    if !allowed_pandoc_pdf_engine(&engine) {
        return Err(format!(
            "Pandoc PDF engine `{engine}` is not allowed. Use xelatex, lualatex, pdflatex, tectonic, typst, or weasyprint."
        ));
    }
    Ok(())
}

fn run_pandoc(
    pandoc_path: &Path,
    input_path: &Path,
    output_path: &Path,
    target: &'static str,
    working_dir: &Path,
    options: &PandocRunOptions,
) -> Result<PandocExportResponse, String> {
    run_pandoc_with_source(
        pandoc_path,
        input_path,
        output_path,
        "markdown+yaml_metadata_block+pipe_tables+tex_math_dollars+footnotes+raw_attribute",
        target,
        working_dir,
        options,
    )
}

fn run_pandoc_with_source(
    pandoc_path: &Path,
    input_path: &Path,
    output_path: &Path,
    source: &'static str,
    target: &'static str,
    working_dir: &Path,
    options: &PandocRunOptions,
) -> Result<PandocExportResponse, String> {
    preflight_pandoc_target(target, &options.extra_args)?;
    let temp_output = create_temp_output_path(output_path, target)?;
    let _temp_output_guard = TempPathGuard::file(temp_output.clone());
    let stderr_path = create_temp_export_path(
        output_path
            .parent()
            .ok_or_else(|| "Could not determine export output directory.".to_string())?,
        "log",
    );
    let _stderr_guard = TempPathGuard::file(stderr_path.clone());
    let stderr_file = fs::File::create(&stderr_path)
        .map_err(|error| format!("Could not create Pandoc log file: {error}"))?;
    let mut command = Command::new(external_safe_path(pandoc_path));
    command
        .current_dir(external_safe_path(working_dir))
        .arg("--sandbox")
        .arg(external_safe_path(input_path))
        .arg("--from")
        .arg(source)
        .arg("--to")
        .arg(target)
        .arg("--output")
        .arg(external_safe_path(&temp_output))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(stderr_file));
    if let Some(csl_path) = options.citation_style_path.as_deref() {
        command.arg("--csl").arg(external_safe_path(csl_path));
    }
    for argument in &options.extra_args {
        command.arg(argument);
    }
    let mut child =
        spawn_quiet(&mut command).map_err(|error| format!("Could not run Pandoc: {error}"))?;

    let status = wait_for_child(&mut child, Duration::from_secs(120), "Pandoc")?;
    let stderr = read_process_log(&stderr_path);
    if !status.success() {
        return Err(if stderr.is_empty() {
            format!("Pandoc export failed with status {status}.")
        } else {
            format!("Pandoc export failed: {stderr}")
        });
    }
    validate_export_output(&temp_output, target)?;
    let final_output = replace_export_output(&temp_output, output_path)?;

    Ok(PandocExportResponse {
        output_path: external_safe_path_string(&final_output),
        stderr,
    })
}

fn wait_for_child(
    child: &mut std::process::Child,
    timeout: Duration,
    label: &str,
) -> Result<std::process::ExitStatus, String> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    terminate_child_tree(child);
                    return Err(format!(
                        "{label} timed out after {} seconds.",
                        timeout.as_secs()
                    ));
                }
                thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(format!("Could not monitor {label}: {error}")),
        }
    }
}

fn wait_for_stable_output_file(path: &Path, timeout: Duration, label: &str) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let mut last_size = None;
    let mut stable_reads = 0usize;
    loop {
        match fs::metadata(path) {
            Ok(metadata) if metadata.len() > 0 => {
                let size = metadata.len();
                if last_size == Some(size) {
                    stable_reads += 1;
                } else {
                    last_size = Some(size);
                    stable_reads = 0;
                }
                if stable_reads >= 2 {
                    return Ok(());
                }
            }
            Ok(_) | Err(_) => {}
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "{label} was not created or did not finish writing within {} seconds.",
                timeout.as_secs()
            ));
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn read_process_log(path: &Path) -> String {
    fs::read_to_string(path)
        .map(|content| truncate_process_output(&content))
        .unwrap_or_default()
}

fn truncate_process_output(output: &str) -> String {
    let trimmed = output.trim();
    const MAX_OUTPUT_CHARS: usize = 16_384;
    if trimmed.chars().count() <= MAX_OUTPUT_CHARS {
        return trimmed.to_string();
    }
    let mut truncated = trimmed.chars().take(MAX_OUTPUT_CHARS).collect::<String>();
    truncated.push_str("\n[output truncated]");
    truncated
}

fn resolve_pandoc_executable() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        let candidates = [
            std::env::var_os("ProgramFiles")
                .map(|root| PathBuf::from(root).join("Pandoc").join("pandoc.exe")),
            std::env::var_os("LOCALAPPDATA")
                .map(|root| PathBuf::from(root).join("Pandoc").join("pandoc.exe")),
        ];
        for candidate in candidates.into_iter().flatten() {
            if candidate.is_file() {
                return Ok(candidate);
            }
        }

        let mut command = Command::new("where.exe");
        command
            .arg("pandoc")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let output = output_quiet(&mut command).map_err(|_| {
            "Pandoc was not found. Install Pandoc and make sure it is available on PATH."
                .to_string()
        })?;
        if output.status.success() {
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
        let mut command = Command::new("which");
        command
            .arg("pandoc")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let output = output_quiet(&mut command).map_err(|_| {
            "Pandoc was not found. Install Pandoc and make sure it is available on PATH."
                .to_string()
        })?;
        if output.status.success() {
            let candidate = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
            if candidate.is_absolute() && candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    Err("Pandoc was not found. Install Pandoc and make sure it is available on PATH.".to_string())
}

fn preflight_pandoc_target(target: &str, extra_args: &[String]) -> Result<(), String> {
    if target != "pdf" {
        return Ok(());
    }
    let requested_engine = pandoc_pdf_engine(extra_args);
    let candidates: Vec<String> =
        requested_engine
            .map(|engine| vec![engine])
            .unwrap_or_else(|| {
                vec![
                    "xelatex".to_string(),
                    "lualatex".to_string(),
                    "pdflatex".to_string(),
                    "tectonic".to_string(),
                    "typst".to_string(),
                    "weasyprint".to_string(),
                ]
            });
    if candidates
        .iter()
        .any(|candidate| resolve_tool_executable(candidate).is_some())
    {
        return Ok(());
    }
    if let Some(engine) = pandoc_pdf_engine(extra_args) {
        Err(format!(
            "Pandoc PDF export requires the configured PDF engine `{engine}`, but it was not found. Install that engine or choose ScieMD's styled PDF export."
        ))
    } else {
        Err("Pandoc PDF export requires a PDF engine (xelatex, lualatex, pdflatex, tectonic, typst, or weasyprint), but none was found. Install a supported engine or choose ScieMD's styled PDF export.".to_string())
    }
}

fn pandoc_pdf_engine(extra_args: &[String]) -> Option<String> {
    let mut index = 0;
    while index < extra_args.len() {
        let argument = extra_args[index].trim();
        if let Some(value) = argument.strip_prefix("--pdf-engine=") {
            return non_empty_engine_name(value);
        }
        if argument == "--pdf-engine" {
            return extra_args
                .get(index + 1)
                .and_then(|value| non_empty_engine_name(value));
        }
        index += 1;
    }
    None
}

fn non_empty_engine_name(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn allowed_pandoc_pdf_engine(engine: &str) -> bool {
    matches!(
        engine,
        "xelatex" | "lualatex" | "pdflatex" | "tectonic" | "typst" | "weasyprint"
    )
}

fn resolve_tool_executable(name: &str) -> Option<PathBuf> {
    let path = PathBuf::from(name);
    if path.components().count() > 1 && path.is_file() {
        return Some(path);
    }
    #[cfg(windows)]
    {
        let mut command = Command::new("where.exe");
        command
            .arg(name)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let output = output_quiet(&mut command).ok()?;
        if !output.status.success() {
            return None;
        }
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .map(PathBuf::from)
            .find(|candidate| candidate.is_absolute() && candidate.is_file())
    }
    #[cfg(not(windows))]
    {
        let mut command = Command::new("which");
        command
            .arg(name)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let output = output_quiet(&mut command).ok()?;
        if !output.status.success() {
            return None;
        }
        let candidate = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
        if candidate.is_absolute() && candidate.is_file() {
            Some(candidate)
        } else {
            None
        }
    }
}

fn pandoc_target_format(format: &str) -> Result<&'static str, String> {
    match format {
        "docx" => Ok("docx"),
        "epub" => Ok("epub"),
        "latex" => Ok("latex"),
        "pdf" => Ok("pdf"),
        "odt" => Ok("odt"),
        "jats" => Ok("jats"),
        "plain" => Ok("plain"),
        "rst" => Ok("rst"),
        "asciidoc" => Ok("asciidoc"),
        "docbook" => Ok("docbook"),
        _ => Err("Unsupported Pandoc export format.".to_string()),
    }
}

fn working_directory(document_path: Option<&str>, output_path: &Path) -> Result<PathBuf, String> {
    if let Some(path) = document_path {
        if let Some(parent) = Path::new(path).parent() {
            return Ok(parent.to_path_buf());
        }
    }
    output_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Could not determine export working directory.".to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        cleanup_stale_export_temp_files, create_conflict_output_path, create_temp_markdown_path,
        create_temp_output_path, html_document_title, pandoc_pdf_engine, pandoc_target_format,
        parse_chromium_major_version, path_to_file_url, reject_directory_output,
        replace_export_output, validate_browser_pdf_output, validate_export_output,
        validate_extra_pandoc_args, working_directory, write_native_docx_from_html, TempPathGuard,
    };
    use std::fs;
    use std::io::Read;
    use std::path::Path;
    use std::time::Duration;

    #[test]
    fn validates_pandoc_export_formats() {
        assert_eq!(pandoc_target_format("docx").unwrap(), "docx");
        assert_eq!(pandoc_target_format("epub").unwrap(), "epub");
        assert_eq!(pandoc_target_format("latex").unwrap(), "latex");
        assert_eq!(pandoc_target_format("pdf").unwrap(), "pdf");
        assert_eq!(pandoc_target_format("odt").unwrap(), "odt");
        assert_eq!(pandoc_target_format("jats").unwrap(), "jats");
        assert_eq!(pandoc_target_format("plain").unwrap(), "plain");
        assert_eq!(pandoc_target_format("rst").unwrap(), "rst");
        assert_eq!(pandoc_target_format("asciidoc").unwrap(), "asciidoc");
        assert_eq!(pandoc_target_format("docbook").unwrap(), "docbook");
        assert!(pandoc_target_format("html;rm").is_err());
    }

    #[test]
    fn extracts_configured_pandoc_pdf_engine_before_running_pandoc() {
        assert_eq!(
            pandoc_pdf_engine(&["--pdf-engine=xelatex".to_string()]),
            Some("xelatex".to_string())
        );
        assert_eq!(
            pandoc_pdf_engine(&["--pdf-engine".to_string(), "lualatex".to_string()]),
            Some("lualatex".to_string())
        );
        assert_eq!(pandoc_pdf_engine(&[]), None);
    }

    #[test]
    fn rejects_path_like_or_unknown_pandoc_pdf_engines() {
        assert!(validate_extra_pandoc_args(vec!["--pdf-engine=xelatex".to_string()]).is_ok());
        assert!(validate_extra_pandoc_args(vec![
            "--pdf-engine".to_string(),
            "tectonic".to_string()
        ])
        .is_ok());
        assert!(validate_extra_pandoc_args(vec!["--pdf-engine=typst".to_string()]).is_ok());
        assert!(validate_extra_pandoc_args(vec![
            "--pdf-engine".to_string(),
            "weasyprint".to_string()
        ])
        .is_ok());
        assert!(validate_extra_pandoc_args(vec![
            "--pdf-engine".to_string(),
            "/tmp/custom-engine".to_string()
        ])
        .is_err());
        assert!(
            validate_extra_pandoc_args(vec!["--pdf-engine=custom-engine".to_string()]).is_err()
        );
    }

    #[test]
    fn rejects_path_bearing_pandoc_profile_arguments() {
        assert!(validate_extra_pandoc_args(vec![
            "--toc".to_string(),
            "--number-sections".to_string(),
        ])
        .is_ok());
        assert!(
            validate_extra_pandoc_args(vec!["--metadata-file=C:\\secret.yml".to_string()]).is_err()
        );
        assert!(validate_extra_pandoc_args(vec!["--sandbox".to_string()]).is_err());
        assert!(validate_extra_pandoc_args(vec![
            "--template".to_string(),
            "C:\\secret-template.html".to_string()
        ])
        .is_err());
        assert!(
            validate_extra_pandoc_args(vec!["--extract-media=C:\\tmp\\media".to_string()]).is_err()
        );
        assert!(
            validate_extra_pandoc_args(vec!["--pdf-engine-opt=--shell-escape".to_string()])
                .is_err()
        );
        assert!(validate_extra_pandoc_args(vec![
            "--pdf-engine-opt".to_string(),
            "-output-directory=C:\\tmp".to_string()
        ])
        .is_err());
    }

    #[test]
    fn uses_document_directory_for_relative_assets() {
        #[cfg(windows)]
        let document_path = r"C:\Users\amin_\paper\document.md";
        #[cfg(windows)]
        let export_path = r"C:\Users\amin_\exports\document.docx";
        #[cfg(not(windows))]
        let document_path = "/Users/amin/paper/document.md";
        #[cfg(not(windows))]
        let export_path = "/Users/amin/exports/document.docx";

        let cwd = working_directory(Some(document_path), Path::new(export_path)).unwrap();
        assert_eq!(
            cwd.file_name().and_then(|name| name.to_str()),
            Some("paper")
        );
    }

    #[test]
    fn temp_markdown_paths_are_collision_resistant() {
        let directory = Path::new(r"C:\Users\amin_\paper");
        let first = create_temp_markdown_path(directory);
        let second = create_temp_markdown_path(directory);

        assert_ne!(first, second);
        assert!(first.to_string_lossy().contains(".scie-md-pandoc-"));
    }

    #[test]
    fn file_urls_escape_spaces_for_webview_pdf_export() {
        let url = path_to_file_url(Path::new(r"C:\Users\Amin Example\paper export.html"));
        assert!(url.starts_with("file:///"));
        assert!(url.contains("Amin%20Example"));
        assert!(url.ends_with("paper%20export.html"));
    }

    #[test]
    #[cfg(windows)]
    fn file_urls_strip_windows_verbatim_prefix() {
        let url = path_to_file_url(Path::new(
            r"\\?\C:\Users\amin_\OneDrive\Documents\.scie-md-export.html",
        ));
        assert_eq!(
            url,
            "file:///C:/Users/amin_/OneDrive/Documents/.scie-md-export.html"
        );
    }

    #[test]
    fn parses_browser_major_versions_for_headless_compatibility() {
        assert_eq!(
            parse_chromium_major_version("Google Chrome 120.0.6099.71"),
            Some(120)
        );
        assert_eq!(
            parse_chromium_major_version("Microsoft Edge 108.0.1462.54"),
            Some(108)
        );
        assert_eq!(
            parse_chromium_major_version("Chromium 109.0.0.0 snap"),
            Some(109)
        );
        assert_eq!(parse_chromium_major_version("not a browser"), None);
    }

    #[test]
    fn html_document_title_decodes_basic_entities() {
        assert_eq!(
            html_document_title("<html><head><title>ScieMD &amp; Export</title></head></html>"),
            Some("ScieMD & Export".to_string())
        );
    }

    #[test]
    fn browser_pdf_validation_rejects_new_tab_output() {
        let directory =
            std::env::temp_dir().join(format!("scie-md-pdf-new-tab-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let pdf = directory.join("new-tab.pdf");
        fs::write(&pdf, b"%PDF-1.4\n1 0 obj\n<</Title (New tab)>>").unwrap();

        assert!(validate_export_output(&pdf, "pdf").is_ok());
        assert!(validate_browser_pdf_output(&pdf, Some("ScieMD Tutorial")).is_err());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn native_docx_export_writes_real_word_document_xml() {
        let directory =
            std::env::temp_dir().join(format!("scie-md-native-docx-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let docx = directory.join("welcome.docx");
        write_native_docx_from_html(
            "<!doctype html><html data-theme=\"dark\"><body><h1>ScieMD Tutorial</h1><p>Export body.</p></body></html>",
            &docx,
        )
        .unwrap();

        validate_export_output(&docx, "docx").unwrap();
        let file = fs::File::open(&docx).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        assert!(archive.by_name("word/afchunk.html").is_err());
        let mut document_xml = String::new();
        archive
            .by_name("word/document.xml")
            .unwrap()
            .read_to_string(&mut document_xml)
            .unwrap();
        assert!(document_xml.contains("ScieMD Tutorial"));
        assert!(document_xml.contains("Export body."));
        assert!(document_xml.contains(r#"<w:background w:color="111817"/>"#));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn temp_output_uses_target_directory_and_extension() {
        let directory = std::env::temp_dir().join(format!(
            "scie-md-export-temp-path-test-{}",
            std::process::id()
        ));
        let target = directory.join("document.pdf");
        let temp = create_temp_output_path(&target, "pdf").unwrap();
        assert!(temp.starts_with(&directory));
        assert_eq!(
            temp.extension().and_then(|value| value.to_str()),
            Some("pdf")
        );
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn conflict_output_path_uses_sibling_copy_name() {
        let directory = std::env::temp_dir().join(format!(
            "scie-md-export-conflict-name-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let target = directory.join("document.pdf");
        let first_copy = directory.join("document (exported copy).pdf");
        fs::write(&first_copy, b"old copy").unwrap();

        let conflict = create_conflict_output_path(&target).unwrap();

        assert_eq!(conflict, directory.join("document (exported copy 2).pdf"));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn replace_export_output_returns_actual_output_path() {
        let directory = std::env::temp_dir().join(format!(
            "scie-md-export-replace-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let target = directory.join("document.pdf");
        let temp = directory.join(".scie-md-pandoc-temp.pdf");
        fs::write(&target, b"old").unwrap();
        fs::write(&temp, b"new").unwrap();

        let final_output = replace_export_output(&temp, &target).unwrap();

        assert_eq!(final_output, target);
        assert_eq!(fs::read(&target).unwrap(), b"new");
        assert!(!temp.exists());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn directory_output_is_rejected_before_exporting() {
        let directory = std::env::temp_dir().join(format!(
            "scie-md-export-directory-target-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let error = reject_directory_output(&directory, "pdf").unwrap_err();
        assert!(error.contains("not a folder"));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn stale_export_cleanup_removes_only_sciemd_temp_artifacts() {
        let directory = std::env::temp_dir().join(format!(
            "scie-md-export-cleanup-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let stale = directory.join(".scie-md-pandoc-old.html");
        let keep = directory.join("paper.html");
        fs::write(&stale, b"temp").unwrap();
        fs::write(&keep, b"real").unwrap();
        std::thread::sleep(Duration::from_millis(5));

        cleanup_stale_export_temp_files(&directory, Duration::ZERO);

        assert!(!stale.exists());
        assert!(keep.exists());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn temp_path_guard_cleans_files_and_directories_on_drop() {
        let directory = std::env::temp_dir().join(format!(
            "scie-md-export-guard-cleanup-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join(".scie-md-pandoc-guard.html");
        let profile = directory.join(".scie-md-browser-profile-guard");
        fs::write(&file, b"temporary html").unwrap();
        fs::create_dir_all(&profile).unwrap();
        fs::write(profile.join("Profile Lock"), b"lock").unwrap();

        {
            let _file_guard = TempPathGuard::file(file.clone());
            let _profile_guard = TempPathGuard::dir(profile.clone());
        }

        assert!(!file.exists());
        assert!(!profile.exists());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn validates_export_signatures() {
        let directory =
            std::env::temp_dir().join(format!("scie-md-export-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let pdf = directory.join("ok.pdf");
        let bad_pdf = directory.join("bad.pdf");
        fs::write(&pdf, b"%PDF-1.7\nbody").unwrap();
        fs::write(&bad_pdf, b"not a pdf").unwrap();
        assert!(validate_export_output(&pdf, "pdf").is_ok());
        assert!(validate_export_output(&bad_pdf, "pdf").is_err());
        let _ = fs::remove_dir_all(directory);
    }
}
