import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readVisualEditorState } from '../../components/visualEditorStateSync';
import { loadSettings } from '../../services/settingsService';
import type { PersistedSettings } from '../../services/settingsService';
import type { DocumentHost } from '../host/documentHost';
import type { ConfirmState } from './useDialogs';
import { useSaveOperations, suggestedMarkdownSavePath } from './useSaveOperations';
import type { VisualRoundTripWriteContext } from './useSaveOperations';
import { DEFAULT_METADATA } from '../documentState';
import type { AutosaveStatus, FileMetadata } from '../documentState';

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
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SaveOperations = ReturnType<typeof useSaveOperations>;

interface SaveSnapshot {
  filePath: string | null;
  fileMetadata: FileMetadata;
  markdown: string;
  lastSavedMarkdown: string;
  autosaveStatus: AutosaveStatus;
  lastAutosavedAt: number | null;
  externalConflict: boolean;
}

describe('suggestedMarkdownSavePath', () => {
  it('uses frontmatter title for untitled Save As suggestions', () => {
    expect(suggestedMarkdownSavePath('---\ntitle: RNA-seq Draft: Batch 2\n---\n# Ignored\n', null))
      .toBe('RNA-seq-Draft-Batch-2.md');
  });

  it('uses the first heading when no title exists', () => {
    expect(suggestedMarkdownSavePath('# Methods / Pilot Cohort?\n\nText', null))
      .toBe('Methods-Pilot-Cohort.md');
  });

  it('keeps the current path for existing documents', () => {
    expect(suggestedMarkdownSavePath('# New Title\n', 'C:/docs/old.md')).toBe('C:/docs/old.md');
  });
});

