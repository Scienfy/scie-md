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

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    close: vi.fn().mockResolvedValue(undefined),
    onCloseRequested: vi.fn().mockResolvedValue(vi.fn()),
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SessionState = ReturnType<typeof useDocumentSession>;

describe('useDocumentSession startup fallback', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestState: SessionState | null;
  let pushToast: ReturnType<typeof vi.fn<(text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void>>;
  let confirmText: ReturnType<typeof vi.fn<() => Promise<boolean>>>;

  beforeEach(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latestState = null;
    pushToast = vi.fn<(text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void>();
    confirmText = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    localStorage.clear();
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it('records no-path startup diagnostics and settles without a failure banner', async () => {
    const host = createHost();
    host.launch.getInitialDocumentPath.mockResolvedValue(null);
    renderSession(host);

    await flushAsync();

    expect(latestState?.startupDocumentOpenPending).toBe(false);
    expect(latestState?.startupDocumentOpenFailure).toBeNull();
    expect(host.recovery.appendDiagnosticsEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'startup-open-no-path',
      documentPath: null,
    }));
  });

  it('keeps a durable startup failure, records diagnostics, and clears it after retry opens the document', async () => {
    const startupPath = 'C:\\Users\\amin_\\missing.md';
    const host = createHost();
    host.launch.getInitialDocumentPath.mockResolvedValue(startupPath);
    host.file.readTextFileForEdit
      .mockRejectedValueOnce(new Error('File access denied'))
      .mockResolvedValueOnce(readResponse('# Recovered\n'));
    renderSession(host);

    await flushAsync();

    expect(latestState?.startupDocumentOpenPending).toBe(false);
    expect(latestState?.startupDocumentOpenFailure).toMatchObject({
      kind: 'open-failed',
      path: startupPath,
      canRetry: true,
    });
    expect(latestState?.startupDocumentOpenFailed).toBe(true);
    expect(latestState?.markdown).toBe('');
    expect(pushToast).toHaveBeenCalledWith('Use Open or Files to grant access to this document again.', 'error');
    expect(host.recovery.appendDiagnosticsEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'document-open-failed',
      documentPath: startupPath,
    }));
    expect(host.recovery.appendDiagnosticsEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'startup-open-failed',
      documentPath: startupPath,
    }));

    let retryResult: boolean | undefined;
    await act(async () => {
      retryResult = await latestState?.retryStartupDocumentOpen();
    });
    await flushAsync();

    expect(retryResult).toBe(true);
    expect(latestState?.startupDocumentOpenFailure).toBeNull();
    expect(latestState?.startupDocumentOpenFailed).toBe(false);
    expect(latestState?.filePath).toBe(startupPath);
    expect(latestState?.markdown).toBe('# Recovered\n');
    expect(host.launch.clearPendingDocumentOpen).toHaveBeenCalledWith(startupPath);
    expect(host.recovery.appendDiagnosticsEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'startup-open-retry-requested',
      documentPath: startupPath,
    }));
    expect(host.recovery.appendDiagnosticsEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'document-open-committed',
      documentPath: startupPath,
    }));
  });

  it('records fallback commits without clearing an active startup failure', async () => {
    const startupPath = 'C:\\Users\\amin_\\missing.md';
    const host = createHost();
    host.launch.getInitialDocumentPath.mockResolvedValue(startupPath);
    host.file.readTextFileForEdit.mockRejectedValueOnce(new Error('Not found'));
    renderSession(host);

    await flushAsync();
    expect(latestState?.startupDocumentOpenFailure?.path).toBe(startupPath);

    act(() => {
      latestState?.recordStartupFallbackCommitted('# Welcome\n');
    });

    expect(latestState?.startupDocumentOpenFailure?.path).toBe(startupPath);
    expect(host.recovery.appendDiagnosticsEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'startup-open-fallback-committed',
      documentPath: startupPath,
      sourceTextBytes: 10,
    }));
  });

  it('waits for desktop startup path resolution before offering an untitled draft', async () => {
    const startupPath = deferred<string | null>();
    const host = createHost();
    host.launch.getInitialDocumentPath.mockReturnValue(startupPath.promise);
    host.recovery.loadUntitledDraft.mockResolvedValue({
      markdown: '# Unsaved draft\n',
      savedAt: 1000,
      format: 'markdown',
    });
    confirmText.mockResolvedValue(true);
    renderSession(host);

    await flushAsync();

    expect(host.recovery.loadUntitledDraft).not.toHaveBeenCalled();
    expect(confirmText).not.toHaveBeenCalled();

    startupPath.resolve(null);
    await flushAsync();

    expect(host.launch.getInitialDocumentPath).toHaveBeenCalledTimes(1);
    expect(host.recovery.loadUntitledDraft).toHaveBeenCalledTimes(1);
    expect(confirmText).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Restore unsaved draft?',
      okLabel: 'Restore',
    }));
    expect(latestState?.filePath).toBeNull();
    expect(latestState?.markdown).toBe('# Unsaved draft\n');
    expect(pushToast).toHaveBeenCalledWith('Restored unsaved draft.', 'warning');
  });

  it('keeps a successful startup document active instead of restoring an untitled draft over it', async () => {
    const startupPath = 'C:\\Users\\amin_\\startup.md';
    const host = createHost();
    host.launch.getInitialDocumentPath.mockResolvedValue(startupPath);
    host.file.readTextFileForEdit.mockResolvedValue(readResponse('# Startup document\n'));
    host.recovery.loadUntitledDraft.mockResolvedValue({
      markdown: '# Unsaved draft\n',
      savedAt: 1000,
      format: 'markdown',
    });
    confirmText.mockResolvedValue(true);
    renderSession(host);

    await flushAsync();

    expect(host.file.readTextFileForEdit).toHaveBeenCalledWith(startupPath);
    expect(host.recovery.loadUntitledDraft).not.toHaveBeenCalled();
    expect(confirmText).not.toHaveBeenCalled();
    expect(latestState?.filePath).toBe(startupPath);
    expect(latestState?.markdown).toBe('# Startup document\n');
  });

  it('opens structured startup documents from the native document launch path', async () => {
    const startupPath = 'C:\\Users\\amin_\\startup.json';
    const host = createHost();
    host.launch.getInitialDocumentPath.mockResolvedValue(startupPath);
    host.file.readTextFileForEdit.mockResolvedValue(readResponse('{"ok":true}\n'));
    renderSession(host);

    await flushAsync();

    expect(host.file.readTextFileForEdit).toHaveBeenCalledWith(startupPath);
    expect(host.recovery.loadUntitledDraft).not.toHaveBeenCalled();
    expect(latestState?.filePath).toBe(startupPath);
    expect(latestState?.format).toBe('json');
    expect(latestState?.mode).toBe('visual');
    expect(latestState?.markdown).toBe('{"ok":true}\n');
  });

  it('drains pending launch paths only after the startup handshake has settled', async () => {
    const startupPath = deferred<string | null>();
    const pendingPath = 'C:\\Users\\amin_\\pending.md';
    const host = createHost();
    host.launch.getInitialDocumentPath.mockReturnValue(startupPath.promise);
    host.launch.peekPendingDocumentOpen
      .mockResolvedValueOnce(pendingPath)
      .mockResolvedValue(null);
    host.file.readTextFileForEdit.mockResolvedValue(readResponse('# Pending launch\n'));
    renderSession(host);

    await flushAsync();

    expect(host.launch.listenSingleInstanceOpen).toHaveBeenCalled();
    expect(host.launch.peekPendingDocumentOpen).not.toHaveBeenCalled();
    expect(host.file.readTextFileForEdit).not.toHaveBeenCalled();

    startupPath.resolve(null);
    await flushAsync();

    expect(host.launch.peekPendingDocumentOpen).toHaveBeenCalled();
    expect(host.file.readTextFileForEdit).toHaveBeenCalledWith(pendingPath);
    expect(host.launch.clearPendingDocumentOpen).toHaveBeenCalledWith(pendingPath);
    expect(latestState?.filePath).toBe(pendingPath);
    expect(latestState?.markdown).toBe('# Pending launch\n');
  });

  it('opens JSON documents in preferred visual mode with JSON format state', async () => {
    const host = createHost();
    host.launch.getInitialDocumentPath.mockResolvedValue(null);
    host.file.readTextFileForEdit.mockResolvedValue(readResponse('{"ok":true}\n'));
    renderSession(host);
    await flushAsync();

    let opened: boolean | undefined;
    await act(async () => {
      opened = await latestState?.handleOpen('C:\\Users\\amin_\\results.json', {
        preferredMode: 'visual',
        draftRestore: 'skip',
      });
    });
    await flushAsync();

    expect(opened).toBe(true);
    expect(latestState?.filePath).toBe('C:\\Users\\amin_\\results.json');
    expect(latestState?.format).toBe('json');
    expect(latestState?.mode).toBe('visual');
    expect(latestState?.markdown).toBe('{"ok":true}\n');
  });

  it.each([
    ['jsonl', 'C:\\Users\\amin_\\records.jsonl', '{"id":1}\n'] as const,
    ['yaml', 'C:\\Users\\amin_\\config.yaml', 'ok: true\n'] as const,
    ['toml', 'C:\\Users\\amin_\\settings.toml', 'ok = true\n'] as const,
    ['xml', 'C:\\Users\\amin_\\metadata.xml', '<root/>\n'] as const,
    ['csv', 'C:\\Users\\amin_\\samples.csv', 'name,value\nalpha,1\n'] as const,
    ['tsv', 'C:\\Users\\amin_\\samples.tsv', 'name\tvalue\nalpha\t1\n'] as const,
  ])('opens %s documents manually with format-aware visual state', async (format, path, content) => {
    const host = createHost();
    host.launch.getInitialDocumentPath.mockResolvedValue(null);
    host.file.readTextFileForEdit.mockResolvedValue(readResponse(content));
    renderSession(host);
    await flushAsync();

    let opened: boolean | undefined;
    await act(async () => {
      opened = await latestState?.handleOpen(path, { draftRestore: 'skip' });
    });
    await flushAsync();

    expect(opened).toBe(true);
    expect(latestState?.filePath).toBe(path);
    expect(latestState?.format).toBe(format);
    expect(latestState?.mode).toBe('visual');
    expect(latestState?.markdown).toBe(content);
    expect(host.settings.rememberRecentFile).toHaveBeenCalledWith(path);
  });

  it('creates structured starter documents with matching format state', async () => {
    const host = createHost();
    host.launch.getInitialDocumentPath.mockResolvedValue(null);
    renderSession(host);
    await flushAsync();

    await act(async () => {
      await latestState?.handleNewFromTemplate('json');
    });
    await flushAsync();

    expect(latestState?.filePath).toBeNull();
    expect(latestState?.format).toBe('json');
    expect(latestState?.mode).toBe('visual');
    expect(latestState?.markdown).toContain('"document"');
    expect(latestState?.markdown).toContain('"classes"');
    expect(pushToast).toHaveBeenCalledWith('JSON created', 'success');
  });

  it('creates a Markdown starter for the direct new-document command', async () => {
    const host = createHost();
    host.launch.getInitialDocumentPath.mockResolvedValue(null);
    renderSession(host);
    await flushAsync();

    await act(async () => {
      await latestState?.handleNew();
    });
    await flushAsync();

    expect(latestState?.filePath).toBeNull();
    expect(latestState?.format).toBe('markdown');
    expect(latestState?.mode).toBe('visual');
    expect(latestState?.markdown).toBe('# Header\n\nMain text\n');
  });

  function renderSession(host: MockDocumentHost) {
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
  launch: {
    getInitialMarkdownPath: ReturnType<typeof vi.fn<() => Promise<string | null>>>;
    getInitialDocumentPath: ReturnType<typeof vi.fn<() => Promise<string | null>>>;
    peekPendingMarkdownOpen: ReturnType<typeof vi.fn<() => Promise<string | null>>>;
    peekPendingDocumentOpen: ReturnType<typeof vi.fn<() => Promise<string | null>>>;
    takePendingMarkdownOpen: ReturnType<typeof vi.fn<() => Promise<string | null>>>;
    takePendingDocumentOpen: ReturnType<typeof vi.fn<() => Promise<string | null>>>;
    clearPendingMarkdownOpen: ReturnType<typeof vi.fn<(path: string) => Promise<void>>>;
    clearPendingDocumentOpen: ReturnType<typeof vi.fn<(path: string) => Promise<void>>>;
    listenSingleInstanceOpen: ReturnType<typeof vi.fn<DocumentHost['launch']['listenSingleInstanceOpen']>>;
  };
  recovery: DocumentHost['recovery'] & {
    loadUntitledDraft: ReturnType<typeof vi.fn<DocumentHost['recovery']['loadUntitledDraft']>>;
    appendDiagnosticsEvent: ReturnType<typeof vi.fn<DocumentHost['recovery']['appendDiagnosticsEvent']>>;
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
      readTextFileForEdit: vi.fn<(path: string) => Promise<ReadTextFileResponse>>().mockResolvedValue(readResponse('')),
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
      getInitialMarkdownPath: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
      getInitialDocumentPath: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
      peekPendingMarkdownOpen: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
      peekPendingDocumentOpen: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
      takePendingMarkdownOpen: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
      takePendingDocumentOpen: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
      clearPendingMarkdownOpen: vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined),
      clearPendingDocumentOpen: vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined),
      listenSingleInstanceOpen: vi.fn<DocumentHost['launch']['listenSingleInstanceOpen']>().mockResolvedValue(vi.fn()),
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
  for (let index = 0; index < 10; index += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 0);
      });
      await Promise.resolve();
    });
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
