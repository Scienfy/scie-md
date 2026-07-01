use std::{fs, ops::Range, path::PathBuf};

use toml_edit::{value, Document, DocumentMut, Table};

const VALID_FIXTURES: &[&str] = &[
    "comments-and-whitespace.toml",
    "dotted-keys.toml",
    "arrays-of-tables.toml",
    "arrays-of-tables-insertion.toml",
    "comments-attached-to-keys.toml",
    "multiline-strings.toml",
    "inline-tables.toml",
    "section-ordering.toml",
    "dotted-key-edit-risk.toml",
];

#[test]
fn toml_edit_noop_round_trip_preserves_valid_fixture_source() {
    for fixture_name in VALID_FIXTURES {
        let source = read_fixture(fixture_name);
        let document = parse_mut_document(&source, fixture_name);

        assert_eq!(
            document.to_string(),
            source,
            "{fixture_name} should round-trip byte-for-byte without edits"
        );
    }
}

#[test]
fn toml_edit_scalar_patch_preserves_unrelated_comments_tables_and_order() {
    let source = read_fixture("arrays-of-tables.toml");
    let mut document = parse_mut_document(&source, "arrays-of-tables.toml");

    document["catalog"]["title"] = value("Archived parts");
    let patched = document.to_string();

    assert!(patched.contains("# Inventory array-of-tables fixture"));
    assert!(patched.contains("title = \"Archived parts\""));
    assert!(patched.contains("[[products]]"));
    assert!(patched.contains("sku = \"A-001\""));
    assert!(patched.contains("sku = \"B-002\""));
    assert_order(&patched, "[catalog]", "[[products]]");
    assert_order(&patched, "sku = \"A-001\"", "sku = \"B-002\"");
}

#[test]
fn toml_edit_inline_table_scalar_patch_preserves_attached_comments() {
    let source = read_fixture("inline-tables.toml");
    let mut document = parse_mut_document(&source, "inline-tables.toml");

    document["sample"]["coating"]["material"] = value("PEDOT:PSS");
    let patched = document.to_string();

    assert!(patched.contains("# Inline table fixture"));
    assert!(patched.contains("coating = { material = \"PEDOT:PSS\""));
    assert!(patched.contains("solvent = \"chlorobenzene\""));
    assert!(patched.contains("limits = { flow = { min = 0.1, max = 0.4 }"));
}

#[test]
fn toml_edit_array_of_tables_insert_preserves_existing_entries_and_order() {
    let source = read_fixture("arrays-of-tables-insertion.toml");
    let mut document = parse_mut_document(&source, "arrays-of-tables-insertion.toml");

    let reagents = document["reagents"]
        .as_array_of_tables_mut()
        .expect("reagents should parse as arrays of tables");
    let mut inserted = Table::new();
    inserted["id"] = value("R-003");
    inserted["name"] = value("Water");
    reagents.insert(1, inserted);
    let patched = document.to_string();

    assert!(patched.contains("# Array-of-tables insertion fixture"));
    assert_order(&patched, "id = \"R-001\"", "id = \"R-003\"");
    assert_order(&patched, "id = \"R-003\"", "id = \"R-002\"");
    assert!(patched.contains("hazards = [\"flammable\", \"irritant\"]"));
}

#[test]
fn toml_edit_exposes_spans_for_values_tables_and_arrays_of_tables() {
    let source = read_fixture("arrays-of-tables.toml");
    let document = parse_spanned_document(&source, "arrays-of-tables.toml");

    let title_span = required_span(document["catalog"]["title"].span(), "catalog.title");
    assert_eq!(slice(&source, &title_span), "\"Spare parts\"");

    let catalog_span = required_span(document["catalog"].span(), "catalog table");
    assert!(slice(&source, &catalog_span).starts_with("[catalog]"));

    let products_span = required_span(document["products"].span(), "products array of tables");
    assert!(slice(&source, &products_span).contains("[[products]]"));

    let products = document["products"]
        .as_array_of_tables()
        .expect("products should parse as an array of tables");
    let product_tables: Vec<_> = products.iter().collect();
    assert_eq!(product_tables.len(), 2);
    for table in &product_tables {
        let table_span = required_span(table.span(), "products entry");
        assert_eq!(slice(&source, &table_span), "[[products]]");
    }
    let first_sku_span = required_span(product_tables[0]["sku"].span(), "first products.sku");
    let second_sku_span = required_span(product_tables[1]["sku"].span(), "second products.sku");
    assert_eq!(slice(&source, &first_sku_span), "\"A-001\"");
    assert_eq!(slice(&source, &second_sku_span), "\"B-002\"");
}

