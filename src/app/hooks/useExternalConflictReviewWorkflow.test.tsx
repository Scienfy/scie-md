import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MutableRefObject } from 'react';
import { DEFAULT_METADATA } from '../documentState';
import type { FileMetadata, ReadTextFileResponse } from '../documentState';
import type { DocumentHost } from '../host/documentHost';
import { loadSettings } from '../../services/settingsService';
import type { PersistedSettings } from '../../services/settingsService';
import { useExternalConflictReviewWorkflow } from './useExternalConflictReviewWorkflow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useExternalConflictReviewWorkflow', () => {
  let container: HTMLDivElement;
  let root: Root;
  let controls: ReturnType<typeof useExternalConflictReviewWorkflow> | null;
  let host: MockDocumentHost;
  let documentEpochRef: MutableRefObject<number>;
  let adoptReviewedDiskMerge: ReturnType<typeof vi.fn>;
  let pushToast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    controls = null;
    host = createHost();
    documentEpochRef = { current: 1 };
    adoptReviewedDiskMerge = vi.fn((_content: string, _diskContent: string, _metadata: typeof DEFAULT_METADATA) => undefined);
    pushToast = vi.fn((_text: string, _tone?: 'error' | 'warning' | 'info' | 'success') => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('opens a disk review through the provided host file reader', async () => {
    const filePath = 'C:\\docs\\a.md';
    const disk = readResponse('Base.\nDisk edit.\n', metadata({ contentHash: 'disk-1' }));
    host.file.readTextFile.mockResolvedValueOnce(disk);
    renderWorkflow(filePath);

    await act(async () => {
      await controls?.openExternalConflictReview();
    });

    expect(host.file.readTextFile).toHaveBeenCalledWith(filePath);
    expect(controls?.externalConflictReview).toMatchObject({
      filePath,
      documentEpoch: 1,
      baseMarkdown: 'Base.\n',
      diskMarkdown: 'Base.\nDisk edit.\n',
      diskMetadata: disk.metadata,
    });
    expect(controls?.externalConflictReview?.hunks.length).toBeGreaterThan(0);
  });

  it('does not apply a disk review after the document epoch changes', async () => {
    host.file.readTextFile.mockResolvedValueOnce(readResponse('Disk edit.\n'));
    renderWorkflow('C:\\docs\\a.md');

    await act(async () => {
      await controls?.openExternalConflictReview();
    });
    documentEpochRef.current += 1;

    act(() => {
      controls?.applyExternalConflictReview(new Set());
    });

    expect(adoptReviewedDiskMerge).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      'Disk review was closed because the document changed before it was applied.',
      'warning',
    );
  });

  it('refreshes the review instead of applying when disk changed again', async () => {
    const filePath = 'C:\\docs\\a.md';
    host.file.readTextFile
      .mockResolvedValueOnce(readResponse('Base.\nFirst disk edit.\n', metadata({ contentHash: 'disk-1' })))
      .mockResolvedValueOnce(readResponse('Base.\nSecond disk edit.\n', metadata({ contentHash: 'disk-2', lastKnownMtimeMs: 2000 })));
    renderWorkflow(filePath);

    await act(async () => {
      await controls?.openExternalConflictReview();
    });
    await act(async () => {
      controls?.applyExternalConflictReview(new Set());
      await flushAsync();
    });

    expect(host.file.readTextFile).toHaveBeenCalledTimes(2);
    expect(adoptReviewedDiskMerge).not.toHaveBeenCalled();
    expect(controls?.externalConflictReview).toMatchObject({
      filePath,
      diskMarkdown: 'Base.\nSecond disk edit.\n',
    });
    expect(pushToast).toHaveBeenCalledWith(
      'Disk changed again while review was open. Review refreshed before applying.',
      'warning',
    );
  });

  it('reports open read failures without creating a review', async () => {
    host.file.readTextFile.mockRejectedValueOnce(new Error('disk unavailable'));
    renderWorkflow('C:\\docs\\a.md');

    await act(async () => {
      await controls?.openExternalConflictReview();
    });

    expect(controls?.externalConflictReview).toBeNull();
    expect(adoptReviewedDiskMerge).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith('disk unavailable', 'error');
  });

  it('reports refresh read failures without applying the review', async () => {
    host.file.readTextFile
      .mockResolvedValueOnce(readResponse('Base.\nDisk edit.\n'))
      .mockRejectedValueOnce(new Error('refresh failed'));
    renderWorkflow('C:\\docs\\a.md');

    await act(async () => {
      await controls?.openExternalConflictReview();
    });
    await act(async () => {
      controls?.applyExternalConflictReview(new Set());
      await flushAsync();
    });

    expect(adoptReviewedDiskMerge).not.toHaveBeenCalled();
    expect(controls?.externalConflictReview).not.toBeNull();
    expect(pushToast).toHaveBeenCalledWith('refresh failed', 'error');
  });

  function renderWorkflow(filePath: string | null) {
    act(() => {
      root.render(
        <Harness
          host={host}
          filePath={filePath}
          documentEpochRef={documentEpochRef}
          adoptReviewedDiskMerge={adoptReviewedDiskMerge as never}
          pushToast={pushToast as never}
          onControls={(nextControls) => {
            controls = nextControls;
          }}
        />,
      );
    });
  }
});

