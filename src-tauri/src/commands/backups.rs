use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use super::path_grants::{assert_file_read_allowed, assert_file_write_allowed};

const BACKUP_LIMIT: usize = 20;
const BACKUP_MAX_TOTAL_BYTES: u64 = 250 * 1024 * 1024;
const BACKUP_MAX_AGE: Duration = Duration::from_secs(90 * 24 * 60 * 60);

#[tauri::command]
pub fn create_backup_snapshot(path: String, label: String) -> Result<Option<String>, String> {
    let source = PathBuf::from(path);
    assert_file_write_allowed(&source)?;
    if !source.exists() {
        return Ok(None);
    }
    assert_file_read_allowed(&source)?;

    let backup_dir = backup_dir_for(&source)?;
    fs::create_dir_all(&backup_dir)
        .map_err(|error| format!("Could not create backup directory: {error}"))?;
    ensure_gitignore(&backup_dir)?;

    let backup_id = backup_id(&source);
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("md");
    let label = sanitize_label(&label);
    let backup_path =
        create_unique_backup_file(&source, &backup_dir, &backup_id, &label, extension)?;
    prune_backups(&backup_dir, &backup_id)?;

    Ok(Some(backup_path.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn list_backups(path: String) -> Result<Vec<String>, String> {
    let source = PathBuf::from(path);
    assert_file_write_allowed(&source)?;
    let backup_dir = backup_dir_for(&source)?;
    let backup_id = backup_id(&source);
    if !backup_dir.exists() {
        return Ok(Vec::new());
    }

    let mut backups = matching_backups(&backup_dir, &backup_id)?;
    backups.sort_by_key(|entry| std::cmp::Reverse(entry.1));
    Ok(backups
        .into_iter()
        .map(|entry| entry.0.to_string_lossy().to_string())
        .collect())
}

fn backup_dir_for(path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Document has no parent directory.".to_string())?;
    Ok(parent.join(".scienfy-backups"))
}

fn ensure_gitignore(backup_dir: &Path) -> Result<(), String> {
    let gitignore = backup_dir.join(".gitignore");
    if !gitignore.exists() {
        write_text_atomically(&gitignore, "*\n", "backup .gitignore")?;
    }
    Ok(())
}

fn backup_id(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(sanitize_label)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "document-md".to_string())
}

fn sanitize_label(label: &str) -> String {
    let sanitized: String = label
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' {
                character
            } else {
                '-'
            }
        })
        .collect();
    sanitized.trim_matches('-').to_string()
}

fn timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn create_unique_backup_file(
    source: &Path,
    backup_dir: &Path,
    backup_id: &str,
    label: &str,
    extension: &str,
) -> Result<PathBuf, String> {
    let mut source_file =
        fs::File::open(source).map_err(|error| format!("Could not open source file: {error}"))?;
    for attempt in 0..1000 {
        let suffix = if attempt == 0 {
            String::new()
        } else {
            format!("-{attempt}")
        };
        let backup_path = backup_dir.join(format!(
            "{backup_id}.{label}-{}{}.{extension}",
            timestamp_ms(),
            suffix
        ));
        let temp_path = backup_path.with_extension(format!("{extension}.tmp"));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(mut target) => {
                io::copy(&mut source_file, &mut target)
                    .and_then(|_| target.flush())
                    .and_then(|_| target.sync_all())
                    .map_err(|error| format!("Could not create backup snapshot: {error}"))?;
                drop(target);
                fs::rename(&temp_path, &backup_path).map_err(|error| {
                    let _ = fs::remove_file(&temp_path);
                    format!("Could not finalize backup snapshot: {error}")
                })?;
                if let Err(error) = sync_parent_dir(backup_dir) {
                    eprintln!(
                        "Backup snapshot was written, but ScieMD could not fsync the backup directory {}: {error}",
                        backup_dir.to_string_lossy()
                    );
                }
                return Ok(backup_path);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not create backup snapshot: {error}")),
        }
    }
    Err("Could not create a unique backup snapshot name.".to_string())
}

fn matching_backups(
    backup_dir: &Path,
    backup_id: &str,
) -> Result<Vec<(PathBuf, SystemTime)>, String> {
    let mut backups = Vec::new();
    for entry in
        fs::read_dir(backup_dir).map_err(|error| format!("Could not list backups: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Could not read backup entry: {error}"))?;
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.starts_with(&format!("{backup_id}.")) {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        backups.push((path, modified));
    }
    Ok(backups)
}

