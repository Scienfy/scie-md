import { describe, expect, it } from 'vitest';
import { parse as parseToml } from 'smol-toml';
import { createTomlContent, createTomlJsonPreview, parseTomlDocument } from './parseTomlDocument.js';

describe('parseTomlDocument', () => {
  it('parses valid TOML sections into a structured read-only value', () => {
    const result = parseTomlDocument(createTomlContent([
      'title = "Dataset"',
      '[server]',
      'port = 8080',
      'active = true',
      '',
    ].join('\n')));

    expect(result.parsed?.value).toEqual({
      title: 'Dataset',
      server: { port: 8080, active: true },
    });
    expect(result.parsed?.sections).toEqual([{ name: 'server', line: 2, kind: 'table' }]);
    expect(result.parsed?.stats).toMatchObject({
      topLevelType: 'object',
      objectCount: 2,
      scalarCount: 3,
    });
    expect(result.parsed?.sourceMap.root).toMatchObject({
      format: 'toml',
      pointer: '',
      displayPath: '$',
      lossy: true,
      editable: false,
      span: null,
    });
    expect(result.parsed?.sourceMap.nodesByPointer['/server/port']).toMatchObject({
      path: ['server', 'port'],
      displayPath: '$.server.port',
      type: 'number',
      lossy: true,
      editable: false,
      unsupportedReason: expect.stringContaining('source-preserving syntax support'),
    });
    expect(result.parsed?.preservation).toMatchObject({
      format: 'toml',
      visualWritesEnabled: false,
      decision: 'defer-visual-writes',
      sourceMapFeasibility: 'requires-lossless-parser',
      nodeSpanCoverage: 'none',
      candidateLibraries: ['taplo', 'toml_edit'],
    });
    expect(result.parsed?.jsonPreview.content).toContain('"server"');
  });

  it('reports TOML syntax errors with source locations', () => {
    const result = parseTomlDocument(createTomlContent('a = [\n'));

    expect(result.parsed).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'toml-syntax',
      line: expect.any(Number),
      column: expect.any(Number),
      source: 'toml',
    }));
  });

  it('warns for TOML source features that are flattened in the tree', () => {
    const result = parseTomlDocument(createTomlContent([
      '# inventory',
      'owner.name = "Ada"',
      'timestamp = 2026-06-30T12:00:00Z',
      '[[products]]',
      'name = "A"',
      '[[products]]',
      'name = "B"',
      '',
    ].join('\n')));

    expect(result.parsed?.value).toMatchObject({
      owner: { name: 'Ada' },
      timestamp: '2026-06-30T12:00:00.000Z',
      products: [{ name: 'A' }, { name: 'B' }],
    });
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'toml-comments-readonly', severity: 'warning' }),
      expect.objectContaining({ code: 'toml-dotted-key-readonly', severity: 'warning' }),
      expect.objectContaining({ code: 'toml-array-table-readonly', severity: 'warning' }),
      expect.objectContaining({ code: 'toml-comments-readonly', category: 'preservation', blocking: false }),
    ]));
  });

  it('surfaces duplicate keys and sections before parser rejection', () => {
    const duplicateKey = parseTomlDocument(createTomlContent('name = "A"\nname = "B"\n'));
    const duplicateSection = parseTomlDocument(createTomlContent('[server]\nport = 1\n[server]\nactive = true\n'));

    expect(duplicateKey.parsed).toBeNull();
    expect(duplicateKey.diagnostics).toContainEqual(expect.objectContaining({ code: 'toml-duplicate-key' }));
    expect(duplicateSection.parsed).toBeNull();
    expect(duplicateSection.diagnostics).toContainEqual(expect.objectContaining({ code: 'toml-duplicate-section' }));
  });

  it('creates explicit JSON previews carrying TOML read-only warnings', () => {
    const result = parseTomlDocument(createTomlContent('owner.name = "Ada" # comment\n'));
    const preview = createTomlJsonPreview(result);

    expect(preview?.content).toBe('{\n  "owner": {\n    "name": "Ada"\n  }\n}\n');
    expect(preview?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'toml-dotted-key-readonly' }),
      expect.objectContaining({ code: 'toml-comments-readonly' }),
      expect.objectContaining({ code: 'toml-json-preview-readonly' }),
    ]));
  });

  it('documents current TOML parser limits without enabling TOML writes', () => {
    const text = [
      '# inventory',
      'owner.name = "Ada"',
      '[server]',
      'port = 8080',
      '[[products]]',
      'name = "A"',
      '[[products]]',
      'name = "B"',
      '',
    ].join('\n');
    const upstreamValue = parseToml(text) as Record<string, unknown>;
    const result = parseTomlDocument(createTomlContent(text));

    expect(upstreamValue).toMatchObject({
      owner: { name: 'Ada' },
      server: { port: 8080 },
      products: [{ name: 'A' }, { name: 'B' }],
    });
    expect(Object.keys(upstreamValue)).not.toContain('comments');
    expect(result.parsed?.sections).toEqual([
      { name: 'server', line: 3, kind: 'table' },
      { name: 'products', line: 5, kind: 'array-table' },
      { name: 'products', line: 7, kind: 'array-table' },
    ]);
    expect(result.parsed?.sourceMap.nodes.every((node) => node.span === null && node.lossy && !node.editable)).toBe(true);
    expect(result.parsed?.preservation.blockers.join('\n')).toContain('lossless parser');
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'toml-comments-readonly' }),
      expect.objectContaining({ code: 'toml-dotted-key-readonly' }),
      expect.objectContaining({ code: 'toml-array-table-readonly' }),
    ]));
  });
});
