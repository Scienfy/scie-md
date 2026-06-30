import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_METADATA } from '../documentState';
import type { ReadTextFileResponse } from '../documentState';
import type { DocumentHost } from '../host/documentHost';
import { loadSettings } from '../../services/settingsService';
import type { PersistedSettings } from '../../services/settingsService';
import {
  openDocumentForSession,
  restoreExternalLaunchDraftAfterCommit,
} from './openDocument';
import type { OpenDocumentForSessionInput } from './openDocument';

describe('openDocumentForSession', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens a disk document with status and diagnostics around read and commit', async () => {
    const path = 'C:\\docs\\paper.md';
    const input = createOpenInput();
    input.host.file.readTextFileForEdit = vi.fn().mockResolvedValue(readResponse('# Disk\n'));

    const opened = await openDocumentForSession({ ...input, explicitPath: path });

    expect(opened).toBe(true);
    expect(input.settleDirtyDocumentBeforeReplace).toHaveBeenCalledTimes(1);
    expect(input.preserveDirtyDraftBeforeExternalOpen).not.toHaveBeenCalled();
    expect(input.host.file.readTextFileForEdit).toHaveBeenCalledWith(path);
    expect(input.commitOpenedDocument).toHaveBeenCalledWith(path, '# Disk\n', readResponse('# Disk\n').metadata, undefined);
    expect(input.showDocumentOpenStatus).toHaveBeenNthCalledWith(1, path, 'reading', {});
    expect(input.showDocumentOpenStatus).toHaveBeenNthCalledWith(2, path, 'preparing', { immediate: false });
    expect(input.clearDocumentOpenStatus).toHaveBeenCalledWith(2, 220);
    expect(diagnosticEventTypes(input.host)).toEqual([
      'document-open-selected',
      'document-open-read-complete',
      'document-open-committed',
    ]);
  });

  it('prompts for an offerable file draft and commits the draft with the disk content as saved baseline', async () => {
    const path = 'C:\\docs\\drafted.md';
    const input = createOpenInput({
      confirmText: vi.fn<OpenDocumentForSessionInput['confirmText']>().mockResolvedValue(true),
    });
    input.host.file.readTextFileForEdit = vi.fn().mockResolvedValue(readResponse('# Disk\n'));
    input.host.recovery.loadFileDraft = vi.fn().mockResolvedValue({ markdown: '# Draft\n', savedAt: 1000 });
    input.host.recovery.shouldOfferFileDraftRestore = vi.fn().mockReturnValue(true);

    const opened = await openDocumentForSession({ ...input, explicitPath: path });

    expect(opened).toBe(true);
    expect(input.confirmText).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Restore unsaved file draft?',
      okLabel: 'Restore draft',
      cancelLabel: 'Open disk version',
    }));
    expect(input.clearDocumentOpenStatus).toHaveBeenNthCalledWith(1, 1, 0);
    expect(input.showDocumentOpenStatus).toHaveBeenLastCalledWith(path, 'restoring', { immediate: true });
    expect(input.commitOpenedDocument).toHaveBeenCalledWith(path, '# Draft\n', readResponse('# Disk\n').metadata, 'visual', '# Disk\n');
    expect(input.pushToast).toHaveBeenCalledWith('Restored unsaved file draft.', 'warning');
    expect(input.host.recovery.clearFileDraft).not.toHaveBeenCalled();
  });

  it('clears an offerable file draft when the user opens the disk version', async () => {
    const path = 'C:\\docs\\disk.md';
    const input = createOpenInput({
      confirmText: vi.fn<OpenDocumentForSessionInput['confirmText']>().mockResolvedValue(false),
    });
    input.host.file.readTextFileForEdit = vi.fn().mockResolvedValue(readResponse('# Disk\n'));
    input.host.recovery.loadFileDraft = vi.fn().mockResolvedValue({ markdown: '# Draft\n', savedAt: 1000 });
    input.host.recovery.shouldOfferFileDraftRestore = vi.fn().mockReturnValue(true);

    const opened = await openDocumentForSession({ ...input, explicitPath: path });

    expect(opened).toBe(true);
    expect(input.host.recovery.clearFileDraft).toHaveBeenCalledWith(path);
    expect(input.commitOpenedDocument).toHaveBeenCalledWith(path, '# Disk\n', readResponse('# Disk\n').metadata, undefined);
  });

  it('stops before path selection when dirty-document settlement is rejected', async () => {
    const input = createOpenInput({
      settleDirtyDocumentBeforeReplace: vi.fn<OpenDocumentForSessionInput['settleDirtyDocumentBeforeReplace']>().mockResolvedValue(false),
    });

    const opened = await openDocumentForSession(input);

    expect(opened).toBe(false);
    expect(input.host.dialog.pickMarkdownFile).not.toHaveBeenCalled();
    expect(input.host.file.readTextFileForEdit).not.toHaveBeenCalled();
  });

  it('records open failures and forgets recent files except for grant failures', async () => {
    const path = 'C:\\docs\\missing.md';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const input = createOpenInput();
    input.host.file.readTextFileForEdit = vi.fn().mockRejectedValue(new Error('Not found'));

    const opened = await openDocumentForSession({ ...input, explicitPath: path });

    expect(opened).toBe(false);
    expect(consoleError).toHaveBeenCalled();
    expect(input.host.settings.forgetRecentFile).toHaveBeenCalledWith(path);
    expect(input.setSettings).toHaveBeenCalledWith(expect.objectContaining({ recentFiles: expect.any(Array) }));
    expect(input.pushToast).toHaveBeenCalledWith('Not found', 'error');
    expect(diagnosticEventTypes(input.host)).toContain('document-open-failed');

    const accessDeniedInput = createOpenInput();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    accessDeniedInput.host.file.readTextFileForEdit = vi.fn().mockRejectedValue(new Error('File access denied'));

    const accessDeniedOpened = await openDocumentForSession({ ...accessDeniedInput, explicitPath: path });

    expect(accessDeniedOpened).toBe(false);
    expect(accessDeniedInput.host.settings.forgetRecentFile).not.toHaveBeenCalled();
    expect(accessDeniedInput.pushToast).toHaveBeenCalledWith('Use Open or Files to grant access to this document again.', 'error');
  });
});

