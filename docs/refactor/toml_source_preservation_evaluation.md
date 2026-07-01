# TOML Source Preservation Evaluation

Date: 2026-07-01
Status: boundary decision complete; production TOML visual writes remain disabled

## Decision

Keep TOML visual writes disabled in ScieMD for this refactor, and use a Rust-backed `toml_edit` boundary as the recommended production direction for future TOML preservation work. Round 9 moved `toml_edit` from an isolated dev spike into the native app dependency boundary and added the non-mutating Tauri command `inspect_toml_source_map`, which returns parse status, source spans, unsupported preservation features, no-op round-trip evidence, and a conservative recommendation without reading or writing files. This gives ScieMD a concrete native source-map bridge to build on later, but it is still not enough to enable production writes because the app needs a typed edit planner with expected-source checks, post-edit validation, unsupported-node gating, and byte-for-byte untouched-region tests.

Taplo remains relevant for diagnostics, formatting, schema/LSP behavior, and syntax-tree inspection, but it is not the primary edit-preservation boundary for ScieMD right now. The reason is practical: the current codebase already has a Tauri/Rust layer, `toml_edit` already proves no-op preservation and localized mutation behavior inside ScieMD fixtures, and keeping TOML preservation in Rust avoids adding large TOML tooling to the webview bundle.

## Fixture Corpus

The evidence fixtures live in `docs/refactor/toml_preservation_fixtures/`:

- `comments-and-whitespace.toml`: leading comments, blank lines, aligned keys, inline comments, indented comments, and array spacing.
- `dotted-keys.toml`: dotted keys plus a later explicit table.
- `dotted-key-edit-risk.toml`: dotted key paths adjacent to an explicit table, for future edit-planner rejection/acceptance decisions.
- `arrays-of-tables.toml`: repeated `[[products]]` tables and table ordering.
- `arrays-of-tables-insertion.toml`: array-of-table insertion order and preservation risk.
- `comments-attached-to-keys.toml`: leading and inline comments that should stay attached to nearby keys.
- `inline-tables.toml`: nested inline tables and punctuation-sensitive scalar edits.
- `multiline-strings.toml`: basic and literal multiline string forms.
- `section-ordering.toml`: non-alphabetical section order.
- `duplicate-key.invalid.toml`: duplicate key rejection.
- `duplicate-section.invalid.toml`: duplicate section rejection.

## Spike Command

```bash
npm run spike:toml-preservation
```

This command runs the Rust integration test `src-tauri/tests/toml_preservation_spike.rs`. Round 9 also added `src-tauri/src/commands/toml_source_map.rs`, which exposes the non-mutating Tauri command `inspect_toml_source_map(sourceText)`. Production TOML visual parsing in the webview remains `smol-toml` in `packages/core/src/formats/toml/parseTomlDocument.ts`, so this round does not switch the visible TOML tree to the Rust source-map command.

## Observed Evidence

The `toml_edit` spike currently proves:

- Valid fixtures round-trip byte-for-byte through `DocumentMut::to_string()` with no edits.
- A scalar edit to `[catalog].title` preserves unrelated comments, `[[products]]` syntax, existing product rows, and relative source order.
- A scalar edit inside an inline table preserves the surrounding fixture comments and inline table structure in the isolated spike.
- Inserting a table into an existing array of tables preserves existing entries and relative order in the isolated spike.
- Immutable `Document<String>` access exposes spans for table headers, array-of-table headers, and values. This matters because `DocumentMut` intentionally removes spans when it becomes editable, so a future adapter must retain immutable parse evidence or keep a parallel source map before mutation.
- The new `inspect_toml_source_map` command returns source-span-backed nodes, no-op round-trip status, and unsupported feature classifications for comments, dotted keys, inline tables, arrays of tables, and multiline strings without mutating the document.
- Duplicate key and duplicate section fixtures are rejected by the parser.

Known limitations and remaining risks:

- The native command is source-map evidence only. It does not apply patches, does not compute expected old source slices, and does not yet compare untouched regions after a planned edit.
- The spike now covers representative scalar, inline-table scalar, and array-of-table insertion cases, but it does not prove safe delete, rename, reorder, dotted-key edit, table move, inline-table insertion/removal, or comment-ownership behavior.
- `toml_edit` documentation warns that dotted key ordering is not fully preserved in all cases, so a future ScieMD adapter must gate or fixture-test dotted-key edits carefully.
- Taplo's documented parser stack preserves comments, whitespace, and original token positions in a syntax tree, but this round did not fixture-test Taplo as an edit engine inside ScieMD.
- The current app still builds its TOML visual tree from normalized `smol-toml` output, so visual tree nodes do not carry authoritative source spans.

## Minimum Adapter Contract Before TOML Writes

Before any TOML visual write control is enabled, a production adapter must provide:

1. A parser-backed source map from every editable visual node to a stable TOML item and source range.
2. A read-only fallback for nodes represented by dotted keys, arrays of tables, inline tables, multiline strings, comments, or table structure that the adapter cannot patch locally.
3. Patch planning with expected-source hash checks and post-edit strict TOML parse validation.
4. Byte-for-byte round-trip tests for no-op documents and untouched regions across the fixture corpus.
5. Scalar edit, key insert, key delete, and array-of-table edit fixtures before UI controls are exposed.
6. A typed bridge from `inspect_toml_source_map`-style native evidence to the host-neutral structured operation/review model.
7. A deliberate UI enablement step that keeps TOML read-only unless the native edit planner proves the exact operation is safe.

## References

- `toml_edit` documentation: https://docs.rs/toml_edit/latest/toml_edit/
- `toml_edit` crate features: https://docs.rs/crate/toml_edit/latest/features
- Taplo documentation: https://taplo.tamasfe.dev/