describe('useSaveOperations', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestOperations: SaveOperations | null;
  let latestSnapshot: SaveSnapshot | null;
  let host: MockDocumentHost;
  let identityVersion: number;
  let confirmText: ReturnType<typeof vi.fn<(state: ConfirmState) => Promise<boolean>>>;
  let confirmVisualRoundTripWrite: ReturnType<typeof vi.fn<(markdown: string, context: VisualRoundTripWriteContext) => Promise<boolean>>>;
  let pushToast: ReturnType<typeof vi.fn<(text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void>>;
  let commitMarkdownEdit: ReturnType<typeof vi.fn<(markdown: string) => void>>;
  const mockedReadVisualEditorState = vi.mocked(readVisualEditorState);

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latestOperations = null;
    latestSnapshot = null;
    host = createHost();
    identityVersion = 1;
    confirmText = vi.fn<(state: ConfirmState) => Promise<boolean>>().mockResolvedValue(true);
    confirmVisualRoundTripWrite = vi.fn<(markdown: string, context: VisualRoundTripWriteContext) => Promise<boolean>>().mockResolvedValue(true);
    pushToast = vi.fn<(text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void>();
    commitMarkdownEdit = vi.fn<(markdown: string) => void>();
    mockedReadVisualEditorState.mockReturnValue(null);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('writes the exact Markdown returned by a visual editor flush', async () => {
    const path = 'C:\\docs\\paper.md';
    const sourceMetadata = metadata({ lastKnownMtimeMs: 1000, lastKnownSizeBytes: 8, contentHash: 'old' });
    const nextMetadata = metadata({ lastKnownMtimeMs: 2000, lastKnownSizeBytes: 17, contentHash: 'flushed' });
    host.file.statFile.mockResolvedValue(sourceMetadata);
    host.file.writeTextFileAtomic.mockResolvedValue(nextMetadata);
    const markCommitted = vi.fn();
    mockedReadVisualEditorState.mockReturnValue({
      surface: 'visual',
      markdown: '# Visual flushed\n',
      changed: true,
      markCommitted,
    });
    renderHarness({ filePath: path, fileMetadata: sourceMetadata, markdown: '# Source stale\n' });

    let result: string | false | undefined;
    await act(async () => {
      result = await latestOperations?.saveCurrent();
    });
    await flushAsync();

    expect(result).toBe(path);
    expect(confirmVisualRoundTripWrite).toHaveBeenCalledWith('# Visual flushed\n', {
      autosave: false,
      forceSaveAs: false,
      forceOverwrite: false,
      reason: 'save',
    });
    expect(markCommitted).toHaveBeenCalledTimes(1);
    expect(commitMarkdownEdit).toHaveBeenCalledWith('# Visual flushed\n');
    expect(host.file.writeTextFileAtomic).toHaveBeenCalledWith(
      path,
      '# Visual flushed\n',
      sourceMetadata,
      sourceMetadata,
    );
    expect(latestSnapshot?.markdown).toBe('# Visual flushed\n');
    expect(latestSnapshot?.lastSavedMarkdown).toBe('# Visual flushed\n');
    expect(latestSnapshot?.fileMetadata).toBe(nextMetadata);
    expect(pushToast).toHaveBeenCalledWith('Saved', 'success');
  });

  it('blocks visual round-trip writes before committing visual editor state when acknowledgement is refused', async () => {
    const path = 'C:\\docs\\paper.md';
    confirmVisualRoundTripWrite.mockResolvedValue(false);
    mockedReadVisualEditorState.mockReturnValue({
      surface: 'visual',
      markdown: '# Should not commit\n',
      changed: true,
      markCommitted: vi.fn(),
    });
    renderHarness({ filePath: path, markdown: '# Risky\n' });

    let result: string | false | undefined;
    await act(async () => {
      result = await latestOperations?.saveCurrent();
    });
    await flushAsync();

    expect(result).toBe(false);
    expect(confirmVisualRoundTripWrite).toHaveBeenCalledWith('# Should not commit\n', {
      autosave: false,
      forceSaveAs: false,
      forceOverwrite: false,
      reason: 'save',
    });
    expect(commitMarkdownEdit).not.toHaveBeenCalled();
    expect(host.file.writeTextFileAtomic).not.toHaveBeenCalled();
  });

  it('returns false without writing when Save As is cancelled', async () => {
    host.dialog.pickSavePath.mockResolvedValue(null);
    renderHarness({ filePath: null, markdown: '# New note\n' });

    let result: string | false | undefined;
    await act(async () => {
      result = await latestOperations?.saveCurrent();
    });
    await flushAsync();

    expect(result).toBe(false);
    expect(host.dialog.pickSavePath).toHaveBeenCalledWith('New-note.md');
    expect(host.file.statFile).not.toHaveBeenCalled();
    expect(host.file.writeTextFileAtomic).not.toHaveBeenCalled();
    expect(latestSnapshot?.filePath).toBeNull();
  });

  it('serializes queued saves so the second write waits for the first write to finish', async () => {
    const path = 'C:\\docs\\queued.md';
    const sourceMetadata = metadata({ lastKnownMtimeMs: 1000, lastKnownSizeBytes: 8, contentHash: 'queued-old' });
    const firstWrite = deferred<FileMetadata>();
    const firstMetadata = metadata({ lastKnownMtimeMs: 2000, lastKnownSizeBytes: 9, contentHash: 'queued-first' });
    const secondMetadata = metadata({ lastKnownMtimeMs: 3000, lastKnownSizeBytes: 9, contentHash: 'queued-second' });
    host.file.statFile
      .mockResolvedValueOnce(sourceMetadata)
      .mockResolvedValueOnce(sourceMetadata)
      .mockResolvedValueOnce(sourceMetadata)
      .mockResolvedValue(firstMetadata);
    host.file.writeTextFileAtomic
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValueOnce(secondMetadata);
    renderHarness({ filePath: path, fileMetadata: sourceMetadata, markdown: '# Queued\n' });

    let firstSave!: Promise<string | false>;
    let secondSave!: Promise<string | false>;
    await act(async () => {
      firstSave = latestOperations!.saveCurrent();
      secondSave = latestOperations!.saveCurrent();
      await Promise.resolve();
    });
    await flushAsync();

    expect(host.file.writeTextFileAtomic).toHaveBeenCalledTimes(1);

    firstWrite.resolve(firstMetadata);
    await act(async () => {
      await firstSave;
    });
    await flushAsync();

    expect(host.file.writeTextFileAtomic).toHaveBeenCalledTimes(2);

    let secondResult: string | false | undefined;
    await act(async () => {
      secondResult = await secondSave;
    });
    await flushAsync();

    expect(secondResult).toBe(path);
    expect(host.file.writeTextFileAtomic).toHaveBeenNthCalledWith(
      2,
      path,
      '# Queued\n',
      firstMetadata,
      firstMetadata,
    );
    expect(latestSnapshot?.fileMetadata).toBe(secondMetadata);
    expect(latestOperations?.saveQueueDepth).toBe(0);
  });

  it('lets Save Anyway recreate a deleted backing file with a new expected baseline', async () => {
    const path = 'C:\\docs\\deleted.md';
    const sourceMetadata = metadata({ lastKnownMtimeMs: 1000, lastKnownSizeBytes: 9, contentHash: 'deleted-old', lineEnding: 'crlf' });
    const nextMetadata = metadata({ lastKnownMtimeMs: 2000, lastKnownSizeBytes: 9, contentHash: 'deleted-new', lineEnding: 'crlf' });
    host.file.statFile.mockRejectedValue(new Error('The system cannot find the file specified. (os error 2)'));
    host.file.writeTextFileAtomic.mockResolvedValue(nextMetadata);
    renderHarness({ filePath: path, fileMetadata: sourceMetadata, markdown: '# Deleted\n' });

    let result: string | false | undefined;
    await act(async () => {
      result = await latestOperations?.saveCurrent({ forceOverwrite: true });
    });
    await flushAsync();

    expect(result).toBe(path);
    expect(host.recovery.saveFileDraft).not.toHaveBeenCalled();
    expect(host.file.writeTextFileAtomic).toHaveBeenCalledWith(
      path,
      '# Deleted\n',
      sourceMetadata,
      null,
    );
    expect(latestSnapshot?.autosaveStatus).toBe('saved');
    expect(latestSnapshot?.externalConflict).toBe(false);
    expect(latestSnapshot?.fileMetadata).toBe(nextMetadata);
  });

  it('drops a stale Save As after document identity changes during path selection', async () => {
    const sourcePath = 'C:\\docs\\paper.md';
    const targetPath = 'C:\\docs\\renamed.md';
    const sourceMetadata = metadata({ lastKnownMtimeMs: 1000, lastKnownSizeBytes: 8, contentHash: 'source' });
    const pickedPath = deferred<string | null>();
    host.dialog.pickSavePath.mockReturnValue(pickedPath.promise);
    renderHarness({ filePath: sourcePath, fileMetadata: sourceMetadata, markdown: '# Original\n' });

    let saveResult!: Promise<string | false>;
    await act(async () => {
      saveResult = latestOperations!.saveCurrent({ forceSaveAs: true });
      await Promise.resolve();
    });
    await flushAsync();

    expect(host.dialog.pickSavePath).toHaveBeenCalledWith(sourcePath);

    identityVersion += 1;
    pickedPath.resolve(targetPath);
    let result: string | false | undefined;
    await act(async () => {
      result = await saveResult;
    });
    await flushAsync();

    expect(result).toBe(false);
    expect(host.file.statFile).not.toHaveBeenCalled();
    expect(host.file.writeTextFileAtomic).not.toHaveBeenCalled();
    expect(latestSnapshot?.filePath).toBe(sourcePath);
  });

  it('does not replace an existing Save As target when the user cancels replacement', async () => {
    const targetPath = 'C:\\docs\\existing.md';
    const existingMetadata = metadata({ lastKnownMtimeMs: 1500, lastKnownSizeBytes: 14, contentHash: 'existing' });
    host.dialog.pickSavePath.mockResolvedValue(targetPath);
    host.file.statFile.mockResolvedValue(existingMetadata);
    confirmText.mockResolvedValue(false);
    renderHarness({ filePath: null, markdown: '# Replacement\n' });

    let result: string | false | undefined;
    await act(async () => {
      result = await latestOperations?.saveCurrent();
    });
    await flushAsync();

    expect(result).toBe(false);
    expect(confirmText).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Replace existing Markdown file?',
      okLabel: 'Replace',
    }));
    expect(host.file.writeTextFileAtomic).not.toHaveBeenCalled();
    expect(latestSnapshot?.autosaveStatus).toBe('idle');
    expect(latestSnapshot?.filePath).toBeNull();
  });

  it('refuses to write cloud-placeholder files and preserves a file draft', async () => {
    const path = 'C:\\docs\\cloud.md';
    const sourceMetadata = metadata({ lastKnownMtimeMs: 1000, lastKnownSizeBytes: 8, contentHash: 'cloud-source' });
    const cloudMetadata = metadata({ cloudState: 'cloud-placeholder' });
    host.file.statFile.mockResolvedValueOnce(cloudMetadata);
    renderHarness({ filePath: path, fileMetadata: sourceMetadata, markdown: '# Cloud draft\n' });

    let result: string | false | undefined;
    await act(async () => {
      result = await latestOperations?.saveCurrent();
    });
    await flushAsync();

    expect(result).toBe(false);
    expect(host.recovery.saveFileDraft).toHaveBeenCalledWith(path, '# Cloud draft\n', expect.any(Number), sourceMetadata);
    expect(host.file.writeTextFileAtomic).not.toHaveBeenCalled();
    expect(latestSnapshot?.autosaveStatus).toBe('error');
    expect(pushToast).toHaveBeenCalledWith(
      'This file is cloud-only. Download or pin it locally before saving so ScieMD does not block on cloud rehydration.',
      'warning',
    );
  });

  it('records diagnostics when a save write fails', async () => {
    const path = 'C:\\docs\\paper.md';
    const sourceMetadata = metadata({ lastKnownMtimeMs: 1000, lastKnownSizeBytes: 9, contentHash: 'old' });
    host.file.statFile.mockResolvedValue(sourceMetadata);
    host.file.writeTextFileAtomic.mockRejectedValue(new Error('disk full'));
    renderHarness({ filePath: path, fileMetadata: sourceMetadata, markdown: '# Draft\n' });

    let result: string | false | undefined;
    await act(async () => {
      result = await latestOperations?.saveCurrent();
    });
    await flushAsync();

    expect(result).toBe(false);
    expect(latestSnapshot?.autosaveStatus).toBe('error');
    expect(host.recovery.appendDiagnosticsEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'save-failed',
      message: 'disk full',
      documentPath: path,
      markdownBytes: 8,
    }));
  });

  it('preserves a draft and marks conflict when disk metadata changed before save', async () => {
    const path = 'C:\\docs\\conflict.md';
    const sourceMetadata = metadata({ lastKnownMtimeMs: 1000, lastKnownSizeBytes: 8, contentHash: 'source' });
    const changedMetadata = metadata({ lastKnownMtimeMs: 2000, lastKnownSizeBytes: 12, contentHash: 'changed' });
    host.file.statFile
      .mockResolvedValueOnce(metadata({ lastKnownMtimeMs: 2000, lastKnownSizeBytes: 12 }))
      .mockResolvedValueOnce(changedMetadata);
    confirmText.mockResolvedValue(false);
    renderHarness({ filePath: path, fileMetadata: sourceMetadata, markdown: '# Local edit\n' });

    let result: string | false | undefined;
    await act(async () => {
      result = await latestOperations?.saveCurrent();
    });
    await flushAsync();

    expect(result).toBe(false);
    expect(host.recovery.saveFileDraft).toHaveBeenCalledWith(path, '# Local edit\n', expect.any(Number), sourceMetadata);
    expect(confirmText).toHaveBeenCalledWith(expect.objectContaining({
      title: 'External change detected',
      okLabel: 'Overwrite',
    }));
    expect(host.file.writeTextFileAtomic).not.toHaveBeenCalled();
    expect(latestSnapshot?.autosaveStatus).toBe('conflict');
    expect(latestSnapshot?.externalConflict).toBe(true);
  });

  function renderHarness(options: {
    filePath?: string | null;
    fileMetadata?: FileMetadata;
    markdown?: string;
  } = {}) {
    act(() => {
      root.render(createElement(SaveHarness, {
        host,
        initialFilePath: options.filePath ?? null,
        initialFileMetadata: options.fileMetadata ?? DEFAULT_METADATA,
        initialMarkdown: options.markdown ?? '# Draft\n',
        getDocumentIdentityVersion: () => identityVersion,
        confirmVisualRoundTripWrite,
        confirmText,
        pushToast,
        commitMarkdownEdit,
        onOperations: (operations: SaveOperations) => {
          latestOperations = operations;
        },
        onSnapshot: (snapshot: SaveSnapshot) => {
          latestSnapshot = snapshot;
        },
      }));
    });
  }
});

