use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::http::{self, header, StatusCode};

use super::path_grants::assert_file_read_allowed;

const MAX_LOCAL_IMAGE_BYTES: u64 = 25 * 1024 * 1024;

pub fn serve_local_image_request(request: http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    match local_image_response(request.uri().path()) {
        Ok((bytes, content_type)) => response(StatusCode::OK, content_type, bytes),
        Err((status, message)) => {
            response(status, "text/plain; charset=utf-8", message.into_bytes())
        }
    }
}

fn local_image_response(path: &str) -> Result<(Vec<u8>, &'static str), (StatusCode, String)> {
    let image_path = decode_image_path_token(path)?;
    assert_file_read_allowed(&image_path)
        .map_err(|_| (StatusCode::FORBIDDEN, "Image access denied.".to_string()))?;
    let content_type = image_content_type(&image_path).ok_or_else(|| {
        (
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "Unsupported image type.".to_string(),
        )
    })?;
    let metadata = fs::metadata(&image_path).map_err(|error| {
        (
            StatusCode::NOT_FOUND,
            format!("Could not read image metadata: {error}"),
        )
    })?;
    if !metadata.is_file() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Local image target is not a file.".to_string(),
        ));
    }
    if metadata.len() > MAX_LOCAL_IMAGE_BYTES {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            "Image is too large to preview.".to_string(),
        ));
    }
    fs::read(&image_path)
        .map(|bytes| (bytes, content_type))
        .map_err(|error| {
            (
                StatusCode::NOT_FOUND,
                format!("Could not read image: {error}"),
            )
        })
}

fn decode_image_path_token(path: &str) -> Result<PathBuf, (StatusCode, String)> {
    let token = path
        .trim_start_matches('/')
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("");
    if token.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Missing local image token.".to_string(),
        ));
    }
    let bytes = URL_SAFE_NO_PAD.decode(token).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            "Invalid local image token.".to_string(),
        )
    })?;
    let decoded = String::from_utf8(bytes).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            "Invalid local image path encoding.".to_string(),
        )
    })?;
    Ok(PathBuf::from(decoded))
}

fn response(
    status: StatusCode,
    content_type: &'static str,
    body: Vec<u8>,
) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .unwrap_or_else(|_| http::Response::new(Vec::new()))
}

fn image_content_type(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "tif" | "tiff" => Some("image/tiff"),
        "svg" => Some("image/svg+xml"),
        "avif" => Some("image/avif"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_image_path_token, image_content_type, local_image_response};
    use crate::commands::path_grants::{
        grant_file_and_parent, isolate_test_path_grants, sync_document_image_grants_for_markdown,
    };
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use std::{
        env, fs,
        path::Path,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn decodes_base64url_path_tokens_without_using_url_path_syntax() {
        let token = URL_SAFE_NO_PAD.encode(r"C:\outside-home\paper assets\figure 1.png");
        let decoded = decode_image_path_token(&format!("/{token}?ignored=1")).unwrap();

        assert_eq!(
            decoded,
            Path::new(r"C:\outside-home\paper assets\figure 1.png")
        );
    }

    #[test]
    fn local_image_protocol_serves_only_image_media_types() {
        assert_eq!(
            image_content_type(Path::new("figure.svg")),
            Some("image/svg+xml")
        );
        assert_eq!(
            image_content_type(Path::new("figure.png")),
            Some("image/png")
        );
        assert_eq!(image_content_type(Path::new("paper.md")), None);
    }

    #[test]
    fn local_image_protocol_requires_path_grants_before_serving_images() {
        let _grants = isolate_test_path_grants();
        let root = env::temp_dir().join(format!("scie-md-local-image-{}", suffix()));
        let assets = root.join("assets");
        fs::create_dir_all(&assets).unwrap();
        let document = root.join("paper.md");
        fs::write(&document, "# Paper\n\n![Figure](assets/figure.png)\n").unwrap();
        let image = assets.join("figure.png");
        fs::write(&image, [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]).unwrap();
        let token = URL_SAFE_NO_PAD.encode(image.to_string_lossy().as_bytes());

        let denied = local_image_response(&format!("/{token}")).unwrap_err();
        assert_eq!(denied.0, tauri::http::StatusCode::FORBIDDEN);

        grant_file_and_parent(&document).unwrap();
        sync_document_image_grants_for_markdown(
            &document,
            "# Paper\n\n![Figure](assets/figure.png)\n",
        )
        .unwrap();
        let (bytes, content_type) = local_image_response(&format!("/{token}")).unwrap();
        assert_eq!(content_type, "image/png");
        assert!(bytes.starts_with(&[0x89, b'P', b'N', b'G']));

        let _ = fs::remove_dir_all(root);
    }

    fn suffix() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    }
}
