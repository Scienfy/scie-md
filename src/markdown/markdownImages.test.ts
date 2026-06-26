import { describe, expect, it } from 'vitest';
import { findMarkdownImages, formatMarkdownImageDestination, replaceMarkdownImages } from './markdownImages';

describe('markdownImages', () => {
  it('parses angle-bracket image destinations with parentheses and titles', () => {
    const markdown = '![Gel](<assets/gel (final).png> "raw scan")\n';
    const [image] = findMarkdownImages(markdown);

    expect(image).toMatchObject({
      raw: '![Gel](<assets/gel (final).png> "raw scan")',
      alt: 'Gel',
      url: 'assets/gel (final).png',
      title: ' "raw scan"',
      line: 1,
    });
  });

  it('rewrites only real image destinations and leaves fenced examples alone', () => {
    const markdown = [
      '![Gel](<assets/gel (final).png> "raw scan")',
      '',
      '```markdown',
      '![Example](<assets/example (draft).png>)',
      '```',
    ].join('\n');

    expect(replaceMarkdownImages(markdown, (image) => `![${image.alt}](safe/${image.url})`)).toBe([
      '![Gel](safe/assets/gel (final).png)',
      '',
      '```markdown',
      '![Example](<assets/example (draft).png>)',
      '```',
    ].join('\n'));
  });

  it('formats restored image destinations with brackets when raw paths contain whitespace or parentheses', () => {
    expect(formatMarkdownImageDestination('assets/gel final (raw).png')).toBe('<assets/gel final (raw).png>');
    expect(formatMarkdownImageDestination('assets/gel.png')).toBe('assets/gel.png');
  });
});
