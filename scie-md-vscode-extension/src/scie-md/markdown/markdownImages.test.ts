import { describe, expect, it } from 'vitest';
import { findMarkdownImages, replaceMarkdownImages } from './markdownImages';

describe('markdownImages', () => {
  it('finds local image destinations that contain spaces', () => {
    const images = findMarkdownImages('![ChatGPT Image](assets/ChatGPT Image May 19, 2026.png)');

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      alt: 'ChatGPT Image',
      url: 'assets/ChatGPT Image May 19, 2026.png',
      title: '',
      line: 1,
    });
  });

  it('preserves quoted titles when replacing image destinations', () => {
    const markdown = '![Figure](assets/my figure.png "Observed sample")';

    expect(replaceMarkdownImages(markdown, (image) => `![${image.alt}](asset://image${image.title})`)).toBe(
      '![Figure](asset://image "Observed sample")',
    );
  });

  it('handles angle-bracket image destinations', () => {
    const images = findMarkdownImages('![Figure](<assets/my figure.png> "Observed sample")');

    expect(images[0]).toMatchObject({
      url: 'assets/my figure.png',
      title: ' "Observed sample"',
    });
  });

  it('ignores image syntax examples inside fenced and inline code', () => {
    const markdown = [
      'Real ![Figure](assets/real figure.png)',
      '',
      '```md',
      '![Example](assets/example.png)',
      '```',
      '',
      'Inline `![Example](assets/inline.png)` should stay literal.',
    ].join('\n');

    expect(findMarkdownImages(markdown).map((image) => image.url)).toEqual(['assets/real figure.png']);
    expect(replaceMarkdownImages(markdown, (image) => `![${image.alt}](${image.url.replace('real', 'shown')})`))
      .toContain('![Example](assets/example.png)');
  });
});
