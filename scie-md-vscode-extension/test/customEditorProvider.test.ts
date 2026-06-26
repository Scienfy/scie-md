import { describe, expect, it, vi } from 'vitest';
import { ScieMDCustomEditorProvider, canSaveAfterPendingEdit } from '../src/extension/ScieMdCustomEditorProvider';

const vscodeMock = vi.hoisted(() => ({
  applyEdit: vi.fn(),
  executeCommand: vi.fn(),
  fsStat: vi.fn(),
  showErrorMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
}));

vi.mock('vscode', () => ({
  WorkspaceEdit: class {
    replace = vi.fn();
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
      writeText: vi.fn(),
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
      writeFile: vi.fn(),
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
  });
});
