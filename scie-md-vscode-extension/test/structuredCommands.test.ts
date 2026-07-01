import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatParseBudgetBytes } from '@sciemd/core/formats/formatPolicy';
import { applyStructuredClipboardToJsonDocument } from '../src/extension/structuredCommands';

const vscodeMock = vi.hoisted(() => ({
  activeTextEditor: undefined as undefined | { document: ReturnType<typeof createDocument> },
  configurationEnabled: false,
  clipboardReadText: vi.fn(),
  applyEdit: vi.fn(),
  openTextDocument: vi.fn(),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  workspaceEdits: [] as Array<{ uri: unknown; range: unknown; text: string }>,
}));

vi.mock('vscode', () => {
  class WorkspaceEdit {
    replace(uri: unknown, range: unknown, text: string) {
      vscodeMock.workspaceEdits.push({ uri, range, text });
    }
  }

  class Range {
    constructor(public readonly start: unknown, public readonly end: unknown) {}
  }

  return {
    Range,
    WorkspaceEdit,
    env: {
      clipboard: {
        readText: vscodeMock.clipboardReadText,
      },
    },
    window: {
      get activeTextEditor() {
        return vscodeMock.activeTextEditor;
      },
      showInformationMessage: vscodeMock.showInformationMessage,
      showWarningMessage: vscodeMock.showWarningMessage,
    },
    workspace: {
      applyEdit: vscodeMock.applyEdit,
      openTextDocument: vscodeMock.openTextDocument,
      getConfiguration: vi.fn(() => ({
        get: vi.fn((_key: string, fallback: boolean) => vscodeMock.configurationEnabled ?? fallback),
      })),
    },
  };
});

describe('structured VS Code commands', () => {
  beforeEach(() => {
    vscodeMock.activeTextEditor = undefined;
    vscodeMock.configurationEnabled = false;
    vscodeMock.clipboardReadText.mockReset();
    vscodeMock.applyEdit.mockReset();
    vscodeMock.applyEdit.mockResolvedValue(true);
    vscodeMock.openTextDocument.mockReset();
    vscodeMock.showInformationMessage.mockReset();
    vscodeMock.showWarningMessage.mockReset();
    vscodeMock.workspaceEdits.length = 0;
  });

  it('requires the default-off JSON actions setting before applying clipboard text', async () => {
    vscodeMock.activeTextEditor = { document: createDocument('C:\\docs\\data.json', '{"id":1}\n') };

    await applyStructuredClipboardToJsonDocument({ appendLine: vi.fn() } as never);

    expect(vscodeMock.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('enableJsonActions'));
    expect(vscodeMock.clipboardReadText).not.toHaveBeenCalled();
    expect(vscodeMock.applyEdit).not.toHaveBeenCalled();
  });

  it('applies validated JSON clipboard text with a workspace edit when the source hash still matches', async () => {
    vscodeMock.configurationEnabled = true;
    vscodeMock.activeTextEditor = { document: createDocument('C:\\docs\\data.json', '{"id":1}\n') };
    vscodeMock.clipboardReadText.mockResolvedValue('{"id":2}\n');
    const output = { appendLine: vi.fn() };

    await applyStructuredClipboardToJsonDocument(output as never);

    expect(vscodeMock.workspaceEdits).toHaveLength(1);
    expect(vscodeMock.workspaceEdits[0].text).toBe('{"id":2}\n');
    expect(vscodeMock.applyEdit).toHaveBeenCalledTimes(1);
    expect(output.appendLine).toHaveBeenCalledWith(expect.stringContaining('Replace JSON document from clipboard'));
    expect(vscodeMock.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('Applied reviewed JSON clipboard text'));
  });

  it('keeps YAML and TOML preview-only even when JSON actions are enabled', async () => {
    vscodeMock.configurationEnabled = true;
    vscodeMock.activeTextEditor = { document: createDocument('C:\\docs\\data.yaml', 'name: Alpha\n') };

    await applyStructuredClipboardToJsonDocument({ appendLine: vi.fn() } as never);

    expect(vscodeMock.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('YAML is preview-only'));
    expect(vscodeMock.applyEdit).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON clipboard text before creating a workspace edit', async () => {
    vscodeMock.configurationEnabled = true;
    vscodeMock.activeTextEditor = { document: createDocument('C:\\docs\\data.json', '{"id":1}\n') };
    vscodeMock.clipboardReadText.mockResolvedValue('{"id":\n');

    await applyStructuredClipboardToJsonDocument({ appendLine: vi.fn() } as never);

    expect(vscodeMock.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('Clipboard JSON is invalid'));
    expect(vscodeMock.applyEdit).not.toHaveBeenCalled();
  });

  it('rejects oversized JSON clipboard text before parser validation', async () => {
    vscodeMock.configurationEnabled = true;
    vscodeMock.activeTextEditor = { document: createDocument('C:\\docs\\data.json', '{"id":1}\n') };
    vscodeMock.clipboardReadText.mockResolvedValue(`{"payload":"${'x'.repeat((formatParseBudgetBytes('json') ?? 0) + 1)}"}`);

    await applyStructuredClipboardToJsonDocument({ appendLine: vi.fn() } as never);

    expect(vscodeMock.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('parse budget'));
    expect(vscodeMock.applyEdit).not.toHaveBeenCalled();
  });

  it('rejects stale JSONL source before creating a workspace edit', async () => {
    vscodeMock.configurationEnabled = true;
    const document = createDocument('C:\\docs\\records.jsonl', '{"id":1}\n');
    document.getText.mockReturnValueOnce('{"id":1}\n').mockReturnValueOnce('{"id":99}\n');
    vscodeMock.activeTextEditor = { document };
    vscodeMock.clipboardReadText.mockResolvedValue('{"id":2}\n');

    await applyStructuredClipboardToJsonDocument({ appendLine: vi.fn() } as never);

    expect(vscodeMock.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('source changed'));
    expect(vscodeMock.applyEdit).not.toHaveBeenCalled();
  });
});

function createDocument(fileName: string, text: string) {
  const uri = {
    scheme: 'file',
    fsPath: fileName,
    path: `/${fileName.replace(/\\/g, '/')}`,
    toString: () => `file:///${fileName.replace(/\\/g, '/')}`,
  };
  return {
    uri,
    fileName,
    getText: vi.fn(() => text),
    positionAt: (offset: number) => ({ line: 0, character: offset }),
  };
}
