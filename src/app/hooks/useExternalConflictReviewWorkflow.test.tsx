import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MutableRefObject } from 'react';
import { DEFAULT_METADATA } from '../documentState';
import type { FileMetadata, ReadTextFileResponse } from '../documentState';
import type { DocumentHost } from '../host/documentHost';
import type { DocumentFormat } from '@sciemd/core';
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
      kind: 'line-review',
      filePath,
      documentEpoch: 1,
      baseMarkdown: 'Base.\n',
      diskMarkdown: 'Base.\nDisk edit.\n',
      diskMetadata: disk.metadata,
    });
    expect(expectLineReview(controls?.externalConflictReview).hunks.length).toBeGreaterThan(0);
  });

  it('opens a structured source conflict for JSON without creating Markdown hunks', async () => {
    const filePath = 'C:\\docs\\results.json';
    const disk = readResponse('{"disk":true}\n', metadata({ contentHash: 'json-disk-1' }));
    host.file.readTextFile.mockResolvedValueOnce(disk);
    renderWorkflow(filePath, {
      format: 'json',
      sourceText: '{"local":true}\n',
      lastSavedSourceText: '{"base":true}\n',
    });

    await act(async () => {
      await controls?.openExternalConflictReview();
    });

    expect(host.file.readTextFile).toHaveBeenCalledWith(filePath);
    expect(controls?.externalConflictReview).toMatchObject({
      kind: 'structured-source',
      filePath,
      documentEpoch: 1,
      format: 'json',
      baseSource: '{"base":true}\n',
      currentSource: '{"local":true}\n',
      diskSource: '{"disk":true}\n',
      diskMetadata: disk.metadata,
    });
    expect(expectStructuredReview(controls?.externalConflictReview).jsonReview).toMatchObject({
      status: 'ready',
    });
    expect('hunks' in expectStructuredReview(controls?.externalConflictReview)).toBe(false);
  });

  it('applies selected JSON structural disk paths without conflict markers', async () => {
    const filePath = 'C:\\docs\\results.json';
    const disk = readResponse('{"name":"disk","count":2}\n', metadata({ contentHash: 'json-disk-1' }));
    host.file.readTextFile.mockResolvedValue(disk);
    renderWorkflow(filePath, {
      format: 'json',
      sourceText: '{"name":"local","count":1}\n',
      lastSavedSourceText: '{"name":"base","count":1}\n',
    });

    await act(async () => {
      await controls?.openExternalConflictReview();
    });
    const review = expectStructuredReview(controls?.externalConflictReview).jsonReview;
    if (!review) throw new Error('expected JSON structural review');
    const rejected = new Set(
      review.entries
        .filter((entry) => entry.displayPath === '$.name')
        .map((entry) => entry.id),
    );

    await act(async () => {
      await controls?.applyStructuredJsonConflictReview(rejected);
      await flushAsync();
    });

    expect(host.file.readTextFile).toHaveBeenCalledTimes(2);
    const [merged, diskSource, diskMetadata] = adoptReviewedDiskMerge.mock.calls[0];
    expect(JSON.parse(merged)).toEqual({ name: 'local', count: 2 });
    expect(merged).not.toContain('<<<<<<<');
    expect(diskSource).toBe(disk.content);
    expect(diskMetadata).toBe(disk.metadata);
    expect(controls?.externalConflictReview).toBeNull();
    expect(pushToast).toHaveBeenCalledWith('Applied selected disk JSON changes', 'success');
  });

  it('opens and applies selected JSONL structured disk lines', async () => {
    const filePath = 'C:\\docs\\records.jsonl';
    const disk = readResponse('{"id":1,"name":"disk","big":9007199254740995}\n', metadata({ contentHash: 'jsonl-disk-1' }));
    host.file.readTextFile.mockResolvedValue(disk);
    renderWorkflow(filePath, {
      format: 'jsonl',
      sourceText: '{"id":1,"name":"local","big":9007199254740993}\n',
      lastSavedSourceText: '{"id":1,"name":"base","big":9007199254740993}\n',
    });

    await act(async () => {
      await controls?.openExternalConflictReview();
    });

    const review = expectStructuredReview(controls?.externalConflictReview).structuredReview;
    expect(review).toMatchObject({ status: 'ready' });
    expect(review?.entries[0]).toMatchObject({
      entryKind: 'jsonl-line',
      displayTarget: 'Line 1',
      conflict: true,
    });

    await act(async () => {
      await controls?.applyStructuredConflictReview(new Set());
      await flushAsync();
    });

    expect(host.file.readTextFile).toHaveBeenCalledTimes(2);
    const [merged, diskSource, diskMetadata] = adoptReviewedDiskMerge.mock.calls[0];
    expect(merged).toBe(disk.content);
    expect(merged).toContain('9007199254740995');
    expect(diskSource).toBe(disk.content);
    expect(diskMetadata).toBe(disk.metadata);
    expect(controls?.externalConflictReview).toBeNull();
    expect(pushToast).toHaveBeenCalledWith('Accepted disk JSONL changes', 'success');
  });

  it('opens and applies selected CSV structured disk cells', async () => {
    const filePath = 'C:\\docs\\samples.csv';
    const disk = readResponse('sample_id,note,count\nS-001,"thin, film",10\n', metadata({ contentHash: 'csv-disk-1' }));
    host.file.readTextFile.mockResolvedValue(disk);
    renderWorkflow(filePath, {
      format: 'csv',
      sourceText: 'sample_id,note,count\nS-001,local,10\n',
      lastSavedSourceText: 'sample_id,note,count\nS-001,base,10\n',
    });

    await act(async () => {
      await controls?.openExternalConflictReview();
    });

    const review = expectStructuredReview(controls?.externalConflictReview).structuredReview;
    expect(review).toMatchObject({ status: 'ready' });
    expect(review?.entries[0]).toMatchObject({
      entryKind: 'tabular-cell',
      displayTarget: 'Row 1, note',
      diskPreview: '"thin, film"',
    });

    await act(async () => {
      await controls?.applyStructuredConflictReview(new Set());
      await flushAsync();
    });

    expect(adoptReviewedDiskMerge.mock.calls[0][0]).toBe(disk.content);
    expect(pushToast).toHaveBeenCalledWith('Accepted disk CSV changes', 'success');
  });

  it('opens and applies selected YAML structured disk paths', async () => {
    const filePath = 'C:\\docs\\study.yaml';
    const disk = readResponse('study:\n  title: disk\n  count: 2\n', metadata({ contentHash: 'yaml-disk-1' }));
    host.file.readTextFile.mockResolvedValue(disk);
    renderWorkflow(filePath, {
      format: 'yaml',
      sourceText: 'study:\n  title: local\n  count: 1\n',
      lastSavedSourceText: 'study:\n  title: base\n  count: 1\n',
    });

    await act(async () => {
      await controls?.openExternalConflictReview();
    });

    const review = expectStructuredReview(controls?.externalConflictReview).structuredReview;
    expect(review).toMatchObject({ status: 'ready' });
    expect(review?.entries.map((entry) => entry.displayTarget)).toEqual(['$.study.count', '$.study.title']);
    const rejected = new Set(
      review?.entries
        .filter((entry) => entry.displayTarget === '$.study.title')
        .map((entry) => entry.id),
    );

    await act(async () => {
      await controls?.applyStructuredConflictReview(rejected);
      await flushAsync();
    });

    const [merged, diskSource, diskMetadata] = adoptReviewedDiskMerge.mock.calls[0];
    expect(merged).toBe('study:\n  title: local\n  count: 2\n');
    expect(diskSource).toBe(disk.content);
    expect(diskMetadata).toBe(disk.metadata);
    expect(pushToast).toHaveBeenCalledWith('Applied selected disk YAML changes', 'success');
  });

  it('keeps unsafe YAML conflicts source-only with a fallback structured review', async () => {
    const filePath = 'C:\\docs\\study.yaml';
    host.file.readTextFile.mockResolvedValue(readResponse('items:\n  - disk\n  - added\n'));
    renderWorkflow(filePath, {
      format: 'yaml',
      sourceText: 'items:\n  - local\n',
      lastSavedSourceText: 'items:\n  - base\n',
    });

    await act(async () => {
      await controls?.openExternalConflictReview();
    });

    const review = expectStructuredReview(controls?.externalConflictReview).structuredReview;
    expect(review).toMatchObject({ status: 'fallback' });
    expect(review?.fallbackReason).toContain('existing scalar value changes only');

    await act(async () => {
      await controls?.applyStructuredConflictReview(new Set());
      await flushAsync();
    });

    expect(adoptReviewedDiskMerge).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      expect.stringContaining('existing scalar value changes only'),
      'warning',
    );
  });

  it('does not run marker-based merge application for JSON structured conflicts', async () => {
    host.file.readTextFile.mockResolvedValueOnce(readResponse('{"disk":true}\n'));
    renderWorkflow('C:\\docs\\results.json', {
      format: 'json',
      sourceText: '{"local":true}\n',
      lastSavedSourceText: '{"base":true}\n',
    });

    await act(async () => {
      await controls?.openExternalConflictReview();
    });
    await act(async () => {
      controls?.applyExternalConflictReview(new Set());
      await flushAsync();
    });

    expect(host.file.readTextFile).toHaveBeenCalledTimes(1);
    expect(adoptReviewedDiskMerge).not.toHaveBeenCalled();
    expect(expectStructuredReview(controls?.externalConflictReview).diskSource).toBe('{"disk":true}\n');
    expect(pushToast).toHaveBeenCalledWith(
      'Source conflict is open for this structured file. Choose Keep Current, Reload Disk, Save As, or Save Anyway.',
      'warning',
    );
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

  it('applies reviewed Markdown disk changes while preserving local edits', async () => {
    const filePath = 'C:\\docs\\a.md';
    const disk = readResponse('Base.\nDisk edit.\n', metadata({ contentHash: 'disk-1' }));
    host.file.readTextFile.mockResolvedValue(disk);
    renderWorkflow(filePath);

    await act(async () => {
      await controls?.openExternalConflictReview();
    });
    await act(async () => {
      controls?.applyExternalConflictReview(new Set());
      await flushAsync();
    });

    expect(host.file.readTextFile).toHaveBeenCalledTimes(2);
    expect(adoptReviewedDiskMerge).toHaveBeenCalledWith(
      'Local edit.\nDisk edit.\n',
      'Base.\nDisk edit.\n',
      disk.metadata,
    );
    expect(controls?.externalConflictReview).toBeNull();
    expect(pushToast).toHaveBeenCalledWith('Accepted disk changes', 'success');
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
      kind: 'line-review',
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

  function renderWorkflow(filePath: string | null, options: {
    format?: DocumentFormat;
    sourceText?: string;
    lastSavedSourceText?: string;
  } = {}) {
    act(() => {
      root.render(
        <Harness
          host={host}
          filePath={filePath}
          format={options.format ?? 'markdown'}
          sourceText={options.sourceText ?? 'Local edit.\n'}
          lastSavedSourceText={options.lastSavedSourceText ?? 'Base.\n'}
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
  format,
  sourceText,
  lastSavedSourceText,
  documentEpochRef,
  adoptReviewedDiskMerge,
  pushToast,
  onControls,
}: {
  host: DocumentHost;
  filePath: string | null;
  format: DocumentFormat;
  sourceText: string;
  lastSavedSourceText: string;
  documentEpochRef: MutableRefObject<number>;
  adoptReviewedDiskMerge: (content: string, diskContent: string, diskMetadata: typeof DEFAULT_METADATA) => void;
  pushToast: (text: string, tone?: 'error' | 'warning' | 'info' | 'success') => void;
  onControls: (controls: ReturnType<typeof useExternalConflictReviewWorkflow>) => void;
}) {
  const controls = useExternalConflictReviewWorkflow({
    filePath,
    documentEpochRef,
    format,
    sourceText,
    lastSavedSourceText,
    adoptReviewedDiskMerge,
    setAuthorshipMarks: (() => undefined) as never,
    pushToast,
    host,
  });
  onControls(controls);
  return null;
}

function expectLineReview(review: ReturnType<typeof useExternalConflictReviewWorkflow>['externalConflictReview'] | undefined) {
  expect(review?.kind).toBe('line-review');
  if (!review || review.kind !== 'line-review') throw new Error('expected line-review conflict state');
  return review;
}

function expectStructuredReview(review: ReturnType<typeof useExternalConflictReviewWorkflow>['externalConflictReview'] | undefined) {
  expect(review?.kind).toBe('structured-source');
  if (!review || review.kind !== 'structured-source') throw new Error('expected structured-source conflict state');
  return review;
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
