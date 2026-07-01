import {
  createStructuredEditSourcePreview,
  type StructuredEditTransaction,
  type StructuredEditableFormat,
} from '@sciemd/core';

export interface StructuredEditJournalEntry {
  id: string;
  format: StructuredEditableFormat;
  operationLabel: string;
  targetLabel: string;
  previewLabel: string;
  riskLabel: string;
  appliedAt: number;
  line: number | null;
  column: number | null;
}

export function createStructuredEditJournalEntry({
  transaction,
  sourceBefore,
  appliedAt = Date.now(),
}: {
  transaction: StructuredEditTransaction;
  sourceBefore: string;
  appliedAt?: number;
}): StructuredEditJournalEntry {
  const preview = createStructuredEditSourcePreview(sourceBefore, transaction);
  return {
    id: `${transaction.id}:${appliedAt}`,
    format: transaction.format,
    operationLabel: transaction.operationLabel,
    targetLabel: transaction.target.label,
    previewLabel: transaction.previewLabel,
    riskLabel: transaction.riskLabel,
    appliedAt,
    line: preview?.range.line ?? null,
    column: preview?.range.column ?? null,
  };
}

export function appendStructuredEditJournalEntry(
  current: readonly StructuredEditJournalEntry[],
  entry: StructuredEditJournalEntry,
  limit = 12,
): StructuredEditJournalEntry[] {
  return [entry, ...current].slice(0, Math.max(1, limit));
}
