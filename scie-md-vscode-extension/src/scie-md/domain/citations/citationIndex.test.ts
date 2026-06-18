import { describe, expect, it } from 'vitest';
import { buildCitationIndex, extractCitationUsages } from './citationIndex';

describe('citationIndex', () => {
  it('indexes bracket citations without treating casual @mentions as citations', () => {
    const usages = extractCitationUsages('Discussed by @colleague, but supported by [@smith2026; @lee2025].');

    expect(usages.map((usage) => usage.key)).toEqual(['smith2026', 'lee2025']);
  });

  it('allows loose narrative citations only when bibliography is configured', () => {
    const withoutBibliography = buildCitationIndex('According to @smith2026, the result holds.');
    const withBibliography = buildCitationIndex('According to @smith2026, the result holds.', ['refs.bib']);

    expect(withoutBibliography.usages).toHaveLength(0);
    expect(withBibliography.usages.map((usage) => usage.key)).toEqual(['smith2026']);
  });

  it('ignores citation examples inside code and ScieMD comments', () => {
    const markdown = [
      'Real claim [@smith2026].',
      '',
      '`[@inlineCode2026]`',
      '',
      '```md',
      'Example [@code2026].',
      '```',
      '',
      '<!-- scie_md:comment audience="llm"',
      'Internal note [@comment2026].',
      '-->',
    ].join('\n');

    expect(extractCitationUsages(markdown, { allowLoose: true }).map((usage) => usage.key)).toEqual(['smith2026']);
  });

  it('does not drop bracket citation keys that share cross-reference prefixes', () => {
    expect(extractCitationUsages('A citation [@fig-study2026].').map((usage) => usage.key)).toEqual(['fig-study2026']);
  });
});