function SaveHarness({
  host,
  initialFilePath,
  initialFileMetadata,
  initialMarkdown,
  getDocumentIdentityVersion,
  confirmVisualRoundTripWrite,
  confirmText,
  pushToast,
  commitMarkdownEdit,
  onOperations,
  onSnapshot,
}: {
  host: DocumentHost;
  initialFilePath: string | null;
  initialFileMetadata: FileMetadata;
  initialMarkdown: string;
  getDocumentIdentityVersion: () => number;
  confirmVisualRoundTripWrite: (markdown: string, context: VisualRoundTripWriteContext) => Promise<boolean>;
  confirmText: (state: ConfirmState) => Promise<boolean>;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  commitMarkdownEdit: (markdown: string) => void;
  onOperations: (operations: SaveOperations) => void;
  onSnapshot: (snapshot: SaveSnapshot) => void;
}) {
  const [filePath, setFilePath] = useState<string | null>(initialFilePath);
  const [fileMetadata, setFileMetadata] = useState<FileMetadata>(initialFileMetadata);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [lastSavedMarkdown, setLastSavedMarkdown] = useState('');
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('idle');
  const [lastAutosavedAt, setLastAutosavedAt] = useState<number | null>(null);
  const [externalConflict, setExternalConflict] = useState(false);
  const [_settings, setSettings] = useState<PersistedSettings>(() => loadSettings());

  const operations = useSaveOperations({
    filePath,
    fileMetadata,
    markdown,
    getDocumentIdentityVersion,
    setFilePath,
    setFileMetadata,
    setLastSavedMarkdown,
    setAutosaveStatus,
    setLastAutosavedAt,
    setExternalConflict,
    setSettings,
    commitMarkdownEdit: (nextMarkdown) => {
      commitMarkdownEdit(nextMarkdown);
      setMarkdown(nextMarkdown);
    },
    confirmVisualRoundTripWrite,
    confirmText,
    pushToast,
    host,
  });

  onOperations(operations);
  onSnapshot({
    filePath,
    fileMetadata,
    markdown,
    lastSavedMarkdown,
    autosaveStatus,
    lastAutosavedAt,
    externalConflict,
  });
  return null;
}