#[test]
fn toml_edit_exposes_spans_for_inline_tables_dotted_keys_and_multiline_strings() {
    let inline_source = read_fixture("inline-tables.toml");
    let inline = parse_spanned_document(&inline_source, "inline-tables.toml");
    let coating_span = required_span(inline["sample"]["coating"].span(), "sample.coating");
    assert!(slice(&inline_source, &coating_span).starts_with("{ material ="));
    let material_span = required_span(
        inline["sample"]["coating"]["material"].span(),
        "sample.coating.material",
    );
    assert_eq!(slice(&inline_source, &material_span), "\"P3HT\"");

    let dotted_source = read_fixture("dotted-key-edit-risk.toml");
    let dotted = parse_spanned_document(&dotted_source, "dotted-key-edit-risk.toml");
    let email_span = required_span(
        dotted["owner"]["contact"]["email"].span(),
        "owner.contact.email",
    );
    assert_eq!(slice(&dotted_source, &email_span), "\"owner@example.test\"");

    let multiline_source = read_fixture("multiline-strings.toml");
    let multiline = parse_spanned_document(&multiline_source, "multiline-strings.toml");
    let summary_span = required_span(multiline["note"]["summary"].span(), "note.summary");
    assert!(slice(&multiline_source, &summary_span).starts_with("\"\"\"Line one"));
}

#[test]
fn toml_edit_rejects_duplicate_invalid_fixtures() {
    for fixture_name in [
        "duplicate-key.invalid.toml",
        "duplicate-section.invalid.toml",
    ] {
        let source = read_fixture(fixture_name);
        let error = source
            .parse::<DocumentMut>()
            .expect_err("invalid fixture should not parse");
        let message = error.to_string();

        assert!(
            message.to_ascii_lowercase().contains("duplicate"),
            "{fixture_name} should fail with duplicate diagnostics, got: {message}"
        );
    }
}

fn read_fixture(name: &str) -> String {
    fs::read_to_string(fixture_path(name))
        .unwrap_or_else(|error| panic!("could not read TOML preservation fixture {name}: {error}"))
}

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri must have a repository parent")
        .join("docs")
        .join("refactor")
        .join("toml_preservation_fixtures")
        .join(name)
}

fn parse_mut_document(source: &str, fixture_name: &str) -> DocumentMut {
    source
        .parse::<DocumentMut>()
        .unwrap_or_else(|error| panic!("could not parse {fixture_name} with toml_edit: {error}"))
}

fn parse_spanned_document(source: &str, fixture_name: &str) -> Document<String> {
    source
        .parse::<Document<String>>()
        .unwrap_or_else(|error| panic!("could not parse {fixture_name} with toml_edit: {error}"))
}

fn required_span(span: Option<Range<usize>>, label: &str) -> Range<usize> {
    span.unwrap_or_else(|| panic!("{label} did not expose a source span"))
}

fn slice<'a>(source: &'a str, span: &Range<usize>) -> &'a str {
    &source[span.clone()]
}

fn assert_order(source: &str, before: &str, after: &str) {
    let before_index = source
        .find(before)
        .unwrap_or_else(|| panic!("missing expected source fragment: {before}"));
    let after_index = source
        .find(after)
        .unwrap_or_else(|| panic!("missing expected source fragment: {after}"));
    assert!(
        before_index < after_index,
        "expected `{before}` to appear before `{after}`"
    );
}
