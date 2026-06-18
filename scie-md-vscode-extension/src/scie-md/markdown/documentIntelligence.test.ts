import { describe, expect, it } from 'vitest';
import { analyzeMarkdownDocument, createRecentFilePreview, resolveRelativeMarkdownAsset } from './documentIntelligence';

describe('documentIntelligence', () => {
  it('extracts prose document basics', () => {
    const insights = analyzeMarkdownDocument('# Note\n\nThis is a short prose paragraph for reading.');

    expect(insights.firstHeading).toBe('Note');
    expect(insights.excerpt).toBe('This is a short prose paragraph for reading.');
  });

  it('counts tables without treating width as a user setting', () => {
    const insights = analyzeMarkdownDocument('| A | B | C | D |\n| --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 |\n');

    expect(insights.tableCount).toBe(1);
  });

  it('extracts recent preview heading and excerpt', () => {
    const preview = createRecentFilePreview('C:/docs/report.md', '# Report\n\nFirst useful paragraph.');

    expect(preview.name).toBe('report.md');
    expect(preview.heading).toBe('Report');
    expect(preview.excerpt).toBe('First useful paragraph.');
  });

  it('resolves local image paths without allowing traversal', () => {
    expect(resolveRelativeMarkdownAsset('C:/docs/report.md', 'assets/figure.png')).toBe('C:/docs/assets/figure.png');
    expect(resolveRelativeMarkdownAsset('C:\\docs\\report.md', 'assets/figure.png')).toBe('C:\\docs\\assets\\figure.png');
    expect(resolveRelativeMarkdownAsset('C:/docs/report.md', '../secret.txt')).toBeNull();
    expect(resolveRelativeMarkdownAsset('C:/docs/report.md', 'https://example.com/a.png')).toBeNull();
  });

  it('extracts image references with filenames that contain spaces', () => {
    const insights = analyzeMarkdownDocument('![Sample](assets/ChatGPT Image May 19, 2026.png)\n');

    expect(insights.imageReferences).toEqual([
      {
        alt: 'Sample',
        url: 'assets/ChatGPT Image May 19, 2026.png',
        line: 1,
      },
    ]);
  });
});
