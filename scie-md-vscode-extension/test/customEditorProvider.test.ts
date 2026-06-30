import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScieMDCustomEditorProvider, canSaveAfterPendingEdit } from '../src/extension/ScieMdCustomEditorProvider';

const vscodeMock = vi.hoisted(() => ({
  applyEdit: vi.fn(),
  clipboardWriteText: vi.fn(),
  executeCommand: vi.fn(),
  fsWriteFile: vi.fn(),
  fsStat: vi.fn(),
  showErrorMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  workspaceEdits: [] as Array<{ replacements: Array<{ range: { start: number; end: number }; text: string }> }>,
}));

vi.mock('vscode', () => ({
  WorkspaceEdit: class {
    replacements: Array<{ range: { start: number; end: number }; text: string }> = [];
    constructor() {
      vscodeMock.workspaceEdits.push(this);
    }
    replace = vi.fn((_uri: unknown, range: { start: number; end: number }, text: string) => {
      this.replacements.push({ range, text });
    });
  },
  Range: class {
    constructor(readonly start: unknown, readonly end: unknown) {}
  },
  RelativePattern: class {
    constructor(readonly base: unknown, readonly pattern: string) {}
  },
  Disposable: {
    from: (...disposables: Array<{ dispose?: () => void }>) => ({
      dispose: () => disposables.forEach((disposable) => disposable.dispose?.()),
    }),
  },
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
  commands: {
    executeCommand: vscodeMock.executeCommand,
  },
  env: {
    clipboard: {
      writeText: vscodeMock.clipboardWriteText,
    },
  },
  window: {
    activeTextEditor: undefined,
    showErrorMessage: vscodeMock.showErrorMessage,
    showInformationMessage: vscodeMock.showInformationMessage,
    showWarningMessage: vscodeMock.showWarningMessage,
  },
  workspace: {
    applyEdit: vscodeMock.applyEdit,
    fs: {
      stat: vscodeMock.fsStat,
      writeFile: vscodeMock.fsWriteFile,
    },
    getWorkspaceFolder: vi.fn(),
    createFileSystemWatcher: vi.fn(() => ({
      dispose: vi.fn(),
      onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
    })),
    onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidDeleteFiles: vi.fn(() => ({ dispose: vi.fn() })),
    onDidRenameFiles: vi.fn(() => ({ dispose: vi.fn() })),
    onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
  },
}));