interface MockDocumentHost extends DocumentHost {
  file: {
    readTextFile: DocumentHost['file']['readTextFile'];
    readTextFileForEdit: DocumentHost['file']['readTextFileForEdit'];
    statFile: ReturnType<typeof vi.fn<DocumentHost['file']['statFile']>>;
    writeTextFileAtomic: ReturnType<typeof vi.fn<DocumentHost['file']['writeTextFileAtomic']>>;
    createBackupSnapshot: ReturnType<typeof vi.fn<DocumentHost['file']['createBackupSnapshot']>>;
  };
  dialog: {
    pickMarkdownFile: DocumentHost['dialog']['pickMarkdownFile'];
    pickSavePath: ReturnType<typeof vi.fn<DocumentHost['dialog']['pickSavePath']>>;
  };
  recovery: DocumentHost['recovery'] & {
    saveFileDraft: ReturnType<typeof vi.fn<DocumentHost['recovery']['saveFileDraft']>>;
    clearFileDraft: ReturnType<typeof vi.fn<DocumentHost['recovery']['clearFileDraft']>>;
  };
}

function createHost(): MockDocumentHost {
  let settings = loadSettings();
  return {
    file: {
      readTextFile: vi.fn().mockResolvedValue({ content: '', metadata: DEFAULT_METADATA }),
      readTextFileForEdit: vi.fn().mockResolvedValue({ content: '', metadata: DEFAULT_METADATA }),
      statFile: vi.fn<DocumentHost['file']['statFile']>().mockResolvedValue(DEFAULT_METADATA),
      writeTextFileAtomic: vi.fn<DocumentHost['file']['writeTextFileAtomic']>().mockResolvedValue(DEFAULT_METADATA),
      createBackupSnapshot: vi.fn<DocumentHost['file']['createBackupSnapshot']>().mockResolvedValue(null),
    },
    dialog: {
      pickMarkdownFile: vi.fn().mockResolvedValue(null),
      pickSavePath: vi.fn<DocumentHost['dialog']['pickSavePath']>().mockResolvedValue(null),
    },
    launch: {
      getInitialMarkdownPath: vi.fn().mockResolvedValue(null),
      peekPendingMarkdownOpen: vi.fn().mockResolvedValue(null),
      clearPendingMarkdownOpen: vi.fn().mockResolvedValue(undefined),
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

function metadata(patch: Partial<FileMetadata> = {}): FileMetadata {
  return { ...DEFAULT_METADATA, ...patch };
}

async function flushAsync() {
  for (let index = 0; index < 8; index += 1) {
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
