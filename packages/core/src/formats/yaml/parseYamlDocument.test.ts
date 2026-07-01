import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { createYamlContent, createYamlJsonPreview, parseYamlDocument, YAML_ALIAS_COUNT_LIMIT } from './parseYamlDocument.js';

describe('parseYamlDocument', () => {
  it('parses valid YAML into a structured read-only value', () => {
    const result = parseYamlDocument(createYamlContent('sample:\n  name: Alpha\n  counts:\n    - 1\n    - 2\n'));

    expect(result.parsed?.value).toEqual({ sample: { name: 'Alpha', counts: [1, 2] } });
    expect(result.parsed?.stats).toMatchObject({
      topLevelType: 'object',
      objectCount: 2,
      arrayCount: 1,
      scalarCount: 3,
    });
    expect(result.parsed?.sourceMap.root).toMatchObject({
      format: 'yaml',
      pointer: '',
      displayPath: '$',
      lossy: true,
      editable: false,
      span: expect.objectContaining({ line: 1, column: 1 }),
    });
    expect(result.parsed?.sourceMap.nodesByPointer['/sample/name']).toMatchObject({
      path: ['sample', 'name'],
      displayPath: '$.sample.name',
      type: 'string',
      lossy: true,
      editable: false,
      span: expect.objectContaining({ line: 2, column: 9 }),
      keySpan: expect.objectContaining({ line: 2, column: 3 }),
      unsupportedReason: expect.stringContaining('fixture-backed source-preserving edit planner'),
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.parsed?.preservation).toMatchObject({
      format: 'yaml',
      visualWritesEnabled: false,
      decision: 'defer-visual-writes',
      sourceMapFeasibility: 'cst-spike-required',
      nodeSpanCoverage: 'partial',
      candidateLibraries: ['yaml'],
    });
    expect(result.parsed?.sourceMapInspection).toMatchObject({
      nodeCount: 6,
      spannedNodeCount: 6,
      editableNodeCount: 0,
      visualWritesEnabled: false,
    });
    expect(result.parsed?.jsonPreview.content).toContain('"sample"');
  });

  it('reports YAML syntax errors with source locations', () => {
    const result = parseYamlDocument(createYamlContent('sample:\n  - ok\n bad: value\n'));

    expect(result.parsed).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error',
      source: 'yaml',
      line: expect.any(Number),
    }));
  });

  it('warns when YAML features are visible only in source', () => {
    const result = parseYamlDocument(createYamlContent([
      '# dataset',
      'defaults: &defaults',
      '  name: Alpha',
      'copy: *defaults',
      'description: |',
      '  Line one',
      'typed: !!str 123',
      '',
    ].join('\n')));

    expect(result.parsed?.value).toMatchObject({
      defaults: { name: 'Alpha' },
      copy: { name: 'Alpha' },
      description: 'Line one\n',
      typed: '123',
    });
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'yaml-comments-readonly', severity: 'warning' }),
      expect.objectContaining({ code: 'yaml-anchor-readonly', severity: 'warning' }),
      expect.objectContaining({ code: 'yaml-alias-readonly', severity: 'warning' }),
      expect.objectContaining({ code: 'yaml-block-scalar-readonly', severity: 'warning' }),
      expect.objectContaining({ code: 'yaml-tag-readonly', severity: 'warning' }),
      expect.objectContaining({ code: 'yaml-comments-readonly', category: 'preservation', blocking: false }),
    ]));
  });

  it('warns when alias usage exceeds the conversion safety limit', () => {
    const aliases = Array.from({ length: YAML_ALIAS_COUNT_LIMIT + 1 }, (_, index) => `copy${index}: *base`).join('\n');
    const result = parseYamlDocument(createYamlContent(`base: &base value\n${aliases}\n`));

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'yaml-alias-count-limit',
      severity: 'warning',
    }));
  });

  it('creates explicit JSON previews carrying YAML read-only warnings', () => {
    const result = parseYamlDocument(createYamlContent('name: Alpha # source-only comment\n'));
    const preview = createYamlJsonPreview(result);

    expect(preview?.content).toBe('{\n  "name": "Alpha"\n}\n');
    expect(preview?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'yaml-comments-readonly' }),
      expect.objectContaining({ code: 'yaml-json-preview-readonly' }),
    ]));
  });

  it('documents YAML CST/range evidence without enabling YAML writes', () => {
    const text = [
      '# top',
      'defaults: &defaults',
      '  name: Alpha',
      'copy: *defaults',
      'description: |',
      '  Line one',
      'typed: !!str 123',
      '',
    ].join('\n');
    const upstreamDocument = parseDocument(text, {
      keepSourceTokens: true,
      strict: true,
      uniqueKeys: true,
    });
    const upstreamRoot = upstreamDocument.contents as {
      range?: number[];
      items?: Array<{
        key?: { value?: unknown; range?: number[]; commentBefore?: string | null };
        value?: { constructor?: { name?: string }; range?: number[]; anchor?: string; tag?: string; srcToken?: unknown };
      }>;
    } | null;
    const result = parseYamlDocument(createYamlContent(text));

    expect(upstreamRoot?.range).toEqual(expect.arrayContaining([expect.any(Number)]));
    expect(upstreamRoot?.items?.[0]?.key?.commentBefore).toContain('top');
    expect(upstreamRoot?.items?.[0]?.value?.anchor).toBe('defaults');
    expect(upstreamRoot?.items?.[1]?.value?.constructor?.name).toBe('Alias');
    expect(upstreamRoot?.items?.[2]?.value?.srcToken).toBeTruthy();
    expect(upstreamRoot?.items?.[3]?.value?.tag).toBe('tag:yaml.org,2002:str');
    expect(result.parsed?.sourceMapInspection.unsupportedKinds).toEqual(expect.arrayContaining([
      'alias',
      'anchor',
      'block-scalar',
      'comment',
      'tag',
    ]));
    expect(result.parsed?.sourceMap.nodes.every((node) => node.lossy && !node.editable)).toBe(true);
    expect(result.parsed?.preservation.blockers.join('\n')).toContain('CST-backed edit planner');
  });

  it('keeps YAML visual writes disabled while exposing source-map inspection evidence', () => {
    const result = parseYamlDocument(createYamlContent([
      'defaults: &defaults',
      '  name: Alpha',
      'copy: *defaults',
      'notes: |',
      '  Preserve scalar style.',
      '',
    ].join('\n')));

    expect(result.parsed?.sourceMap.root?.span).toEqual(expect.objectContaining({ offset: 0 }));
    expect(result.parsed?.sourceMap.nodesByPointer['/defaults/name']).toMatchObject({
      span: expect.objectContaining({ line: 2 }),
      editable: false,
      lossy: true,
    });
    expect(result.parsed?.sourceMap.nodesByPointer['/copy/name']).toMatchObject({
      span: null,
      editable: false,
      unsupportedReason: expect.stringContaining('no local YAML source span'),
    });
    expect(result.parsed?.sourceMapUnsupportedFeatures).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'anchor', pointer: '/defaults' }),
      expect.objectContaining({ kind: 'alias', pointer: '/copy' }),
      expect.objectContaining({ kind: 'block-scalar', pointer: '/notes' }),
    ]));
    expect(result.parsed?.sourceMapInspection).toMatchObject({
      spanCoverage: 'partial',
      editableNodeCount: 0,
      visualWritesEnabled: false,
    });
  });
});
