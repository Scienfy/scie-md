import { describe, expect, it } from 'vitest';
import {
  applyTabularTextEdits,
  planTabularVisualEdit,
  tabularSourceHash,
  type TabularVisualEditPlan,
} from './tabularEdits.js';

function requireOk(plan: TabularVisualEditPlan): TabularVisualEditPlan & { nextSource: string } {
  expect(plan.ok).toBe(true);
  if (!plan.ok || plan.nextSource === undefined) {
    throw new Error(plan.unsupportedReason ?? 'Expected tabular visual edit plan to be applicable.');
  }
  return plan as TabularVisualEditPlan & { nextSource: string };
}

function requireUnsupported(plan: TabularVisualEditPlan): TabularVisualEditPlan & { unsupportedReason: string } {
  expect(plan.ok).toBe(false);
  if (plan.ok || plan.unsupportedReason === undefined) {
    throw new Error('Expected tabular visual edit plan to be rejected.');
  }
  expect(plan.edits).toEqual([]);
  expect(plan.diagnostics).toHaveLength(1);
  expect(plan.diagnostics[0]).toMatchObject({
    severity: 'warning',
    category: 'edit',
    blocking: true,
  });
  return plan as TabularVisualEditPlan & { unsupportedReason: string };
}

describe('tabularEdits', () => {
  it('hashes source text deterministically for stale edit detection', () => {
    const source = 'id,note\n001,Alpha\n';

    expect(tabularSourceHash(source)).toBe(tabularSourceHash(source));
    expect(tabularSourceHash(source)).not.toBe(tabularSourceHash(`${source}002,Beta\n`));
  });

  it('applies multiple text edits from right to left regardless of input order', () => {
    expect(applyTabularTextEdits('abcdef', [
      { offset: 1, length: 2, content: 'XX' },
      { offset: 4, length: 1, content: 'Y' },
    ])).toBe('aXXdYf');
  });

  it('plans CSV cell replacement while preserving source spans, CRLF, and quoted style', () => {
    const source = 'id,note\r\n001,"Alpha, A"\r\n002,Beta\r\n';
    const plan = requireOk(planTabularVisualEdit(source, {
      kind: 'replaceCell',
      format: 'csv',
      dataRowIndex: 0,
      columnIndex: 1,
      nextValue: 'Gamma, "quoted"',
      expectedSourceHash: tabularSourceHash(source),
    }));

    expect(plan.previewLabel).toBe('Updated row 1, column 2.');
    expect(plan.edits).toEqual([{
      offset: source.indexOf('"Alpha, A"'),
      length: '"Alpha, A"'.length,
      content: '"Gamma, ""quoted"""',
    }]);
    expect(plan.nextSource).toBe('id,note\r\n001,"Gamma, ""quoted"""\r\n002,Beta\r\n');
    expect(applyTabularTextEdits(source, plan.edits)).toBe(plan.nextSource);
  });

  it('quotes CSV replacement cells when the new value requires CSV escaping', () => {
    const source = 'id,note\n001,Alpha\n';
    const plan = requireOk(planTabularVisualEdit(source, {
      kind: 'replaceCell',
      format: 'csv',
      dataRowIndex: 0,
      columnIndex: 1,
      nextValue: 'Thin, film',
    }));

    expect(plan.nextSource).toBe('id,note\n001,"Thin, film"\n');
  });

  it('keeps an originally quoted CSV cell quoted even when the replacement is plain text', () => {
    const source = 'id,note\n001,"Alpha"\n';
    const plan = requireOk(planTabularVisualEdit(source, {
      kind: 'replaceCell',
      format: 'csv',
      dataRowIndex: 0,
      columnIndex: 1,
      nextValue: 'Gamma',
    }));

    expect(plan.nextSource).toBe('id,note\n001,"Gamma"\n');
  });

  it('plans TSV cell replacement with tab-aware quoting', () => {
    const source = 'id\tnote\n001\tAlpha\n';
    const plan = requireOk(planTabularVisualEdit(source, {
      kind: 'replaceCell',
      format: 'tsv',
      dataRowIndex: 0,
      columnIndex: 1,
      nextValue: 'left\tright',
    }));

    expect(plan.nextSource).toBe('id\tnote\n001\t"left\tright"\n');
  });

  it('appends rows with the existing line ending when the file already ends with one', () => {
    const source = 'id,note\r\n001,Alpha\r\n';
    const plan = requireOk(planTabularVisualEdit(source, {
      kind: 'appendRow',
      format: 'csv',
      values: ['002', 'Delta, "value"'],
      expectedSourceHash: tabularSourceHash(source),
    }));

    expect(plan.previewLabel).toBe('Appended table row.');
    expect(plan.edits).toEqual([{
      offset: source.length,
      length: 0,
      content: '002,"Delta, ""value"""\r\n',
    }]);
    expect(plan.nextSource).toBe('id,note\r\n001,Alpha\r\n002,"Delta, ""value"""\r\n');
  });

  it('inserts a line ending before appended rows when the source has no trailing newline', () => {
    const source = 'id,note\n001,Alpha';
    const plan = requireOk(planTabularVisualEdit(source, {
      kind: 'appendRow',
      format: 'csv',
      values: ['002', 'Beta'],
    }));

    expect(plan.nextSource).toBe('id,note\n001,Alpha\n002,Beta\n');
  });

  it('rejects stale visual edits before parsing the table', () => {
    const plan = requireUnsupported(planTabularVisualEdit('id,note\n001,Alpha\n', {
      kind: 'replaceCell',
      format: 'csv',
      dataRowIndex: 0,
      columnIndex: 0,
      nextValue: '002',
      expectedSourceHash: 'stale',
    }));

    expect(plan.previewLabel).toBe('Table edit unavailable');
    expect(plan.unsupportedReason).toContain('source changed');
    expect(plan.diagnostics[0]?.code).toBe('tabular-edit-stale-source');
  });

  it('rejects cell replacement requests outside the parsed table bounds', () => {
    const source = 'id,note\n001,Alpha\n';

    expect(requireUnsupported(planTabularVisualEdit(source, {
      kind: 'replaceCell',
      format: 'csv',
      dataRowIndex: -1,
      columnIndex: 0,
      nextValue: '002',
    })).unsupportedReason).toBe('Table row index must be a non-negative integer.');

    expect(requireUnsupported(planTabularVisualEdit(source, {
      kind: 'replaceCell',
      format: 'csv',
      dataRowIndex: 0,
      columnIndex: 2,
      nextValue: 'Beta',
    })).unsupportedReason).toBe('Table column index is outside the parsed table.');

    expect(requireUnsupported(planTabularVisualEdit(source, {
      kind: 'replaceCell',
      format: 'csv',
      dataRowIndex: 1,
      columnIndex: 0,
      nextValue: '002',
    })).unsupportedReason).toBe('The selected table row is outside the parsed preview.');
  });

  it('rejects appends that cannot preserve a safe table shape', () => {
    expect(requireUnsupported(planTabularVisualEdit('id,note\n001,Alpha\n', {
      kind: 'appendRow',
      format: 'csv',
      values: ['002'],
    })).unsupportedReason).toBe('New rows must contain exactly 2 cells.');

    expect(requireUnsupported(planTabularVisualEdit('id,note\n001,Alpha  ', {
      kind: 'appendRow',
      format: 'csv',
      values: ['002', 'Beta'],
    })).unsupportedReason).toBe('Trailing non-line-ending whitespace must be cleaned up before appending rows visually.');
  });

  it('rejects visual edits when parser diagnostics make source-preserving edits unsafe', () => {
    expect(requireUnsupported(planTabularVisualEdit('id,note\n001\n002,Beta\n', {
      kind: 'replaceCell',
      format: 'csv',
      dataRowIndex: 0,
      columnIndex: 0,
      nextValue: '003',
    })).unsupportedReason).toContain('expected');

    expect(requireUnsupported(planTabularVisualEdit('id,note\n001,"bad"x\n', {
      kind: 'replaceCell',
      format: 'csv',
      dataRowIndex: 0,
      columnIndex: 1,
      nextValue: 'good',
    })).unsupportedReason).toContain('Unexpected characters after a closing quote');

    const largeSource = [
      'id,note',
      ...Array.from({ length: 1002 }, (_value, index) => `${index + 1},Row ${index + 1}`),
      '',
    ].join('\n');
    expect(requireUnsupported(planTabularVisualEdit(largeSource, {
      kind: 'appendRow',
      format: 'csv',
      values: ['1003', 'New row'],
    })).unsupportedReason).toBe('Appending rows is disabled while the parser preview is truncated.');
  });
});