function Harness({
  host,
  filePath,
  documentEpochRef,
  adoptReviewedDiskMerge,
  pushToast,
  onControls,
}: {
  host: DocumentHost;
  filePath: string | null;
  documentEpochRef: MutableRefObject<number>;
  adoptReviewedDiskMerge: (content: string, diskContent: string, diskMetadata: typeof DEFAULT_METADATA) => void;
  pushToast: (text: string, tone?: 'error' | 'warning' | 'info' | 'success') => void;
  onControls: (controls: ReturnType<typeof useExternalConflictReviewWorkflow>) => void;
}) {
  const controls = useExternalConflictReviewWorkflow({
    filePath,
    documentEpochRef,
    markdown: 'Local edit.\n',
    lastSavedMarkdown: 'Base.\n',
    adoptReviewedDiskMerge,
    setAuthorshipMarks: (() => undefined) as never,
    pushToast,
    host,
  });
  onControls(controls);
  return null;
}

interface MockDocumentHost extends DocumentHost {
  file: {
    readTextFile: ReturnType<typeof vi.fn<(path: string) => Promise<ReadTextFileResponse>>>;
    readTextFileForEdit: DocumentHost['file']['readTextFileForEdit'];
    statFile: DocumentHost['file']['statFile'];
    writeTextFileAtomic: DocumentHost['file']['writeTextFileAtomic'];
    createBackupSnapshot: DocumentHost['file']['createBackupSnapshot'];
  };
}

function createHost(): MockDocumentHost {
  let settings = loadSettings();
  return {
    file: {
      readTextFile: vi.fn<(path: string) => Promise<ReadTextFileResponse>>().mockResolvedValue(readResponse('')),
      readTextFileForEdit: vi.fn().mockResolvedValue(readResponse('')),
      statFile: vi.fn().mockResolvedValue(DEFAULT_METADATA),
      writeTextFileAtomic: vi.fn().mockResolvedValue(DEFAULT_METADATA),
      createBackupSnapshot: vi.fn().mockResolvedValue(null),
    },
    dialog: {
      pickMarkdownFile: vi.fn().mockResolvedValue(null),
      pickSavePath: vi.fn().mockResolvedValue(null),
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

function readResponse(content: string, responseMetadata: FileMetadata = metadata()): ReadTextFileResponse {
  return {
    content,
    metadata: responseMetadata,
  };
}

function metadata(patch: Partial<FileMetadata> = {}): FileMetadata {
  return {
    ...DEFAULT_METADATA,
    lastKnownMtimeMs: 1000,
    lastKnownSizeBytes: 5,
    contentHash: 'base',
    ...patch,
  };
}

async function flushAsync() {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });
    await Promise.resolve();
  }
}
