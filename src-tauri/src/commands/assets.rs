use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use super::path_grants::{assert_file_read_allowed, assert_file_write_allowed};

const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyImageResponse {
    markdown_path: String,
    file_name: String,
    alt_text: String,
}

#[tauri::command]
pub fn copy_image_to_assets(
    document_path: String,
    image_path: String,
    alt_text: String,
) -> Result<CopyImageResponse, String> {
    let document = PathBuf::from(document_path);
    let image = PathBuf::from(image_path);
    assert_file_write_allowed(&document)?;
    assert_file_read_allowed(&image)?;
    validate_image_extension(&image)?;
    validate_image_file_size(&image)?;

    let parent = document
        .parent()
        .ok_or_else(|| "Document must be saved before inserting images.".to_string())?;
    let assets_dir = parent.join("assets");
    fs::create_dir_all(&assets_dir)
        .map_err(|error| format!("Could not create assets directory: {error}"))?;

    let file_name = image
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Image file has no valid file name.".to_string())?;
    let safe_file_name = sanitize_file_name(file_name);

    let mut bytes = Vec::new();
    fs::File::open(&image)
        .and_then(|mut file| file.read_to_end(&mut bytes))
        .map_err(|error| format!("Could not read image: {error}"))?;
    validate_image_signature(&image, &bytes)?;
    let destination = write_unique_asset(&assets_dir, &safe_file_name, &bytes)?;

    let copied_name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Copied image has no valid file name.".to_string())?
        .to_string();

    Ok(CopyImageResponse {
        markdown_path: format!("assets/{copied_name}"),
        file_name: copied_name,
        alt_text,
    })
}

#[tauri::command]
pub fn save_image_bytes_to_assets(
    document_path: String,
    file_name: String,
    bytes: Vec<u8>,
    alt_text: String,
) -> Result<CopyImageResponse, String> {
    let document = PathBuf::from(document_path);
    assert_file_write_allowed(&document)?;
    let safe_file_name = sanitize_file_name(
        Path::new(&file_name)
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("pasted-image.png"),
    );
    validate_image_extension(Path::new(&safe_file_name))?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("Image is too large. Use an image smaller than 25 MB.".to_string());
    }
    validate_image_signature(Path::new(&safe_file_name), &bytes)?;

    let parent = document
        .parent()
        .ok_or_else(|| "Document must be saved before inserting images.".to_string())?;
    let assets_dir = parent.join("assets");
    fs::create_dir_all(&assets_dir)
        .map_err(|error| format!("Could not create assets directory: {error}"))?;

    let destination = write_unique_asset(&assets_dir, &safe_file_name, &bytes)?;

    let copied_name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Copied image has no valid file name.".to_string())?
        .to_string();

    Ok(CopyImageResponse {
        markdown_path: format!("assets/{copied_name}"),
        file_name: copied_name,
        alt_text,
    })
}

fn validate_image_extension(path: &Path) -> Result<(), String> {
    let allowed = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"];
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if allowed.contains(&extension.as_str()) {
        Ok(())
    } else {
        Err("Unsupported image type.".to_string())
    }
}

fn validate_image_file_size(path: &Path) -> Result<(), String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("Could not read image metadata: {error}"))?;
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err("Image is too large. Use an image smaller than 25 MB.".to_string());
    }
    Ok(())
}

fn validate_image_signature(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let valid = match extension.as_str() {
        "png" => bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]),
        "jpg" | "jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "webp" => bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP",
        "bmp" => bytes.starts_with(b"BM"),
        "tif" | "tiff" => {
            bytes.starts_with(&[b'I', b'I', 42, 0]) || bytes.starts_with(&[b'M', b'M', 0, 42])
        }
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err("Image content does not match its file type.".to_string())
    }
}

#[cfg(test)]
fn unique_destination(assets_dir: &Path, file_name: &str) -> PathBuf {
    let base = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");

    let first = assets_dir.join(file_name);
    if !first.exists() {
        return first;
    }

    for index in 2..1000 {
        let candidate_name = if extension.is_empty() {
            format!("{base}-{index}")
        } else {
            format!("{base}-{index}.{extension}")
        };
        let candidate = assets_dir.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    assets_dir.join(format!("{base}-copy.{extension}"))
}

fn write_unique_asset(assets_dir: &Path, file_name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    for index in 1..1000 {
        let candidate = asset_candidate_path(assets_dir, file_name, index);
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(mut file) => {
                if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
                    drop(file);
                    let _ = fs::remove_file(&candidate);
                    return Err(format!("Could not save image: {error}"));
                }
                return Ok(candidate);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not save image: {error}")),
        }
    }
    Err("Could not choose a unique asset file name.".to_string())
}