describe('restoreExternalLaunchDraftAfterCommit', () => {
  it('restores an offerable launch draft only while the disk document is still current', async () => {
    const path = 'C:\\docs\\launch.md';
    const host = createHost();
    const commitOpenedDocument = vi.fn<OpenDocumentForSessionInput['commitOpenedDocument']>();
    const pushToast = vi.fn<OpenDocumentForSessionInput['pushToast']>();
    host.recovery.loadFileDraft = vi.fn().mockResolvedValue({ markdown: '# Draft\n', savedAt: 2000 });
    host.recovery.shouldOfferFileDraftRestore = vi.fn().mockReturnValue(true);

    await restoreExternalLaunchDraftAfterCommit({
      recoveryHost: host.recovery,
      path,
      response: readResponse('# Disk\n'),
      preferredMode: 'visual',
      isStillCurrentDocument: () => true,
      getCurrentMarkdown: () => '# Disk\n',
      commitOpenedDocument,
      pushToast,
      draftRestoreTimeoutMs: 20,
    });

    expect(commitOpenedDocument).toHaveBeenCalledWith(path, '# Draft\n', readResponse('# Disk\n').metadata, 'visual', '# Disk\n');
    expect(pushToast).toHaveBeenCalledWith('Restored unsaved file draft.', 'warning');
    expect(diagnosticEventTypes(host)).toEqual([
      'document-open-draft-check-start',
      'document-open-draft-restored',
    ]);
  });

  it('leaves a launch draft untouched after the active document changes', async () => {
    const host = createHost();
    const commitOpenedDocument = vi.fn<OpenDocumentForSessionInput['commitOpenedDocument']>();
    const pushToast = vi.fn<OpenDocumentForSessionInput['pushToast']>();
    host.recovery.loadFileDraft = vi.fn().mockResolvedValue({ markdown: '# Draft\n', savedAt: 2000 });
    host.recovery.shouldOfferFileDraftRestore = vi.fn().mockReturnValue(true);

    await restoreExternalLaunchDraftAfterCommit({
      recoveryHost: host.recovery,
      path: 'C:\\docs\\launch.md',
      response: readResponse('# Disk\n'),
      preferredMode: 'visual',
      isStillCurrentDocument: () => false,
      getCurrentMarkdown: () => '# Disk\n',
      commitOpenedDocument,
      pushToast,
      draftRestoreTimeoutMs: 20,
    });

    expect(commitOpenedDocument).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });
});

