# ScieMD Structured Data Example Files

These files are local test documents for the ScieMD structured-data workflows. They are intentionally richer than tiny parser examples so the app can be tested with nested objects, arrays, source diagnostics, table previews, JSON Schema suggestions, preservation warnings, and format-specific save behavior.

## Suggested Test Order

1. Open `materials-study-comprehensive.json`.
2. Open `materials-study.schema.json`, then use it as the schema companion for the JSON file.
3. Open `materials-study-records.jsonl` and `materials-study-events.ndjson`.
4. Open `materials-study-config.yaml`.
5. Open `materials-study-settings.toml`.
6. Open `materials-study-results.csv`.
7. Open `materials-study-matrix.tsv`.

## What Each File Exercises

* `materials-study-comprehensive.json`: nested objects, arrays, numbers, booleans, nulls, empty containers, escaped strings, dotted keys, schema-friendly sample records, and JSON visual editing.

* `materials-study.schema.json`: nested JSON Schema defaults, enums, required fields, array/object constraints, and descriptions for schema-aware controls.

* `materials-study-records.jsonl`: one JSON object per line with heterogeneous scientific records, nested measurements, arrays, nulls, and event metadata.

* `materials-study-events.ndjson`: NDJSON extension alias coverage for JSON Lines ingestion and preview.

* `materials-study-config.yaml`: comments, anchors, aliases, merge keys, block scalars, nested maps, sequences, nulls, booleans, and read-only preservation warnings.

* `materials-study-settings.toml`: comments, dotted keys, arrays, inline tables, arrays of tables, multiline strings, dates, numbers, booleans, and TOML read-only preservation warnings.

* `materials-study-results.csv`: quoted commas, escaped quotes, empty fields, leading zeros, scientific notation, dates, long notes, and editable CSV table behavior.

* `materials-study-matrix.tsv`: tab-separated wide records with categorical values, blank cells, numeric-like strings, JSON-like text fields, and editable TSV table behavior.

All values are synthetic.
