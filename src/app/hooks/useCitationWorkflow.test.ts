import { describe, expect, it } from 'vitest';
import { ensureBibliographyFrontmatter } from './useCitationWorkflow';

describe('ensureBibliographyFrontmatter', () => {
  it('adds bibliography front matter without normalizing CRLF documents', () => {
    const markdown = [
      '---',
      'title: Citation Test',
      '---',
      '# Body',
      '',
    ].join('\r\n');

    expect(ensureBibliographyFrontmatter(markdown, 'refs.bib')).toBe([
      '---',
      'title: Citation Test',
      'bibliography: refs.bib',
      '---',
      '# Body',
      '',
    ].join('\r\n'));
  });
});
