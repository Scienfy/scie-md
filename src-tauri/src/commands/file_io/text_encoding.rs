use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

pub(super) struct LineEndingDetection {
    pub(super) line_ending: String,
    pub(super) has_mixed_line_endings: bool,
}

pub(super) fn detect_line_endings(content: &str) -> LineEndingDetection {
    let crlf = content.matches("\r\n").count();
    let lf = content.matches('\n').count().saturating_sub(crlf);
    let cr = content.matches('\r').count().saturating_sub(crlf);
    let styles = [crlf > 0, lf > 0, cr > 0]
        .into_iter()
        .filter(|style_present| *style_present)
        .count();

    LineEndingDetection {
        line_ending: if crlf > lf + cr {
            "crlf".to_string()
        } else {
            "lf".to_string()
        },
        has_mixed_line_endings: styles > 1,
    }
}

pub(super) fn normalize_to_lf(content: &str) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n")
}

pub(super) fn readable_file_kind(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "md" | "markdown" => Some("markdown"),
        "json" => Some("json"),
        "jsonl" | "ndjson" => Some("jsonl"),
        "yaml" | "yml" => Some("yaml"),
        "toml" => Some("toml"),
        "xml" => Some("xml"),
        "csv" => Some("csv"),
        "tsv" => Some("tsv"),
        "txt" | "text" => Some("plainText"),
        _ => None,
    }
}

pub(super) fn metadata_mtime_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .unwrap_or(SystemTime::UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

pub(super) fn unix_timestamp_for_file_name() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub(super) struct DecodedText {
    pub(super) raw: String,
    pub(super) encoding: String,
    pub(super) has_bom: bool,
}

pub(super) fn decode_text_bytes(bytes: &[u8]) -> Result<DecodedText, String> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        let raw = String::from_utf8(bytes[3..].to_vec())
            .map_err(|error| format!("File has a UTF-8 BOM but contains invalid UTF-8: {error}"))?;
        return Ok(DecodedText {
            raw,
            encoding: "utf8".to_string(),
            has_bom: true,
        });
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return Ok(DecodedText {
            raw: decode_utf16(&bytes[2..], true),
            encoding: "utf16le".to_string(),
            has_bom: true,
        });
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return Ok(DecodedText {
            raw: decode_utf16(&bytes[2..], false),
            encoding: "utf16be".to_string(),
            has_bom: true,
        });
    }
    if let Ok(raw) = String::from_utf8(bytes.to_vec()) {
        return Ok(DecodedText {
            raw,
            encoding: "utf8".to_string(),
            has_bom: false,
        });
    }
    if looks_like_utf16(bytes, true) {
        return Ok(DecodedText {
            raw: decode_utf16(bytes, true),
            encoding: "utf16le".to_string(),
            has_bom: false,
        });
    }
    if looks_like_utf16(bytes, false) {
        return Ok(DecodedText {
            raw: decode_utf16(bytes, false),
            encoding: "utf16be".to_string(),
            has_bom: false,
        });
    }
    Ok(DecodedText {
        raw: decode_windows_1252(bytes),
        encoding: "windows1252".to_string(),
        has_bom: false,
    })
}

pub(super) fn decode_text_bytes_lossy(bytes: &[u8]) -> DecodedText {
    decode_text_bytes(bytes).unwrap_or_else(|_| DecodedText {
        raw: decode_windows_1252(bytes),
        encoding: "windows1252".to_string(),
        has_bom: false,
    })
}

fn decode_utf16(bytes: &[u8], little_endian: bool) -> String {
    let units = bytes.chunks_exact(2).map(|chunk| {
        if little_endian {
            u16::from_le_bytes([chunk[0], chunk[1]])
        } else {
            u16::from_be_bytes([chunk[0], chunk[1]])
        }
    });
    std::char::decode_utf16(units)
        .map(|result| result.unwrap_or(char::REPLACEMENT_CHARACTER))
        .collect()
}

fn looks_like_utf16(bytes: &[u8], little_endian: bool) -> bool {
    if bytes.len() < 8 || !bytes.len().is_multiple_of(2) {
        return false;
    }
    let pairs = bytes.len() / 2;
    let nul_position = if little_endian { 1 } else { 0 };
    let nul_count = bytes
        .chunks_exact(2)
        .filter(|chunk| chunk[nul_position] == 0)
        .count();
    nul_count * 2 >= pairs
}