fn prune_backups(backup_dir: &Path, backup_id: &str) -> Result<(), String> {
    let mut backups = matching_backups(backup_dir, backup_id)?;
    backups.sort_by_key(|entry| std::cmp::Reverse(entry.1));
    let now = SystemTime::now();
    let mut kept_bytes = 0_u64;
    let mut pruned = false;
    for (index, (path, modified)) in backups.into_iter().enumerate() {
        let size = fs::metadata(&path).map(|metadata| metadata.len()).unwrap_or(0);
        let too_many = index >= BACKUP_LIMIT;
        let too_old = now
            .duration_since(modified)
            .map(|age| age > BACKUP_MAX_AGE)
            .unwrap_or(false);
        let too_large = index > 0 && kept_bytes.saturating_add(size) > BACKUP_MAX_TOTAL_BYTES;
        if too_many || too_old || too_large {
            let _ = fs::remove_file(path);
            pruned = true;
        } else {
            kept_bytes = kept_bytes.saturating_add(size);
        }
    }
    if pruned {
        if let Err(error) = sync_parent_dir(backup_dir) {
            eprintln!(
                "Backups were pruned, but ScieMD could not fsync the backup directory {}: {error}",
                backup_dir.to_string_lossy()
            );
        }
    }
    Ok(())
}

fn write_text_atomically(path: &Path, text: &str, label: &str) -> Result<(), String> {
    let temp_path = path.with_extension("tmp");
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&temp_path)
        .map_err(|error| format!("Could not write {label}: {error}"))?;
    if let Err(error) = file
        .write_all(text.as_bytes())
        .and_then(|_| file.sync_all())
    {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("Could not flush {label}: {error}"));
    }
    drop(file);
    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        format!("Could not finalize {label}: {error}")
    })?;
    if let Some(parent) = path.parent() {
        if let Err(error) = sync_parent_dir(parent) {
            eprintln!(
                "Backup {label} was written, but ScieMD could not fsync the backup directory {}: {error}",
                parent.to_string_lossy()
            );
        }
    }
    Ok(())
}

#[cfg(windows)]
fn sync_parent_dir(_parent: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
fn sync_parent_dir(parent: &Path) -> Result<(), String> {
    let directory = fs::File::open(parent)
        .map_err(|error| format!("open directory failed: {error}"))?;
    directory
        .sync_all()
        .map_err(|error| format!("sync directory failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::path_grants::{grant_file_and_parent, isolate_test_path_grants};
    use std::{env, fs};

    #[test]
    fn backups_create_gitignore_and_prune_to_limit() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-backups-{}", timestamp_ms()));
        fs::create_dir_all(&dir).unwrap();
        let document = dir.join("document.md");
        fs::write(&document, "# Test\n").unwrap();
        grant_file_and_parent(&document).unwrap();

        for index in 0..25 {
            create_backup_snapshot(
                document.to_string_lossy().to_string(),
                format!("manual-{index}"),
            )
            .unwrap();
        }

        let backup_dir = dir.join(".scienfy-backups");
        assert_eq!(
            fs::read_to_string(backup_dir.join(".gitignore")).unwrap(),
            "*\n"
        );
        assert!(
            list_backups(document.to_string_lossy().to_string())
                .unwrap()
                .len()
                <= BACKUP_LIMIT
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn backup_matching_does_not_prune_similar_file_names() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-backup-isolation-{}", timestamp_ms()));
        fs::create_dir_all(&dir).unwrap();
        let document = dir.join("paper.md");
        let similar = dir.join("paper.notes.md");
        fs::write(&document, "# Paper\n").unwrap();
        fs::write(&similar, "# Notes\n").unwrap();
        grant_file_and_parent(&document).unwrap();
        grant_file_and_parent(&similar).unwrap();

        create_backup_snapshot(document.to_string_lossy().to_string(), "manual".to_string())
            .unwrap();
        create_backup_snapshot(similar.to_string_lossy().to_string(), "manual".to_string())
            .unwrap();

        let document_backups = list_backups(document.to_string_lossy().to_string()).unwrap();
        let similar_backups = list_backups(similar.to_string_lossy().to_string()).unwrap();

        assert_eq!(document_backups.len(), 1);
        assert_eq!(similar_backups.len(), 1);
        assert!(document_backups[0].contains("paper-md."));
        assert!(similar_backups[0].contains("paper-notes-md."));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn backup_creation_leaves_no_temp_snapshot_on_success() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-backup-atomic-{}", timestamp_ms()));
        fs::create_dir_all(&dir).unwrap();
        let document = dir.join("paper.md");
        fs::write(&document, "# Paper\n").unwrap();
        grant_file_and_parent(&document).unwrap();

        create_backup_snapshot(document.to_string_lossy().to_string(), "manual".to_string())
            .unwrap();

        let backup_dir = dir.join(".scienfy-backups");
        let temp_count = fs::read_dir(&backup_dir)
            .unwrap()
            .flatten()
            .filter(|entry| {
                entry
                    .path()
                    .file_name()
                    .and_then(|value| value.to_str())
                    .is_some_and(|name| name.ends_with(".tmp"))
            })
            .count();
        assert_eq!(temp_count, 0);

        let _ = fs::remove_dir_all(dir);
    }
}
