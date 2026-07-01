use std::{collections::BTreeSet, ops::Range};

use serde::Serialize;
use toml_edit::{Document, DocumentMut, Item, Table, Value};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum TomlPathSegment {
    Key(String),
    Index(usize),
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TomlSourceSpan {
    pub offset: usize,
    pub length: usize,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TomlSourceMapStatus {
    Valid,
    Invalid,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum TomlUnsupportedKind {
    ArrayOfTables,
    Comment,
    DottedKey,
    InlineTable,
    MultilineString,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TomlSourceMapDiagnostic {
    pub severity: String,
    pub code: String,
    pub message: String,
    pub span: Option<TomlSourceSpan>,
    pub line: Option<usize>,
    pub column: Option<usize>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TomlUnsupportedFeature {
    pub kind: TomlUnsupportedKind,
    pub code: String,
    pub message: String,
    pub path: Vec<TomlPathSegment>,
    pub pointer: String,
    pub display_path: String,
    pub span: Option<TomlSourceSpan>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TomlSourceMapNode {
    pub path: Vec<TomlPathSegment>,
    pub pointer: String,
    pub display_path: String,
    pub kind: String,
    pub value_type: String,
    pub span: Option<TomlSourceSpan>,
    pub editable_candidate: bool,
    pub unsupported_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TomlSourceMapSummary {
    pub node_count: usize,
    pub spanned_node_count: usize,
    pub scalar_node_count: usize,
    pub table_node_count: usize,
    pub array_of_tables_node_count: usize,
    pub unsupported_feature_count: usize,
    pub unsupported_kinds: Vec<TomlUnsupportedKind>,
    pub no_op_round_trip_preserved: bool,
    pub visual_writes_enabled: bool,
    pub boundary_status: String,
    pub command_scope: String,
    pub recommended_boundary: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TomlSourceMapReport {
    pub status: TomlSourceMapStatus,
    pub diagnostics: Vec<TomlSourceMapDiagnostic>,
    pub nodes: Vec<TomlSourceMapNode>,
    pub unsupported_features: Vec<TomlUnsupportedFeature>,
    pub summary: TomlSourceMapSummary,
}

#[tauri::command]
pub fn inspect_toml_source_map(source_text: String) -> TomlSourceMapReport {
    inspect_toml_source_map_text(&source_text)
}

pub fn inspect_toml_source_map_text(source: &str) -> TomlSourceMapReport {
    let document = match source.parse::<Document<String>>() {
        Ok(document) => document,
        Err(error) => {
            let span = error.span().map(|range| source_span(source, range));
            let diagnostic = TomlSourceMapDiagnostic {
                severity: "error".into(),
                code: "toml-source-map-parse-error".into(),
                message: error.to_string(),
                line: span.as_ref().map(|span| span.line),
                column: span.as_ref().map(|span| span.column),
                span,
            };
            return TomlSourceMapReport {
                status: TomlSourceMapStatus::Invalid,
                diagnostics: vec![diagnostic],
                nodes: Vec::new(),
                unsupported_features: Vec::new(),
                summary: TomlSourceMapSummary {
                    node_count: 0,
                    spanned_node_count: 0,
                    scalar_node_count: 0,
                    table_node_count: 0,
                    array_of_tables_node_count: 0,
                    unsupported_feature_count: 0,
                    unsupported_kinds: Vec::new(),
                    no_op_round_trip_preserved: false,
                    visual_writes_enabled: false,
                    boundary_status: boundary_status(),
                    command_scope: command_scope(),
                    recommended_boundary: recommended_boundary(),
                },
            };
        }
    };

    let mut nodes = Vec::new();
    let mut unsupported_features = collect_comment_features(source);
    collect_item(
        source,
        document.as_item(),
        Vec::new(),
        &mut nodes,
        &mut unsupported_features,
    );
    let unsupported_kinds = unsupported_features
        .iter()
        .map(|feature| feature.kind.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let no_op_round_trip_preserved = source
        .parse::<DocumentMut>()
        .map(|document| document.to_string() == source)
        .unwrap_or(false);

    TomlSourceMapReport {
        status: TomlSourceMapStatus::Valid,
        diagnostics: Vec::new(),
        summary: TomlSourceMapSummary {
            node_count: nodes.len(),
            spanned_node_count: nodes.iter().filter(|node| node.span.is_some()).count(),
            scalar_node_count: nodes.iter().filter(|node| node.kind == "scalar").count(),
            table_node_count: nodes.iter().filter(|node| node.kind == "table").count(),
            array_of_tables_node_count: nodes
                .iter()
                .filter(|node| node.kind == "array-of-tables")
                .count(),
            unsupported_feature_count: unsupported_features.len(),
            unsupported_kinds,
            no_op_round_trip_preserved,
            visual_writes_enabled: false,
            boundary_status: boundary_status(),
            command_scope: command_scope(),
            recommended_boundary: recommended_boundary(),
        },
        nodes,
        unsupported_features,
    }
}

fn collect_item(
    source: &str,
    item: &Item,
    path: Vec<TomlPathSegment>,
    nodes: &mut Vec<TomlSourceMapNode>,
    unsupported_features: &mut Vec<TomlUnsupportedFeature>,
) {
    let kind = item_kind(item);
    push_node(
        source,
        item.span(),
        path.clone(),
        kind,
        item.type_name(),
        nodes,
    );

    match item {
        Item::Table(table) => collect_table(source, table, path, nodes, unsupported_features),
        Item::ArrayOfTables(array_of_tables) => {
            unsupported_features.push(unsupported_feature(
                source,
                TomlUnsupportedKind::ArrayOfTables,
                "toml-array-table-readonly",
                "TOML arrays of tables need table-identity-aware source patches before visual edits are safe.",
                &path,
                array_of_tables.span(),
            ));
            for (index, table) in array_of_tables.iter().enumerate() {
                let mut child_path = path.clone();
                child_path.push(TomlPathSegment::Index(index));
                push_node(
                    source,
                    table.span(),
                    child_path.clone(),
                    "table",
                    "table",
                    nodes,
                );
                collect_table(source, table, child_path, nodes, unsupported_features);
            }
        }
        Item::Value(value) => collect_value(source, value, path, nodes, unsupported_features),
        Item::None => {}
    }
}

fn collect_table(
    source: &str,
    table: &Table,
    path: Vec<TomlPathSegment>,
    nodes: &mut Vec<TomlSourceMapNode>,
    unsupported_features: &mut Vec<TomlUnsupportedFeature>,
) {
    if table.is_dotted() {
        unsupported_features.push(unsupported_feature(
            source,
            TomlUnsupportedKind::DottedKey,
            "toml-dotted-key-readonly",
            "TOML dotted keys can reorder or expand into implicit tables and need a guarded patch planner.",
            &path,
            table.span(),
        ));
    }
    for (key, child) in table.iter() {
        let mut child_path = path.clone();
        child_path.push(TomlPathSegment::Key(key.to_string()));
        collect_item(source, child, child_path, nodes, unsupported_features);
    }
}

fn collect_value(
    source: &str,
    value: &Value,
    path: Vec<TomlPathSegment>,
    nodes: &mut Vec<TomlSourceMapNode>,
    unsupported_features: &mut Vec<TomlUnsupportedFeature>,
) {
    match value {
        Value::Array(array) => {
            for (index, child) in array.iter().enumerate() {
                let mut child_path = path.clone();
                child_path.push(TomlPathSegment::Index(index));
                push_node(
                    source,
                    child.span(),
                    child_path.clone(),
                    value_kind(child),
                    child.type_name(),
                    nodes,
                );
                collect_value(source, child, child_path, nodes, unsupported_features);
            }
        }
        Value::InlineTable(table) => {
            unsupported_features.push(unsupported_feature(
                source,
                TomlUnsupportedKind::InlineTable,
                "toml-inline-table-readonly",
                "TOML inline tables need punctuation-aware source patches before visual edits are safe.",
                &path,
                table.span(),
            ));
            for (key, child) in table.iter() {
                let mut child_path = path.clone();
                child_path.push(TomlPathSegment::Key(key.to_string()));
                push_node(
                    source,
                    child.span(),
                    child_path.clone(),
                    value_kind(child),
                    child.type_name(),
                    nodes,
                );
                collect_value(source, child, child_path, nodes, unsupported_features);
            }
        }
        _ => {
            if is_multiline_string(source, value.span()) {
                unsupported_features.push(unsupported_feature(
                    source,
                    TomlUnsupportedKind::MultilineString,
                    "toml-multiline-string-readonly",
                    "TOML multiline string style and indentation must be preserved before visual edits are safe.",
                    &path,
                    value.span(),
                ));
            }
        }
    }
}

fn push_node(
    source: &str,
    span: Option<Range<usize>>,
    path: Vec<TomlPathSegment>,
    kind: &str,
    value_type: &str,
    nodes: &mut Vec<TomlSourceMapNode>,
) {
    let span = span.map(|range| source_span(source, range));
    nodes.push(TomlSourceMapNode {
        pointer: pointer_from_path(&path),
        display_path: display_path_from_path(&path),
        path,
        kind: kind.into(),
        value_type: value_type.into(),
        editable_candidate: false,
        unsupported_reason: Some(
            "TOML visual writes remain disabled until the toml_edit source-map command is paired with a fixture-backed patch planner."
                .into(),
        ),
        span,
    });
}

fn unsupported_feature(
    source: &str,
    kind: TomlUnsupportedKind,
    code: &str,
    message: &str,
    path: &[TomlPathSegment],
    span: Option<Range<usize>>,
) -> TomlUnsupportedFeature {
    TomlUnsupportedFeature {
        kind,
        code: code.into(),
        message: message.into(),
        path: path.to_vec(),
        pointer: pointer_from_path(path),
        display_path: display_path_from_path(path),
        span: span.map(|range| source_span(source, range)),
    }
}

fn collect_comment_features(source: &str) -> Vec<TomlUnsupportedFeature> {
    let mut features = Vec::new();
    let mut offset = 0;
    for line in source.split('\n') {
        if let Some(comment_index) = unquoted_comment_index(line) {
            features.push(TomlUnsupportedFeature {
                kind: TomlUnsupportedKind::Comment,
                code: "toml-comments-readonly".into(),
                message: "TOML comments are source-only and need targeted source patches.".into(),
                path: Vec::new(),
                pointer: String::new(),
                display_path: "$".into(),
                span: Some(source_span(
                    source,
                    offset + comment_index..offset + line.len(),
                )),
            });
        }
        offset += line.len() + 1;
    }
    features
}

fn unquoted_comment_index(line: &str) -> Option<usize> {
    let mut quote: Option<char> = None;
    let mut previous = '\0';
    for (index, character) in line.char_indices() {
        if (quote == Some('"') && character == '"' && previous != '\\')
            || (quote == Some('\'') && character == '\'')
        {
            quote = None;
        } else if quote.is_none() && (character == '"' || character == '\'') {
            quote = Some(character);
        } else if quote.is_none() && character == '#' {
            return Some(index);
        }
        previous = character;
    }
    None
}

fn source_span(source: &str, range: Range<usize>) -> TomlSourceSpan {
    let start = range.start.min(source.len());
    let end = range.end.min(source.len()).max(start);
    let (line, column) = line_column_from_offset(source, start);
    TomlSourceSpan {
        offset: start,
        length: end - start,
        line,
        column,
    }
}

fn line_column_from_offset(source: &str, offset: usize) -> (usize, usize) {
    let mut line = 1;
    let mut line_start = 0;
    for (index, character) in source.char_indices() {
        if index >= offset {
            break;
        }
        if character == '\n' {
            line += 1;
            line_start = index + 1;
        }
    }
    (line, offset.saturating_sub(line_start) + 1)
}

fn item_kind(item: &Item) -> &'static str {
    match item {
        Item::None => "none",
        Item::Table(_) => "table",
        Item::ArrayOfTables(_) => "array-of-tables",
        Item::Value(value) => value_kind(value),
    }
}

fn value_kind(value: &Value) -> &'static str {
    match value {
        Value::Array(_) => "array",
        Value::InlineTable(_) => "inline-table",
        _ => "scalar",
    }
}

fn is_multiline_string(source: &str, span: Option<Range<usize>>) -> bool {
    let Some(span) = span else {
        return false;
    };
    let Some(raw) = source.get(span) else {
        return false;
    };
    raw.trim_start().starts_with("\"\"\"") || raw.trim_start().starts_with("'''")
}

fn pointer_from_path(path: &[TomlPathSegment]) -> String {
    if path.is_empty() {
        return String::new();
    }
    path.iter()
        .map(|segment| format!("/{}", escape_pointer_segment(&segment_string(segment))))
        .collect::<Vec<_>>()
        .join("")
}

fn display_path_from_path(path: &[TomlPathSegment]) -> String {
    let mut display = "$".to_string();
    for segment in path {
        match segment {
            TomlPathSegment::Index(index) => display.push_str(&format!("[{index}]")),
            TomlPathSegment::Key(key) if is_identifier_like(key) => {
                display.push('.');
                display.push_str(key);
            }
            TomlPathSegment::Key(key) => {
                display.push('[');
                display.push_str(&serde_json::to_string(key).unwrap_or_else(|_| "\"?\"".into()));
                display.push(']');
            }
        }
    }
    display
}

fn segment_string(segment: &TomlPathSegment) -> String {
    match segment {
        TomlPathSegment::Key(key) => key.clone(),
        TomlPathSegment::Index(index) => index.to_string(),
    }
}

fn escape_pointer_segment(value: &str) -> String {
    value.replace('~', "~0").replace('/', "~1")
}

fn is_identifier_like(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first.is_ascii_alphabetic() || first == '_' || first == '$')
        && chars.all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '$'
        })
}

fn recommended_boundary() -> String {
    "rust-toml-edit-source-map-command".into()
}

fn boundary_status() -> String {
    "experimental-readonly-evidence".into()
}

fn command_scope() -> String {
    "inspect-source-map-only".into()
}

#[cfg(test)]
mod tests {
    use super::{inspect_toml_source_map_text, TomlSourceMapStatus, TomlUnsupportedKind};

    #[test]
    fn returns_spanned_nodes_without_enabling_visual_writes() {
        let source = [
            "# catalog",
            "title = \"Dataset\"",
            "[server]",
            "port = 8080",
            "",
        ]
        .join("\n");
        let report = inspect_toml_source_map_text(&source);

        assert_eq!(report.status, TomlSourceMapStatus::Valid);
        assert!(report.summary.no_op_round_trip_preserved);
        assert!(!report.summary.visual_writes_enabled);
        assert_eq!(report.summary.boundary_status, "experimental-readonly-evidence");
        assert_eq!(report.summary.command_scope, "inspect-source-map-only");
        assert_eq!(
            report.summary.recommended_boundary,
            "rust-toml-edit-source-map-command"
        );
        assert!(report.summary.node_count >= 4);
        assert!(report.summary.spanned_node_count >= 3);
        assert!(report.nodes.iter().any(|node| {
            node.pointer == "/server/port"
                && node.kind == "scalar"
                && node.span.as_ref().is_some_and(|span| span.line == 4)
        }));
        assert!(report.unsupported_features.iter().any(|feature| {
            feature.kind == TomlUnsupportedKind::Comment
                && feature.span.as_ref().is_some_and(|span| span.line == 1)
        }));
    }

    #[test]
    fn classifies_toml_preservation_blockers() {
        let source = [
            "owner.name = \"Ada\"",
            "inline = { ok = true }",
            "notes = \"\"\"",
            "Line one",
            "\"\"\"",
            "[[products]]",
            "sku = \"A-001\"",
            "",
        ]
        .join("\n");
        let report = inspect_toml_source_map_text(&source);

        assert_eq!(report.status, TomlSourceMapStatus::Valid);
        assert!(report
            .summary
            .unsupported_kinds
            .contains(&TomlUnsupportedKind::DottedKey));
        assert!(report
            .summary
            .unsupported_kinds
            .contains(&TomlUnsupportedKind::InlineTable));
        assert!(report
            .summary
            .unsupported_kinds
            .contains(&TomlUnsupportedKind::MultilineString));
        assert!(report
            .summary
            .unsupported_kinds
            .contains(&TomlUnsupportedKind::ArrayOfTables));
        assert!(report.nodes.iter().all(|node| !node.editable_candidate));
    }

    #[test]
    fn reports_invalid_toml_without_source_nodes() {
        let report = inspect_toml_source_map_text("name = \"A\"\nname = \"B\"\n");

        assert_eq!(report.status, TomlSourceMapStatus::Invalid);
        assert_eq!(report.nodes.len(), 0);
        assert_eq!(report.summary.node_count, 0);
        assert_eq!(report.diagnostics.len(), 1);
        assert_eq!(report.diagnostics[0].severity, "error");
    }
}
