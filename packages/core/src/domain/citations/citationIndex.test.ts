import { describe, expect, it } from 'vitest';
import { buildCitationIndex, extractCitationTokens, extractCitationUsages } from './citationIndex.js';

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
    expect(withBibliography.usages[0].kind).toBe('narrative');
  });

  it('returns source offsets for bracket and narrative citation tokens', () => {
    const markdown = 'Claim [@smith2026; @lee2025] and see @doe2024.';
    const tokens = extractCitationTokens(markdown, { allowLoose: true });

    expect(tokens.map((token) => ({ key: token.key, kind: token.kind, raw: markdown.slice(token.from, token.to) }))).toEqual([
      { key: 'smith2026', kind: 'bracket', raw: '@smith2026' },
      { key: 'lee2025', kind: 'bracket', raw: '@lee2025' },
      { key: 'doe2024', kind: 'narrative', raw: '@doe2024' },
    ]);
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

  it('reports missing citations when a configured bibliography is empty', () => {
    const index = buildCitationIndex('Claim [@missing2026].', ['refs.bib'], '');

    expect(index.usages).toEqual([expect.objectContaining({ key: 'missing2026', line: 1 })]);
    expect(index.missingKeys).toEqual(['missing2026']);
  });

  it('ignores loose hyphen and colon cross-reference labels when bibliography is configured', () => {
    const index = buildCitationIndex('See @fig-surface and @fig:surface, but cite @smith2026.', ['refs.bib'], '@article{smith2026,title={Known}}');

    expect(index.usages.map((usage) => usage.key)).toEqual(['smith2026']);
    expect(index.missingKeys).toEqual([]);
  });
});
