#[cfg(all(unix, not(target_os = "macos")))]
use std::{path::Path, process::Stdio};
use std::{path::PathBuf, process::Command};

#[cfg(all(unix, not(target_os = "macos")))]
use super::process::output_quiet;
use super::{
    path_grants::{assert_directory_read_allowed, assert_file_read_allowed},
    path_utils::external_safe_path_string,
    process::spawn_quiet,
};

#[tauri::command]
pub fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if path.is_dir() {
        assert_directory_read_allowed(&path)?;
    } else {
        assert_file_read_allowed(&path)?;
    }

    #[cfg(windows)]
    {
        let argument = if path.is_file() {
            format!("/select,{}", external_safe_path_string(&path))
        } else {
            external_safe_path_string(&path)
        };
        let mut command = Command::new("explorer.exe");
        command.arg(argument);
        spawn_quiet(&mut command).map_err(|error| format!("Could not reveal file: {error}"))?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open");
        command.arg("-R").arg(&path);
        spawn_quiet(&mut command).map_err(|error| format!("Could not reveal file: {error}"))?;
        Ok(())
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if path.is_file() && show_item_with_file_manager_dbus(&path).is_ok() {
            return Ok(());
        }
        let target = if path.is_file() {
            path.parent().unwrap_or(&path).to_path_buf()
        } else {
            path
        };
        let mut command = Command::new("xdg-open");
        command.arg(target);
        spawn_quiet(&mut command).map_err(|error| format!("Could not reveal file: {error}"))?;
        Ok(())
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn show_item_with_file_manager_dbus(path: &Path) -> Result<(), String> {
    let uri = path_to_file_uri(path);
    let mut command = Command::new("dbus-send");
    command
        .arg("--session")
        .arg("--dest=org.freedesktop.FileManager1")
        .arg("--type=method_call")
        .arg("/org/freedesktop/FileManager1")
        .arg("org.freedesktop.FileManager1.ShowItems")
        .arg(format!("array:string:{uri}"))
        .arg("string:")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let output = output_quiet(&mut command)
        .map_err(|error| format!("Could not invoke file manager D-Bus: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err("File manager D-Bus reveal failed.".to_string())
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn path_to_file_uri(path: &Path) -> String {
    let path = path.to_string_lossy().replace('\\', "/");
    format!("file://{}", percent_encode_file_uri_path(&path))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn percent_encode_file_uri_path(path: &str) -> String {
    path.bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'-' | b'_' | b'.' | b'~' => {
                vec![char::from(byte)]
            }
            value => format!("%{value:02X}").chars().collect(),
        })
        .collect()
}
