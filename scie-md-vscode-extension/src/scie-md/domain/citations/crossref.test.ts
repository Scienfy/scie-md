import { describe, expect, it } from 'vitest';
import { crossrefMessageToCitationDraft, normalizeDoiInput } from './crossref';

describe('crossref citation mapping', () => {
  it('normalizes DOI URLs and DOI prefixes', () => {
    expect(normalizeDoiInput('https://doi.org/10.1000/example')).toBe('10.1000/example');
    expect(normalizeDoiInput('doi: 10.1000/example')).toBe('10.1000/example');
  });

  it('maps Crossref work metadata to an editable BibTeX draft', () => {
    const draft = crossrefMessageToCitationDraft({
      DOI: '10.5555/scie.2026',
      URL: 'https://doi.org/10.5555/scie.2026',
      type: 'journal-article',
      title: ['Reliable Scientific Markdown'],
      author: [
        { given: 'Jane', family: 'Smith' },
        { given: 'Alex', family: 'Doe' },
      ],
      'container-title': ['Journal of Research Tools'],
      issued: { 'date-parts': [[2026, 4, 2]] },
    });

    expect(draft).toMatchObject({
      type: 'article',
      title: 'Reliable Scientific Markdown',
      author: 'Jane Smith and Alex Doe',
      year: '2026',
      journal: 'Journal of Research Tools',
      doi: '10.5555/scie.2026',
    });
  });
});