describe('ScieMDCustomEditorProvider', () => {
  beforeEach(() => {
    vscodeMock.applyEdit.mockReset();
    vscodeMock.clipboardWriteText.mockReset();
    vscodeMock.executeCommand.mockReset();
    vscodeMock.fsWriteFile.mockReset();
    vscodeMock.fsStat.mockReset();
    vscodeMock.showErrorMessage.mockReset();
    vscodeMock.showInformationMessage.mockReset();
    vscodeMock.showWarningMessage.mockReset();
    vscodeMock.workspaceEdits.length = 0;
  });

  it('saves only after a pending webview edit is applied or is a no-op', () => {
    expect(canSaveAfterPendingEdit('applied')).toBe(true);
    expect(canSaveAfterPendingEdit('noop')).toBe(true);
    expect(canSaveAfterPendingEdit('failed')).toBe(false);
    expect(canSaveAfterPendingEdit('skipped')).toBe(false);
    expect(canSaveAfterPendingEdit('readonly')).toBe(false);
  });

  it('does not save stale document text when applying pending webview text fails', async () => {
    vscodeMock.applyEdit.mockResolvedValueOnce(false);
    vscodeMock.fsStat.mockResolvedValueOnce({});
    const provider = new ScieMDCustomEditorProvider(
      { extensionUri: { toString: () => 'file:///extension' } } as never,
      { appendLine: vi.fn() } as never,
    );
    const save = vi.fn();
    const document = {
      uri: { scheme: 'file', fsPath: 'C:\\docs\\paper.md', toString: () => 'file:///C:/docs/paper.md' },
      fileName: 'paper.md',
      version: 1,
      isDirty: true,
      getText: () => 'old\n',
      positionAt: (offset: number) => offset,
      save,
    };
    const panel = {
      webview: {
        postMessage: vi.fn(),
      },
    };

    await (provider as unknown as {
      handleMessage: (
        document: typeof document,
        panel: typeof panel,
        message: { type: 'save'; pendingText: string; editId: string; baseText: string; baseVersion: number },
      ) => Promise<void>;
    }).handleMessage(document, panel, {
      type: 'save',
      pendingText: 'new\n',
      editId: 'edit-1',
      baseText: 'old\n',
      baseVersion: 1,
    });

    expect(vscodeMock.applyEdit).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(vscodeMock.showErrorMessage).toHaveBeenCalledWith('ScieMD could not apply the document edit.');
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'operationResult',
      id: 'edit-1',
      ok: false,
      result: 'failed',
    }));
  });

  it('keeps two webview panels isolated and rejects edits carrying another panel id', async () => {
    vscodeMock.fsStat.mockResolvedValue({});
    const provider = createProvider();
    const document = createMutableDocument('Original\n', 1);
    const firstPanel = createPanel();
    const secondPanel = createPanel();

    await provider.resolveCustomTextEditor(document as never, firstPanel as never, { isCancellationRequested: false } as never);
    await provider.resolveCustomTextEditor(document as never, secondPanel as never, { isCancellationRequested: false } as never);

    const firstPanelId = firstPanel.webview.postMessage.mock.calls.find((call) => call[0]?.type === 'documentUpdate')?.[0].panelId;
    const secondPanelId = secondPanel.webview.postMessage.mock.calls.find((call) => call[0]?.type === 'documentUpdate')?.[0].panelId;
    expect(firstPanelId).toBeTruthy();
    expect(secondPanelId).toBeTruthy();
    expect(firstPanelId).not.toBe(secondPanelId);

    await (provider as unknown as {
      handleMessage: (
        document: typeof document,
        panel: typeof firstPanel,
        message: { type: 'replaceDocument'; panelId: string; editId: string; editChainId: string; text: string; baseText: string; baseVersion: number },
      ) => Promise<void>;
    }).handleMessage(document, firstPanel, {
      type: 'replaceDocument',
      panelId: secondPanelId,
      editId: 'edit-wrong-panel',
      editChainId: 'chain-1',
      text: 'Wrong panel edit\n',
      baseText: 'Original\n',
      baseVersion: 1,
    });

    expect(vscodeMock.applyEdit).not.toHaveBeenCalled();
    expect(firstPanel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'operationResult',
      id: 'edit-wrong-panel',
      ok: false,
      result: 'skipped',
      message: expect.stringContaining('another webview panel'),
    }));
  });

  it('merges a stale panel edit with the latest VS Code document text and acknowledges it', async () => {
    vscodeMock.fsStat.mockResolvedValue({});
    let currentText = 'Intro\nExternal line\n';
    const document = createMutableDocument(currentText, 2, (nextText) => {
      currentText = nextText;
      document.getText = () => currentText;
    });
    vscodeMock.applyEdit.mockImplementation(async () => {
      const replacement = vscodeMock.workspaceEdits.at(-1)?.replacements.at(-1);
      if (replacement === undefined) return false;
      currentText = `${currentText.slice(0, replacement.range.start)}${replacement.text}${currentText.slice(replacement.range.end)}`;
      document.getText = () => currentText;
      return true;
    });
    const provider = createProvider();
    const panel = createPanel();

    await provider.resolveCustomTextEditor(document as never, panel as never, { isCancellationRequested: false } as never);
    const panelId = panel.webview.postMessage.mock.calls.find((call) => call[0]?.type === 'documentUpdate')?.[0].panelId;

    await (provider as unknown as {
      handleMessage: (
        document: typeof document,
        panel: typeof panel,
        message: { type: 'replaceDocument'; panelId: string; editId: string; editChainId: string; text: string; baseText: string; baseVersion: number },
      ) => Promise<void>;
    }).handleMessage(document, panel, {
      type: 'replaceDocument',
      panelId,
      editId: 'edit-stale',
      editChainId: 'chain-1',
      baseText: 'Intro\n',
      baseVersion: 1,
      text: 'Intro\nPanel line\n',
    });

    expect(currentText).toContain('Panel line');
    expect(currentText).toContain('External line');
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'operationResult',
      id: 'edit-stale',
      ok: true,
      result: 'applied',
    }));
    expect(vscodeMock.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('merged webview edits'));
  });

  it('does not run VS Code undo when pending webview flush fails', async () => {
    vscodeMock.applyEdit.mockResolvedValueOnce(false);
    vscodeMock.fsStat.mockResolvedValueOnce({});
    const provider = createProvider();
    const document = createMutableDocument('old\n', 1);
    const panel = createPanel();

    await (provider as unknown as {
      handleMessage: (
        document: typeof document,
        panel: typeof panel,
        message: { type: 'undo'; pendingText: string; editId: string; baseText: string; baseVersion: number },
      ) => Promise<void>;
    }).handleMessage(document, panel, {
      type: 'undo',
      pendingText: 'new\n',
      editId: 'edit-before-undo',
      baseText: 'old\n',
      baseVersion: 1,
    });

    expect(vscodeMock.applyEdit).toHaveBeenCalledTimes(1);
    expect(vscodeMock.executeCommand).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'operationResult',
      id: 'edit-before-undo',
      ok: false,
      result: 'failed',
    }));
  });

  it('acknowledges read-only pending edits and does not run VS Code commands', async () => {
    vscodeMock.fsStat.mockRejectedValueOnce(new Error('missing'));
    const provider = createProvider();
    const document = createMutableDocument('old\n', 1);
    const panel = createPanel();

    await (provider as unknown as {
      handleMessage: (
        document: typeof document,
        panel: typeof panel,
        message: { type: 'redo'; pendingText: string; editId: string; baseText: string; baseVersion: number },
      ) => Promise<void>;
    }).handleMessage(document, panel, {
      type: 'redo',
      pendingText: 'new\n',
      editId: 'edit-readonly',
      baseText: 'old\n',
      baseVersion: 1,
    });

    expect(vscodeMock.applyEdit).not.toHaveBeenCalled();
    expect(vscodeMock.executeCommand).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'operationResult',
      id: 'edit-readonly',
      ok: false,
      result: 'readonly',
    }));
  });

  it('rejects unknown webview messages before running host commands', async () => {
    const provider = createProvider();
    const document = createMutableDocument('old\n', 1);
    const panel = createPanel();

    await handleHostMessage(provider, document, panel, {
      type: 'unknownCommand',
      editId: 'edit-unknown',
      editChainId: 'chain-unknown',
    });

    expect(vscodeMock.applyEdit).not.toHaveBeenCalled();
    expect(vscodeMock.executeCommand).not.toHaveBeenCalled();
    expect(vscodeMock.clipboardWriteText).not.toHaveBeenCalled();
    expect(vscodeMock.fsWriteFile).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'operationResult',
      id: 'edit-unknown',
      editChainId: 'chain-unknown',
      ok: false,
      result: 'failed',
      message: expect.stringContaining('unsupported message.type "unknownCommand"'),
    }));
  });

  it('rejects malformed replaceDocument payloads before applying edits', async () => {
    const provider = createProvider();
    const document = createMutableDocument('old\n', 1);
    const panel = createPanel();

    await handleHostMessage(provider, document, panel, {
      type: 'replaceDocument',
      editId: 'edit-malformed-replace',
    });

    expect(vscodeMock.applyEdit).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'operationResult',
      id: 'edit-malformed-replace',
      ok: false,
      result: 'failed',
      message: expect.stringContaining('replaceDocument.text must be a string'),
    }));
  });

  for (const commandType of ['save', 'undo', 'redo'] as const) {
    it(`rejects malformed ${commandType} pending-edit payloads before mutating the host`, async () => {
      const provider = createProvider();
      const document = createMutableDocument('old\n', 1);
      const panel = createPanel();

      await handleHostMessage(provider, document, panel, {
        type: commandType,
        pendingText: 'new\n',
      });

      expect(vscodeMock.applyEdit).not.toHaveBeenCalled();
      expect(vscodeMock.executeCommand).not.toHaveBeenCalled();
      expect(document.save).not.toHaveBeenCalled();
      expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: 'operationResult',
        ok: false,
        result: 'failed',
        message: expect.stringContaining(`${commandType}.editId is required when pending edit fields are present`),
      }));
    });
  }

  it('rejects malformed clipboard and notification payloads before side effects', async () => {
    const provider = createProvider();
    const document = createMutableDocument('old\n', 1);
    const panel = createPanel();

    await handleHostMessage(provider, document, panel, {
      type: 'copyText',
      text: 42,
    });
    await handleHostMessage(provider, document, panel, {
      type: 'showMessage',
      severity: 'debug',
      message: 'Invisible host notification',
    });

    expect(vscodeMock.clipboardWriteText).not.toHaveBeenCalled();
    expect(vscodeMock.showInformationMessage).not.toHaveBeenCalled();
    expect(vscodeMock.showWarningMessage).not.toHaveBeenCalled();
    expect(vscodeMock.showErrorMessage).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'operationResult',
      ok: false,
      result: 'failed',
      message: expect.stringContaining('copyText.text must be a string'),
    }));
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'operationResult',
      ok: false,
      result: 'failed',
      message: expect.stringContaining('showMessage.severity must be "info", "warning", or "error"'),
    }));
  });
});

