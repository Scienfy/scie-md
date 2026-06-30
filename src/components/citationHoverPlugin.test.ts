import { describe, expect, it } from 'vitest';
import { createCitationHoverRanges } from './citationHoverPlugin';
import type { BibtexEntry } from '@sciemd/core';

describe('createCitationHoverRanges', () => {
  const entry: BibtexEntry = {
    type: 'article',
    key: 'smith2026',
    fields: {
      title: '{Reliable Markdown}',
      author: 'A. Smith and B. Doe',
      year: '2026',
      journal: 'Journal of Tools',
      abstract: 'A short abstract.',
    },
  };

  it('creates rich visual citation ranges for Pandoc citation keys', () => {
    const ranges = createCitationHoverRanges(
      'Known [@smith2026] and missing [@ghost2026], bracketed [@fig-study2026], but @fig-one is a reference.',
      10,
      new Map([[entry.key, entry]]),
      new Set([entry.key]),
      true,
    );

    expect(ranges).toHaveLength(3);
    expect(ranges[0]).toMatchObject({
      key: 'smith2026',
      className: expect.stringContaining('visual-citation-verified'),
    });
    expect(ranges[0]?.tooltip).toContain('Reliable Markdown');
    expect(ranges[1]).toMatchObject({
      key: 'ghost2026',
      className: expect.stringContaining('visual-citation-missing'),
    });
    expect(ranges[2]).toMatchObject({
      key: 'fig-study2026',
      className: expect.stringContaining('visual-citation-missing'),
    });
  });
});
