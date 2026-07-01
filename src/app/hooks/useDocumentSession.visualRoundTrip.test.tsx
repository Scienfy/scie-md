import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_METADATA } from '../documentState';
import type { FileMetadata, ReadTextFileResponse } from '../documentState';
import type { DocumentHost } from '../host/documentHost';
import { loadSettings } from '../../services/settingsService';
import type { PersistedSettings } from '../../services/settingsService';
import type { AuthorshipMark } from '../../markdown/authorship';
import type { ConfirmState } from './useDialogs';
import { useDocumentSession } from './useDocumentSession';
import { readVisualEditorState } from '../../components/visualEditorStateSync';

vi.mock('../../components/visualEditorStateSync', () => ({
  readVisualEditorState: vi.fn(() => null),
  commitVisualEditorReadResult: vi.fn((result: { markdown: string; changed: boolean; markCommitted?: () => void } | null, onCommit: (markdown: string) => void) => {
    if (!result) return null;
    if (result.changed) {
      result.markCommitted?.();
      onCommit(result.markdown);
    }
    return result.markdown;
  }),
  commitVisualEditorState: vi.fn(() => null),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SessionState = ReturnType<typeof useDocumentSession>;

describe('useDocumentSession visual round-trip write acknowledgement', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestState: SessionState | null;
  let host: MockDocumentHost;
  let pushToast: ReturnType<typeof vi.fn<(text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void>>;
  let confirmText: ReturnType<typeof vi.fn<(state: ConfirmState) => Promise<boolean>>>;
  const mockedReadVisualEditorState = vi.mocked(readVisualEditorState);

  beforeEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latestState = null;
    host = createHost();
    pushToast = vi.fn<(text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void>();
    confirmText = vi.fn<(state: ConfirmState) => Promise<boolean>>().mockResolvedValue(true);
    mockedReadVisualEditorState.mockReturnValue(null);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('prompts once per risky visual Markdown shape during the session', async () => {
    renderSession();
    const riskyMarkdown = 'Methods\n---\n\n+ compact\n+ list\n';

    let first: boolean | undefined;
    await act(async () => {
      first = await latestState?.confirmVisualRoundTripWrite(riskyMarkdown, { reason: 'save' });
    });
    let second: boolean | undefined;
    await act(async () => {
      second = await latestState?.confirmVisualRoundTripWrite(riskyMarkdown, { reason: 'save' });
    });

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(confirmText).toHaveBeenCalledTimes(1);
    expect(confirmText).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Continue with visual formatting changes?',
      okLabel: 'Continue',
      cancelLabel: 'Cancel',
    }));
  });

  it('cancels an unacknowledged visual write before the caller commits it', async () => {
    confirmText.mockResolvedValue(false);
    renderSession();

    let allowed: boolean | undefined;
    await act(async () => {
      allowed = await latestState?.confirmVisualRoundTripWrite('Title\n---\n', { reason: 'save' });
    });

    expect(allowed).toBe(false);
    expect(pushToast).toHaveBeenCalledWith('Visual formatting write canceled.', 'info');
  });

  it('does not prompt for source-mode saves but does prompt before opening risky source in visual mode', async () => {
    renderSession();
    act(() => {
      latestState?.setMode('source');
    });
    await flushAsync();
    confirmText.mockClear();

    let sourceSaveAllowed: boolean | undefined;
    await act(async () => {
      sourceSaveAllowed = await latestState?.confirmVisualRoundTripWrite('Title\n---\n', { reason: 'save' });
    });
    let sourceToVisualAllowed: boolean | undefined;
    await act(async () => {
      sourceToVisualAllowed = await latestState?.confirmVisualRoundTripWrite('Title\n---\n', { reason: 'mode-switch-to-visual' });
    });

    expect(sourceSaveAllowed).toBe(true);
    expect(sourceToVisualAllowed).toBe(true);
    expect(confirmText).toHaveBeenCalledTimes(1);
  });

  it('flushes structured recovery drafts from source text without reading Markdown visual state', async () => {
    const path = 'C:\\docs\\results.json';
    renderSession();

    await act(async () => {
      await latestState?.handleOpen(path, { draftRestore: 'skip' });
    });
    await flushAsync();

    act(() => {
      latestState?.commitSourceTextEdit('{"ok":false}\n');
    });
    await flushAsync();
    mockedReadVisualEditorState.mockClear();

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await flushAsync();

    expect(mockedReadVisualEditorState).not.toHaveBeenCalled();
    expect(host.recovery.saveFileDraftAsync).toHaveBeenCalledWith(
      path,
      '{"ok":false}\n',
      expect.any(Number),
      expect.objectContaining({ lastKnownSizeBytes: '{"ok":true}\n'.length }),
      'json',
    );
  });

  function renderSession() {
    act(() => {
      root.render(
        <Harness
          host={host}
          confirmText={confirmText}
          pushToast={pushToast}
          onState={(state) => {
            latestState = state;
          }}
        />,
      );
    });
  }
});

interface MockDocumentHost extends DocumentHost {
  file: {
    readTextFile: ReturnType<typeof vi.fn<(path: string) => Promise<ReadTextFileResponse>>>;
    readTextFileForEdit: ReturnType<typeof vi.fn<(path: string) => Promise<ReadTextFileResponse>>>;
    statFile: ReturnType<typeof vi.fn<(path: string) => Promise<FileMetadata>>>;
    writeTextFileAtomic: DocumentHost['file']['writeTextFileAtomic'];
    createBackupSnapshot: DocumentHost['file']['createBackupSnapshot'];
  };
  recovery: DocumentHost['recovery'] & {
    saveFileDraftAsync: ReturnType<typeof vi.fn<DocumentHost['recovery']['saveFileDraftAsync']>>;
  };
}

function Harness({
  host,
  confirmText,
  pushToast,
  onState,
}: {
  host: DocumentHost;
  confirmText: (state: ConfirmState) => Promise<boolean>;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  onState: (state: SessionState) => void;
}) {
  const [settings, setSettings] = useState<PersistedSettings>(() => loadSettings());
  const [_authorshipMarks, setAuthorshipMarks] = useState<AuthorshipMark[]>([]);
  const state = useDocumentSession({
    initialMarkdown: '',
    setSettings,
    setAuthorshipMarks,
    confirmText,
    pushToast,
    host,
  });
  void settings;
  onState(state);
  return null;
}

function createHost(): MockDocumentHost {
  let settings = loadSettings();
  return {
    file: {
      readTextFile: vi.fn<(path: string) => Promise<ReadTextFileResponse>>().mockResolvedValue(readResponse('')),
      readTextFileForEdit: vi.fn<(path: string) => Promise<ReadTextFileResponse>>().mockImplementation(async (path) => (
        path.endsWith('.json') ? readResponse('{"ok":true}\n') : readResponse('')
      )),
      statFile: vi.fn<(path: string) => Promise<FileMetadata>>().mockResolvedValue(DEFAULT_METADATA),
      writeTextFileAtomic: vi.fn().mockResolvedValue(DEFAULT_METADATA),
      createBackupSnapshot: vi.fn().mockResolvedValue(null),
    },
    dialog: {
      pickMarkdownFile: vi.fn().mockResolvedValue(null),
      pickDocumentFile: vi.fn().mockResolvedValue(null),
      pickJsonSchemaFile: vi.fn().mockResolvedValue(null),
      pickSavePath: vi.fn().mockResolvedValue(null),
    },
    launch: {
      getInitialMarkdownPath: vi.fn().mockResolvedValue(null),
      getInitialDocumentPath: vi.fn().mockResolvedValue(null),
      peekPendingMarkdownOpen: vi.fn().mockResolvedValue(null),
      peekPendingDocumentOpen: vi.fn().mockResolvedValue(null),
      takePendingMarkdownOpen: vi.fn().mockResolvedValue(null),
      takePendingDocumentOpen: vi.fn().mockResolvedValue(null),
      clearPendingMarkdownOpen: vi.fn().mockResolvedValue(undefined),
      clearPendingDocumentOpen: vi.fn().mockResolvedValue(undefined),
      listenSingleInstanceOpen: vi.fn().mockResolvedValue(vi.fn()),
    },
    recovery: {
      loadUntitledDraft: vi.fn().mockResolvedValue(null),
      loadFileDraft: vi.fn().mockResolvedValue(null),
      saveUntitledDraft: vi.fn(),
      saveUntitledDraftAsync: vi.fn().mockResolvedValue(undefined),
      clearUntitledDraftAsync: vi.fn().mockResolvedValue(undefined),
      saveFileDraft: vi.fn(),
      saveFileDraftAsync: vi.fn().mockResolvedValue(undefined),
      clearFileDraft: vi.fn(),
      clearFileDraftAsync: vi.fn().mockResolvedValue(undefined),
      shouldPersistUntitledDraft: vi.fn().mockReturnValue(false),
      shouldOfferFileDraftRestore: vi.fn().mockReturnValue(false),
      isBundledWelcomeMarkdown: vi.fn().mockReturnValue(false),
      appendDiagnosticsEvent: vi.fn().mockResolvedValue(true),
    },
    settings: {
      rememberRecentFile: vi.fn((filePath: string) => {
        settings = {
          ...settings,
          recentFiles: [filePath, ...settings.recentFiles.filter((item) => item !== filePath)],
        };
        return settings;
      }),
      forgetRecentFile: vi.fn((filePath: string) => {
        settings = {
          ...settings,
          recentFiles: settings.recentFiles.filter((item) => item !== filePath),
        };
        return settings;
      }),
      updateSettings: vi.fn((patch: Partial<PersistedSettings>) => {
        settings = { ...settings, ...patch };
        return settings;
      }),
    },
    watcher: {
      listenFileWatchChanges: vi.fn().mockResolvedValue(vi.fn()),
      updateWatchedFiles: vi.fn().mockResolvedValue(true),
      clearWatchedFiles: vi.fn().mockResolvedValue(true),
    },
  };
}

function readResponse(content: string): ReadTextFileResponse {
  return {
    content,
    metadata: {
      ...DEFAULT_METADATA,
      lastKnownSizeBytes: content.length,
      contentHash: `hash:${content.length}`,
    },
  };
}

async function flushAsync() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 0);
      });
      await Promise.resolve();
    });
  }
}
