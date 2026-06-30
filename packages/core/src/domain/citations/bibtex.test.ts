import { describe, expect, it } from 'vitest';
import { countCitationKeyUsages, createBibtexEntrySource, deleteBibtexEntrySource, extractCitationUsageKeys, formatBibliographyEntry, parseBibtexEntries, renameCitationKeyUsages, syncGeneratedBibliography, upsertBibtexEntrySource } from './bibtex.js';

describe('bibtex utilities', () => {
  const bibtex = `
@article{smith2026,
  author = {Jane Smith and Amin Researcher and Alex Doe},
  title = {Hybrid Markdown for Scientific Writing},
  journal = {Journal of Research Tools},
  year = {2026},
  doi = {10.1234/scie.2026}
}
`;

  it('parses entries and formats references', () => {
    const entries = parseBibtexEntries(bibtex);
    expect(entries[0].key).toBe('smith2026');
    expect(formatBibliographyEntry(entries[0])).toContain('Jane Smith et al. (2026). Hybrid Markdown for Scientific Writing.');
    expect(formatBibliographyEntry(entries[0])).toContain('https://doi.org/10.1234/scie.2026');
  });

  it('syncs a managed bibliography section from used keys', () => {
    const entries = parseBibtexEntries(bibtex);
    const synced = syncGeneratedBibliography('Claim [@smith2026].', entries);
    expect(synced).toContain('## References');
    expect(synced).toContain('<!-- scie_md:bibliography:start -->');
    expect(synced).toContain('Journal of Research Tools');
  });

  it('syncs every key in a multi-citation bracket', () => {
    const entries = parseBibtexEntries(`${bibtex}\n@article{doe2026,title={Second},author={Alex Doe},year={2026}}`);
    const synced = syncGeneratedBibliography('Claim [@smith2026; @doe2026].', entries);

    expect(synced).toContain('Hybrid Markdown for Scientific Writing');
    expect(synced).toContain('Second.');
  });

  it('creates and upserts editable BibTeX entries', () => {
    const source = createBibtexEntrySource({
      type: 'article',
      key: 'lee2027',
      title: 'Editable Citations',
      author: 'Mina Lee',
      year: '2027',
      journal: 'Journal of Local Markdown',
      doi: 'https://doi.org/10.5555/example',
    });
    expect(source).toContain('@article{lee2027,');
    expect(source).toContain('doi = {10.5555/example}');

    const updated = upsertBibtexEntrySource(bibtex, 'smith2026', source);
    const entries = parseBibtexEntries(updated);
    expect(entries.map((entry) => entry.key)).toEqual(['lee2027']);
    expect(updated).toContain('Editable Citations');
  });

  it('deletes editable BibTeX entries while preserving other entries', () => {
    const deleted = deleteBibtexEntrySource(`${bibtex}\n@article{doe2026,title={Second}}\n`, 'smith2026');
    const entries = parseBibtexEntries(deleted);

    expect(entries.map((entry) => entry.key)).toEqual(['doe2026']);
    expect(deleted).not.toContain('Hybrid Markdown');
  });

  it('counts and renames citation usages outside code and comments', () => {
    const markdown = [
      'Claim [@smith2026; @doe2026].',
      '`[@smith2026]` stays literal.',
      '```',
      '[@smith2026]',
      '```',
      '<!-- scie_md:comment audience="llm": keep [@smith2026] -->',
      '',
    ].join('\n');

    expect(extractCitationUsageKeys(markdown)).toEqual(['smith2026', 'doe2026']);
    expect(countCitationKeyUsages(markdown, 'smith2026')).toBe(1);
    const renamed = renameCitationKeyUsages(markdown, 'smith2026', 'lee2027');
    expect(renamed).toContain('Claim [@lee2027; @doe2026].');
    expect(renamed).toContain('`[@smith2026]` stays literal.');
    expect(renamed).toContain('keep [@smith2026]');
  });

  it('counts, renames, and syncs narrative citations with the shared tokenizer', () => {
    const markdown = 'Smith reports this in @smith2026, with follow-up [@doe2026].';
    const entries = parseBibtexEntries(`${bibtex}\n@article{doe2026,title={Follow Up},author={Alex Doe},year={2026}}`);

    expect(extractCitationUsageKeys(markdown)).toEqual(['smith2026', 'doe2026']);
    expect(countCitationKeyUsages(markdown, 'smith2026')).toBe(1);
    expect(renameCitationKeyUsages(markdown, 'smith2026', 'lee2027')).toContain('@lee2027');

    const synced = syncGeneratedBibliography(markdown, entries);
    expect(synced).toContain('Hybrid Markdown for Scientific Writing');
    expect(synced).toContain('Follow Up.');
  });

  it('renames and syncs citation usages only in the Markdown body, not front matter', () => {
    const markdown = [
      '---',
      'title: "Front matter cites [@smith2026]"',
      'bibliography: refs.bib',
      '---',
      '',
      'Body claim [@smith2026].',
    ].join('\n');

    const renamed = renameCitationKeyUsages(markdown, 'smith2026', 'lee2027');
    expect(renamed).toContain('title: "Front matter cites [@smith2026]"');
    expect(renamed).toContain('Body claim [@lee2027].');

    const synced = syncGeneratedBibliography([
      '---',
      'title: "Front matter cites [@smith2026]"',
      '---',
      '',
      'No body citations.',
    ].join('\n'), parseBibtexEntries(bibtex));
    expect(synced).toContain('No citation keys were found');
    expect(synced).not.toContain('Hybrid Markdown for Scientific Writing');
  });

  it('updates and deletes parenthesized BibTeX entries', () => {
    const parenthesized = '@article(smith2026, title = "Original", year = 2026)';
    expect(parseBibtexEntries(parenthesized)[0]).toMatchObject({
      key: 'smith2026',
      fields: { title: 'Original', year: '2026' },
    });

    const replacement = createBibtexEntrySource({
      type: 'article',
      key: 'smith2026',
      title: 'Updated',
      year: '2027',
    });
    const updated = upsertBibtexEntrySource(parenthesized, 'smith2026', replacement);
    expect(parseBibtexEntries(updated)[0]).toMatchObject({
      key: 'smith2026',
      fields: { title: 'Updated', year: '2027' },
    });

    expect(parseBibtexEntries(deleteBibtexEntrySource(parenthesized, 'smith2026'))).toEqual([]);
  });

  it('creates compact website and DOI-only entries', () => {
    const website = createBibtexEntrySource({
      type: 'misc',
      key: 'scieDocs2026',
      title: 'ScieMD documentation',
      url: 'https://example.org/scie-md',
    });
    expect(website).toContain('@misc{scieDocs2026,');
    expect(website).toContain('title = {ScieMD documentation}');
    expect(website).toContain('url = {https://example.org/scie-md}');
    expect(website).not.toContain('author =');
    expect(website).not.toContain('year =');

    const doiOnly = createBibtexEntrySource({
      type: 'misc',
      key: 'doiOnly2026',
      doi: 'https://doi.org/10.1000/example',
    });
    expect(doiOnly).toContain('@misc{doiOnly2026,');
    expect(doiOnly).toContain('doi = {10.1000/example}');
    expect(doiOnly).not.toContain('title =');
  });

  it('preserves unknown fields when creating edited entries', () => {
    const edited = createBibtexEntrySource({
      type: 'inproceedings',
      key: 'smith2026',
      title: 'Hybrid Markdown for Scientific Writing',
      author: 'Jane Smith',
      extraFields: {
        volume: '4',
        pages: '12--18',
      },
    });
    expect(edited).toContain('@inproceedings{smith2026,');
    expect(edited).toContain('volume = {4}');
    expect(edited).toContain('pages = {12--18}');
  });

  it('handles real-world BibTeX control entries, strings, concatenation, and crossref', () => {
    const entries = parseBibtexEntries(`
@comment{Generated by Zotero}
@preamble{"ignored"}
@string{jrn = "Journal of " # "Robust Parsers"}
@proceedings{conf2026,
  title = {Proceedings of the Parser Conference},
  publisher = {Open Tools}
}
@inproceedings{muller2026,
  author = {M{\\\"u}ller and Jane Smith},
  title = {{RNA} Editing with {Smith} Case Protection},
  journal = jrn,
  month = jan,
  crossref = {conf2026}
}
`);

    expect(entries.map((entry) => entry.key)).toEqual(['conf2026', 'muller2026']);
    expect(entries[1].fields.journal).toBe('Journal of Robust Parsers');
    expect(entries[1].fields.month).toBe('January');
    expect(entries[1].fields.publisher).toBe('Open Tools');
    expect(entries[1].fields.title).toContain('{Smith}');
  });

  it('continues after malformed control items with unmatched delimiters', () => {
    const entries = parseBibtexEntries(`
@comment(contact (at) example.org)
@article{later2026,
  title = {Later Entry},
  year = {2026}
}
`);

    expect(entries.map((entry) => entry.key)).toEqual(['later2026']);
    expect(entries[0].fields.title).toBe('Later Entry');
  });

  it('ignores escaped braces while parsing entries and brace-delimited values', () => {
    const entries = parseBibtexEntries(`
@article{escaped2026,
  title = {A \\{literal\\} brace pair},
  note = {Ends with escaped closer \\}},
  year = {2026}
}
`);

    expect(entries.map((entry) => entry.key)).toEqual(['escaped2026']);
    expect(entries[0].fields.title).toBe('A \\{literal\\} brace pair');
    expect(entries[0].fields.note).toBe('Ends with escaped closer \\}');
    expect(entries[0].fields.year).toBe('2026');
  });
});
