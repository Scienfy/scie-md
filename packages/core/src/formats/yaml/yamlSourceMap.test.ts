import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { createYamlSourceMap } from './yamlSourceMap.js';

const fixtureDir = join(process.cwd(), 'docs/refactor/yaml_preservation_fixtures');

describe('createYamlSourceMap', () => {
  it('maps simple mapping and sequence nodes to source spans while keeping them read-only', () => {
    const text = [
      'study:',
      '  id: SCMD-YAML-001',
      '  values:',
      '    - 1',
      '    - 2',
      '',
    ].join('\n');
    const document = parseDocument(text, { keepSourceTokens: true, strict: true, uniqueKeys: true });
    const value = document.toJS();
    const result = createYamlSourceMap(text, document, value);

    expect(result.sourceMap.nodesByPointer['']).toMatchObject({
      displayPath: '$',
      span: expect.objectContaining({ line: 1, column: 1 }),
      editable: false,
      lossy: true,
    });
    expect(result.sourceMap.nodesByPointer['/study/id']).toMatchObject({
      type: 'string',
      keySpan: expect.objectContaining({ line: 2, column: 3 }),
      valueSpan: expect.objectContaining({ line: 2, column: 7 }),
      span: expect.objectContaining({ line: 2, column: 7 }),
      editable: false,
    });
    expect(result.sourceMap.nodesByPointer['/study/values/1']).toMatchObject({
      type: 'number',
      span: expect.objectContaining({ line: 5, column: 7 }),
    });
    expect(result.inspection).toMatchObject({
      nodeCount: 6,
      spannedNodeCount: 6,
      unmappedVisualNodeCount: 0,
      editableNodeCount: 0,
      editableCandidateCount: 6,
      visualWritesEnabled: false,
    });
  });

  it('classifies YAML preservation blockers with paths and spans', () => {
    const text = [
      '# source comment',
      'defaults: &defaults',
      '  name: Alpha',
      'copy: *defaults',
      'typed: !!str 001',
      'notes: |',
      '  Line one',
      'inline: { ok: true }',
      'merged:',
      '  <<: *defaults',
      '',
    ].join('\n');
    const document = parseDocument(text, { keepSourceTokens: true, strict: true, uniqueKeys: true });
    const result = createYamlSourceMap(text, document, document.toJS());

    expect(result.inspection.unsupportedKinds).toEqual(expect.arrayContaining([
      'alias',
      'anchor',
      'block-scalar',
      'comment',
      'flow-collection',
      'merge-key',
      'tag',
    ]));
    expect(result.unsupportedFeatures).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'comment', pointer: '', span: expect.objectContaining({ line: 1 }) }),
      expect.objectContaining({ kind: 'anchor', pointer: '/defaults' }),
      expect.objectContaining({ kind: 'alias', pointer: '/copy' }),
      expect.objectContaining({ kind: 'tag', pointer: '/typed' }),
      expect.objectContaining({ kind: 'block-scalar', pointer: '/notes' }),
      expect.objectContaining({ kind: 'flow-collection', pointer: '/inline' }),
      expect.objectContaining({ kind: 'merge-key', pointer: '/merged/<<' }),
    ]));
    expect(result.sourceMap.nodesByPointer['/copy/name']).toMatchObject({
      span: null,
      editable: false,
      unsupportedReason: expect.stringContaining('no local YAML source span'),
    });
  });

  it('maps source comment spans with CRLF, LF, and CR line endings', () => {
    const crlf = 'study:\r\n  id: S-001\r\n  title: Surface assay # inline note\r\n';
    const crlfResult = createYamlSourceMap(crlf);
    expect(crlfResult.unsupportedFeatures).toContainEqual(expect.objectContaining({
      kind: 'comment',
      span: expect.objectContaining({
        offset: crlf.indexOf('# inline note'),
        line: 3,
        column: 24,
      }),
    }));

    const lf = 'first: 1\nsecond: 2 # lf note\n';
    const lfResult = createYamlSourceMap(lf);
    expect(lfResult.unsupportedFeatures).toContainEqual(expect.objectContaining({
      kind: 'comment',
      span: expect.objectContaining({
        offset: lf.indexOf('# lf note'),
        line: 2,
      }),
    }));

    const cr = 'first: 1\rsecond: 2 # cr note\r';
    const crResult = createYamlSourceMap(cr);
    expect(crResult.unsupportedFeatures).toContainEqual(expect.objectContaining({
      kind: 'comment',
      span: expect.objectContaining({
        offset: cr.indexOf('# cr note'),
        line: 2,
      }),
    }));
  });

  it('keeps the preservation fixture corpus parseable or explicitly invalid', () => {
    const fixtureNames = readdirSync(fixtureDir).filter((name) => name.endsWith('.yaml'));

    expect(fixtureNames).toEqual(expect.arrayContaining([
      'anchors-and-aliases.yaml',
      'block-scalars.yaml',
      'comments-and-whitespace.yaml',
      'comprehensive-preservation.yaml',
      'duplicate-key.invalid.yaml',
      'flow-and-indentation.yaml',
      'merge-keys.yaml',
      'tags-and-scalars.yaml',
    ]));

    for (const fixtureName of fixtureNames) {
      const text = readFileSync(join(fixtureDir, fixtureName), 'utf8');
      const document = parseDocument(text, { keepSourceTokens: true, strict: true, uniqueKeys: true });
      if (fixtureName.endsWith('.invalid.yaml')) {
        expect(document.errors.length, fixtureName).toBeGreaterThan(0);
        continue;
      }
      expect(document.errors, fixtureName).toHaveLength(0);
      const result = createYamlSourceMap(text, document, document.toJS());
      expect(result.sourceMap.nodes.length, fixtureName).toBeGreaterThan(0);
      expect(result.inspection.spannedNodeCount, fixtureName).toBeGreaterThan(0);
      expect(result.inspection.visualWritesEnabled, fixtureName).toBe(false);
    }
  });

  it('covers the comprehensive preservation fixture including CRLF comments', () => {
    const source = readFileSync(join(fixtureDir, 'comprehensive-preservation.yaml'), 'utf8');
    for (const text of [source, source.replace(/\n/g, '\r\n')]) {
      const document = parseDocument(text, { keepSourceTokens: true, strict: true, uniqueKeys: true });
      expect(document.errors).toHaveLength(0);
      const result = createYamlSourceMap(text, document, document.toJS());

      expect(result.inspection.visualWritesEnabled).toBe(false);
      expect(result.inspection.unsupportedKinds).toEqual(expect.arrayContaining([
        'alias',
        'anchor',
        'block-scalar',
        'comment',
        'flow-collection',
        'merge-key',
        'tag',
      ]));
      expect(result.unsupportedFeatures).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'comment', span: expect.objectContaining({ line: 1 }) }),
        expect.objectContaining({ kind: 'anchor', pointer: '/defaults' }),
        expect.objectContaining({ kind: 'merge-key', pointer: '/samples/0/<<' }),
        expect.objectContaining({ kind: 'alias', pointer: '/samples/1/inherited' }),
        expect.objectContaining({ kind: 'tag', pointer: '/metadata/uri' }),
        expect.objectContaining({ kind: 'block-scalar', pointer: '/protocol/summary' }),
        expect.objectContaining({ kind: 'flow-collection', pointer: '/matrix/rows/0' }),
      ]));
      expect(result.sourceMap.nodesByPointer['/samples/1/inherited/operator']).toMatchObject({
        span: null,
        editable: false,
        unsupportedReason: expect.stringContaining('no local YAML source span'),
      });
      expect(result.unsupportedFeatures.find((feature) => feature.code === 'yaml-comment-readonly')?.span).toMatchObject({
        offset: 0,
        line: 1,
        column: 1,
      });
    }
  });
});