fn asset_candidate_path(assets_dir: &Path, file_name: &str, index: usize) -> PathBuf {
    if index == 1 {
        return assets_dir.join(file_name);
    }

    let base = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let candidate_name = if extension.is_empty() {
        format!("{base}-{index}")
    } else {
        format!("{base}-{index}.{extension}")
    };
    assets_dir.join(candidate_name)
}

fn sanitize_file_name(file_name: &str) -> String {
    let sanitized: String = file_name
        .chars()
        .map(|ch| {
            if ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
            {
                '_'
            } else {
                ch
            }
        })
        .collect();
    let trimmed = sanitized.trim().trim_matches('.').to_string();
    let candidate = if trimmed.is_empty() {
        "image.png".to_string()
    } else {
        trimmed
    };
    let stem = Path::new(&candidate)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_uppercase();
    if matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    ) {
        format!("_{candidate}")
    } else {
        candidate
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::path_grants::{grant_file_and_parent, isolate_test_path_grants};
    use std::{
        env, fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn unique_destination_starts_conflicts_at_two() {
        let dir = env::temp_dir().join(format!("scie-md-assets-{}", suffix()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("image.png"), b"one").unwrap();

        assert_eq!(
            unique_destination(&dir, "image.png"),
            dir.join("image-2.png")
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn save_image_bytes_creates_assets_markdown_path() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-assets-{}", suffix()));
        fs::create_dir_all(&dir).unwrap();
        let document = dir.join("document.md");
        fs::write(&document, b"# Doc").unwrap();
        grant_file_and_parent(&document).unwrap();

        let image = save_image_bytes_to_assets(
            document.to_string_lossy().to_string(),
            "clipboard.png".to_string(),
            vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
            "clipboard".to_string(),
        )
        .unwrap();

        assert_eq!(image.markdown_path, "assets/clipboard.png");
        assert!(dir.join("assets").join("clipboard.png").exists());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn save_image_bytes_sanitizes_reserved_windows_asset_names() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-assets-reserved-{}", suffix()));
        fs::create_dir_all(&dir).unwrap();
        let document = dir.join("document.md");
        fs::write(&document, b"# Doc").unwrap();
        grant_file_and_parent(&document).unwrap();

        let image = save_image_bytes_to_assets(
            document.to_string_lossy().to_string(),
            "..\\NUL.png".to_string(),
            png_bytes(),
            "reserved".to_string(),
        )
        .unwrap();

        assert_eq!(image.file_name, "_NUL.png");
        assert_eq!(image.markdown_path, "assets/_NUL.png");
        assert!(dir.join("assets").join("_NUL.png").exists());
        assert!(!dir.join("NUL.png").exists());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn save_image_bytes_strips_nested_path_components_from_pasted_names() {
        let _grants = isolate_test_path_grants();
        let dir = env::temp_dir().join(format!("scie-md-assets-path-strip-{}", suffix()));
        fs::create_dir_all(&dir).unwrap();
        let document = dir.join("document.md");
        fs::write(&document, b"# Doc").unwrap();
        grant_file_and_parent(&document).unwrap();

        let image = save_image_bytes_to_assets(
            document.to_string_lossy().to_string(),
            "nested/clipboard.png".to_string(),
            png_bytes(),
            "clipboard".to_string(),
        )
        .unwrap();

        assert_eq!(image.file_name, "clipboard.png");
        assert_eq!(image.markdown_path, "assets/clipboard.png");
        assert!(dir.join("assets").join("clipboard.png").exists());
        assert!(!dir.join("assets").join("nested").exists());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn image_signature_must_match_extension() {
        let error =
            validate_image_signature(Path::new("clipboard.png"), &[137, 80, 78, 71]).unwrap_err();

        assert!(error.contains("does not match"));
        assert!(validate_image_signature(
            Path::new("clipboard.png"),
            &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
        )
        .is_ok());
    }

    fn suffix() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    }

    fn png_bytes() -> Vec<u8> {
        vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]
    }
}
