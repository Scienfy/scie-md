import { afterEach, describe, expect, it } from 'vitest';
import { fromVisualImagePaths, resolveSafeDocumentRelativePath, toVisualImagePaths } from './imagePaths';

const vscodeResourceWindow = window as Window & { __SCIE_MD_VSCODE_DOCUMENT_RESOURCE_BASE__?: string };

afterEach(() => {
  delete vscodeResourceWindow.__SCIE_MD_VSCODE_DOCUMENT_RESOURCE_BASE__;
});

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
      '![Alt](<assets/my image.png> "Figure title")',
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

  it('rejects malformed encoded relative image paths', () => {
    expect(resolveSafeDocumentRelativePath('C:\\docs\\paper.md', 'assets/%E0%A4%A.png')).toBeNull();
  });
});

describe('toVisualImagePaths', () => {
  it('rewrites relative images to VS Code webview resource URIs when available', () => {
    vscodeResourceWindow.__SCIE_MD_VSCODE_DOCUMENT_RESOURCE_BASE__ = 'https://file+.vscode-resource.vscode-cdn.net/c%3A/docs';

    const result = toVisualImagePaths('![Figure](assets/my image.png?raw#frag)', 'C:\\docs\\paper.md');
    const displayUrl = 'https://file+.vscode-resource.vscode-cdn.net/c%3A/docs/assets/my%20image.png?raw#frag';

    expect(result.markdown).toBe(`![Figure](${displayUrl})`);
    expect(result.displayToOriginal.get(displayUrl)).toBe('assets/my image.png?raw#frag');
  });

  it('rewrites VS Code relative images when the document path is unavailable but a resource base exists', () => {
    vscodeResourceWindow.__SCIE_MD_VSCODE_DOCUMENT_RESOURCE_BASE__ = 'https://file+.vscode-resource.vscode-cdn.net/c%3A/docs';

    const result = toVisualImagePaths('![Figure](assets/figure.png)', null);

    expect(result.markdown).toBe('![Figure](https://file+.vscode-resource.vscode-cdn.net/c%3A/docs/assets/figure.png)');
  });

  it('round-trips VS Code visual image paths with encoded spaces, query, hash, and title', () => {
    vscodeResourceWindow.__SCIE_MD_VSCODE_DOCUMENT_RESOURCE_BASE__ = 'https://file+.vscode-resource.vscode-cdn.net/c%3A/docs';
    const markdown = '![Panel](assets/panel%20A.svg?raw=1#roi "Panel A")';

    const result = toVisualImagePaths(markdown, 'C:\\docs\\paper.md');
    const displayUrl = 'https://file+.vscode-resource.vscode-cdn.net/c%3A/docs/assets/panel%20A.svg?raw=1#roi';

    expect(result.markdown).toBe(`![Panel](${displayUrl} "Panel A")`);
    expect(result.displayToOriginal.get(displayUrl)).toBe('assets/panel%20A.svg?raw=1#roi');
    expect(fromVisualImagePaths(result.markdown, result.displayToOriginal)).toBe(markdown);
  });
});
