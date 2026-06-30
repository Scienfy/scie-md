use std::{
    path::{Path, PathBuf},
    thread,
};

use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

use super::path_grants::{
    grant_directory, grant_file, grant_file_and_parent, grant_read_only_file,
};

const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown"];
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"];
const CSL_EXTENSIONS: &[&str] = &["csl"];

#[tauri::command]
pub async fn pick_markdown_file<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    pick_file(
        app,
        "Open Markdown File",
        "Markdown",
        MARKDOWN_EXTENSIONS,
        GrantMode::FileAndParent,
    )
    .await
}

#[tauri::command]
pub async fn pick_image_file<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    pick_file(
        app,
        "Choose Image",
        "Images",
        IMAGE_EXTENSIONS,
        GrantMode::ReadOnlyFile,
    )
    .await
}

#[tauri::command]
pub async fn pick_citation_style_file<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<String>, String> {
    pick_file(
        app,
        "Choose CSL Citation Style",
        "CSL",
        CSL_EXTENSIONS,
        GrantMode::File,
    )
    .await
}

#[tauri::command]
pub async fn pick_folder<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let selected = thread::spawn(move || {
        app.dialog()
            .file()
            .set_title("Choose Folder")
            .blocking_pick_folder()
    })
    .join()
    .map_err(|_| "Could not open folder picker.".to_string())?;

    let Some(path) = selected else {
        return Ok(None);
    };
    let path = into_path(path)?;
    grant_directory(&path)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn pick_save_path<R: Runtime>(
    app: AppHandle<R>,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    pick_save_file(
        app,
        default_path,
        "Save Markdown File",
        "Markdown",
        MARKDOWN_EXTENSIONS,
    )
    .await
}

#[tauri::command]
pub async fn pick_html_save_path<R: Runtime>(
    app: AppHandle<R>,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    pick_save_file(app, default_path, "Export HTML", "HTML", &["html", "htm"]).await
}

#[tauri::command]
pub async fn pick_pandoc_export_save_path<R: Runtime>(
    app: AppHandle<R>,
    default_path: Option<String>,
    format: String,
) -> Result<Option<String>, String> {
    let extension = match format.as_str() {
        "docx" => ("DOCX", &["docx"][..]),
        "epub" => ("EPUB", &["epub"][..]),
        "latex" => ("LATEX", &["tex"][..]),
        "pdf" => ("PDF", &["pdf"][..]),
        "odt" => ("ODT", &["odt"][..]),
        "jats" => ("JATS XML", &["xml"][..]),
        "plain" => ("Plain Text", &["txt"][..]),
        "rst" => ("reStructuredText", &["rst"][..]),
        "asciidoc" => ("AsciiDoc", &["adoc", "asciidoc"][..]),
        "docbook" => ("DocBook XML", &["xml"][..]),
        _ => return Err("Unsupported export format.".to_string()),
    };
    pick_save_file(
        app,
        default_path,
        "Export Document",
        extension.0,
        extension.1,
    )
    .await
}

async fn pick_file<R: Runtime>(
    app: AppHandle<R>,
    title: &'static str,
    filter_name: &'static str,
    extensions: &'static [&'static str],
    grant_mode: GrantMode,
) -> Result<Option<String>, String> {
    let selected = thread::spawn(move || {
        app.dialog()
            .file()
            .set_title(title)
            .add_filter(filter_name, extensions)
            .blocking_pick_file()
    })
    .join()
    .map_err(|_| "Could not open file picker.".to_string())?;

    let Some(path) = selected else {
        return Ok(None);
    };
    let path = into_path(path)?;
    match grant_mode {
        GrantMode::File => grant_file(&path)?,
        GrantMode::ReadOnlyFile => grant_read_only_file(&path)?,
        GrantMode::FileAndParent => grant_file_and_parent(&path)?,
    }
    Ok(Some(path.to_string_lossy().to_string()))
}

async fn pick_save_file<R: Runtime>(
    app: AppHandle<R>,
    default_path: Option<String>,
    title: &'static str,
    filter_name: &'static str,
    extensions: &'static [&'static str],
) -> Result<Option<String>, String> {
    let selected = thread::spawn(move || {
        let mut builder = app
            .dialog()
            .file()
            .set_title(title)
            .add_filter(filter_name, extensions);
        if let Some(default_path) = default_path {
            let default = PathBuf::from(default_path);
            if let Some(file_name) = default.file_name().and_then(|value| value.to_str()) {
                builder = builder.set_file_name(file_name);
            }
            if let Some(parent) = default.parent().filter(|parent| parent.exists()) {
                builder = builder.set_directory(parent);
            }
        }
        builder.blocking_save_file()
    })
    .join()
    .map_err(|_| "Could not open save dialog.".to_string())?;

    let Some(path) = selected else {
        return Ok(None);
    };
    let path = into_path(path)?;
    ensure_parent_exists(&path)?;
    grant_file(&path)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

fn into_path(path: tauri_plugin_dialog::FilePath) -> Result<PathBuf, String> {
    path.into_path()
        .map_err(|error| format!("Could not resolve selected path: {error}"))
}

fn ensure_parent_exists(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Selected file has no parent directory.".to_string())?;
    if parent.exists() {
        Ok(())
    } else {
        Err("Selected folder does not exist.".to_string())
    }
}

enum GrantMode {
    File,
    ReadOnlyFile,
    FileAndParent,
}
