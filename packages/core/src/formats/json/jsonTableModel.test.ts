import { describe, expect, it } from 'vitest';
import {
  createJsonArrayTableModel,
  jsonArrayTableCellClipboardValue,
  jsonArrayTableToTsvPreview,
} from './jsonTableModel';
import { createJsonContent, parseJsonDocument } from './parseJsonDocument';

describe('jsonTableModel', () => {
  it('detects top-level arrays of object records with source-backed scalar cells', () => {
    const parsed = parseJsonDocument(createJsonContent('[\n  {"id":"S-001","score":1},\n  {"id":"S-002","score":2,"ok":true}\n]\n')).parsed;
    const model = createJsonArrayTableModel(parsed?.value, parsed?.sourceMap ?? null);

    expect(model).toMatchObject({
      displayPath: '$',
      reason: 'top-level',
      rowCount: 2,
      columnCount: 3,
      viewMode: 'table',
    });
    expect(model?.columns.map((column) => column.key)).toEqual(['id', 'score', 'ok']);
    expect(model?.columns.find((column) => column.key === 'ok')).toMatchObject({
      presentCount: 1,
      missingCount: 1,
      types: ['boolean', 'missing'],
    });
    expect(model?.rows[0]?.cells.find((cell) => cell.columnKey === 'id')).toMatchObject({
      path: [0, 'id'],
      pointer: '/0/id',
      displayPath: '$[0].id',
      preview: 'S-001',
      type: 'string',
      editable: true,
    });
  });

  it('uses the selected nested object array or its ancestor as the active table', () => {
    const parsed = parseJsonDocument(createJsonContent(JSON.stringify({
      study: {
        metadata: { name: 'Coating' },
        samples: [
          { id: 'S-001', substrate: 'glass' },
          { id: 'S-002', substrate: 'steel' },
        ],
      },
    }, null, 2))).parsed;

    const selectedArray = createJsonArrayTableModel(parsed?.value, parsed?.sourceMap ?? null, {
      selectedPath: '$.study.samples',
    });
    const selectedCell = createJsonArrayTableModel(parsed?.value, parsed?.sourceMap ?? null, {
      selectedPath: '$.study.samples[1].substrate',
    });

    expect(selectedArray).toMatchObject({
      displayPath: '$.study.samples',
      reason: 'selected',
      rowCount: 2,
    });
    expect(selectedCell).toMatchObject({
      displayPath: '$.study.samples',
      reason: 'selected',
      rowCount: 2,
    });
  });

  it('falls back to the largest direct child object array for object documents', () => {
    const parsed = parseJsonDocument(createJsonContent(JSON.stringify({
      notes: [{ id: 1 }],
      samples: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
    }))).parsed;

    const model = createJsonArrayTableModel(parsed?.value, parsed?.sourceMap ?? null);

    expect(model).toMatchObject({
      displayPath: '$.samples',
      reason: 'direct-child',
      rowCount: 3,
    });
  });

  it('switches to cards when records exceed the table column budget', () => {
    const row = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`c${index + 1}`, index + 1]));
    const parsed = parseJsonDocument(createJsonContent(JSON.stringify([row, row]))).parsed;

    const model = createJsonArrayTableModel(parsed?.value, parsed?.sourceMap ?? null);

    expect(model).toMatchObject({
      columnCount: 10,
      viewMode: 'cards',
      hiddenColumnCount: 0,
    });
    expect(model?.visibleColumns).toHaveLength(10);
  });

  it('keeps mixed and scalar arrays out of the table projection', () => {
    const scalar = parseJsonDocument(createJsonContent('[1, 2, 3]')).parsed;
    const mixed = parseJsonDocument(createJsonContent('[{"id":1}, 2]')).parsed;
    const empty = parseJsonDocument(createJsonContent('[]')).parsed;

    expect(createJsonArrayTableModel(scalar?.value, scalar?.sourceMap ?? null)).toBeNull();
    expect(createJsonArrayTableModel(mixed?.value, mixed?.sourceMap ?? null)).toBeNull();
    expect(createJsonArrayTableModel(empty?.value, empty?.sourceMap ?? null)).toBeNull();
  });

  it('formats table and cell clipboard text without changing source values', () => {
    const parsed = parseJsonDocument(createJsonContent('[{"id":"S-001","note":"line one\\nline two","meta":{"x":1}}]')).parsed;
    const model = createJsonArrayTableModel(parsed?.value, parsed?.sourceMap ?? null);
    const note = model?.rows[0]?.cells.find((cell) => cell.columnKey === 'note');
    const meta = model?.rows[0]?.cells.find((cell) => cell.columnKey === 'meta');

    expect(note ? jsonArrayTableCellClipboardValue(note) : null).toBe('line one\nline two');
    expect(meta ? jsonArrayTableCellClipboardValue(meta) : null).toBe('{\n  "x": 1\n}');
    expect(model ? jsonArrayTableToTsvPreview(model) : null).toBe('id\tnote\tmeta\nS-001\tline one line two\t{"x":1}\n');
  });
});
