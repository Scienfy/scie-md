import { describe, expect, it, vi } from 'vitest';
import { desktopDocumentHost } from './desktopDocumentHost';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

vi.mock('../../services/fileService', () => ({
  clearPendingDocumentOpen: vi.fn(),
  clearPendingMarkdownOpen: vi.fn(),
  createBackupSnapshot: vi.fn(),
  getInitialDocumentPath: vi.fn(),
  getInitialMarkdownPath: vi.fn(),
  peekPendingDocumentOpen: vi.fn(),
  peekPendingMarkdownOpen: vi.fn(),
  pickDocumentFile: vi.fn(),
  pickJsonSchemaFile: vi.fn(),
  pickMarkdownFile: vi.fn(),
  pickSavePath: vi.fn(),
  takePendingDocumentOpen: vi.fn(),
  takePendingMarkdownOpen: vi.fn(),
  readTextFile: vi.fn(),
  readTextFileForEdit: vi.fn(),
  statFile: vi.fn(),
  writeTextFileAtomic: vi.fn(),
}));

vi.mock('../../services/draftRecoveryService', () => ({
  clearFileDraft: vi.fn(),
  clearFileDraftAsync: vi.fn(),
  clearUntitledDraftAsync: vi.fn(),
  isBundledWelcomeMarkdown: vi.fn(),
  loadFileDraftAsync: vi.fn(),
  loadUntitledDraftAsync: vi.fn(),
  saveFileDraft: vi.fn(),
  saveFileDraftAsync: vi.fn(),
  saveUntitledDraft: vi.fn(),
  saveUntitledDraftAsync: vi.fn(),
  shouldOfferFileDraftRestore: vi.fn(),
  shouldPersistUntitledDraft: vi.fn(),
}));

vi.mock('../../services/nativeRecoveryService', () => ({
  appendDiagnosticsEvent: vi.fn(),
}));

vi.mock('../../services/settingsService', () => ({
  forgetRecentFile: vi.fn(),
  rememberRecentFile: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock('../../services/fileWatchService', () => ({
  clearWatchedFiles: vi.fn(),
  listenFileWatchChanges: vi.fn(),
  updateWatchedFiles: vi.fn(),
}));

describe('desktopDocumentHost', () => {
  it('exposes typed host sections for document lifecycle dependencies', () => {
    expect(desktopDocumentHost.file.readTextFileForEdit).toEqual(expect.any(Function));
    expect(desktopDocumentHost.dialog.pickMarkdownFile).toEqual(expect.any(Function));
    expect(desktopDocumentHost.dialog.pickDocumentFile).toEqual(expect.any(Function));
    expect(desktopDocumentHost.dialog.pickJsonSchemaFile).toEqual(expect.any(Function));
    expect(desktopDocumentHost.launch.getInitialMarkdownPath).toEqual(expect.any(Function));
    expect(desktopDocumentHost.launch.getInitialDocumentPath).toEqual(expect.any(Function));
    expect(desktopDocumentHost.launch.peekPendingDocumentOpen).toEqual(expect.any(Function));
    expect(desktopDocumentHost.launch.takePendingDocumentOpen).toEqual(expect.any(Function));
    expect(desktopDocumentHost.launch.clearPendingDocumentOpen).toEqual(expect.any(Function));
    expect(desktopDocumentHost.launch.listenSingleInstanceOpen).toEqual(expect.any(Function));
    expect(desktopDocumentHost.recovery.loadFileDraft).toEqual(expect.any(Function));
    expect(desktopDocumentHost.settings.rememberRecentFile).toEqual(expect.any(Function));
    expect(desktopDocumentHost.watcher.updateWatchedFiles).toEqual(expect.any(Function));
  });
});
