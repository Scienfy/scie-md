import { describe, expect, it } from 'vitest';
import { extractHeadings, headingPathForLine } from './outline';

describe('extractHeadings', () => {
  it('extracts markdown headings and ignores code fences', () => {
    const headings = extractHeadings('# Intro\n\n```md\n# Not heading\n```\n\n## Methods\n### Methods\n');

    expect(headings).toEqual([
      { id: 'intro', level: 1, text: 'Intro', line: 1 },
      { id: 'methods', level: 2, text: 'Methods', line: 7 },
      { id: 'methods-2', level: 3, text: 'Methods', line: 8 },
    ]);
  });

  it('returns the current heading path for a cursor line', () => {
    const headings = extractHeadings('# Intro\n\n## Methods\n\n### Spray coating\n\n## Results\n');

    expect(headingPathForLine(headings, 6).map((heading) => heading.text)).toEqual(['Intro', 'Methods', 'Spray coating']);
    expect(headingPathForLine(headings, 7).map((heading) => heading.text)).toEqual(['Intro', 'Results']);
  });
});
