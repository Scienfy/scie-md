import type { Dispatch, SetStateAction } from 'react';
import type { EditorMode, FileMetadata, ReadTextFileResponse } from '../documentState';
import type { DocumentFormat } from '@sciemd/core';
import type { DocumentOpenPhase } from '../documentOpenStatus';
import { shouldRestoreExternalLaunchDraft } from '../documentSessionPolicy';
import type { DocumentHost, RecoveryHost } from '../host/documentHost';
import type { ConfirmState } from '../hooks/useDialogs';
import type { PersistedSettings } from '../../services/settingsService';
import {
  displayNameForPath,
  documentOpenStatusClearDelay,
  shouldShowImmediatePreparingOverlay,
} from './controller';
import {
  loadFileDraftWithTimeout,
  recordDocumentOpenDiagnostic,
  withTimeout,
} from './openEffects';

export interface OpenDocumentOptions {
  preferredMode?: EditorMode;
  externalLaunch?: boolean;
  draftRestore?: 'prompt' | 'auto' | 'skip';
  skipDirtySettlement?: boolean;
}

export interface DocumentOpenTimeouts {
  fileReadMs: number;
  draftRestoreMs: number;
}

export const DEFAULT_DOCUMENT_OPEN_TIMEOUTS: DocumentOpenTimeouts = {
  fileReadMs: 20_000,
  draftRestoreMs: 1_500,
};

export type CommitOpenedDocument = (
  path: string | null,
  content: string,
  metadata: FileMetadata,
  preferredMode?: EditorMode,
  savedSourceText?: string,
  format?: DocumentFormat,
) => void;

export interface OpenDocumentForSessionInput {
  explicitPath?: string;
  options?: OpenDocumentOptions;
  host: DocumentHost;
  confirmText: (state: ConfirmState) => Promise<boolean>;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  setSettings: Dispatch<SetStateAction<PersistedSettings>>;
  isLatestOpenRequest: () => boolean;
  isExternalLaunchDocumentCurrent: (path: string) => boolean;
  getCurrentSourceText: () => string;
  settleDirtyDocumentBeforeReplace: () => Promise<boolean>;
  preserveDirtyDraftBeforeExternalOpen: () => void;
  showDocumentOpenStatus: (path: string, phase: DocumentOpenPhase, options?: { immediate?: boolean }) => number;
  clearDocumentOpenStatus: (token: number, delayMs?: number) => void;
  commitOpenedDocument: CommitOpenedDocument;
  timeouts?: DocumentOpenTimeouts;
}

