import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  openStructuredPreview,
  structuredPreviewTextForWebview,
  VSCODE_STRUCTURED_PREVIEW_SOURCE_EXCERPT_BYTES,
} from '../src/extension/StructuredPreviewPanel';

const vscodeMock = vi.hoisted(() => ({
  activeTextEditor: undefined as undefined | { document: ReturnType<typeof createDocument> },
  createWebviewPanel: vi.fn(),
  getWorkspaceFolder: vi.fn(),
  onDidChangeTextDocument: vi.fn(),
  onDidSaveTextDocument: vi.fn(),
  openTextDocument: vi.fn(),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  clipboardWriteText: vi.fn(),
}));

vi.mock('vscode', () => ({
  ViewColumn: {
    Beside: 2,
  },
  Uri: {
    file: (fsPath: string) => ({
      scheme: 'file',
      fsPath,
      path: `/${fsPath.replace(/\\/g, '/')}`,
      toString: () => `file:///${fsPath.replace(/\\/g, '/')}`,
    }),
    joinPath: (base: { toString: () => string }, ...parts: string[]) => ({
      scheme: 'file',
      fsPath: parts.join('/'),
      path: `/${parts.join('/')}`,
      toString: () => `${base.toString()}/${parts.join('/')}`,
    }),
  },
  env: {
    clipboard: {
      writeText: vscodeMock.clipboardWriteText,
    },
  },
  window: {
    get activeTextEditor() {
      return vscodeMock.activeTextEditor;
    },
    createWebviewPanel: vscodeMock.createWebviewPanel,
    showInformationMessage: vscodeMock.showInformationMessage,
    showWarningMessage: vscodeMock.showWarningMessage,
  },
  workspace: {
    getWorkspaceFolder: vscodeMock.getWorkspaceFolder,
    onDidChangeTextDocument: vscodeMock.onDidChangeTextDocument,
    onDidSaveTextDocument: vscodeMock.onDidSaveTextDocument,
    openTextDocument: vscodeMock.openTextDocument,
  },
}));