function createOpenInput(overrides: Partial<OpenDocumentForSessionInput> = {}): OpenDocumentForSessionInput {
  let statusToken = 0;
  return {
    host: createHost(),
    confirmText: vi.fn<OpenDocumentForSessionInput['confirmText']>().mockResolvedValue(false),
    pushToast: vi.fn<OpenDocumentForSessionInput['pushToast']>(),
    setSettings: vi.fn<(settings: PersistedSettings | ((current: PersistedSettings) => PersistedSettings)) => void>(),
    isLatestOpenRequest: vi.fn<OpenDocumentForSessionInput['isLatestOpenRequest']>().mockReturnValue(true),
    isExternalLaunchDocumentCurrent: vi.fn<OpenDocumentForSessionInput['isExternalLaunchDocumentCurrent']>().mockReturnValue(true),
    getCurrentMarkdown: vi.fn<OpenDocumentForSessionInput['getCurrentMarkdown']>().mockReturnValue('# Disk\n'),
    settleDirtyDocumentBeforeReplace: vi.fn<OpenDocumentForSessionInput['settleDirtyDocumentBeforeReplace']>().mockResolvedValue(true),
    preserveDirtyDraftBeforeExternalOpen: vi.fn<OpenDocumentForSessionInput['preserveDirtyDraftBeforeExternalOpen']>(),
    showDocumentOpenStatus: vi.fn<OpenDocumentForSessionInput['showDocumentOpenStatus']>(() => {
      statusToken += 1;
      return statusToken;
    }),
    clearDocumentOpenStatus: vi.fn<OpenDocumentForSessionInput['clearDocumentOpenStatus']>(),
    commitOpenedDocument: vi.fn<OpenDocumentForSessionInput['commitOpenedDocument']>(),
    timeouts: { fileReadMs: 20, draftRestoreMs: 20 },
    ...overrides,
  };
}

function createHost(): DocumentHost {
  return {
    file: {
      readTextFile: vi.fn().mockResolvedValue(readResponse('')),
      readTextFileForEdit: vi.fn().mockResolvedValue(readResponse('')),
      statFile: vi.fn().mockResolvedValue(DEFAULT_METADATA),
      writeTextFileAtomic: vi.fn().mockResolvedValue(DEFAULT_METADATA),
      createBackupSnapshot: vi.fn().mockResolvedValue(null),
    },
    dialog: {
      pickMarkdownFile: vi.fn().mockResolvedValue('C:\\docs\\picked.md'),
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
      rememberRecentFile: vi.fn().mockReturnValue(loadSettings()),
      forgetRecentFile: vi.fn().mockReturnValue(loadSettings()),
      updateSettings: vi.fn().mockReturnValue(loadSettings()),
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

function diagnosticEventTypes(host: DocumentHost): string[] {
  const appendDiagnosticsEvent = host.recovery.appendDiagnosticsEvent as ReturnType<typeof vi.fn>;
  return appendDiagnosticsEvent.mock.calls.map(([event]) => event.eventType);
}
