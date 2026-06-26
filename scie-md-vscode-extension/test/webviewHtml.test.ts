import { describe, expect, it, vi } from 'vitest';
import { documentParentUri, getWebviewHtml } from '../src/extension/webviewHtml';

vi.mock('vscode', () => ({
  Uri: {
    file: (fsPath: string) => ({
      scheme: 'file',
      fsPath,
      toString: () => `file:///${fsPath.replace(/\\/g, '/')}`,
    }),
    joinPath: (base: { toString: () => string }, ...parts: string[]) => ({
      scheme: 'file',
      fsPath: parts.join('/'),
      toString: () => `${base.toString()}/${parts.join('/')}`,
    }),
  },
}));

describe('getWebviewHtml', () => {
  it('injects the document parent folder as the VS Code resource base for relative images', () => {
    const webview = {
      cspSource: 'vscode-resource:',
      asWebviewUri: (uri: { toString: () => string }) => ({
        toString: () => `webview:${uri.toString()}`,
      }),
    };

    const html = getWebviewHtml(
      webview as never,
      { toString: () => 'file:///extension' } as never,
      {
        scheme: 'file',
        fsPath: 'C:\\docs\\paper.md',
      } as never,
    );

    expect(html).toContain(
      'window.__SCIE_MD_VSCODE_DOCUMENT_RESOURCE_BASE__ = "webview:file:///C:/docs"',
    );
  });

  it('injects a resource base for remote document URIs', () => {
    const webview = {
      cspSource: 'vscode-resource:',
      asWebviewUri: (uri: { toString: () => string }) => ({
        toString: () => `webview:${uri.toString()}`,
      }),
    };
    const documentUri = {
      scheme: 'vscode-remote',
      path: '/home/amin/project/paper.md',
      fsPath: '/home/amin/project/paper.md',
      toString: () => 'vscode-remote://ssh-remote+lab/home/amin/project/paper.md',
      with: (changes: { path?: string; query?: string; fragment?: string }) => ({
        scheme: 'vscode-remote',
        path: changes.path ?? '/home/amin/project/paper.md',
        query: changes.query ?? '',
        fragment: changes.fragment ?? '',
        toString: () => `vscode-remote://ssh-remote+lab${changes.path ?? '/home/amin/project/paper.md'}`,
      }),
    };

    const html = getWebviewHtml(webview as never, { toString: () => 'file:///extension' } as never, documentUri as never);

    expect(documentParentUri(documentUri as never)?.toString()).toBe('vscode-remote://ssh-remote+lab/home/amin/project');
    expect(html).toContain(
      'window.__SCIE_MD_VSCODE_DOCUMENT_RESOURCE_BASE__ = "webview:vscode-remote://ssh-remote+lab/home/amin/project"',
    );
  });
});