export async function openDocumentForSession({
  explicitPath,
  options = {},
  host,
  confirmText,
  pushToast,
  setSettings,
  isLatestOpenRequest,
  isExternalLaunchDocumentCurrent,
  getCurrentSourceText,
  settleDirtyDocumentBeforeReplace,
  preserveDirtyDraftBeforeExternalOpen,
  showDocumentOpenStatus,
  clearDocumentOpenStatus,
  commitOpenedDocument,
  timeouts = DEFAULT_DOCUMENT_OPEN_TIMEOUTS,
}: OpenDocumentForSessionInput): Promise<boolean> {
  let selectedPath = explicitPath ?? null;
  let openStatusToken: number | null = null;
  let committedDocument = false;

  const showOpeningPhase = (phase: DocumentOpenPhase, phaseOptions: { immediate?: boolean } = {}) => {
    if (!selectedPath || !isLatestOpenRequest()) return;
    openStatusToken = showDocumentOpenStatus(selectedPath, phase, phaseOptions);
  };
  const clearOpeningStatus = (delayMs = 0) => {
    if (openStatusToken === null) return;
    clearDocumentOpenStatus(openStatusToken, delayMs);
    openStatusToken = null;
  };

  try {
    if (options.skipDirtySettlement) {
      // Caller already made the replacement decision.
    } else if (options.externalLaunch) {
      preserveDirtyDraftBeforeExternalOpen();
      if (!(await settleDirtyDocumentBeforeReplace())) return false;
    } else if (!(await settleDirtyDocumentBeforeReplace())) {
      return false;
    }
    if (!isLatestOpenRequest()) return false;

    selectedPath = explicitPath ?? (await host.dialog.pickDocumentFile());
    if (!selectedPath) return false;
    if (!isLatestOpenRequest()) return false;

    recordDocumentOpenDiagnostic(host.recovery, 'document-open-selected', 'Document open path selected.', selectedPath);
    showOpeningPhase('reading');

    const response = await withTimeout(
      host.file.readTextFileForEdit(selectedPath),
      timeouts.fileReadMs,
      `Reading ${displayNameForPath(selectedPath)} took too long.`,
    );

    recordDocumentOpenDiagnostic(
      host.recovery,
      'document-open-read-complete',
      'Document file read completed.',
      selectedPath,
      response.content,
    );
    if (!isLatestOpenRequest()) return false;

    if (options.externalLaunch) {
      const immediatePreparingOverlay = shouldShowImmediatePreparingOverlay(response.metadata.lastKnownSizeBytes);
      showOpeningPhase('preparing', { immediate: immediatePreparingOverlay });
      if (immediatePreparingOverlay) await waitForDocumentOpenPaint();
      if (!isLatestOpenRequest()) return false;

      commitOpenedDocument(selectedPath, response.content, response.metadata, options.preferredMode);
      committedDocument = true;
      recordDocumentOpenDiagnostic(
        host.recovery,
        'document-open-committed',
        'External launch document committed before draft recovery.',
        selectedPath,
        response.content,
      );
      if (options.draftRestore !== 'skip') {
        const launchPath = selectedPath;
        void restoreExternalLaunchDraftAfterCommit({
          recoveryHost: host.recovery,
          path: launchPath,
          response,
          preferredMode: options.preferredMode,
          isStillCurrentDocument: () => isExternalLaunchDocumentCurrent(launchPath),
          getCurrentSourceText,
          commitOpenedDocument,
          pushToast,
          draftRestoreTimeoutMs: timeouts.draftRestoreMs,
        });
      }
      return true;
    }

    const draft = options.draftRestore === 'skip'
      ? null
      : await loadFileDraftWithTimeout(host.recovery, selectedPath, timeouts.draftRestoreMs);
    if (!isLatestOpenRequest()) return false;

    if (draft && draft.markdown !== response.content && host.recovery.shouldOfferFileDraftRestore(draft, response.metadata)) {
      if (options.draftRestore === 'auto') {
        showOpeningPhase('restoring', { immediate: true });
        if (!isLatestOpenRequest()) return false;
        commitOpenedDocument(selectedPath, draft.markdown, response.metadata, options.preferredMode, response.content, draft.format);
        committedDocument = true;
        pushToast('Restored unsaved file draft.', 'warning');
        return true;
      }

      clearOpeningStatus();
      const restoreDraft = await confirmText({
        title: 'Restore unsaved file draft?',
        message: 'ScieMD found unsaved edits for this file from a previous session. Restore that draft instead of the disk version?',
        okLabel: 'Restore draft',
        cancelLabel: 'Open disk version',
      });
      if (!isLatestOpenRequest()) return false;

      if (restoreDraft) {
        showOpeningPhase('restoring', { immediate: true });
        if (!isLatestOpenRequest()) return false;
        commitOpenedDocument(selectedPath, draft.markdown, response.metadata, options.preferredMode ?? 'visual', response.content, draft.format);
        committedDocument = true;
        pushToast('Restored unsaved file draft.', 'warning');
        return true;
      }
      host.recovery.clearFileDraft(selectedPath);
    } else if (draft && draft.markdown !== response.content) {
      pushToast('An older recovery draft exists, but the disk file changed after it. Opened the disk version and kept the draft.', 'warning');
    }

    const immediatePreparingOverlay = shouldShowImmediatePreparingOverlay(response.metadata.lastKnownSizeBytes);
    showOpeningPhase('preparing', { immediate: immediatePreparingOverlay });
    if (immediatePreparingOverlay) await waitForDocumentOpenPaint();
    if (!isLatestOpenRequest()) return false;

    commitOpenedDocument(selectedPath, response.content, response.metadata, options.preferredMode);
    committedDocument = true;
    recordDocumentOpenDiagnostic(
      host.recovery,
      'document-open-committed',
      'Document committed.',
      selectedPath,
      response.content,
    );
    return true;
  } catch (error) {
    if (!isLatestOpenRequest()) return false;
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    if (selectedPath && !/File access denied/i.test(message)) {
      setSettings(host.settings.forgetRecentFile(selectedPath));
    }
    recordDocumentOpenDiagnostic(
      host.recovery,
      'document-open-failed',
      message || 'Document open failed.',
      selectedPath,
    );
    pushToast(/File access denied/i.test(message) ? 'Use Open or Files to grant access to this document again.' : message || 'Open failed.', 'error');
    return false;
  } finally {
    clearOpeningStatus(documentOpenStatusClearDelay(committedDocument));
  }
}

export interface RestoreExternalLaunchDraftInput {
  recoveryHost: RecoveryHost;
  path: string;
  response: ReadTextFileResponse;
  preferredMode: EditorMode | undefined;
  isStillCurrentDocument: () => boolean;
  getCurrentSourceText: () => string;
  commitOpenedDocument: CommitOpenedDocument;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  draftRestoreTimeoutMs?: number;
}

export async function restoreExternalLaunchDraftAfterCommit({
  recoveryHost,
  path,
  response,
  preferredMode,
  isStillCurrentDocument,
  getCurrentSourceText,
  commitOpenedDocument,
  pushToast,
  draftRestoreTimeoutMs = DEFAULT_DOCUMENT_OPEN_TIMEOUTS.draftRestoreMs,
}: RestoreExternalLaunchDraftInput): Promise<void> {
  recordDocumentOpenDiagnostic(recoveryHost, 'document-open-draft-check-start', 'Checking launch document recovery draft.', path);
  const draft = await loadFileDraftWithTimeout(recoveryHost, path, draftRestoreTimeoutMs);
  const stillCurrentDocument = isStillCurrentDocument();
  if (!stillCurrentDocument) return;

  if (shouldRestoreExternalLaunchDraft({
    stillCurrentDocument,
    currentSourceText: getCurrentSourceText(),
    diskSourceText: response.content,
    draftSourceText: draft?.sourceText ?? draft?.markdown ?? null,
    draftRestoreOfferable: draft ? recoveryHost.shouldOfferFileDraftRestore(draft, response.metadata) : false,
  })) {
    if (!draft) return;
    const draftSourceText = draft.sourceText ?? draft.markdown;
    commitOpenedDocument(path, draftSourceText, response.metadata, preferredMode, response.content, draft.format);
    recordDocumentOpenDiagnostic(
      recoveryHost,
      'document-open-draft-restored',
      'Launch document recovery draft restored after disk document opened.',
      path,
      draftSourceText,
    );
    pushToast('Restored unsaved file draft.', 'warning');
    return;
  }

  if (draft && draft.markdown !== response.content) {
    pushToast('An older recovery draft exists, but the disk file changed after it. Opened the disk version and kept the draft.', 'warning');
  }
}

async function waitForDocumentOpenPaint(): Promise<void> {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
