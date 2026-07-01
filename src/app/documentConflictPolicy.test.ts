import { describe, expect, it } from 'vitest';
import { canUseLineConflictReview, conflictReviewKindForFormat, labelForDocumentFormat } from './documentConflictPolicy';

describe('documentConflictPolicy', () => {
  it('keeps marker-based line review scoped to Markdown', () => {
    expect(canUseLineConflictReview('markdown')).toBe(true);
    expect(conflictReviewKindForFormat('markdown')).toBe('line-review');

    expect(canUseLineConflictReview('json')).toBe(false);
    expect(canUseLineConflictReview('jsonl')).toBe(false);
    expect(canUseLineConflictReview('yaml')).toBe(false);
    expect(conflictReviewKindForFormat('json')).toBe('structured-source');
  });

  it('uses registry labels for structured conflict text', () => {
    expect(labelForDocumentFormat('json')).toBe('JSON');
    expect(labelForDocumentFormat('jsonl')).toBe('JSON Lines');
    expect(labelForDocumentFormat('plainText')).toBe('Plain Text');
  });
});
