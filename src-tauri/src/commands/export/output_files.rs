use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};

use crate::commands::path_utils::external_safe_path_string;

use super::temp_artifacts::{cleanup_stale_export_temp_files, create_temp_export_path};

pub(super) fn create_temp_output_path(output_path: &Path, target: &str) -> Result<PathBuf, String> {
    let parent = output_path
        .parent()
        .ok_or_else(|| "Could not determine export output directory.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not prepare export output directory: {error}"))?;
    cleanup_stale_export_temp_files(parent, Duration::from_secs(60 * 60));
    let extension = output_path
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(target);
    Ok(create_temp_export_path(parent, extension))
}

pub(super) fn reject_directory_output(output_path: &Path, target: &str) -> Result<(), String> {
    if output_path.is_dir() {
        Err(format!(
            "Choose a file name for the {} export, not a folder.",
            target.to_uppercase()
        ))
    } else {
        Ok(())
    }
}

pub(super) fn validate_export_output(path: &Path, target: &str) -> Result<(), String> {
    let metadata = fs::metadata(path).map_err(|error| {
        format!("Export finished but the output could not be inspected: {error}")
    })?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("Export finished but produced an empty output file.".to_string());
    }

    let mut file = fs::File::open(path)
        .map_err(|error| format!("Could not validate export output: {error}"))?;
    let mut signature = [0_u8; 8];
    let read = file
        .read(&mut signature)
        .map_err(|error| format!("Could not read export output signature: {error}"))?;
    match target {
        "pdf" if !signature[..read].starts_with(b"%PDF") => {
            Err("PDF export did not produce a valid PDF file.".to_string())
        }
        "docx" | "epub" | "odt" if !signature[..read].starts_with(b"PK") => Err(format!(
            "{} export did not produce a valid archive file.",
            target.to_uppercase()
        )),
        _ => Ok(()),
    }
}

pub(super) fn replace_export_output(
    temp_output: &Path,
    output_path: &Path,
) -> Result<PathBuf, String> {
    let final_output;
    if output_path.exists() {
        let backup_path = create_temp_export_path(
            output_path
                .parent()
                .ok_or_else(|| "Could not determine export output directory.".to_string())?,
            "previous",
        );
        match fs::rename(output_path, &backup_path) {
            Ok(()) => {
                if let Err(error) = rename_or_copy_output(temp_output, output_path) {
                    let _ = fs::rename(&backup_path, output_path);
                    return Err(error);
                }
                let _ = fs::remove_file(backup_path);
                final_output = output_path.to_path_buf();
            }
            Err(preserve_error) => {
                let conflict_path = create_conflict_output_path(output_path)?;
                fs::rename(temp_output, &conflict_path).map_err(|move_error| {
                    format!(
                        "Could not replace the selected export because it appears to be open or locked: {preserve_error}. ScieMD also could not save the new export as {}: {move_error}",
                        external_safe_path_string(&conflict_path)
                    )
                })?;
                final_output = conflict_path;
            }
        }
    } else {
        rename_or_copy_output(temp_output, output_path)?;
        final_output = output_path.to_path_buf();
    }
    sync_file_best_effort(&final_output);
    if let Some(parent) = final_output.parent() {
        if let Ok(directory) = fs::File::open(parent) {
            let _ = directory.sync_all();
        }
    }
    Ok(final_output)
}

fn rename_or_copy_output(temp_output: &Path, output_path: &Path) -> Result<(), String> {
    match fs::rename(temp_output, output_path) {
        Ok(()) => Ok(()),
        Err(error) if is_cross_device_error(&error) => {
            fs::copy(temp_output, output_path)
                .map_err(|copy_error| format!("Could not copy export output into place after cross-device rename failed: {copy_error}"))?;
            sync_file_best_effort(output_path);
            fs::remove_file(temp_output).map_err(|remove_error| {
                format!("Could not remove temporary export after cross-device copy: {remove_error}")
            })?;
            Ok(())
        }
        Err(error) => Err(format!("Could not move export output into place: {error}")),
    }
}

fn is_cross_device_error(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::CrossesDevices || is_platform_cross_device_error(error)
}

#[cfg(unix)]
fn is_platform_cross_device_error(error: &std::io::Error) -> bool {
    error.raw_os_error() == Some(libc::EXDEV)
}

#[cfg(not(unix))]
fn is_platform_cross_device_error(error: &std::io::Error) -> bool {
    error.raw_os_error() == Some(17)
}

fn sync_file_best_effort(path: &Path) {
    if let Ok(file) = fs::File::open(path) {
        let _ = file.sync_all();
    }
}

pub(super) fn create_conflict_output_path(output_path: &Path) -> Result<PathBuf, String> {
    let parent = output_path
        .parent()
        .ok_or_else(|| "Could not determine export output directory.".to_string())?;
    let stem = output_path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("export");
    let extension = output_path
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty());
    for index in 1..=999 {
        let suffix = if index == 1 {
            "exported copy".to_string()
        } else {
            format!("exported copy {index}")
        };
        let file_name = match extension {
            Some(extension) => format!("{stem} ({suffix}).{extension}"),
            None => format!("{stem} ({suffix})"),
        };
        let candidate = parent.join(file_name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("Could not choose a non-conflicting export filename.".to_string())
}
