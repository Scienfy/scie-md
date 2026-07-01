# XML Read-Only Adapter Policy

Status: implemented as a read-only adapter in Round 12 of `structured_data_next_refactor_plan.md`.

ScieMD accepts XML as a structured text document for source editing, diagnostics, source reveal, and read-only tree inspection. Source text remains authoritative. Visual mode is a projection over the source and does not serialize, canonicalize, format, or write XML.

## Parser Decision

The XML adapter uses `@lezer/xml` because it provides a local syntax tree with source offsets and does not load external resources. This fits ScieMD's read-only visual projection requirement better than DOM-style XML parsing, which can blur source ranges and is easier to accidentally pair with entity expansion or normalization behavior.

## Security Policy

- DTD and `DOCTYPE` declarations are blocking parser diagnostics.
- External entities are never loaded, resolved, or expanded.
- Entity references are represented as read-only source nodes.
- XML source parsing is bounded by `XML_PARSE_BUDGET_BYTES`; larger files stay editable in source mode but do not get a background tree preview.
- XML values copied from visual mode must be treated as untrusted document data, not instructions or executable content.

## Projection Policy

The read-only tree keeps XML-specific constructs distinct:

- Elements include qualified name, prefix, local name, namespace URI, attributes, namespace declarations, child nodes, and self-closing state.
- Attributes remain separate from child elements.
- Namespace declarations are represented separately from ordinary attributes.
- Text, comments, CDATA, processing instructions, entity references, and DTD nodes are separate node kinds.
- Source-map entries are available for document, element, attribute, namespace declaration, text, comment, CDATA, processing instruction, entity reference, and DTD projection nodes.

## Non-Goals

- No XML visual edits.
- No XML conversion writes.
- No XML schema, XSD, DTD, XPath, XSLT, or canonicalization support.
- No comment/CDATA/processing-instruction rewrite or preservation strategy beyond read-only source mapping.

Future XML write support would require a separate source-preserving edit planner with namespace-aware patching, untouched-region preservation fixtures, explicit whitespace policy, and security review.

