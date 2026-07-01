import { describe, expect, it } from 'vitest';
import { jsonAdapter } from './jsonAdapter';
import { createJsonContent, parseJsonDocument } from './parseJsonDocument';

describe('parseJsonDocument', () => {
  it('parses valid JSON without reformatting or changing content', () => {
    const content = createJsonContent('{\n  "study": "A1",\n  "values": [1, 2, 3]\n}\n', 'C:\\lab\\result.json');

    const result = parseJsonDocument(content);

    expect(result.format).toBe('json');
    expect(result.content).toBe(content);
    expect(result.parsed?.value).toEqual({ study: 'A1', values: [1, 2, 3] });
    expect(result.parsed?.health).toMatchObject({
      objectCount: 1,
      arrayCount: 1,
      scalarCount: 4,
      maxDepth: 3,
      topLevelType: 'object',
    });
    expect(result.parsed?.sourceMap.root).toMatchObject({
      format: 'json',
      path: [],
      pointer: '',
      displayPath: '$',
      type: 'object',
      editable: true,
      lossy: false,
    });
    expect(result.parsed?.sourceMap.nodesByPointer['/values/1']).toMatchObject({
      path: ['values', 1],
      pointer: '/values/1',
      displayPath: '$.values[1]',
      type: 'number',
      editable: true,
      lossy: false,
    });
    expect(result.parsed?.sourceMap.nodesByPointer['/values/1']?.valueSpan).toMatchObject({
      offset: content.text.indexOf('2'),
      length: 1,
      line: 3,
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('builds JSON source maps with escaped pointers, key spans, and top-level scalar roots', () => {
    const result = parseJsonDocument(createJsonContent('{\n  "has/slash~and.dot": {"0": true},\n  "items": [{"name": "A"}]\n}\n'));
    const escaped = result.parsed?.sourceMap.nodesByDisplayPath['$["has/slash~and.dot"]'];
    const nested = result.parsed?.sourceMap.nodesByPointer['/items/0/name'];
    const scalar = parseJsonDocument(createJsonContent('"ready"\n'));

    expect(escaped).toMatchObject({
      path: ['has/slash~and.dot'],
      pointer: '/has~1slash~0and.dot',
      type: 'object',
      childCount: 1,
    });
    expect(escaped?.keySpan).toMatchObject({
      offset: 4,
      line: 2,
      column: 3,
    });
    expect(nested).toMatchObject({
      path: ['items', 0, 'name'],
      pointer: '/items/0/name',
      displayPath: '$.items[0].name',
      type: 'string',
    });
    expect(scalar.parsed?.sourceMap.root).toMatchObject({
      pointer: '',
      displayPath: '$',
      type: 'string',
      childCount: 0,
    });
  });

  it('reports strict JSON syntax diagnostics with source ranges', () => {
    const result = parseJsonDocument(createJsonContent('{\n  "ok": true,\n}\n'));

    expect(result.parsed).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'json-syntax-PropertyNameExpected',
      line: 3,
      column: 1,
      source: 'json',
      category: 'parser',
      blocking: true,
      span: expect.objectContaining({ line: 3, column: 1 }),
    }));
  });

  it('rejects comments in strict JSON mode', () => {
    const result = parseJsonDocument(createJsonContent('{\n  // comment\n  "ok": true\n}\n'));

    expect(result.parsed).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'json-syntax-InvalidCommentToken',
      message: 'Comments are not valid in strict JSON.',
      source: 'json',
    }));
  });

  it('warns about duplicate keys and mixed arrays without blocking a syntactically valid document', () => {
    const result = parseJsonDocument(createJsonContent('{\n  "id": 1,\n  "id": 2,\n  "values": [1, "two"]\n}\n'));

    expect(result.parsed?.value).toEqual({ id: 2, values: [1, 'two'] });
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'warning',
        code: 'json-duplicate-key',
        line: 3,
        source: 'json',
        category: 'health',
        path: ['id'],
        pointer: '/id',
        displayPath: '$.id',
        span: expect.objectContaining({ line: 3 }),
      }),
      expect.objectContaining({
        severity: 'warning',
        code: 'json-mixed-array-types',
        line: 4,
        source: 'json',
        category: 'health',
        path: ['values'],
        pointer: '/values',
        displayPath: '$.values',
      }),
    ]));
  });

  it('warns about JSON number tokens that JavaScript would not preserve faithfully', () => {
    const result = parseJsonDocument(createJsonContent('{\n  "large": 900719925474099312345,\n  "negativeZero": -0,\n  "exponent": 1e3,\n  "fraction": 1.0\n}\n'));

    expect(result.parsed).not.toBeNull();
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'json-number-unsafe-integer',
        path: ['large'],
        displayPath: '$.large',
        category: 'health',
      }),
      expect.objectContaining({
        code: 'json-number-negative-zero',
        path: ['negativeZero'],
        displayPath: '$.negativeZero',
      }),
      expect.objectContaining({
        code: 'json-number-token-canonicalizes',
        path: ['exponent'],
        displayPath: '$.exponent',
      }),
      expect.objectContaining({
        code: 'json-number-token-canonicalizes',
        path: ['fraction'],
        displayPath: '$.fraction',
      }),
    ]));
  });

  it('keeps schema diagnostics separate from parser errors and health warnings', () => {
    const result = parseJsonDocument(createJsonContent('{\n  "$schema": "https://example.test/schema.json",\n  "count": "2",\n  "values": [1, "two"]\n}\n'), {
      schema: {
        kind: 'explicit',
        path: 'C:\\lab\\result.schema.json',
        text: JSON.stringify({
          type: 'object',
          required: ['id'],
          properties: {
            count: { type: 'number' },
          },
        }),
      },
    });

    expect(result.parsed).not.toBeNull();
    expect(result.parsed?.schemaMetadata.uri).toBe('https://example.test/schema.json');
    expect(result.parsed?.schemaValidation?.status).toBe('invalid');
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'json-schema-required',
        severity: 'error',
        category: 'schema',
        path: [],
        pointer: '',
        displayPath: '$',
        span: expect.objectContaining({ line: 1 }),
        blocking: false,
      }),
      expect.objectContaining({
        code: 'json-schema-type',
        severity: 'error',
        category: 'schema',
        path: ['count'],
        pointer: '/count',
        displayPath: '$.count',
        span: expect.objectContaining({ offset: expect.any(Number), line: 3 }),
        blocking: false,
      }),
      expect.objectContaining({ code: 'json-mixed-array-types', severity: 'warning' }),
    ]));
  });

  it('exposes JSON source-mode capabilities through the adapter', () => {
    expect(jsonAdapter.extensions).toEqual(['json']);
    expect(jsonAdapter.parse(jsonAdapter.createContent('{"ok":true}')).diagnostics).toEqual([]);
    expect(jsonAdapter.capabilities).toMatchObject({
      sourceEditing: true,
      visualEditing: true,
      readonlyTree: true,
      diagnostics: true,
      schemaValidation: true,
      formatPreservingEdits: true,
      defaultMode: 'source',
    });
  });
});
