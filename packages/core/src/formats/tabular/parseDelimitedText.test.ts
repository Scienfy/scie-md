import { describe, expect, it } from 'vitest';
import { adapterForFormat } from '../registry.js';
import {
  createCsvContent,
  createTsvContent,
  parseCsvDocument,
  parseTsvDocument,
} from './tabularAdapter.js';
import {
  TABULAR_PARSE_ROW_SCAN_LIMIT,
  convertDelimitedText,
  createDelimitedTextConversionPreview,
  isLikelyDelimitedText,
  parseDelimitedText,
} from './parseDelimitedText.js';
import {
  applyTabularTextEdits,
  planTabularVisualEdit,
  tabularSourceHash,
} from './tabularEdits.js';

describe('parseDelimitedText', () => {
  it('infers TSV headers, column types, and Markdown table output', () => {
    const parsed = parseDelimitedText('sample\tcount\tactive\nA\t12\ttrue\nB\t03\tfalse\n');

    expect(parsed.delimiter).toBe('\t');
    expect(parsed.header).toMatchObject({
      hasHeader: true,
      source: 'inferred',
      names: ['sample', 'count', 'active'],
      jsonKeys: ['sample', 'count', 'active'],
    });
    expect(parsed.dataRowCount).toBe(2);
    expect(parsed.columns[1].types).toContain('number');
    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({
      code: 'tabular-number-risk',
      severity: 'warning',
    }));
    expect(convertDelimitedText(parsed, 'markdown').content).toBe([
      '| sample | count | active |',
      '| --- | --- | --- |',
      '| A | 12 | true |',
      '| B | 03 | false |',
      '',
    ].join('\n'));
  });

  it('handles RFC-style quoted CSV cells and doubled quotes', () => {
    const parsed = parseDelimitedText('name,note\n"Alpha, A","He said ""ok"""\n');

    expect(parsed.delimiter).toBe(',');
    expect(parsed.dataRows).toEqual([['Alpha, A', 'He said "ok"']]);
    expect(convertDelimitedText(parsed, 'json').content).toBe('[\n  {\n    "name": "Alpha, A",\n    "note": "He said \\"ok\\""\n  }\n]\n');
  });

  it('records row and cell source spans for quoted CRLF CSV cells', () => {
    const source = 'name,note\r\n"Alpha, A","Line 1\r\nLine 2"\r\n';
    const parsed = parseDelimitedText(source);
    const dataRow = parsed.sourceRows[1];

    expect(parsed.sourceRows[0].lineEnding).toBe('\r\n');
    expect(dataRow.lineEnding).toBe('');
    expect(dataRow.span).toMatchObject({
      offset: source.indexOf('"Alpha'),
      line: 2,
      column: 1,
    });
    expect(dataRow.cells[0]).toMatchObject({
      value: 'Alpha, A',
      quoted: true,
      span: {
        offset: source.indexOf('"Alpha'),
        length: '"Alpha, A"'.length,
      },
      valueSpan: {
        offset: source.indexOf('Alpha'),
        length: 'Alpha, A'.length,
      },
    });
    expect(dataRow.cells[1]).toMatchObject({
      value: 'Line 1\r\nLine 2',
      quoted: true,
      span: expect.objectContaining({
        line: 2,
        endLine: 3,
      }),
    });
  });

  it('warns for inconsistent rows, empty headers, and duplicate JSON keys', () => {
    const parsed = parseDelimitedText('id,,id\n1,A\n2,B,C,D\n', { header: 'present' });

    expect(parsed.header.names).toEqual(['id', 'Column 2', 'id', 'Column 4']);
    expect(parsed.header.jsonKeys).toEqual(['id', 'column_2', 'id_2', 'column_4']);
    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({ code: 'tabular-empty-header' }));
    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({ code: 'tabular-duplicate-header' }));
    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({ code: 'tabular-inconsistent-row-width', line: 2 }));
  });

  it('creates JSON array and JSONL previews without coercing cell values', () => {
    const preview = createDelimitedTextConversionPreview('id,count\n001,12\n002,13\n');

    expect(preview).not.toBeNull();
    expect(preview?.json.content).toContain('"id": "001"');
    expect(preview?.jsonl.content).toBe('{"id":"001","count":"12"}\n{"id":"002","count":"13"}\n');
    expect(preview?.parsed.diagnostics).toContainEqual(expect.objectContaining({
      code: 'tabular-number-risk',
      column: 1,
    }));
  });

  it('keeps total row counts separate from bounded preview rows', () => {
    const text = [
      'id,count',
      ...Array.from({ length: 80 }, (_value, index) => `S-${index + 1},${index}`),
      '',
    ].join('\n');
    const parsed = parseDelimitedText(text, { maxRows: 25 });

    expect(parsed.rowCount).toBe(25);
    expect(parsed.dataRowCount).toBe(24);
    expect(parsed.totalRowCount).toBe(81);
    expect(parsed.totalRowCountIsEstimated).toBe(true);
    expect(parsed.totalDataRowCount).toBe(80);
    expect(parsed.totalDataRowCountIsEstimated).toBe(true);
    expect(parsed.parsedRowCount).toBe(25);
    expect(parsed.parsedDataRowCount).toBe(24);
    expect(parsed.scannedRowCount).toBe(80);
    expect(parsed.previewPageInfo).toMatchObject({
      itemLabel: 'row',
      totalItems: 80,
      parsedItems: 24,
      pageSize: 50,
      pageCount: 1,
      previewTruncated: true,
    });
  });

  it('samples very large tables without parsing every source row', () => {
    const text = [
      'id,count',
      ...Array.from({ length: TABULAR_PARSE_ROW_SCAN_LIMIT + 500 }, (_value, index) => `S-${index + 1},${index}`),
    ].join('\n');

    const parsed = parseDelimitedText(text, { maxRows: 50 });

    expect(parsed.scannedRowCount).toBeLessThan(TABULAR_PARSE_ROW_SCAN_LIMIT + 501);
    expect(parsed.scannedRowCount).toBe(80);
    expect(parsed.totalRowCountIsEstimated).toBe(true);
    expect(parsed.totalDataRowCountIsEstimated).toBe(true);
    expect(parsed.previewTruncated).toBe(true);
    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({
      code: 'tabular-preview-truncated',
      message: expect.stringContaining('sampled'),
    }));
  });

  it('does not classify normal prose as delimited data', () => {
    expect(isLikelyDelimitedText('This is not a table.\nIt is just two lines.')).toBe(false);
    expect(createDelimitedTextConversionPreview('This is not a table.\nIt is just two lines.')).toBeNull();
  });

  it('reports quote errors instead of creating a conversion preview', () => {
    const parsed = parseDelimitedText('name,note\nAlpha,"unfinished\n');

    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({
      code: 'tabular-unclosed-quote',
      severity: 'error',
    }));
    expect(createDelimitedTextConversionPreview('name,note\nAlpha,"unfinished\n')).toBeNull();
  });

  it('plans source-preserving cell replacement and row append edits', () => {
    const source = 'id,note\r\n001,"Alpha, A"\r\n002,Beta\r\n';
    const replace = planTabularVisualEdit(source, {
      kind: 'replaceCell',
      format: 'csv',
      dataRowIndex: 0,
      columnIndex: 1,
      nextValue: 'Gamma, "quoted"',
      expectedSourceHash: tabularSourceHash(source),
    });

    expect(replace).toMatchObject({
      ok: true,
      previewLabel: 'Updated row 1, column 2.',
    });
    const replaced = replace.nextSource ?? source;
    expect(replaced).toContain('001,"Gamma, ""quoted"""');
    expect(replaced).toContain('\r\n002,Beta\r\n');

    const append = planTabularVisualEdit(replaced, {
      kind: 'appendRow',
      format: 'csv',
      values: ['003', 'Delta'],
      expectedSourceHash: tabularSourceHash(replaced),
    });
    expect(append).toMatchObject({
      ok: true,
      previewLabel: 'Appended table row.',
    });
    expect(append.nextSource).toBe('id,note\r\n001,"Gamma, ""quoted"""\r\n002,Beta\r\n003,Delta\r\n');
    expect(applyTabularTextEdits(replaced, append.edits)).toBe(append.nextSource);
  });

  it('rejects unsafe tabular visual edit targets', () => {
    const inconsistent = 'id,note\n001\n002,Beta\n';
    expect(planTabularVisualEdit(inconsistent, {
      kind: 'replaceCell',
      format: 'csv',
      dataRowIndex: 0,
      columnIndex: 0,
      nextValue: '003',
    })).toMatchObject({
      ok: false,
      unsupportedReason: expect.stringContaining('expected'),
    });

    const source = 'id,note\n001,Alpha\n';
    expect(planTabularVisualEdit(source, {
      kind: 'appendRow',
      format: 'csv',
      values: ['002'],
    })).toMatchObject({
      ok: false,
      unsupportedReason: 'New rows must contain exactly 2 cells.',
    });

    expect(planTabularVisualEdit(source, {
      kind: 'replaceCell',
      format: 'csv',
      dataRowIndex: 0,
      columnIndex: 0,
      nextValue: '002',
      expectedSourceHash: 'stale',
    })).toMatchObject({
      ok: false,
      unsupportedReason: expect.stringContaining('source changed'),
    });
  });

  it('registers CSV and TSV adapters with source-preserving document parsing', () => {
    const csv = adapterForFormat('csv');
    const tsv = adapterForFormat('tsv');

    expect(csv).not.toBeNull();
    expect(tsv).not.toBeNull();
    expect(csv?.capabilities).toMatchObject({
      sourceEditing: true,
      diagnostics: true,
      visualEditing: true,
      formatPreservingEdits: true,
      editPolicy: 'format-preserving',
      defaultMode: 'source',
    });
    expect(tsv?.capabilities.defaultMode).toBe('source');
  });

  it('parses semicolon CSV and CRLF while keeping cell values as strings', () => {
    const result = parseCsvDocument(createCsvContent('id;count\r\n001;12\r\n002;13\r\n', 'C:\\lab\\table.csv'));

    expect(result.format).toBe('csv');
    expect(result.content.format).toBe('csv');
    expect(result.parsed?.delimiter).toBe(';');
    expect(result.parsed?.header.names).toEqual(['id', 'count']);
    expect(result.parsed?.dataRows).toEqual([
      ['001', '12'],
      ['002', '13'],
    ]);
    expect(convertDelimitedText(result.parsed!, 'json').content).toContain('"id": "001"');
  });

  it('forces tab delimiters for TSV documents', () => {
    const result = parseTsvDocument(createTsvContent('sample\tvalue\nA\t1\nB\t2\n', 'C:\\lab\\table.tsv'));

    expect(result.format).toBe('tsv');
    expect(result.parsed?.delimiter).toBe('\t');
    expect(result.parsed?.delimiterLabel).toBe('Tab');
    expect(result.parsed?.dataRowCount).toBe(2);
  });

  it('creates YAML and TOML conversion previews with explicit string-value warnings', () => {
    const preview = createDelimitedTextConversionPreview('id,count\n001,12\n002,13\n');

    expect(preview?.yaml.content).toBe([
      '-',
      '  id: "001"',
      '  count: "12"',
      '-',
      '  id: "002"',
      '  count: "13"',
      '',
    ].join('\n'));
    expect(preview?.yaml.diagnostics).toContainEqual(expect.objectContaining({
      code: 'tabular-yaml-string-values',
      category: 'conversion',
    }));
    expect(preview?.toml.content).toBe([
      '[[rows]]',
      '"id" = "001"',
      '"count" = "12"',
      '',
      '[[rows]]',
      '"id" = "002"',
      '"count" = "13"',
      '',
    ].join('\n'));
    expect(preview?.toml.diagnostics).toContainEqual(expect.objectContaining({
      code: 'tabular-toml-string-values',
      category: 'conversion',
    }));
  });
});