fn decode_windows_1252(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| match *byte {
            0x80 => '\u{20AC}',
            0x82 => '\u{201A}',
            0x83 => '\u{0192}',
            0x84 => '\u{201E}',
            0x85 => '\u{2026}',
            0x86 => '\u{2020}',
            0x87 => '\u{2021}',
            0x88 => '\u{02C6}',
            0x89 => '\u{2030}',
            0x8A => '\u{0160}',
            0x8B => '\u{2039}',
            0x8C => '\u{0152}',
            0x8E => '\u{017D}',
            0x91 => '\u{2018}',
            0x92 => '\u{2019}',
            0x93 => '\u{201C}',
            0x94 => '\u{201D}',
            0x95 => '\u{2022}',
            0x96 => '\u{2013}',
            0x97 => '\u{2014}',
            0x98 => '\u{02DC}',
            0x99 => '\u{2122}',
            0x9A => '\u{0161}',
            0x9B => '\u{203A}',
            0x9C => '\u{0153}',
            0x9E => '\u{017E}',
            0x9F => '\u{0178}',
            value => char::from(value),
        })
        .collect()
}

pub(super) fn markdown_to_bytes(
    markdown: &str,
    line_ending: &str,
    encoding: &str,
    has_bom: bool,
) -> Result<Vec<u8>, String> {
    let normalized = normalize_to_lf(markdown);
    let output = if line_ending == "crlf" {
        normalized.replace('\n', "\r\n")
    } else {
        normalized
    };

    match encoding {
        "utf8" => {
            let mut bytes = Vec::with_capacity(output.len() + if has_bom { 3 } else { 0 });
            if has_bom {
                bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
            }
            bytes.extend_from_slice(output.as_bytes());
            Ok(bytes)
        }
        "utf16le" => Ok(encode_utf16_bytes(&output, true, has_bom)),
        "utf16be" => Ok(encode_utf16_bytes(&output, false, has_bom)),
        "windows1252" => encode_windows_1252(&output),
        other => Err(format!("Unsupported text encoding: {other}")),
    }
}

fn encode_utf16_bytes(content: &str, little_endian: bool, has_bom: bool) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(content.len() * 2 + if has_bom { 2 } else { 0 });
    if has_bom {
        bytes.extend_from_slice(if little_endian {
            &[0xFF, 0xFE]
        } else {
            &[0xFE, 0xFF]
        });
    }
    for unit in content.encode_utf16() {
        let encoded = if little_endian {
            unit.to_le_bytes()
        } else {
            unit.to_be_bytes()
        };
        bytes.extend_from_slice(&encoded);
    }
    bytes
}

fn encode_windows_1252(content: &str) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::with_capacity(content.len());
    for character in content.chars() {
        let encoded = match character {
            '\u{20AC}' => 0x80,
            '\u{201A}' => 0x82,
            '\u{0192}' => 0x83,
            '\u{201E}' => 0x84,
            '\u{2026}' => 0x85,
            '\u{2020}' => 0x86,
            '\u{2021}' => 0x87,
            '\u{02C6}' => 0x88,
            '\u{2030}' => 0x89,
            '\u{0160}' => 0x8A,
            '\u{2039}' => 0x8B,
            '\u{0152}' => 0x8C,
            '\u{017D}' => 0x8E,
            '\u{2018}' => 0x91,
            '\u{2019}' => 0x92,
            '\u{201C}' => 0x93,
            '\u{201D}' => 0x94,
            '\u{2022}' => 0x95,
            '\u{2013}' => 0x96,
            '\u{2014}' => 0x97,
            '\u{02DC}' => 0x98,
            '\u{2122}' => 0x99,
            '\u{0161}' => 0x9A,
            '\u{203A}' => 0x9B,
            '\u{0153}' => 0x9C,
            '\u{017E}' => 0x9E,
            '\u{0178}' => 0x9F,
            value if u32::from(value) <= 0xFF => value as u8,
            value => {
                return Err(format!(
                    "Character U+{:04X} cannot be saved using Windows-1252 encoding.",
                    u32::from(value)
                ));
            }
        };
        bytes.push(encoded);
    }
    Ok(bytes)
}

pub(super) fn content_hash(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}