describe('StructuredPreviewPanel', () => {
  beforeEach(() => {
    vscodeMock.activeTextEditor = undefined;
    vscodeMock.createWebviewPanel.mockReset();
    vscodeMock.getWorkspaceFolder.mockReset();
    vscodeMock.onDidChangeTextDocument.mockReset();
    vscodeMock.onDidSaveTextDocument.mockReset();
    vscodeMock.openTextDocument.mockReset();
    vscodeMock.showInformationMessage.mockReset();
    vscodeMock.showWarningMessage.mockReset();
    vscodeMock.clipboardWriteText.mockReset();
    vscodeMock.onDidChangeTextDocument.mockReturnValue({ dispose: vi.fn() });
    vscodeMock.onDidSaveTextDocument.mockReturnValue({ dispose: vi.fn() });
  });

  it('opens an active JSON document in a read-only structured preview webview', async () => {
    const document = createDocument('C:\\docs\\data.json', '{"id":"trial"}\n');
    const panel = createPanel();
    vscodeMock.activeTextEditor = { document };
    vscodeMock.createWebviewPanel.mockReturnValue(panel);

    await openStructuredPreview(
      { extensionUri: uri('C:\\extension') } as never,
      { appendLine: vi.fn() } as never,
    );

    expect(vscodeMock.createWebviewPanel).toHaveBeenCalledWith(
      'scieMd.structuredPreview',
      expect.stringContaining('JSON Preview'),
      2,
      { enableScripts: true },
    );
    expect(panel.webview.options.enableScripts).toBe(true);
    expect(panel.webview.html).toContain('ScieMD webview');
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'documentUpdate',
      snapshot: expect.objectContaining({
        fileName: 'data.json',
        format: 'json',
        isReadonly: true,
        text: '{"id":"trial"}\n',
      }),
    }));
  });

  it('caps structured preview text before posting to the webview', () => {
    const source = `{"payload":"${'x'.repeat(VSCODE_STRUCTURED_PREVIEW_SOURCE_EXCERPT_BYTES + 128)}"}`;
    const result = structuredPreviewTextForWebview('json', source);

    expect(result.truncated).toBe(true);
    expect(result.totalBytes).toBeGreaterThan(result.limitBytes);
    expect(byteLength(result.text)).toBeLessThanOrEqual(result.limitBytes);
  });

  it('posts source-excerpt metadata for oversized structured preview documents', async () => {
    const source = `{"payload":"${'x'.repeat(VSCODE_STRUCTURED_PREVIEW_SOURCE_EXCERPT_BYTES + 128)}"}`;
    const document = createDocument('C:\\docs\\large.json', source);
    const panel = createPanel();
    vscodeMock.activeTextEditor = { document };
    vscodeMock.createWebviewPanel.mockReturnValue(panel);

    await openStructuredPreview(
      { extensionUri: uri('C:\\extension') } as never,
      { appendLine: vi.fn() } as never,
    );

    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'documentUpdate',
      snapshot: expect.objectContaining({
        format: 'json',
        sourceTextTruncated: true,
        sourceLimitBytes: VSCODE_STRUCTURED_PREVIEW_SOURCE_EXCERPT_BYTES,
        readonlyReason: expect.stringContaining('source excerpt'),
      }),
    }));
    const message = panel.webview.postMessage.mock.calls[0][0];
    expect(byteLength(message.snapshot.text)).toBeLessThanOrEqual(VSCODE_STRUCTURED_PREVIEW_SOURCE_EXCERPT_BYTES);
  });

  it('opens a JSON Lines URI through shared ingest detection', async () => {
    const document = createDocument('C:\\docs\\records.ndjson', '{"id":1}\n{"id":2}\n');
    const panel = createPanel();
    vscodeMock.openTextDocument.mockResolvedValue(document);
    vscodeMock.createWebviewPanel.mockReturnValue(panel);

    await openStructuredPreview(
      { extensionUri: uri('C:\\extension') } as never,
      { appendLine: vi.fn() } as never,
      uri('C:\\docs\\records.ndjson') as never,
    );

    expect(vscodeMock.openTextDocument).toHaveBeenCalled();
    expect(vscodeMock.createWebviewPanel).toHaveBeenCalledWith(
      'scieMd.structuredPreview',
      expect.stringContaining('JSON Lines Preview'),
      2,
      { enableScripts: true },
    );
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'documentUpdate',
      snapshot: expect.objectContaining({
        fileName: 'records.ndjson',
        format: 'jsonl',
      }),
    }));
  });

  it('refuses unsupported active documents instead of opening a structured panel', async () => {
    vscodeMock.activeTextEditor = { document: createDocument('C:\\docs\\paper.md', '# Paper\n') };

    await openStructuredPreview(
      { extensionUri: uri('C:\\extension') } as never,
      { appendLine: vi.fn() } as never,
    );

    expect(vscodeMock.createWebviewPanel).not.toHaveBeenCalled();
    expect(vscodeMock.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('JSON, JSON Lines, YAML, TOML, and XML'));
  });
});

function createDocument(fileName: string, text: string) {
  return {
    uri: uri(fileName),
    fileName,
    version: 1,
    isDirty: false,
    getText: () => text,
  };
}

function createPanel() {
  return {
    webview: {
      cspSource: 'vscode-resource:',
      options: {},
      html: '',
      asWebviewUri: (target: { toString: () => string }) => ({
        toString: () => `webview:${target.toString()}`,
      }),
      postMessage: vi.fn(async () => true),
      onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
    },
    onDidDispose: vi.fn(),
  };
}

function uri(fsPath: string) {
  return {
    scheme: 'file',
    fsPath,
    path: `/${fsPath.replace(/\\/g, '/')}`,
    toString: () => `file:///${fsPath.replace(/\\/g, '/')}`,
  };
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}
