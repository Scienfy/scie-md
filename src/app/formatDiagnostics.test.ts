import { describe, expect, it } from 'vitest';
import { formatParseBudgetBytes } from '@sciemd/core';
import {
  JSON_SOURCE_ONLY_PARSE_BYTES,
  JSON_TREE_RENDER_NODE_BUDGET,
  formatDiagnosticsToValidationIssues,
  parseSourceFormatDiagnostics,
} from './formatDiagnostics';

describe('formatDiagnostics', () => {
  it('parses JSON source diagnostics through the registered adapter', () => {
    const result = parseSourceFormatDiagnostics('json', '{\n  "ok": true,\n}\n', 'C:\\lab\\result.json');

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'json-syntax-PropertyNameExpected',
      line: 3,
      source: 'json',
    }));
    expect(result.jsonAnalysis?.status).toBe('invalid');
  });

  it('marks valid JSON as tree-ready when it is under the render budget', () => {
    const result = parseSourceFormatDiagnostics('json', '{"samples":[1,2,3]}', null);

    expect(result.jsonAnalysis?.status).toBe('valid');
    expect(result.jsonAnalysis?.nodeCount).toBeLessThanOrEqual(JSON_TREE_RENDER_NODE_BUDGET);
    expect(result.structuredModel).toMatchObject({
      format: 'json',
      status: 'valid',
      canRenderVisualSurface: true,
      primaryVisualSurface: expect.objectContaining({
        kind: 'tree',
        editable: true,
        preservesSource: true,
      }),
      metrics: {
        nodeCount: result.jsonAnalysis?.nodeCount,
        treeBudget: JSON_TREE_RENDER_NODE_BUDGET,
      },
      editPolicy: 'format-preserving',
      preservationPolicy: 'lossless-parse',
    });
    expect(result.jsonAnalysis?.parseResult.parsed?.value).toEqual({ samples: [1, 2, 3] });
    expect(result.jsonAnalysis?.parseResult.parsed?.sourceMap.nodesByPointer['/samples/2']).toMatchObject({
      path: ['samples', 2],
      displayPath: '$.samples[2]',
      editable: true,
      lossy: false,
    });
  });

  it('keeps schema-invalid JSON tree-ready while returning schema diagnostics', () => {
    const result = parseSourceFormatDiagnostics('json', '{"count":"2"}', null, {
      jsonSchema: {
        kind: 'explicit',
        path: 'C:\\lab\\result.schema.json',
        text: JSON.stringify({
          type: 'object',
          required: ['id'],
          properties: { count: { type: 'number' } },
        }),
      },
    });

    expect(result.jsonAnalysis?.status).toBe('valid');
    expect(result.jsonAnalysis?.parseResult.parsed?.schemaValidation?.status).toBe('invalid');
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'json-schema-required', severity: 'error' }),
      expect.objectContaining({ code: 'json-schema-type', severity: 'error' }),
    ]));
  });

  it('keeps large valid JSON out of tree mode', () => {
    const values = Array.from({ length: JSON_TREE_RENDER_NODE_BUDGET + 1 }, (_, index) => index);
    const result = parseSourceFormatDiagnostics('json', JSON.stringify(values), null);

    expect(result.jsonAnalysis?.status).toBe('too-large');
    expect(result.jsonAnalysis?.parseResult.parsed).not.toBeNull();
  });

  it('uses source-only diagnostics instead of parsing JSON above the byte budget', () => {
    const result = parseSourceFormatDiagnostics('json', `{"payload":"${'x'.repeat(JSON_SOURCE_ONLY_PARSE_BYTES + 1)}"}`, null);

    expect(result.jsonAnalysis?.status).toBe('source-only');
    expect(result.structuredModel).toMatchObject({
      format: 'json',
      status: 'source-only',
      canRenderVisualSurface: false,
      sourceOnly: true,
      parseBudgetBytes: JSON_SOURCE_ONLY_PARSE_BYTES,
    });
    expect(result.jsonAnalysis?.parseResult.parsed).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'warning',
      code: 'json-source-only-large-file',
      source: 'json',
    }));
  });

  it('uses adapter budgets for non-JSON source-only diagnostics', () => {
    const yamlBudget = formatParseBudgetBytes('yaml') ?? 0;
    const csvBudget = formatParseBudgetBytes('csv') ?? 0;
    const yaml = parseSourceFormatDiagnostics('yaml', `payload: ${'x'.repeat(yamlBudget + 1)}`, null);
    const csv = parseSourceFormatDiagnostics('csv', `value\n${'x'.repeat(csvBudget + 1)}\n`, null);

    expect(yaml.structuredAnalysis?.status).toBe('source-only');
    expect(yaml.structuredModel).toMatchObject({
      format: 'yaml',
      status: 'source-only',
      canRenderVisualSurface: false,
      sourceOnly: true,
    });
    expect(yaml.diagnostics).toContainEqual(expect.objectContaining({
      code: 'yaml-source-only-large-file',
      severity: 'warning',
    }));

    expect(csv.tabularAnalysis?.status).toBe('source-only');
    expect(csv.structuredModel).toMatchObject({
      format: 'csv',
      status: 'source-only',
      canRenderVisualSurface: false,
      sourceOnly: true,
    });
    expect(csv.diagnostics).toContainEqual(expect.objectContaining({
      code: 'csv-source-only-large-file',
      severity: 'warning',
    }));
  });

  it('keeps Markdown diagnostics owned by the Markdown validator path', () => {
    expect(parseSourceFormatDiagnostics('markdown', '{ bad json', null).diagnostics).toEqual([]);
    expect(parseSourceFormatDiagnostics('markdown', '{ bad json', null).structuredModel).toBeNull();
    expect(parseSourceFormatDiagnostics('markdown', '{ bad json', null).jsonAnalysis).toBeNull();
    expect(parseSourceFormatDiagnostics('markdown', '{ bad json', null).jsonlAnalysis).toBeNull();
    expect(parseSourceFormatDiagnostics('markdown', '{ bad json', null).tabularAnalysis).toBeNull();
  });

  it('parses JSONL diagnostics and keeps per-record inspection data', () => {
    const result = parseSourceFormatDiagnostics('jsonl', '{"id":1}\n\n{"id":2,"extra":true}\n', 'C:\\lab\\records.jsonl');

    expect(result.jsonAnalysis).toBeNull();
    expect(result.jsonlAnalysis?.status).toBe('invalid');
    expect(result.structuredModel).toMatchObject({
      format: 'jsonl',
      status: 'invalid',
      canRenderVisualSurface: true,
      primaryVisualSurface: expect.objectContaining({
        kind: 'records',
        editable: true,
      }),
      metrics: {
        recordCount: 2,
        invalidLineCount: 1,
        totalLineCount: 3,
      },
    });
    expect(result.jsonlAnalysis?.recordCount).toBe(2);
    expect(result.jsonlAnalysis?.invalidLineCount).toBe(1);
    expect(result.jsonlAnalysis?.parseResult.parsed?.lines).toHaveLength(3);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'jsonl-blank-line',
      line: 2,
      source: 'jsonl',
    }));
  });

  it('parses YAML diagnostics into generic structured tree analysis', () => {
    const result = parseSourceFormatDiagnostics('yaml', 'sample:\n  name: Alpha\n  values:\n    - 1\n', 'C:\\lab\\config.yaml');

    expect(result.jsonAnalysis).toBeNull();
    expect(result.jsonlAnalysis).toBeNull();
    expect(result.structuredAnalysis?.format).toBe('yaml');
    expect(result.structuredAnalysis?.status).toBe('valid');
    expect(result.structuredModel).toMatchObject({
      format: 'yaml',
      status: 'valid',
      canRenderVisualSurface: true,
      primaryVisualSurface: expect.objectContaining({
        kind: 'tree',
        readonly: true,
        lossy: true,
      }),
      editPolicy: 'lossy-readonly',
      preservationPolicy: 'lossy-projection',
      metrics: {
        nodeCount: 5,
        sourceMappedNodeCount: 5,
        unmappedVisualNodeCount: 0,
        unsupportedFeatureCount: 0,
      },
    });
    expect(result.structuredAnalysis?.parseResult.parsed?.value).toEqual({
      sample: { name: 'Alpha', values: [1] },
    });
    expect(result.structuredAnalysis?.parseResult.parsed?.sourceMap.root).toMatchObject({
      format: 'yaml',
      editable: false,
      lossy: true,
    });
  });

  it('keeps invalid TOML in source analysis while preserving parser diagnostics', () => {
    const result = parseSourceFormatDiagnostics('toml', 'a = [\n', 'C:\\lab\\config.toml');

    expect(result.jsonAnalysis).toBeNull();
    expect(result.jsonlAnalysis).toBeNull();
    expect(result.structuredAnalysis?.format).toBe('toml');
    expect(result.structuredAnalysis?.status).toBe('invalid');
    expect(result.structuredModel).toMatchObject({
      format: 'toml',
      status: 'invalid',
      canRenderVisualSurface: false,
      primaryVisualSurface: expect.objectContaining({
        kind: 'tree',
      }),
    });
    expect(result.structuredAnalysis?.parseResult.parsed).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'toml-syntax',
      severity: 'error',
    }));
  });

  it('parses XML diagnostics into generic read-only structured tree analysis', () => {
    const result = parseSourceFormatDiagnostics('xml', '<study><sample id="S-001">ready</sample></study>\n', 'C:\\lab\\metadata.xml');

    expect(result.jsonAnalysis).toBeNull();
    expect(result.jsonlAnalysis).toBeNull();
    expect(result.structuredAnalysis?.format).toBe('xml');
    expect(result.structuredAnalysis?.status).toBe('valid');
    expect(result.structuredModel).toMatchObject({
      format: 'xml',
      status: 'valid',
      canRenderVisualSurface: true,
      primaryVisualSurface: expect.objectContaining({
        kind: 'tree',
        readonly: true,
        editable: false,
        lossy: false,
      }),
      editPolicy: 'lossy-readonly',
      preservationPolicy: 'lossless-parse',
      metrics: {
        unsupportedFeatureCount: 0,
      },
    });
    expect(result.structuredAnalysis?.parseResult.parsed?.sourceMap.root).toMatchObject({
      format: 'xml',
      editable: false,
      lossy: false,
    });
  });

  it('parses CSV and TSV diagnostics into tabular analysis', () => {
    const csv = parseSourceFormatDiagnostics('csv', 'id,count\n001,12\n002,13\n', 'C:\\lab\\table.csv');
    const tsv = parseSourceFormatDiagnostics('tsv', 'sample\tvalue\nA\t1\n', 'C:\\lab\\table.tsv');

    expect(csv.tabularAnalysis?.format).toBe('csv');
    expect(csv.tabularAnalysis?.status).toBe('valid');
    expect(csv.structuredModel).toMatchObject({
      format: 'csv',
      status: 'valid',
      canRenderVisualSurface: true,
      primaryVisualSurface: expect.objectContaining({
        kind: 'table',
        editable: true,
      }),
      metrics: {
        dataRowCount: 2,
        totalDataRowCount: 2,
        parsedDataRowCount: 2,
        columnCount: 2,
      },
      preservationPolicy: 'tabular-normalized',
    });
    expect(csv.tabularAnalysis?.dataRowCount).toBe(2);
    expect(csv.tabularAnalysis?.columnCount).toBe(2);
    expect(csv.tabularAnalysis?.parseResult.parsed?.header.jsonKeys).toEqual(['id', 'count']);
    expect(csv.diagnostics).toContainEqual(expect.objectContaining({
      code: 'tabular-number-risk',
      source: 'csv',
    }));
    expect(tsv.tabularAnalysis?.format).toBe('tsv');
    expect(tsv.tabularAnalysis?.status).toBe('valid');
    expect(tsv.tabularAnalysis?.parseResult.parsed?.delimiter).toBe('\t');
  });

  it('maps format diagnostics into the existing validation panel issue shape', () => {
    expect(formatDiagnosticsToValidationIssues([
      {
        severity: 'info',
        code: 'json-health',
        message: 'Array contains mixed values.',
        line: 4,
        column: 12,
        source: 'json',
      },
    ])).toEqual([{
      severity: 'warning',
      code: 'json-health',
      message: 'Array contains mixed values. (line 4, column 12)',
    }]);
  });
});
