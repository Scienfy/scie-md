import { describe, expect, it } from 'vitest';
import {
  JSONL_PARSE_LINE_SCAN_LIMIT,
  JSONL_RECORD_PREVIEW_LIMIT,
  createJsonlContent,
  parseJsonlDocument,
} from './parseJsonlDocument.js';

describe('parseJsonlDocument', () => {
  it('parses one JSON value per nonblank line with record indexes and field summaries', () => {
    const result = parseJsonlDocument(createJsonlContent([
      '{"id":"a","score":1,"ok":true}',
      '{"id":"b","score":2}',
      '["not","an","object"]',
      '42',
    ].join('\n')));

    expect(result.format).toBe('jsonl');
    expect(result.diagnostics).toEqual([]);
    expect(result.parsed?.recordCount).toBe(4);
    expect(result.parsed?.recordCountIsEstimated).toBe(false);
    expect(result.parsed?.objectRecordCount).toBe(2);
    expect(result.parsed?.lines.map((line) => [line.line, line.recordIndex, line.valueType])).toEqual([
      [1, 0, 'object'],
      [2, 1, 'object'],
      [3, 2, 'array'],
      [4, 3, 'number'],
    ]);
    expect(result.parsed?.commonFields).toContainEqual({
      field: 'id',
      presentCount: 2,
      missingCount: 0,
      types: ['string'],
    });
    expect(result.parsed?.missingFieldSummary).toContainEqual({
      field: 'ok',
      presentCount: 1,
      missingCount: 1,
      types: ['boolean'],
    });
  });

  it('reports invalid and blank lines without blocking valid records', () => {
    const result = parseJsonlDocument(createJsonlContent('{"ok":true}\n\n{"bad":}\n{"ok":false}\n'));

    expect(result.parsed?.recordCount).toBe(2);
    expect(result.parsed?.invalidLineCount).toBe(2);
    expect(result.parsed?.blankLineCount).toBe(1);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'jsonl-blank-line',
      line: 2,
      column: 1,
      source: 'jsonl',
    }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'jsonl-syntax-ValueExpected',
      line: 3,
      source: 'jsonl',
    }));
    expect(result.parsed?.lines.map((line) => line.valid)).toEqual([true, false, false, true]);
  });

  it('uses a strict preview budget for large JSONL files while still counting records', () => {
    const source = Array.from({ length: JSONL_RECORD_PREVIEW_LIMIT + 25 }, (_, index) => (
      JSON.stringify({ id: index, group: index % 2 })
    )).join('\n');

    const result = parseJsonlDocument(createJsonlContent(source));

    expect(result.parsed?.recordCount).toBe(JSONL_RECORD_PREVIEW_LIMIT + 25);
    expect(result.parsed?.recordCountIsEstimated).toBe(false);
    expect(result.parsed?.totalLineCount).toBe(JSONL_RECORD_PREVIEW_LIMIT + 25);
    expect(result.parsed?.totalLineCountIsEstimated).toBe(false);
    expect(result.parsed?.lines).toHaveLength(JSONL_RECORD_PREVIEW_LIMIT);
    expect(result.parsed?.previewTruncated).toBe(true);
    expect(result.parsed?.previewLimit).toBe(JSONL_RECORD_PREVIEW_LIMIT);
    expect(result.parsed?.previewPageInfo).toMatchObject({
      itemLabel: 'line',
      totalItems: JSONL_RECORD_PREVIEW_LIMIT + 25,
      parsedItems: JSONL_RECORD_PREVIEW_LIMIT,
      pageSize: 50,
      pageCount: 4,
      previewTruncated: true,
    });
  });

  it('samples very large JSONL files without scanning every source line', () => {
    const source = Array.from({ length: JSONL_PARSE_LINE_SCAN_LIMIT + 500 }, (_, index) => (
      JSON.stringify({ id: index, group: index % 3 })
    )).join('\n');

    const result = parseJsonlDocument(createJsonlContent(source));

    expect(result.parsed?.scannedLineCount).toBe(JSONL_PARSE_LINE_SCAN_LIMIT);
    expect(result.parsed?.totalLineCount).toBe(JSONL_PARSE_LINE_SCAN_LIMIT + 1);
    expect(result.parsed?.totalLineCountIsEstimated).toBe(true);
    expect(result.parsed?.recordCount).toBe(JSONL_PARSE_LINE_SCAN_LIMIT + 1);
    expect(result.parsed?.recordCountIsEstimated).toBe(true);
    expect(result.parsed?.lines).toHaveLength(JSONL_RECORD_PREVIEW_LIMIT);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'jsonl-parser-sampled',
      severity: 'warning',
    }));
  });

  it('treats a trailing newline as a delimiter, not as an extra blank record', () => {
    const result = parseJsonlDocument(createJsonlContent('{"id":1}\n{"id":2}\n'));

    expect(result.parsed?.totalLineCount).toBe(2);
    expect(result.parsed?.recordCount).toBe(2);
    expect(result.parsed?.blankLineCount).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });
});
