import { describe, expect, it } from 'vitest';
import { planJsonVisualEdit, structuredEditTransactionFromJsonEdit } from '@sciemd/core';
import {
  appendStructuredEditJournalEntry,
  createStructuredEditJournalEntry,
} from './structuredEditJournal';

describe('structuredEditJournal', () => {
  it('creates compact journal entries from structured edit transactions', () => {
    const source = '{\n  "name": "A"\n}\n';
    const intent = {
      kind: 'replaceScalar' as const,
      path: ['name'],
      nextValue: 'B',
    };
    const plan = planJsonVisualEdit(source, intent);
    const transaction = structuredEditTransactionFromJsonEdit(source, intent, plan);

    expect(transaction).not.toBeNull();
    const entry = createStructuredEditJournalEntry({
      transaction: transaction!,
      sourceBefore: source,
      appliedAt: 1000,
    });

    expect(entry).toMatchObject({
      format: 'json',
      operationLabel: 'Edit JSON value',
      targetLabel: '$.name',
      previewLabel: 'Updated $.name.',
      riskLabel: 'Replace source range',
      appliedAt: 1000,
      line: 2,
    });
  });

  it('keeps newest entries first and bounds the journal', () => {
    const entries = Array.from({ length: 4 }, (_, index) => ({
      id: String(index),
      format: 'json' as const,
      operationLabel: `Edit ${index}`,
      targetLabel: '$',
      previewLabel: `Updated ${index}`,
      riskLabel: 'Replace source range',
      appliedAt: index,
      line: index,
      column: 1,
    }));

    const next = appendStructuredEditJournalEntry(entries.slice(0, 2), entries[3]!, 2);

    expect(next.map((entry) => entry.id)).toEqual(['3', '0']);
  });
});