function createProvider(): ScieMDCustomEditorProvider {
  return new ScieMDCustomEditorProvider(
    { extensionUri: { toString: () => 'file:///extension' } } as never,
    { appendLine: vi.fn() } as never,
  );
}

function createMutableDocument(initialText: string, version: number, onSetText?: (text: string) => void) {
  let text = initialText;
  return {
    uri: { scheme: 'file', fsPath: 'C:\\docs\\paper.md', toString: () => 'file:///C:/docs/paper.md' },
    fileName: 'paper.md',
    version,
    isDirty: true,
    getText: () => text,
    positionAt: (offset: number) => offset,
    save: vi.fn(),
    setText: (nextText: string) => {
      text = nextText;
      onSetText?.(nextText);
    },
  };
}

function createPanel() {
  return {
    webview: {
      cspSource: 'vscode-resource:',
      options: {},
      html: '',
      asWebviewUri: (uri: { toString: () => string }) => ({ toString: () => `webview:${uri.toString()}` }),
      postMessage: vi.fn(async () => true),
      onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
    },
    onDidDispose: vi.fn(),
  };
}

async function handleHostMessage(
  provider: ScieMDCustomEditorProvider,
  document: unknown,
  panel: unknown,
  message: unknown,
): Promise<void> {
  await (provider as unknown as {
    handleMessage: (document: unknown, panel: unknown, message: unknown) => Promise<void>;
  }).handleMessage(document, panel, message);
}
