# YAML/TOML Preservation Decision

Date: 2026-06-30

## Decision

YAML and TOML remain read-only visual inspection formats in this refactor. ScieMD should not enable tree-driven YAML/TOML writes until the adapter layer has a source-preserving parser/editor contract with node identity, source spans, comments, syntax style, ordering, and an edit planner that can prove a patch is narrower than a full document rewrite.

## Current Implementation Evidence

- YAML is parsed with the `yaml` package through `parseDocument`, then normalized through `document.toJS()` for the visual tree. The visual value is useful for inspection, but it is not the editable source representation.
- The `yaml` package exposes useful source-level evidence, including node `range` data, source tokens when `keepSourceTokens` is enabled, comments, anchors, aliases, tags, and scalar token detail. That is enough to justify a future CST/source-map spike, but not enough by itself because ScieMD has not mapped those CST nodes to stable visual edit intents.
- TOML is parsed with `smol-toml`, which gives normalized values but does not expose a lossless edit tree for comments, whitespace, dotted-key syntax, array-of-table identity, or original section ordering.
- Round F5 added the fixture-backed `toml_edit` spike in `src-tauri/tests/toml_preservation_spike.rs` with fixtures in `docs/refactor/toml_preservation_fixtures/`. The result makes `toml_edit` the leading future TOML adapter candidate, but production TOML writes remain disabled because ScieMD still lacks a source-map adapter and edit planner.
- Taplo remains worth evaluating for syntax-tree, formatter, schema, and language-server behavior, but this refactor has not fixture-tested it as ScieMD's edit engine.

## Product Behavior

- YAML/TOML can be opened in source mode and inspected in a normalized read-only tree.
- The tree and inspector show preservation warnings for syntax that would be lost or changed by a naive value rewrite.
- YAML/TOML expose a copyable JSON preview with explicit lossy/read-only diagnostics.
- Visual write controls remain disabled for YAML/TOML.
- The TOML-specific evidence and future adapter contract are documented in `docs/refactor/toml_source_preservation_evaluation.md`.

## Requirements Before Enabling Writes

1. A source map that links each visual node to stable parser/CST nodes and original source spans.
2. Fixture coverage for YAML comments, anchors, aliases, tags, block scalars, merge keys, indentation-sensitive structures, TOML comments, dotted keys, arrays of tables, duplicate sections/keys, and section ordering.
3. An edit planner that can reject unsafe edits and apply safe edits without full-document reserialization.
4. Round-trip checks proving untouched source regions remain byte-for-byte stable for supported edits.
5. UI language that distinguishes value inspection, JSON conversion, and format-preserving source editing.

## References

- YAML package documentation: https://eemeli.org/yaml/
- Taplo documentation: https://taplo.tamasfe.dev/
- Rust toml_edit crate documentation: https://docs.rs/toml_edit/latest/toml_edit/
