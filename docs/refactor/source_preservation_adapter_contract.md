# Source Preservation Adapter Contract

Date: 2026-07-01
Status: contract established; YAML, TOML, and XML visual writes remain disabled

## Purpose

ScieMD visual mode may eventually edit YAML, TOML, and XML, but these formats cannot be treated like JSON stringify output. A production write adapter must prove that it can preserve untouched source text, comments, ordering, style, namespace semantics, and security policy before any visual control is enabled. The host-neutral contract is implemented in `packages/core/src/formats/structured/sourcePreservationAdapter.ts`.

## Required Adapter Shape

A production `SourcePreservationAdapter` must provide:

- Parser-backed source-map analysis from visual paths to stable source ranges.
- Unsupported-feature classification with display paths, pointers, spans, and diagnostics.
- Edit planning that returns source patches, not whole-document regeneration.
- A source-hash guard to reject plans created against stale text.
- An expected-old-source guard for every patch span.
- Raw-token preservation for scalar values where the visual value would normalize syntax.
- Strict post-edit parsing and format-specific validation.
- Byte-for-byte no-op round-trip evidence.
- Untouched-region comparison after every planned edit.

Until those guards exist for a concrete operation, visual writes must return an unsupported plan and keep `visualWritesEnabled` false.

## Format Decisions

### YAML

YAML has a useful CST boundary through the `yaml` package with `keepSourceTokens`, node ranges, comments, anchors, aliases, tags, block scalars, flow collections, and merge-key evidence. ScieMD now keeps a fixture corpus in `docs/refactor/yaml_preservation_fixtures/`, including `comprehensive-preservation.yaml`, and tests source-map spans plus blocker classification. Future YAML writes should start with a very narrow scalar replacement only when the path has a local source span and no nearby unsupported feature.

### TOML

TOML production visual parsing in the webview remains `smol-toml`, which is value-only and intentionally read-only. The native Rust command `inspect_toml_source_map` is registered only as `experimental-readonly-evidence`: it exposes `toml_edit` source-map evidence, unsupported feature classification, and no-op round-trip status, but it does not plan or apply patches. Future TOML writes should be Rust-backed unless a better lossless parser boundary is proven.

### XML

XML writes need a separate design round. A source-preserving XML adapter must define namespace-aware node identity, default namespace behavior for unprefixed attributes, attribute versus element versus text mutation rules, whitespace policy, comments, CDATA, processing instructions, and entity-reference policy. DTD and DOCTYPE declarations remain blocked, and external entities must never be loaded or expanded.

## Current Proof Gates

- `packages/core/src/formats/structured/sourcePreservationAdapter.test.ts` covers source hashes, expected-old-source guards, patch application, overlap rejection, no-op evidence, and untouched-region comparison.
- `packages/core/src/formats/yaml/yamlSourceMap.test.ts` covers the expanded YAML fixture corpus and CRLF comment spans.
- `packages/core/src/formats/xml/parseXmlDocument.test.ts` covers XML namespace/comment/CDATA/entity fixtures and DTD blocking.
- `src-tauri/tests/toml_preservation_spike.rs` covers TOML no-op preservation, scalar edit spikes, array-of-table insertion spikes, span exposure, duplicate rejection, and fixture behavior.
- `scripts/validate-tauri-command-contract.mjs` keeps the TOML source-map command experimental by ensuring production TypeScript does not invoke it.

## References

- YAML package documentation: https://eemeli.org/yaml/
- `toml_edit` documentation: https://docs.rs/toml_edit/latest/toml_edit/
- quick-xml security notes: https://docs.rs/quick-xml/latest/quick_xml/
