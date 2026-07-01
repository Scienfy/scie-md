# YAML Source Preservation Evaluation

Date: 2026-07-01
Status: source-map spike complete; production YAML visual writes remain disabled

## Decision

Keep YAML visual writes disabled in ScieMD for this refactor. The `yaml` package remains the best current JavaScript candidate for future YAML preservation work because the spike proves parsed node ranges, key/value spans, source tokens, comments, anchors, aliases, tags, block scalar style, flow collection style, and merge-key evidence can be detected without leaving the existing core package. That is enough to improve inspection and source reveal, but not enough to allow writes because ScieMD still needs a patch planner that can preserve untouched comments, whitespace, scalar style, anchors, aliases, tags, merge semantics, and indentation byte-for-byte.

## Fixture Corpus

The evidence fixtures live in `docs/refactor/yaml_preservation_fixtures/`:

- `comments-and-whitespace.yaml`: leading comments, inline comments, blank lines, attached comments, nested objects, and arrays.
- `anchors-and-aliases.yaml`: anchors, aliases, and merge-like `<<` entries inside sequence records.
- `tags-and-scalars.yaml`: explicit YAML tags, timestamps, booleans, strings, numbers, Windows paths, and URI-like values.
- `block-scalars.yaml`: literal and folded block scalars with chomping and indentation-sensitive content.
- `merge-keys.yaml`: merge-key syntax with anchor defaults and overriding values.
- `flow-and-indentation.yaml`: flow sequences, flow maps, and deeply indented block structures.
- `duplicate-key.invalid.yaml`: duplicate-key rejection.

## Implemented Spike

`packages/core/src/formats/yaml/yamlSourceMap.ts` parses or receives a `yaml` document with `keepSourceTokens: true`, collects CST evidence by visual path, and then overlays that evidence onto the normalized visual value. This matters because the visual tree is still built from `document.toJS()`; aliases and merge-like values can appear as normal objects in the visual projection even when there is no local source span for the expanded child value.

The spike now records:

- `StructuredNodeRef.span`, `keySpan`, and `valueSpan` where the parsed YAML node has a stable range.
- Unsupported preservation features with path, pointer, display path, source span, code, and message.
- Inspection metrics for node count, spanned node count, unmapped visual node count, source-token-backed node count, unsupported feature count, unsupported kinds, and span coverage.
- Read-only source reveal for mapped YAML tree nodes.

## Observed Evidence

The current implementation proves:

- Simple mappings, nested sequences, scalar values, and scalar keys can be mapped to source spans with line and column positions.
- Source tokens are available for parsed nodes when `keepSourceTokens` is enabled.
- Anchors, aliases, explicit tags, block scalars, flow collections, merge keys, comments, and complex keys can be detected and classified as read-only blockers.
- Alias-expanded visual children may not have local source spans, so a normalized visual tree cannot be treated as a directly editable source tree.
- Duplicate keys are rejected by the parser with `uniqueKeys: true`.

Known limitations and remaining risks:

- The source map is inspection-only. It does not attempt targeted edits or byte-for-byte no-op serialization checks.
- Comment association is still conservative. The spike can detect comments and attached node comments, but it does not yet model exact ownership for insert/delete/rename operations.
- Block scalar edits are unsafe until scalar style, indentation, chomping, and untouched-region preservation are fixture-tested.
- Anchors, aliases, and merge keys require value identity and reference semantics that are not represented by the normalized visual tree.
- Tags may carry type or application-level meaning that cannot be safely regenerated from JSON-like values.
- Flow-style collections require punctuation-aware patches rather than line-oriented value replacement.

## Minimum Adapter Contract Before YAML Writes

Before any YAML visual write control is enabled, a production adapter must provide:

1. A CST-backed source map from every editable visual node to stable parser nodes and source ranges.
2. A clear unsupported-node policy for comments, anchors, aliases, tags, block scalars, flow collections, merge keys, complex keys, and any visual node without a local source span.
3. Patch planning with source-hash checks, expected-old-source checks, and strict YAML reparse validation after each edit.
4. Byte-for-byte no-op and untouched-region tests across the fixture corpus.
5. Scalar edit, key rename, key insert, key delete, sequence item insert/delete/reorder, and nested object insertion fixtures before UI controls are exposed.
6. UI language that distinguishes read-only value inspection, source reveal, JSON preview, and future format-preserving YAML edits.

## References

- YAML package documentation: https://eemeli.org/yaml/
- YAML package parse options and `keepSourceTokens`: `node_modules/yaml/dist/options.d.ts`
- Red Hat YAML language server, for schema-aware YAML workflow patterns: https://github.com/redhat-developer/yaml-language-server

