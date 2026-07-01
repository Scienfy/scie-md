import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createXmlContent, parseXmlDocument, XML_PARSE_BUDGET_BYTES } from './parseXmlDocument.js';

const fixtureDir = join(process.cwd(), 'docs/refactor/xml_preservation_fixtures');

describe('parseXmlDocument', () => {
  it('projects XML namespaces, attributes, text, comments, CDATA, and processing instructions into a read-only tree', () => {
    const source = [
      '<?xml version="1.0"?>',
      '<study xmlns="urn:study" xmlns:lab="urn:lab" lab:id="S-001">',
      '  <title>Surface assay</title>',
      '  <!-- reviewer note -->',
      '  <lab:sample status="ready"><![CDATA[thin <film>]]></lab:sample>',
      '  <?scie-md keep?>',
      '</study>',
      '',
    ].join('\n');

    const result = parseXmlDocument(createXmlContent(source, 'study.xml'));

    expect(result.parsed).not.toBeNull();
    expect(result.diagnostics).toEqual([]);
    expect(result.parsed?.elementCount).toBe(3);
    expect(result.parsed?.attributeCount).toBe(2);
    expect(result.parsed?.namespaceCount).toBe(2);
    expect(result.parsed?.commentCount).toBe(1);
    expect(result.parsed?.cdataCount).toBe(1);
    expect(result.parsed?.processingInstructionCount).toBe(2);
    expect(result.parsed?.sourceMap.root).toMatchObject({
      format: 'xml',
      editable: false,
      lossy: false,
      displayPath: '$',
    });

    const root = result.parsed?.value.children.find((node) => node.kind === 'element');
    expect(root).toMatchObject({
      kind: 'element',
      name: 'study',
      namespaceUri: 'urn:study',
      namespaceDeclarations: [
        { kind: 'namespace', prefix: null, uri: 'urn:study' },
        { kind: 'namespace', prefix: 'lab', uri: 'urn:lab' },
      ],
      attributes: [
        {
          kind: 'attribute',
          name: 'lab:id',
          prefix: 'lab',
          localName: 'id',
          namespaceUri: 'urn:lab',
          value: 'S-001',
        },
      ],
    });
    expect(result.parsed?.sourceMap.nodesByDisplayPath['$.children[2]']).toMatchObject({
      format: 'xml',
      span: expect.objectContaining({ line: 2 }),
    });
    expect(JSON.stringify(result.parsed?.value)).toContain('reviewer note');
    expect(JSON.stringify(result.parsed?.value)).toContain('thin <film>');
    expect(JSON.stringify(result.parsed?.value)).toContain('processing-instruction');
  });

  it('keeps default namespaces off unprefixed attributes while resolving prefixed names', () => {
    const result = parseXmlDocument(createXmlContent([
      '<study xmlns="urn:study" xmlns:lab="urn:lab" id="S-001" lab:phase="coat" xml:lang="en">',
      '  <sample status="ready" lab:site="north" />',
      '</study>',
    ].join('\n')));

    const root = result.parsed?.value.children.find((node) => node.kind === 'element');
    expect(root).toMatchObject({
      kind: 'element',
      namespaceUri: 'urn:study',
      namespaceDeclarations: [
        { kind: 'namespace', prefix: null, uri: 'urn:study' },
        { kind: 'namespace', prefix: 'lab', uri: 'urn:lab' },
      ],
      attributes: [
        expect.objectContaining({ name: 'id', prefix: null, namespaceUri: null }),
        expect.objectContaining({ name: 'lab:phase', prefix: 'lab', namespaceUri: 'urn:lab' }),
        expect.objectContaining({ name: 'xml:lang', prefix: 'xml', namespaceUri: 'http://www.w3.org/XML/1998/namespace' }),
      ],
    });
    const sample = root?.kind === 'element'
      ? root.children.find((node) => node.kind === 'element' && node.name === 'sample')
      : null;
    expect(sample).toMatchObject({
      kind: 'element',
      namespaceUri: 'urn:study',
      attributes: [
        expect.objectContaining({ name: 'status', prefix: null, namespaceUri: null }),
        expect.objectContaining({ name: 'lab:site', prefix: 'lab', namespaceUri: 'urn:lab' }),
      ],
    });
  });

  it('keeps entity references as read-only source nodes while exposing safe decoded display values', () => {
    const result = parseXmlDocument(createXmlContent('<root label="A&#x3BC;">AT&amp;T &#956; &alpha; <![CDATA[raw & text]]><!-- keep --></root>\n'));

    expect(result.parsed).not.toBeNull();
    expect(result.parsed?.entityReferenceCount).toBe(3);
    expect(result.parsed?.cdataCount).toBe(1);
    expect(result.parsed?.commentCount).toBe(1);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'xml-entity-reference-readonly',
      severity: 'warning',
      source: 'xml',
    }));
    const serialized = JSON.stringify(result.parsed?.value);
    const micro = String.fromCodePoint(0x3bc);
    expect(serialized).toContain('"raw":"&amp;"');
    expect(serialized).toContain('"decoded":"&"');
    expect(serialized).toContain('"raw":"&#956;"');
    expect(serialized).toContain(`"decoded":"${micro}"`);
    expect(serialized).toContain('"raw":"&alpha;"');
    expect(serialized).toContain('"decoded":null');
    expect(serialized).toContain(`"value":"A${micro}"`);
  });

  it('rejects DTD declarations instead of allowing entity expansion', () => {
    const result = parseXmlDocument(createXmlContent(
      '<!DOCTYPE root [<!ENTITY x SYSTEM "file:///etc/passwd">]><root>&x;</root>',
    ));

    expect(result.parsed).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'xml-doctype-disabled',
      severity: 'error',
      blocking: true,
    }));
  });

  it('returns parser diagnostics for malformed XML', () => {
    const result = parseXmlDocument(createXmlContent('<root><sample></root>'));

    expect(result.parsed).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'xml-missing-close-tag',
      severity: 'error',
    }));
  });

  it('rejects documents with missing or multiple root elements', () => {
    expect(parseXmlDocument(createXmlContent('<?xml version="1.0"?>')).diagnostics).toContainEqual(expect.objectContaining({
      code: 'xml-root-missing',
      severity: 'error',
    }));
    expect(parseXmlDocument(createXmlContent('<a/><b/>')).diagnostics).toContainEqual(expect.objectContaining({
      code: 'xml-multiple-root-elements',
      severity: 'error',
    }));
  });

  it('keeps very large XML source-only instead of parsing in the background', () => {
    const result = parseXmlDocument(createXmlContent(`<root>${'x'.repeat(XML_PARSE_BUDGET_BYTES + 1)}</root>`));

    expect(result.sourceOnly).toBe(true);
    expect(result.parsed).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'xml-source-only-large-file',
      severity: 'warning',
    }));
  });

  it('keeps XML preservation fixtures read-only while preserving risky node classes', () => {
    const source = readFileSync(join(fixtureDir, 'namespaces-comments-cdata.xml'), 'utf8');
    const result = parseXmlDocument(createXmlContent(source, 'namespaces-comments-cdata.xml'));

    expect(result.parsed).not.toBeNull();
    expect(result.parsed?.preservation).toMatchObject({
      format: 'xml',
      visualWritesEnabled: false,
      decision: 'defer-visual-writes',
      sourceMapFeasibility: 'syntax-tree-readonly',
      nodeSpanCoverage: 'partial',
    });
    expect(result.parsed?.sourceMap.nodes.every((node) => !node.editable)).toBe(true);
    expect(result.parsed).toMatchObject({
      namespaceCount: 2,
      attributeCount: expect.any(Number),
      commentCount: 1,
      cdataCount: 1,
      processingInstructionCount: 2,
      entityReferenceCount: 2,
    });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'xml-entity-reference-readonly',
      category: 'preservation',
    }));
    expect(result.parsed?.preservation.blockers.join('\n')).toContain('namespace scope');
    expect(result.parsed?.preservation.blockers.join('\n')).toContain('Entity references');
  });

  it('keeps DTD fixture blocked as a security and preservation prerequisite', () => {
    const source = readFileSync(join(fixtureDir, 'doctype-disabled.invalid.xml'), 'utf8');
    const result = parseXmlDocument(createXmlContent(source, 'doctype-disabled.invalid.xml'));

    expect(result.parsed).toBeNull();
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'xml-doctype-disabled',
        severity: 'error',
        blocking: true,
      }),
      expect.objectContaining({
        code: 'xml-entity-reference-readonly',
        severity: 'warning',
      }),
    ]));
  });
});
