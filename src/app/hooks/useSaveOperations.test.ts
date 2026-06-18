import { describe, expect, it } from 'vitest';
import { suggestedMarkdownSavePath } from './useSaveOperations';

describe('suggestedMarkdownSavePath', () => {
  it('uses frontmatter title for untitled Save As suggestions', () => {
    expect(suggestedMarkdownSavePath('---\ntitle: RNA-seq Draft: Batch 2\n---\n# Ignored\n', null))
      .toBe('RNA-seq-Draft-Batch-2.md');
  });

  it('uses the first heading when no title exists', () => {
    expect(suggestedMarkdownSavePath('# Methods / Pilot Cohort?\n\nText', null))
      .toBe('Methods-Pilot-Cohort.md');
  });

  it('keeps the current path for existing documents', () => {
    expect(suggestedMarkdownSavePath('# New Title\n', 'C:/docs/old.md')).toBe('C:/docs/old.md');
  });
});
