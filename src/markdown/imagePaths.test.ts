import { describe, expect, it } from 'vitest';
import { fromVisualImagePaths, resolveSafeDocumentRelativePath } from './imagePaths';

describe('fromVisualImagePaths', () => {
  it('restores display URLs only inside image markdown URLs', () => {
    const displayUrl = 'asset://localhost/C:/doc/assets/a.png?x=1';
    const map = new Map([[displayUrl, 'assets/a.png']]);
    const markdown = `Text mentioning ${displayUrl}\n\n![Alt](${displayUrl})\n`;

    expect(fromVisualImagePaths(markdown, map)).toBe(`Text mentioning ${displayUrl}\n\n![Alt](assets/a.png)\n`);
  });

  it('restores display URLs for image markdown that includes a title', () => {
    const displayUrl = 'asset://localhost/C:/doc/assets/my%20image.png';
    const map = new Map([[displayUrl, 'assets/my image.png']]);

    expect(fromVisualImagePaths(`![Alt](${displayUrl} "Figure title")`, map)).toBe(
      '![Alt](assets/my image.png "Figure title")',
    );
  });
});

describe('resolveSafeDocumentRelativePath', () => {
  it('resolves image paths inside the document directory', () => {
    expect(resolveSafeDocumentRelativePath('C:\\docs\\paper.md', 'assets/figure.png')).toBe('C:\\docs\\assets\\figure.png');
  });

  it('rejects traversal outside the document directory', () => {
    expect(resolveSafeDocumentRelativePath('C:\\docs\\paper.md', '../secret.png')).toBeNull();
    expect(resolveSafeDocumentRelativePath('C:\\docs\\paper.md', '%2e%2e/secret.png')).toBeNull();
  });
});
