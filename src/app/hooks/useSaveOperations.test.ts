import { act, createElement, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readVisualEditorState } from '../../components/visualEditorStateSync';
import { loadSettings } from '../../services/settingsService';
import type { PersistedSettings } from '../../services/settingsService';
import type { DocumentHost } from '../host/documentHost';
import type { ConfirmState } from './useDialogs';
import { useSaveOperations, suggestedDocumentSavePath, suggestedMarkdownSavePath } from './useSaveOperations';
import type { VisualRoundTripWriteContext } from './useSaveOperations';
import { DEFAULT_METADATA } from '../documentState';
import type { AutosaveStatus, FileMetadata } from '../documentState';
import type { DocumentFormat } from '@sciemd/core';
import type { StructuredSavePolicy } from '../structuredSavePolicy';

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
  format: DocumentFormat;
  sourceText: string;
  lastSavedSourceText: string;
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

describe('suggestedDocumentSavePath', () => {
  it('uses non-Markdown extensions for untitled structured and text documents', () => {
    expect(suggestedDocumentSavePath('{"ok":true}\n', null, 'json')).toBe('Untitled.json');
    expect(suggestedDocumentSavePath('{"ok":true}\n', null, 'jsonl')).toBe('Untitled.jsonl');
    expect(suggestedDocumentSavePath('ok: true\n', null, 'yaml')).toBe('Untitled.yaml');
    expect(suggestedDocumentSavePath('ok = true\n', null, 'toml')).toBe('Untitled.toml');
    expect(suggestedDocumentSavePath('<root/>\n', null, 'xml')).toBe('Untitled.xml');
    expect(suggestedDocumentSavePath('plain\n', null, 'plainText')).toBe('Untitled.txt');
    expect(suggestedDocumentSavePath('{"ok":true}\n', 'C:/docs/results.json', 'json')).toBe('C:/docs/results.json');
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
    expect(host.dialog.pickSavePath).toHaveBeenCalledWith('New-note.md', 'markdown');
    expect(host.file.statFile).not.toHaveBeenCalled();
    expect(host.file.writeTextFileAtomic).not.toHaveBeenCalled();
    expect(latestSnapshot?.filePath).toBeNull();
  });

  it('suggests a JSON path for untitled JSON Save As without using stale visual Markdown', async () => {
    host.dialog.pickSavePath.mockResolvedValue(null);
    mockedReadVisualEditorState.mockReturnValue({
      surface: 'visual',
      markdown: '# Stale visual Markdown\n',
      changed: true,
      markCommitted: vi.fn(),
    });
    renderHarness({ filePath: null, format: 'json', markdown: '{"ok":true}\n' });

    let result: string | false | undefined;
    await act(async () => {
      result = await latestOperations?.saveCurrent({ forceSaveAs: true });
    });
    await flushAsync();

    expect(result).toBe(false);
    expect(host.dialog.pickSavePath).toHaveBeenCalledWith('Untitled.json', 'json');
    expect(mockedReadVisualEditorState).not.toHaveBeenCalled();
    expect(commitMarkdownEdit).not.toHaveBeenCalled();
    expect(confirmVisualRoundTripWrite).not.toHaveBeenCalled();
    expect(latestSnapshot?.sourceText).toBe('{"ok":true}\n');
    expect(latestSnapshot?.markdown).toBe('{"ok":true}\n');
  });

  it.each([
    ['jsonl', 'Untitled.jsonl', '{"id":1}\n'] as const,
    ['yaml', 'Untitled.yaml', 'ok: true\n'] as const,
    ['toml', 'Untitled.toml', 'ok = true\n'] as const,
    ['xml', 'Untitled.xml', '<root/>\n'] as const,
  ])('passes %s Save As format to the native dialog', async (format, expectedPath, markdown) => {
    host.dialog.pickSavePath.mockResolvedValue(null);
    renderHarness({ filePath: null, format, markdown });

    let result: string | false | undefined;
    await act(async () => {
      result = await latestOperations?.saveCurrent({ forceSaveAs: true });
    });
    await flushAsync();

    expect(result).toBe(false);
    expect(host.dialog.pickSavePath).toHaveBeenCalledWith(expectedPath, format);
    expect(host.file.writeTextFileAtomic).not.toHaveBeenCalled();
  });

  it('writes existing JSON source exactly without visual state or JSON stringify round-trips', async () => {
    const path = 'C:\\docs\\results.json';
    const jsonSource = '{\n  "z": 0,\n  "a": [\n    1,\n    2\n  ],\n  "unicode": "\\u03bc"\n}\n';
    const sourceMetadata = metadata({ lastKnownMtimeMs: 1000, lastKnownSizeBytes: jsonSource.length, contentHash: 'json-old' });
    const nextMetadata = metadata({ lastKnownMtimeMs: 2000, lastKnownSizeBytes: jsonSource.length, contentHash: 'json-new' });
    host.file.statFile.mockResolvedValue(sourceMetadata);
    host.file.writeTextFileAtomic.mockResolvedValue(nextMetadata);
    mockedReadVisualEditorState.mockReturnValue({
      surface: 'visual',
      markdown: '{"stale":true}',
      changed: true,
      markCommitted: vi.fn(),
    });
    renderHarness({ filePath: path, fileMetadata: sourceMetadata, format: 'json', markdown: jsonSource });

    let result: string | false | undefined;
    await act(async () => {
      result = await latestOperations?.saveCurrent();
    });
    await flushAsync();

    expect(result).toBe(path);
    expect(mockedReadVisualEditorState).not.toHaveBeenCalled();
    expect(commitMarkdownEdit).not.toHaveBeenCalled();
    expect(confirmVisualRoundTripWrite).not.toHaveBeenCalled();
    expect(host.file.writeTextFileAtomic).toHaveBeenCalledWith(
      path,
      jsonSource,
      sourceMetadata,
      sourceMetadata,
    );
    expect(latestSnapshot?.lastSavedSourceText).toBe(jsonSource);
    expect(latestSnapshot?.lastSavedMarkdown).toBe(jsonSource);
    expect(latestSnapshot?.format).toBe('json');
  });

  it.each([
    ['json', 'C:\\docs\\results.json', '{\n  "ok": true\n}\n'] as const,
    ['jsonl', 'C:\\docs\\records.jsonl', '{"id":1}\n{"id":2}\n'] as const,
    ['csv', 'C:\\docs\\samples.csv', 'sample,value\nS-001,3.14\n'] as const,
    ['tsv', 'C:\\docs\\samples.tsv', 'sample\tvalue\nS-001\t3.14\n'] as const,
    ['yaml', 'C:\\docs\\config.yaml', 'ok: true\nitems:\n  - alpha\n'] as const,
    ['toml', 'C:\\docs\\config.toml', 'ok = true\nitems = ["alpha"]\n'] as const,
    ['xml', 'C:\\docs\\metadata.xml', '<root><item id="alpha"/></root>\n'] as const,
  ])('saves %s source text without invoking Markdown visual flush logic', async (format, path, sourceText) => {
    const sourceMetadata = metadata({ lastKnownMtimeMs: 1000, lastKnownSizeBytes: sourceText.length, contentHash: `${format}-old` });
    const nextMetadata = metadata({ lastKnownMtimeMs: 2000, lastKnownSizeBytes: sourceText.length, contentHash: `${format}-new` });
    host.file.statFile.mockResolvedValue(sourceMetadata);
    host.file.writeTextFileAtomic.mockResolvedValue(nextMetadata);
    mockedReadVisualEditorState.mockReturnValue({
      surface: 'visual',
      markdown: '# Stale visual Markdown\n',
      changed: true,
      markCommitted: vi.fn(),
    });
    renderHarness({ filePath: path, fileMetadata: sourceMetadata, format, markdown: sourceText });

    let result: string | false | undefined;
    await act(async () => {
      result = await latestOperations?.saveCurrent();
    });
    await flushAsync();

    expect(result).toBe(path);
    expect(mockedReadVisualEditorState).not.toHaveBeenCalled();
    expect(commitMarkdownEdit).not.toHaveBeenCalled();
    expect(confirmVisualRoundTripWrite).not.toHaveBeenCalled();
    expect(host.file.writeTextFileAtomic).toHaveBeenCalledWith(
      path,
      sourceText,
      sourceMetadata,
      sourceMetadata,
    );
    expect(latestSnapshot?.sourceText).toBe(sourceText);
    expect(latestSnapshot?.lastSavedSourceText).toBe(sourceText);
    expect(latestSnapshot?.format).toBe(format);
  });

  it('uses flushed visual Markdown when suggesting an untitled Save As path', async () => {
    const markCommitted = vi.fn();
    host.dialog.pickSavePath.mockResolvedValue(null);
    mockedReadVisualEditorState.mockReturnValue({
      surface: 'visual',
      markdown: '---\ntitle: Visual Draft\n---\n# Source title is stale\n',
      changed: true,
      markCommitted,
    });
    renderHarness({ filePath: null, markdown: '# Stale source title\n' });

    let result: string | false | undefined;
    await act(async () => {
      result = await latestOperations?.saveCurrent({ forceSaveAs: true });
    });
    await flushAsync();

    expect(result).toBe(false);
    expect(confirmVisualRoundTripWrite).toHaveBeenCalledWith('---\ntitle: Visual Draft\n---\n# Source title is stale\n', {
      autosave: false,
      forceSaveAs: true,
      forceOverwrite: false,
      reason: 'save',
    });
    expect(markCommitted).toHaveBeenCalledTimes(1);
    expect(commitMarkdownEdit).toHaveBeenCalledWith('---\ntitle: Visual Draft\n---\n# Source title is stale\n');
    expect(host.dialog.pickSavePath).toHaveBeenCalledWith('Visual-Draft.md', 'markdown');
    expect(host.file.writeTextFileAtomic).not.toHaveBeenCalled();
    expect(latestSnapshot?.markdown).toBe('---\ntitle: Visual Draft\n---\n# Source title is stale\n');
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

    expect(host.dialog.pickSavePath).toHaveBeenCalledWith(sourcePath, 'markdown');

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

  it('labels existing structured Save As replacements by document format', async () => {
    const targetPath = 'C:\\docs\\config.yaml';
    const existingMetadata = metadata({ lastKnownMtimeMs: 1500, lastKnownSizeBytes: 14, contentHash: 'yaml-existing' });
    host.dialog.pickSavePath.mockResolvedValue(targetPath);
    host.file.statFile.mockResolvedValue(existingMetadata);
    confirmText.mockResolvedValue(false);
    renderHarness({ filePath: null, format: 'yaml', markdown: 'ok: true\n' });

    let result: string | false | undefined;
    await act(async () => {
      result = await latestOperations?.saveCurrent({ forceSaveAs: true });
    });
    await flushAsync();

    expect(result).toBe(false);
    expect(host.dialog.pickSavePath).toHaveBeenCalledWith('Untitled.yaml', 'yaml');
    expect(confirmText).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Replace existing YAML file?',
      okLabel: 'Replace',
    }));
    expect(host.file.writeTextFileAtomic).not.toHaveBeenCalled();
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
    expect(host.recovery.saveFileDraft).toHaveBeenCalledWith(path, '# Cloud draft\n', expect.any(Number), sourceMetadata, 'markdown');
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
      sourceTextBytes: 8,
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
    expect(host.recovery.saveFileDraft).toHaveBeenCalledWith(path, '# Local edit\n', expect.any(Number), sourceMetadata, 'markdown');
    expect(confirmText).toHaveBeenCalledWith(expect.objectContaining({
      title: 'External change detected',
      okLabel: 'Overwrite',
    }));
    expect(host.file.writeTextFileAtomic).not.toHaveBeenCalled();
    expect(latestSnapshot?.autosaveStatus).toBe('conflict');
    expect(latestSnapshot?.externalConflict).toBe(true);
  });

  it('backs up a changed JSON disk version before Save Anyway overwrites it', async () => {
    const path = 'C:\\docs\\results.json';
    const sourceMetadata = metadata({ lastKnownMtimeMs: 1000, lastKnownSizeBytes: 14, contentHash: 'json-source' });
    const changedMetadata = metadata({ lastKnownMtimeMs: 2000, lastKnownSizeBytes: 16, contentHash: 'json-disk' });
    const nextMetadata = metadata({ lastKnownMtimeMs: 3000, lastKnownSizeBytes: 15, contentHash: 'json-local' });
    host.file.statFile
      .mockResolvedValueOnce(changedMetadata)
      .mockResolvedValueOnce(changedMetadata)
      .mockResolvedValueOnce(changedMetadata);
    host.file.writeTextFileAtomic.mockResolvedValue(nextMetadata);
    renderHarness({
      filePath: path,
      fileMetadata: sourceMetadata,
      format: 'json',
      markdown: '{"local":true}\n',
    });

    let result: string | false | undefined;
    await act(async () => {
      result = await latestOperations?.saveCurrent({ forceOverwrite: true });
    });
    await flushAsync();

    expect(result).toBe(path);
    expect(confirmText).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Overwrite disk version?',
      okLabel: 'Overwrite',
    }));
    expect(host.recovery.saveFileDraft).toHaveBeenCalledWith(path, '{"local":true}\n', expect.any(Number), sourceMetadata, 'json');
    expect(host.file.createBackupSnapshot).toHaveBeenCalledWith(path, 'external');
    expect(host.file.writeTextFileAtomic).toHaveBeenCalledWith(
      path,
      '{"local":true}\n',
      changedMetadata,
      changedMetadata,
    );
    expect(host.file.createBackupSnapshot.mock.invocationCallOrder[0])
      .toBeLessThan(host.file.writeTextFileAtomic.mock.invocationCallOrder[0]);
    expect(latestSnapshot?.format).toBe('json');
    expect(latestSnapshot?.externalConflict).toBe(false);
    expect(latestSnapshot?.fileMetadata).toBe(nextMetadata);
  });

  it('pauses autosave for parser-invalid structured source and preserves a recovery draft', async () => {
    const path = 'C:\\docs\\invalid.json';
    const sourceMetadata = metadata({ lastKnownMtimeMs: 1000, lastKnownSizeBytes: 9, contentHash: 'invalid-source' });
    renderHarness({
      filePath: path,
      fileMetadata: sourceMetadata,
      format: 'json',
      markdown: '{"bad": }\n',
      structuredSavePolicy: invalidJsonSavePolicy(),
    });

    let result: string | false | undefined;
    await act(async () => {
      result = await latestOperations?.saveCurrent({ autosave: true });
    });
    await flushAsync();

    expect(result).toBe(false);
    expect(host.file.writeTextFileAtomic).not.toHaveBeenCalled();
    expect(host.recovery.saveFileDraft).toHaveBeenCalledWith(path, '{"bad": }\n', expect.any(Number), sourceMetadata, 'json');
    expect(host.recovery.appendDiagnosticsEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'autosave-structured-parser-invalid',
      documentPath: path,
    }));
    expect(latestSnapshot?.autosaveStatus).toBe('paused');
  });

  it('requires explicit confirmation before manually saving parser-invalid structured source', async () => {
    const path = 'C:\\docs\\invalid.yaml';
    const sourceMetadata = metadata({ lastKnownMtimeMs: 1000, lastKnownSizeBytes: 10, contentHash: 'yaml-old' });
    const policy = invalidJsonSavePolicy();
    confirmText.mockResolvedValue(false);
    renderHarness({
      filePath: path,
      fileMetadata: sourceMetadata,
      format: 'yaml',
      markdown: 'sample:\n  : bad\n',
      structuredSavePolicy: {
        ...policy,
        format: 'yaml',
        reason: 'Autosave paused: YAML syntax is invalid at line 2.',
        diagnostic: {
          severity: 'error',
          code: 'yaml-syntax',
          message: 'Nested mappings are not allowed here.',
          source: 'yaml',
          category: 'parser',
          line: 2,
        },
      },
    });

    let result: string | false | undefined;
    await act(async () => {
      result = await latestOperations?.saveCurrent();
    });
    await flushAsync();

    expect(result).toBe(false);
    expect(confirmText).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Save invalid YAML source?',
      okLabel: 'Save Anyway',
    }));
    expect(host.file.writeTextFileAtomic).not.toHaveBeenCalled();
    expect(host.recovery.saveFileDraft).toHaveBeenCalledWith(path, 'sample:\n  : bad\n', expect.any(Number), sourceMetadata, 'yaml');
    expect(latestSnapshot?.autosaveStatus).toBe('paused');
  });

  function renderHarness(options: {
    filePath?: string | null;
    fileMetadata?: FileMetadata;
    format?: DocumentFormat;
    markdown?: string;
    structuredSavePolicy?: StructuredSavePolicy;
  } = {}) {
    act(() => {
      root.render(createElement(SaveHarness, {
        host,
        initialFilePath: options.filePath ?? null,
        initialFileMetadata: options.fileMetadata ?? DEFAULT_METADATA,
        initialFormat: options.format ?? 'markdown',
        initialMarkdown: options.markdown ?? '# Draft\n',
        getDocumentIdentityVersion: () => identityVersion,
        confirmVisualRoundTripWrite,
        structuredSavePolicy: options.structuredSavePolicy,
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
  initialFormat,
  initialMarkdown,
  getDocumentIdentityVersion,
  confirmVisualRoundTripWrite,
  structuredSavePolicy,
  confirmText,
  pushToast,
  commitMarkdownEdit,
  onOperations,
  onSnapshot,
}: {
  host: DocumentHost;
  initialFilePath: string | null;
  initialFileMetadata: FileMetadata;
  initialFormat: DocumentFormat;
  initialMarkdown: string;
  getDocumentIdentityVersion: () => number;
  confirmVisualRoundTripWrite: (markdown: string, context: VisualRoundTripWriteContext) => Promise<boolean>;
  structuredSavePolicy?: StructuredSavePolicy;
  confirmText: (state: ConfirmState) => Promise<boolean>;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  commitMarkdownEdit: (markdown: string) => void;
  onOperations: (operations: SaveOperations) => void;
  onSnapshot: (snapshot: SaveSnapshot) => void;
}) {
  const [filePath, setFilePath] = useState<string | null>(initialFilePath);
  const [fileMetadata, setFileMetadata] = useState<FileMetadata>(initialFileMetadata);
  const [format, setFormat] = useState<DocumentFormat>(initialFormat);
  const [sourceText, setSourceText] = useState(initialMarkdown);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [lastSavedSourceText, setLastSavedSourceText] = useState('');
  const [lastSavedMarkdown, setLastSavedMarkdown] = useState('');
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('idle');
  const [lastAutosavedAt, setLastAutosavedAt] = useState<number | null>(null);
  const [externalConflict, setExternalConflict] = useState(false);
  const [_settings, setSettings] = useState<PersistedSettings>(() => loadSettings());
  const structuredSavePolicyRef = useRef<StructuredSavePolicy>(defaultStructuredSavePolicy(format));
  structuredSavePolicyRef.current = structuredSavePolicy ?? defaultStructuredSavePolicy(format);

  const operations = useSaveOperations({
    filePath,
    fileMetadata,
    format,
    sourceText,
    markdown,
    getDocumentIdentityVersion,
    setFilePath,
    setFormat,
    setFileMetadata,
    setLastSavedSourceText: (nextSourceText) => {
      setLastSavedSourceText(nextSourceText);
      setLastSavedMarkdown(nextSourceText);
    },
    setLastSavedMarkdown,
    setAutosaveStatus,
    setLastAutosavedAt,
    setExternalConflict,
    setSettings,
    commitSourceTextEdit: (nextSourceText) => {
      commitMarkdownEdit(nextSourceText);
      setSourceText(nextSourceText);
      setMarkdown(nextSourceText);
    },
    commitMarkdownEdit: (nextMarkdown) => {
      commitMarkdownEdit(nextMarkdown);
      setSourceText(nextMarkdown);
      setMarkdown(nextMarkdown);
    },
    confirmVisualRoundTripWrite,
    structuredSavePolicyRef,
    confirmText,
    pushToast,
    host,
  });

  onOperations(operations);
  onSnapshot({
    filePath,
    fileMetadata,
    format,
    sourceText,
    lastSavedSourceText,
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
    pickDocumentFile: DocumentHost['dialog']['pickDocumentFile'];
    pickJsonSchemaFile: DocumentHost['dialog']['pickJsonSchemaFile'];
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
      pickDocumentFile: vi.fn().mockResolvedValue(null),
      pickJsonSchemaFile: vi.fn().mockResolvedValue(null),
      pickSavePath: vi.fn<DocumentHost['dialog']['pickSavePath']>().mockResolvedValue(null),
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

function metadata(patch: Partial<FileMetadata> = {}): FileMetadata {
  return { ...DEFAULT_METADATA, ...patch };
}

function defaultStructuredSavePolicy(format: DocumentFormat): StructuredSavePolicy {
  return {
    format,
    autosaveBlocked: false,
    manualSaveRequiresConfirmation: false,
    reason: null,
    diagnostic: null,
  };
}

function invalidJsonSavePolicy(): StructuredSavePolicy {
  return {
    format: 'json',
    autosaveBlocked: true,
    manualSaveRequiresConfirmation: true,
    reason: 'Autosave paused: JSON syntax is invalid at line 1, column 9.',
    diagnostic: {
      severity: 'error',
      code: 'json-syntax',
      message: 'Value expected.',
      source: 'json',
      category: 'parser',
      line: 1,
      column: 9,
    },
  };
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
