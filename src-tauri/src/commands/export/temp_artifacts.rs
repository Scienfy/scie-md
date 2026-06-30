use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

static TEMP_EXPORT_COUNTER: AtomicU64 = AtomicU64::new(0);
const TEMP_EXPORT_PREFIX: &str = ".scie-md-pandoc-";
const TEMP_BROWSER_PROFILE_PREFIX: &str = ".scie-md-browser-profile-";

enum TempPathKind {
    File,
    Directory,
}

pub(super) struct TempPathGuard {
    path: PathBuf,
    kind: TempPathKind,
}

impl TempPathGuard {
    pub(super) fn file(path: PathBuf) -> Self {
        Self {
            path,
            kind: TempPathKind::File,
        }
    }

    pub(super) fn dir(path: PathBuf) -> Self {
        Self {
            path,
            kind: TempPathKind::Directory,
        }
    }
}

impl Drop for TempPathGuard {
    fn drop(&mut self) {
        let result = match self.kind {
            TempPathKind::File => fs::remove_file(&self.path),
            TempPathKind::Directory => fs::remove_dir_all(&self.path),
        };
        if let Err(error) = result {
            if error.kind() != std::io::ErrorKind::NotFound {
                eprintln!(
                    "Could not clean export temporary artifact {:?}: {error}",
                    self.path
                );
            }
        }
    }
}

pub(super) fn create_temp_markdown_path(directory: &Path) -> PathBuf {
    create_temp_export_path(directory, "md")
}

pub(super) fn create_temp_html_path(directory: &Path) -> PathBuf {
    create_temp_export_path(directory, "html")
}

pub(super) fn create_temp_browser_profile_path(directory: &Path) -> PathBuf {
    directory.join(create_temp_export_stem("browser-profile"))
}

pub(super) fn create_temp_export_path(directory: &Path, extension: &str) -> PathBuf {
    let stem = create_temp_export_stem("pandoc");
    directory.join(format!("{stem}.{extension}"))
}

fn create_temp_export_stem(label: &str) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let counter = TEMP_EXPORT_COUNTER.fetch_add(1, Ordering::Relaxed);
    let process_id = std::process::id();
    format!(".scie-md-{label}-{timestamp}-{process_id}-{counter}")
}

pub(super) fn cleanup_stale_export_temp_files(directory: &Path, max_age: Duration) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !is_export_temp_artifact(file_name) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        if now.duration_since(modified).unwrap_or_default() <= max_age {
            continue;
        }
        if metadata.is_dir() {
            let _ = fs::remove_dir_all(path);
        } else {
            let _ = fs::remove_file(path);
        }
    }
}

fn is_export_temp_artifact(file_name: &str) -> bool {
    file_name.starts_with(TEMP_EXPORT_PREFIX) || file_name.starts_with(TEMP_BROWSER_PROFILE_PREFIX)
}

pub(super) fn write_temp_markdown(path: &Path, markdown: &str) -> Result<(), String> {
    write_temp_text(path, markdown, "Pandoc")
}

pub(super) fn write_temp_text(path: &Path, text: &str, label: &str) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("Could not create {label} temporary file: {error}"))?;
    file.write_all(text.as_bytes())
        .map_err(|error| format!("Could not write {label} temporary file: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("Could not flush {label} temporary file: {error}"))
}
