mod commands;

use std::path::{Path, PathBuf};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::{Emitter, Manager};

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
                if let Some(path) = markdown_path_from_args(&argv, &cwd) {
                    let _ = commands::path_grants::grant_file_and_parent(&path);
                    let _ = window.emit("single-instance-open", path.to_string_lossy().to_string());
                }
            }
        }))
        .invoke_handler(tauri::generate_handler![
            initial_markdown_path,
            commands::dialogs::pick_markdown_file,
            commands::dialogs::pick_image_file,
            commands::dialogs::pick_citation_style_file,
            commands::dialogs::pick_folder,
            commands::dialogs::pick_save_path,
            commands::dialogs::pick_html_save_path,
            commands::dialogs::pick_pandoc_export_save_path,
            commands::path_grants::grant_external_path,
            commands::file_io::read_text_file,
            commands::file_io::read_text_file_preview,
            commands::file_io::read_binary_file_base64,
            commands::file_io::list_readable_files,
            commands::file_io::stat_file,
            commands::file_io::write_text_file_atomic,
            commands::file_io::write_text_file_create_new,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running ScieMD");
}

#[tauri::command]
fn initial_markdown_path() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    let cwd = std::env::current_dir().ok()?;
    let path = markdown_path_from_args(&args, &cwd.to_string_lossy())?;
    let _ = commands::path_grants::grant_file_and_parent(&path);
    Some(path.to_string_lossy().to_string())
}

fn markdown_path_from_args(argv: &[String], cwd: &str) -> Option<PathBuf> {
    argv.iter()
        .filter_map(|arg| {
            let path = PathBuf::from(arg);
            if is_supported_markdown_path(&path) {
                Some(if path.is_absolute() { path } else { Path::new(cwd).join(path) })
            } else {
                None
            }
        })
        .find(|path| path.is_file())
}

fn is_supported_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown"))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::markdown_path_from_args;
    use std::fs;

    #[test]
    fn finds_markdown_file_from_second_instance_args() {
        let directory =
            std::env::temp_dir().join(format!("scie-md-single-instance-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("paper.md");
        fs::write(&file, "# Paper\n").unwrap();

        let cwd = directory.to_string_lossy();
        let found = markdown_path_from_args(&["sciemd".into(), "paper.md".into()], cwd.as_ref());

        assert_eq!(found, Some(file));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn ignores_plain_text_file_from_second_instance_args() {
        let directory = std::env::temp_dir().join(format!(
            "scie-md-single-instance-text-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("paper.txt");
        fs::write(&file, "# Paper\n").unwrap();

        let cwd = directory.to_string_lossy();
        let found = markdown_path_from_args(&["sciemd".into(), "paper.txt".into()], cwd.as_ref());

        assert_eq!(found, None);
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
        let found = markdown_path_from_args(
            &["sciemd".into(), file.to_string_lossy().to_string()],
            cwd.to_string_lossy().as_ref(),
        );

        assert_eq!(found, Some(file));
        let _ = fs::remove_dir_all(directory);
    }
}
