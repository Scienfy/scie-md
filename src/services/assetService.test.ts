import { describe, expect, it } from 'vitest';
import { encodeMarkdownImagePath, markdownImageSyntax } from './assetService';

describe('encodeMarkdownImagePath', () => {
  it('percent-encodes image paths so Markdown parsers render filenames with spaces', () => {
    expect(encodeMarkdownImagePath('assets/ChatGPT Image May 19, 2026, 01_26_41 AM-3.png')).toBe(
      'assets/ChatGPT%20Image%20May%2019%2C%202026%2C%2001_26_41%20AM-3.png',
    );
  });

  it('does not double-encode existing percent escapes', () => {
    expect(encodeMarkdownImagePath('assets/a%20b.png')).toBe('assets/a%20b.png');
  });
});

describe('markdownImageSyntax', () => {
  it('escapes alt text and emits a parser-safe image token', () => {
    expect(markdownImageSyntax('A [test] image', 'assets/my image (1).png')).toBe(
      '![A \\[test\\] image](assets/my%20image%20%281%29.png)',
    );
  });
});
