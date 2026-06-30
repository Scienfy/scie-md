use std::{fs, io::Write, path::Path};

use regex::Regex;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

use super::browser_pdf::decode_basic_html_entities;

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub(super) fn write_native_docx_from_html(html: &str, output_path: &Path) -> Result<(), String> {
    let blocks = html_to_docx_blocks(html);
    let theme = docx_theme_from_html(html);
    let document_xml = build_docx_document_xml(&blocks, &theme);

    let file = fs::File::create(output_path)
        .map_err(|error| format!("Could not create DOCX export: {error}"))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    write_zip_entry(&mut zip, "[Content_Types].xml", DOCX_CONTENT_TYPES, options)?;
    write_zip_entry(&mut zip, "_rels/.rels", DOCX_ROOT_RELS, options)?;
    write_zip_entry(&mut zip, "word/document.xml", &document_xml, options)?;
    write_zip_entry(
        &mut zip,
        "word/_rels/document.xml.rels",
        DOCX_DOCUMENT_RELS,
        options,
    )?;
    write_zip_entry(&mut zip, "word/settings.xml", DOCX_SETTINGS, options)?;
    let file = zip
        .finish()
        .map_err(|error| format!("Could not finalize DOCX export: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("Could not flush DOCX export: {error}"))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DocxBlockKind {
    Title,
    Heading1,
    Heading2,
    Heading3,
    Paragraph,
    ListItem,
    Caption,
}

#[derive(Clone, Debug)]
struct DocxBlock {
    kind: DocxBlockKind,
    text: String,
}

#[derive(Clone, Debug)]
struct DocxTheme {
    background: &'static str,
    text: &'static str,
    muted: &'static str,
    font: &'static str,
}

fn html_to_docx_blocks(html: &str) -> Vec<DocxBlock> {
    let body = html_body(html);
    let block_pattern = Regex::new(
        r"(?is)<(h1|h2|h3|p|li|figcaption|th|td)[^>]*>(.*?)</(?:h1|h2|h3|p|li|figcaption|th|td)>",
    )
    .expect("DOCX HTML block regex should compile");
    let mut blocks = Vec::new();
    for capture in block_pattern.captures_iter(body) {
        let tag = capture
            .get(1)
            .map(|value| value.as_str().to_ascii_lowercase())
            .unwrap_or_default();
        let text = capture
            .get(2)
            .map(|value| html_fragment_to_text(value.as_str()))
            .unwrap_or_default();
        if text.is_empty() {
            continue;
        }
        let kind = match tag.as_str() {
            "h1" if blocks.is_empty() => DocxBlockKind::Title,
            "h1" => DocxBlockKind::Heading1,
            "h2" => DocxBlockKind::Heading2,
            "h3" => DocxBlockKind::Heading3,
            "li" => DocxBlockKind::ListItem,
            "figcaption" => DocxBlockKind::Caption,
            _ => DocxBlockKind::Paragraph,
        };
        if blocks
            .last()
            .is_some_and(|last: &DocxBlock| last.kind == kind && last.text == text)
        {
            continue;
        }
        blocks.push(DocxBlock { kind, text });
    }

    if blocks.is_empty() {
        let text = html_fragment_to_text(body);
        if !text.is_empty() {
            blocks.push(DocxBlock {
                kind: DocxBlockKind::Paragraph,
                text,
            });
        }
    }

    blocks
}

fn html_body(html: &str) -> &str {
    let lower = html.to_ascii_lowercase();
    let start = lower
        .find("<body")
        .and_then(|index| lower[index..].find('>').map(|offset| index + offset + 1))
        .unwrap_or(0);
    let end = lower[start..]
        .find("</body>")
        .map(|offset| start + offset)
        .unwrap_or(html.len());
    &html[start..end]
}

fn html_fragment_to_text(fragment: &str) -> String {
    let without_svg = Regex::new(r"(?is)<svg\b[\s\S]*?</svg>")
        .expect("SVG strip regex should compile")
        .replace_all(fragment, "[SVG figure]");
    let with_breaks = Regex::new(r"(?is)<br\s*/?>")
        .expect("HTML break regex should compile")
        .replace_all(&without_svg, "\n");
    let no_tags = Regex::new(r"(?is)<[^>]+>")
        .expect("HTML tag regex should compile")
        .replace_all(&with_breaks, " ");
    let decoded = decode_html_text(&no_tags);
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn decode_html_text(value: &str) -> String {
    let mut output = decode_basic_html_entities(value);
    let decimal_pattern = Regex::new(r"&#([0-9]+);").expect("decimal entity regex should compile");
    output = decimal_pattern
        .replace_all(&output, |capture: &regex::Captures<'_>| {
            capture
                .get(1)
                .and_then(|digits| digits.as_str().parse::<u32>().ok())
                .and_then(char::from_u32)
                .map(|character| character.to_string())
                .unwrap_or_else(|| capture[0].to_string())
        })
        .to_string();
    let hex_pattern = Regex::new(r"&#x([0-9a-fA-F]+);").expect("hex entity regex should compile");
    hex_pattern
        .replace_all(&output, |capture: &regex::Captures<'_>| {
            capture
                .get(1)
                .and_then(|digits| u32::from_str_radix(digits.as_str(), 16).ok())
                .and_then(char::from_u32)
                .map(|character| character.to_string())
                .unwrap_or_else(|| capture[0].to_string())
        })
        .to_string()
}

fn docx_theme_from_html(html: &str) -> DocxTheme {
    let dark = html.contains("data-theme=\"dark\"") || html.contains("data-theme='dark'");
    if dark {
        DocxTheme {
            background: "111817",
            text: "EAF1EF",
            muted: "A7B7B3",
            font: "Scie Sans",
        }
    } else {
        DocxTheme {
            background: "FFFFFF",
            text: "102A33",
            muted: "5B6B73",
            font: "Scie Sans",
        }
    }
}

fn build_docx_document_xml(blocks: &[DocxBlock], theme: &DocxTheme) -> String {
    let body = if blocks.is_empty() {
        docx_paragraph_xml(
            &DocxBlock {
                kind: DocxBlockKind::Paragraph,
                text: "ScieMD export".to_string(),
            },
            theme,
        )
    } else {
        blocks
            .iter()
            .map(|block| docx_paragraph_xml(block, theme))
            .collect::<Vec<_>>()
            .join("")
    };

    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:background w:color="{background}"/>
  <w:body>
    {body}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1080" w:right="1260" w:bottom="1080" w:left="1260" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>"#,
        background = theme.background,
    )
}

