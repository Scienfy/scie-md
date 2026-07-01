import { describe, expect, it } from 'vitest';
import {
  appendJsonlRecord,
  applyJsonlEdits,
  deleteJsonlRecord,
  duplicateJsonlRecord,
  jsonArrayToJsonlPreview,
  jsonlToJsonArrayPreview,
  jsonlSourceHash,
  planJsonlVisualEdit,
  replaceJsonlRecord,
} from './jsonlEdits.js';

describe('jsonlEdits', () => {
  it('appends records without rewriting existing content', () => {
    const source = '{"id":1}\n{"id":2}';
    const plan = appendJsonlRecord(source, { id: 3 });

    expect(plan.unsupportedReason).toBeUndefined();
    expect(applyJsonlEdits(source, plan.edits)).toBe('{"id":1}\n{"id":2}\n{"id":3}\n');
  });

  it('duplicates, deletes, and replaces a single record while preserving unrelated lines', () => {
    const source = '{"id":1}\r\n{"id":2}\r\n{"id":3}\r\n';
    const duplicated = applyJsonlEdits(source, duplicateJsonlRecord(source, 2).edits);
    expect(duplicated).toBe('{"id":1}\r\n{"id":2}\r\n{"id":2}\r\n{"id":3}\r\n');

    const replaced = applyJsonlEdits(duplicated, replaceJsonlRecord(duplicated, 3, { id: 20, ok: true }).edits);
    expect(replaced).toBe('{"id":1}\r\n{"id":2}\r\n{"id":20,"ok":true}\r\n{"id":3}\r\n');

    const deleted = applyJsonlEdits(replaced, deleteJsonlRecord(replaced, 2).edits);
    expect(deleted).toBe('{"id":1}\r\n{"id":20,"ok":true}\r\n{"id":3}\r\n');
  });

  it('keeps final-line delete localized', () => {
    const source = '{"id":1}\n{"id":2}';
    const next = applyJsonlEdits(source, deleteJsonlRecord(source, 2).edits);

    expect(next).toBe('{"id":1}\n');
  });

  it('rejects records that cannot be represented as one JSON line', () => {
    expect(appendJsonlRecord('', undefined).unsupportedReason).toContain('JSON-serializable');
    expect(duplicateJsonlRecord('\n', 1).unsupportedReason).toContain('Blank');
    expect(replaceJsonlRecord('', 99, { id: 1 }).unsupportedReason).toContain('does not exist');
  });

  it('previews JSON array to JSONL conversion', () => {
    const result = jsonArrayToJsonlPreview('[{"id":1},{"id":2}]');

    expect(result).toEqual({
      ok: true,
      content: '{"id":1}\n{"id":2}\n',
      diagnostics: [],
    });
  });

  it('previews JSONL to JSON array conversion and reports invalid source lines', () => {
    const ok = jsonlToJsonArrayPreview('{"id":1}\n42\n');
    expect(ok.ok).toBe(true);
    expect(ok.content).toBe('[\n  {\n    "id": 1\n  },\n  42\n]\n');

    const bad = jsonlToJsonArrayPreview('{"id":1}\n\n{"id":}\n');
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics).toContain('Line 2: blank lines are not valid JSON Lines records.');
    expect(bad.diagnostics[1]).toContain('Line 3:');
  });

  it('rejects JSON to JSONL conversion when the root is not an array', () => {
    const result = jsonArrayToJsonlPreview('{"id":1}');

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(['JSON to JSONL conversion requires a top-level array.']);
  });

  it('plans visual record edits with source and line-span checks', () => {
    const source = '{"id":1}\r\n{"id":2}\r\n';
    const duplicated = planJsonlVisualEdit(source, {
      kind: 'duplicateRecord',
      lineNumber: 2,
      expectedOffset: 10,
      expectedLength: 8,
      expectedLineText: '{"id":2}',
      expectedSourceHash: jsonlSourceHash(source),
    });

    expect(duplicated).toMatchObject({
      ok: true,
      previewLabel: 'Duplicated JSONL line 2.',
    });
    expect(duplicated.nextSource).toBe('{"id":1}\r\n{"id":2}\r\n{"id":2}\r\n');

    expect(planJsonlVisualEdit(source, {
      kind: 'deleteRecord',
      lineNumber: 2,
      expectedLineText: '{"id":999}',
      expectedSourceHash: jsonlSourceHash(source),
    })).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'jsonl-edit-stale-line' })],
    });

    expect(planJsonlVisualEdit(source, {
      kind: 'replaceRecord',
      lineNumber: 1,
      value: { id: 10 },
      expectedSourceHash: 'stale',
    })).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'jsonl-edit-stale-source' })],
    });
  });

  it('plans append, replace, and final-line delete without rewriting unrelated records', () => {
    let source = '{"id":1}\n{"id":2}';

    const appended = planJsonlVisualEdit(source, {
      kind: 'appendRecord',
      value: { id: 3 },
      expectedSourceHash: jsonlSourceHash(source),
    });
    expect(appended.ok).toBe(true);
    expect(appended.nextSource).toBe('{"id":1}\n{"id":2}\n{"id":3}\n');
    source = appended.nextSource ?? source;

    const replaced = planJsonlVisualEdit(source, {
      kind: 'replaceRecord',
      lineNumber: 2,
      value: { id: 20, ok: true },
      expectedLineText: '{"id":2}',
    });
    expect(replaced.ok).toBe(true);
    expect(replaced.nextSource).toBe('{"id":1}\n{"id":20,"ok":true}\n{"id":3}\n');
    source = replaced.nextSource ?? source;

    const deleted = planJsonlVisualEdit(source, {
      kind: 'deleteRecord',
      lineNumber: 3,
      expectedLineText: '{"id":3}',
    });
    expect(deleted.ok).toBe(true);
    expect(deleted.nextSource).toBe('{"id":1}\n{"id":20,"ok":true}\n');
  });

  it('keeps existing invalid lines visible but disables visual edits against them', () => {
    const source = '{"id":1}\n\n{"id":2}\n';

    const appended = planJsonlVisualEdit(source, {
      kind: 'appendRecord',
      value: { id: 3 },
    });
    expect(appended.ok).toBe(true);
    expect(appended.nextSource).toBe('{"id":1}\n\n{"id":2}\n{"id":3}\n');

    expect(planJsonlVisualEdit(source, {
      kind: 'deleteRecord',
      lineNumber: 2,
      expectedLineText: '',
    })).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'jsonl-edit-invalid-line' })],
    });
  });
});
