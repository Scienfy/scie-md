import { describe, expect, it } from 'vitest';
import { parseSourceFormatDiagnostics } from './formatDiagnostics';
import { createStructuredNavigationIndex } from './structuredNavigation';

describe('structuredNavigation', () => {
  it('builds JSON node and diagnostic navigation items from source maps', () => {
    const diagnostics = parseSourceFormatDiagnostics('json', '{"study":{"id":"S-001","samples":[1,2]}}', null);
    const index = createStructuredNavigationIndex({
      format: 'json',
      diagnostics: diagnostics.diagnostics,
      jsonAnalysis: diagnostics.jsonAnalysis,
    });

    expect(index?.title).toBe('JSON structure');
    expect(index?.items.map((item) => item.label)).toContain('study');
    expect(index?.items.find((item) => item.target.path === '$.study.samples')?.target.sourceRange).toMatchObject({
      line: 1,
    });
  });

  it('builds JSONL record and invalid-line targets', () => {
    const diagnostics = parseSourceFormatDiagnostics('jsonl', '{"id":1}\ninvalid\n{"id":2}\n', null);
    const index = createStructuredNavigationIndex({
      format: 'jsonl',
      diagnostics: diagnostics.diagnostics,
      jsonlAnalysis: diagnostics.jsonlAnalysis,
    });

    expect(index?.items.find((item) => item.kind === 'record')?.target).toMatchObject({
      line: 1,
      recordIndex: 0,
    });
    expect(index?.items.find((item) => item.label === 'Invalid line 2')?.severity).toBe('error');
  });

  it('builds tabular column, row, and cell targets', () => {
    const diagnostics = parseSourceFormatDiagnostics('csv', 'id,count\nS-001,12\nS-002,13\n', null);
    const index = createStructuredNavigationIndex({
      format: 'csv',
      diagnostics: diagnostics.diagnostics,
      tabularAnalysis: diagnostics.tabularAnalysis,
    });

    expect(index?.items.find((item) => item.kind === 'column' && item.label === 'id')).toBeTruthy();
    expect(index?.items.find((item) => item.kind === 'row' && item.label === 'Row 2')?.target).toMatchObject({
      rowIndex: 1,
    });
    expect(index?.items.find((item) => item.kind === 'cell' && item.detail === 'S-001')?.target).toMatchObject({
      rowIndex: 0,
      columnIndex: 0,
    });
  });

  it('keeps invalid structured documents navigable through diagnostics', () => {
    const diagnostics = parseSourceFormatDiagnostics('yaml', 'sample: [\n', null);
    const index = createStructuredNavigationIndex({
      format: 'yaml',
      diagnostics: diagnostics.diagnostics,
      structuredAnalysis: diagnostics.structuredAnalysis,
    });

    expect(index?.items).toHaveLength(1);
    expect(index?.items[0]).toMatchObject({
      kind: 'diagnostic',
      severity: 'error',
    });
  });
});