fn docx_paragraph_xml(block: &DocxBlock, theme: &DocxTheme) -> String {
    let (size, bold, italic, before, after, color, prefix) = match block.kind {
        DocxBlockKind::Title => (44, false, false, 160, 260, theme.text, ""),
        DocxBlockKind::Heading1 => (34, true, false, 360, 160, theme.text, ""),
        DocxBlockKind::Heading2 => (28, true, false, 280, 120, theme.text, ""),
        DocxBlockKind::Heading3 => (24, true, false, 220, 100, theme.text, ""),
        DocxBlockKind::ListItem => (22, false, false, 60, 80, theme.text, "- "),
        DocxBlockKind::Caption => (20, false, true, 60, 160, theme.muted, ""),
        DocxBlockKind::Paragraph => (22, false, false, 100, 120, theme.text, ""),
    };
    let bold_xml = if bold { "<w:b/>" } else { "" };
    let italic_xml = if italic { "<w:i/>" } else { "" };
    let indent_xml = if block.kind == DocxBlockKind::ListItem {
        r#"<w:ind w:left="360" w:hanging="180"/>"#
    } else {
        ""
    };
    let text = format!("{prefix}{}", block.text);
    format!(
        r#"<w:p>
  <w:pPr>
    <w:spacing w:before="{before}" w:after="{after}" w:line="300" w:lineRule="auto"/>
    <w:shd w:val="clear" w:color="auto" w:fill="{background}"/>
    {indent_xml}
  </w:pPr>
  <w:r>
    <w:rPr>
      <w:rFonts w:ascii="{font}" w:hAnsi="{font}" w:cs="{font}"/>
      <w:color w:val="{color}"/>
      <w:sz w:val="{size}"/>
      {bold_xml}{italic_xml}
    </w:rPr>
    <w:t xml:space="preserve">{text}</w:t>
  </w:r>
</w:p>"#,
        background = theme.background,
        font = escape_xml(theme.font),
        text = escape_xml(&text),
    )
}

fn write_zip_entry(
    zip: &mut ZipWriter<fs::File>,
    name: &str,
    content: &str,
    options: SimpleFileOptions,
) -> Result<(), String> {
    zip.start_file(name, options)
        .map_err(|error| format!("Could not write DOCX entry {name}: {error}"))?;
    zip.write_all(content.as_bytes())
        .map_err(|error| format!("Could not write DOCX entry {name}: {error}"))
}

const DOCX_CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
</Types>"#;

const DOCX_ROOT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#;

const DOCX_DOCUMENT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="settings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
</Relationships>"#;

const DOCX_SETTINGS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:displayBackgroundShape/>
</w:settings>"#;
