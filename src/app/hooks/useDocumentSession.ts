import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AutosaveStatus, EditorMode, FileMetadata } from '../documentState';
import { DEFAULT_METADATA, isDirty } from '../documentState';
import { createDocumentOpenStatus } from '../documentOpenStatus';
import type { DocumentOpenPhase, DocumentOpenStatus } from '../documentOpenStatus';
import {
  buildOpenedDocumentTransition,
  buildReviewedDiskMergeTransition,
  buildUntitledDraftRestoreTransition,
  decideLaunchDuplicate,
  decideUntitledDraftRestore,
  nextDirtyReplacementStep,
} from '../documentSession/controller';
import type { DocumentSessionState } from '../documentSession/controller';
import {
  recordDocumentOpenDiagnostic,
  withTimeout,
} from '../documentSession/openEffects';
import { openDocumentForSession } from '../documentSession/openDocument';
import type { OpenDocumentOptions } from '../documentSession/openDocument';
import { useAutosaveTimer } from './useAutosaveTimer';
import { useDocumentValidator } from './useDocumentValidator';
import { useExternalChangeDetection } from './useExternalChangeDetection';
import { useLayerTwoDocument } from './useLayerTwoDocument';
import { useSaveOperations } from './useSaveOperations';
import { useWindowCloseGuard } from './useWindowCloseGuard';
import type { PersistedSettings } from '../../services/settingsService';
import { normalizeVisualStyleId } from '../../services/visualStyleService';
import { createScienfyTemplate } from '../../domain/document/templates';
import type { ScienfyTemplateId } from '../../domain/document/templates';
import { safeParseScienfyDocument } from '@sciemd/core';
import type { AuthorshipMark } from '../../markdown/authorship';
import { SOURCE_ONLY_FILE_BYTES } from '../../markdown/supportedMarkdown';
import { detectVisualRoundTripRisks } from '../../markdown/visualRoundTripSafety';
import { commitVisualEditorReadResult, commitVisualEditorState, readVisualEditorState } from '../../components/visualEditorStateSync';
import {
  createDocumentHistory,
  recordDocumentEdit,
  redoDocumentHistory,
  resetDocumentHistory as clearDocumentHistory,
  undoDocumentHistory,
} from '../../markdown/documentHistory';
import type { ConfirmState } from './useDialogs';
import { isTauriRuntime } from '../runtime';
import type { DocumentHost } from '../host/documentHost';
import { desktopDocumentHost } from '../host/desktopDocumentHost';
import type { StartupOpenFailureKind, StartupOpenFailureState } from '../startupOpenFailure';
import { createStartupOpenFailure, startupOpenDiagnosticEvent } from '../startupOpenFailure';

interface DocumentSessionParams {
  initialMarkdown: string;
  setSettings: Dispatch<SetStateAction<PersistedSettings>>;
  setAuthorshipMarks: Dispatch<SetStateAction<AuthorshipMark[]>>;
  onDocumentReplaced?: () => void;
  onOpenedFilePath?: (path: string) => void;
  confirmText: (state: ConfirmState) => Promise<boolean>;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  host?: DocumentHost;
}

interface CommitOpenedDocumentOptions {
  preserveStartupOpenFailure?: boolean;
}

interface VisualRoundTripWriteRequest {
  autosave?: boolean;
  reason: 'save' | 'mode-switch-to-visual';
}

const DOCUMENT_OPEN_STATUS_DELAY_MS = 650;
const STARTUP_PATH_TIMEOUT_MS = 5_000;
const LAUNCH_DUPLICATE_SUPPRESSION_MS = 3_000;

export function useDocumentSession({
  initialMarkdown,
  setSettings,
  setAuthorshipMarks,
  onDocumentReplaced,
  onOpenedFilePath,
  confirmText,
  pushToast,
  host = desktopDocumentHost,
}: DocumentSessionParams) {
  const draftRestoreCheckedRef = useRef(false);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const markdownRef = useRef(initialMarkdown);
  const documentHistoryRef = useRef(createDocumentHistory());
  const editorEditGroupTimerRef = useRef<number | null>(null);
  const initialOpenCheckedRef = useRef(false);
  const [lastSavedMarkdown, setLastSavedMarkdown] = useState(initialMarkdown);
  const [filePath, setFilePath] = useState<string | null>(null);
  const activeFilePathRef = useRef<string | null>(null);
  const documentIdentityVersionRef = useRef(0);
  const openRequestIdRef = useRef(0);
  const [fileMetadata, setFileMetadata] = useState<FileMetadata>(DEFAULT_METADATA);
  const [mode, setMode] = useState<EditorMode>('visual');
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('idle');
  const [lastAutosavedAt, setLastAutosavedAt] = useState<number | null>(null);
  const [externalConflict, setExternalConflict] = useState(false);
  const [startupDocumentOpenPending, setStartupDocumentOpenPending] = useState(() => isTauriRuntime());
  const [startupDocumentOpenFailure, setStartupDocumentOpenFailure] = useState<StartupOpenFailureState | null>(null);
  const startupDocumentOpenFailed = startupDocumentOpenFailure !== null;
  const [documentOpenStatus, setDocumentOpenStatus] = useState<DocumentOpenStatus | null>(null);
  const documentOpenStatusTokenRef = useRef(0);
  const documentOpenStatusShowTimerRef = useRef<number | null>(null);
  const documentOpenStatusClearTimerRef = useRef<number | null>(null);
  const documentOpenStatusVisibleRef = useRef(false);
  const startupDocumentOpenSettledRef = useRef(!isTauriRuntime());
  const singleInstanceListenerReadyRef = useRef(false);
  const pendingLaunchDrainInFlightRef = useRef(false);
  const launchOpenInFlightKeysRef = useRef(new Set<string>());
  const lastLaunchOpenRef = useRef<{ path: string; pathKey: string; openedAt: number } | null>(null);
  const lastDraftWarningRef = useRef('');
  const untitledDraftRestoreAttemptedRef = useRef(false);
  const visualRoundTripAcknowledgementKeyRef = useRef<string | null>(null);

  const {
    document: layerTwoDocument,
    parsedMarkdown,
    bibliographyLoading,
    documentParsingPending,
    linkedVariableLoading,
    reloadBibliography,
  } = useLayerTwoDocument(markdown, filePath, host);
  const { validation, validateNow, validationPending } = useDocumentValidator(markdown, layerTwoDocument, parsedMarkdown);
  const dirty = isDirty(markdown, lastSavedMarkdown);
  const autosaveBlocked = false;

  // This handshake is intentionally mount-scoped. Cancelling it on ordinary
  // callback identity churn can leave Tauri startup permanently pending.
  useEffect(() => {
    markdownRef.current = markdown;
  }, [markdown]);

  useEffect(() => {
    activeFilePathRef.current = filePath;
  }, [filePath]);

  const clearEditorEditGroup = useCallback(() => {
    if (editorEditGroupTimerRef.current !== null) {
      window.clearTimeout(editorEditGroupTimerRef.current);
      editorEditGroupTimerRef.current = null;
    }
  }, []);

  const resetDocumentHistory = useCallback(() => {
    clearEditorEditGroup();
    clearDocumentHistory(documentHistoryRef.current);
  }, [clearEditorEditGroup]);

  const applyDocumentSessionState = useCallback((state: DocumentSessionState) => {
    visualRoundTripAcknowledgementKeyRef.current = null;
    setMarkdown(state.markdown);
    markdownRef.current = state.markdown;
    resetDocumentHistory();
    setLastSavedMarkdown(state.lastSavedMarkdown);
    activeFilePathRef.current = state.filePath;
    setFilePath(state.filePath);
    setFileMetadata(state.fileMetadata);
    setMode(state.mode);
    setAutosaveStatus(state.autosaveStatus);
    setLastAutosavedAt(state.lastAutosavedAt);
    setExternalConflict(state.externalConflict);
    setAuthorshipMarks(state.authorshipMarks);
  }, [resetDocumentHistory, setAuthorshipMarks]);

  const showDocumentOpenStatus = useCallback((path: string, phase: DocumentOpenPhase, options: { immediate?: boolean } = {}) => {
    if (documentOpenStatusClearTimerRef.current !== null) {
      window.clearTimeout(documentOpenStatusClearTimerRef.current);
      documentOpenStatusClearTimerRef.current = null;
    }
    if (documentOpenStatusShowTimerRef.current !== null) {
      window.clearTimeout(documentOpenStatusShowTimerRef.current);
      documentOpenStatusShowTimerRef.current = null;
    }
    const token = documentOpenStatusTokenRef.current + 1;
    documentOpenStatusTokenRef.current = token;

    const show = () => {
      if (documentOpenStatusTokenRef.current !== token) return;
      documentOpenStatusShowTimerRef.current = null;
      documentOpenStatusVisibleRef.current = true;
      setDocumentOpenStatus(createDocumentOpenStatus(path, phase));
    };

    if (options.immediate || documentOpenStatusVisibleRef.current) {
      show();
    } else {
      documentOpenStatusShowTimerRef.current = window.setTimeout(show, DOCUMENT_OPEN_STATUS_DELAY_MS);
    }
    return token;
  }, []);

  const clearDocumentOpenStatus = useCallback((token: number, delayMs = 0) => {
    const clear = () => {
      if (documentOpenStatusTokenRef.current === token) {
        if (documentOpenStatusShowTimerRef.current !== null) {
          window.clearTimeout(documentOpenStatusShowTimerRef.current);
          documentOpenStatusShowTimerRef.current = null;
        }
        documentOpenStatusVisibleRef.current = false;
        setDocumentOpenStatus(null);
      }
      if (documentOpenStatusClearTimerRef.current !== null) {
        window.clearTimeout(documentOpenStatusClearTimerRef.current);
        documentOpenStatusClearTimerRef.current = null;
      }
    };
    if (delayMs <= 0) {
      clear();
      return;
    }
    documentOpenStatusClearTimerRef.current = window.setTimeout(clear, delayMs);
  }, []);

  useEffect(() => () => {
    if (documentOpenStatusShowTimerRef.current !== null) {
      window.clearTimeout(documentOpenStatusShowTimerRef.current);
    }
    if (documentOpenStatusClearTimerRef.current !== null) {
      window.clearTimeout(documentOpenStatusClearTimerRef.current);
    }
  }, []);

  const commitMarkdownEdit = useCallback((action: SetStateAction<string>) => {
    clearEditorEditGroup();
    setMarkdown((current) => {
      const next = typeof action === 'function'
        ? (action as (value: string) => string)(current)
        : action;
      if (next === current) return current;
      recordDocumentEdit(documentHistoryRef.current, current);
      markdownRef.current = next;
      return next;
    });
  }, [clearEditorEditGroup]);

  const commitEditorMarkdownEdit = useCallback((next: string) => {
    setMarkdown((current) => {
      if (next === current) return current;
      if (editorEditGroupTimerRef.current === null) {
        recordDocumentEdit(documentHistoryRef.current, current);
      } else {
        window.clearTimeout(editorEditGroupTimerRef.current);
      }
      editorEditGroupTimerRef.current = window.setTimeout(() => {
        editorEditGroupTimerRef.current = null;
      }, 1000);
      markdownRef.current = next;
      return next;
    });
  }, []);

  const undoDocumentEdit = useCallback(() => {
    clearEditorEditGroup();
    const current = commitVisualEditorState(commitEditorMarkdownEdit) ?? markdownRef.current;
    markdownRef.current = current;
    const previous = undoDocumentHistory(documentHistoryRef.current, current);
    if (previous === null) return false;
    markdownRef.current = previous;
    setMarkdown(previous);
    return true;
  }, [clearEditorEditGroup, commitEditorMarkdownEdit]);

  const redoDocumentEdit = useCallback(() => {
    clearEditorEditGroup();
    const current = commitVisualEditorState(commitEditorMarkdownEdit) ?? markdownRef.current;
    markdownRef.current = current;
    const next = redoDocumentHistory(documentHistoryRef.current, current);
    if (next === null) return false;
    markdownRef.current = next;
    setMarkdown(next);
    return true;
  }, [clearEditorEditGroup, commitEditorMarkdownEdit]);

  const confirmVisualRoundTripWrite = useCallback(async (
    candidateMarkdown: string,
    request: VisualRoundTripWriteRequest,
  ) => {
    if (mode !== 'visual' && request.reason !== 'mode-switch-to-visual') return true;
    const issues = detectVisualRoundTripRisks(candidateMarkdown);
    if (issues.length === 0) return true;

    const acknowledgementKey = visualRoundTripRiskKey(issues.map((issue) => issue.message));
    if (visualRoundTripAcknowledgementKeyRef.current === acknowledgementKey) return true;
    if (request.autosave) return false;

    const preview = issues
      .slice(0, 3)
      .map((issue) => `- ${issue.message}`)
      .join('\n');
    const moreCount = issues.length - 3;
    const confirmed = await confirmText({
      title: 'Continue with visual formatting changes?',
      message: [
        'Visual mode will normalize some Markdown source formatting when this document is saved or opened visually.',
        '',
        preview,
        moreCount > 0 ? `- ${moreCount} more visual formatting warnings.` : '',
        '',
        'Continue for this session?',
      ].filter(Boolean).join('\n'),
      okLabel: 'Continue',
      cancelLabel: 'Cancel',
    });
    if (!confirmed) {
      pushToast('Visual formatting write canceled.', 'info');
      return false;
    }
    visualRoundTripAcknowledgementKeyRef.current = acknowledgementKey;
    return true;
  }, [confirmText, mode, pushToast]);

  useEffect(() => () => {
    clearEditorEditGroup();
  }, [clearEditorEditGroup]);

  useEffect(() => {
    const handleDraftStorageWarning = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      const message = detail?.message?.trim();
      if (!message || message === lastDraftWarningRef.current) return;
      lastDraftWarningRef.current = message;
      pushToast(message, 'warning');
    };
    window.addEventListener('scienfy:draft-storage-warning', handleDraftStorageWarning);
    return () => window.removeEventListener('scienfy:draft-storage-warning', handleDraftStorageWarning);
  }, [pushToast]);

  const restoreUntitledDraftIfAvailable = useCallback(async (isCancelled: () => boolean) => {
    if (untitledDraftRestoreAttemptedRef.current) return;
    untitledDraftRestoreAttemptedRef.current = true;
    const draft = await host.recovery.loadUntitledDraft();
    if (isCancelled() || !draft || draft.markdown === initialMarkdown) return;
    const restoreDecision = decideUntitledDraftRestore({
      draftMarkdown: draft.markdown,
      initialMarkdown,
      draftIsBundledWelcome: host.recovery.isBundledWelcomeMarkdown(draft.markdown),
      initialIsBundledWelcome: host.recovery.isBundledWelcomeMarkdown(initialMarkdown),
    });
    if (restoreDecision.action === 'skip') return;
    if (restoreDecision.action === 'clear-bundled-welcome') {
      void host.recovery.clearUntitledDraftAsync();
      return;
    }
    const restoreBaselinePath = activeFilePathRef.current;
    const restoreBaselineMarkdown = markdownRef.current;
    const shouldRestore = await confirmText({
      title: 'Restore unsaved draft?',
      message: 'An unsaved draft from the previous session was found. Restore it so it can be reviewed?',
      okLabel: 'Restore',
      cancelLabel: 'Discard',
    });
    if (isCancelled()) return;
    if (!shouldRestore) {
      void host.recovery.clearUntitledDraftAsync();
      pushToast('Previous unsaved draft discarded.', 'info');
      return;
    }
    if (activeFilePathRef.current !== restoreBaselinePath || markdownRef.current !== restoreBaselineMarkdown) {
      pushToast('Previous unsaved draft was kept because another document is now active.', 'warning');
      return;
    }

    onDocumentReplaced?.();
    const transition = buildUntitledDraftRestoreTransition(draft.markdown, initialMarkdown);
    applyDocumentSessionState(transition.state);
    pushToast(transition.toast.text, transition.toast.tone);
  }, [applyDocumentSessionState, confirmText, host, initialMarkdown, onDocumentReplaced, pushToast]);

  useEffect(() => {
    // Desktop startup owns draft restore after launch-path resolution settles.
    if (isTauriRuntime()) return undefined;
    if (draftRestoreCheckedRef.current) return undefined;
    draftRestoreCheckedRef.current = true;
    let cancelled = false;
    void (async () => {
      await restoreUntitledDraftIfAvailable(() => cancelled);
    })().catch((error) => {
      console.warn('Draft restore check failed.', error);
      if (!cancelled) pushToast('Could not check the previous unsaved draft.', 'warning');
    });

    return () => {
      cancelled = true;
    };
  }, [pushToast, restoreUntitledDraftIfAvailable]);

  useEffect(() => {
    if (filePath) {
      void host.recovery.clearUntitledDraftAsync();
      if (markdown === lastSavedMarkdown) {
        void host.recovery.clearFileDraftAsync(filePath);
        return undefined;
      }
      const timer = window.setTimeout(() => {
        void host.recovery.saveFileDraftAsync(filePath, markdown, Date.now(), fileMetadata);
      }, 600);
      return () => window.clearTimeout(timer);
    }
    if (!host.recovery.shouldPersistUntitledDraft(markdown, initialMarkdown, { suppressBundledWelcome: true })) {
      void host.recovery.clearUntitledDraftAsync();
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void host.recovery.saveUntitledDraftAsync(markdown);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [fileMetadata, filePath, host, initialMarkdown, lastSavedMarkdown, markdown]);

  useEffect(() => {
    const flushRecoveryDraft = () => {
      const currentMarkdown = readVisualEditorState()?.markdown ?? markdownRef.current;
      markdownRef.current = currentMarkdown;
      if (filePath) {
        if (currentMarkdown === lastSavedMarkdown) {
          void host.recovery.clearFileDraftAsync(filePath);
        } else {
          void host.recovery.saveFileDraftAsync(filePath, currentMarkdown, Date.now(), fileMetadata);
        }
        return;
      }
      if (host.recovery.shouldPersistUntitledDraft(currentMarkdown, initialMarkdown, { suppressBundledWelcome: true })) {
        void host.recovery.saveUntitledDraftAsync(currentMarkdown);
      } else {
        void host.recovery.clearUntitledDraftAsync();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushRecoveryDraft();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', flushRecoveryDraft);
    window.addEventListener('beforeunload', flushRecoveryDraft);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', flushRecoveryDraft);
      window.removeEventListener('beforeunload', flushRecoveryDraft);
    };
  }, [fileMetadata, filePath, host, initialMarkdown, lastSavedMarkdown]);

  const { saveCurrent, ensureDocumentPathForAssets, resetBackupSession, saveQueueDepth } = useSaveOperations({
    filePath,
    fileMetadata,
    markdown,
    getDocumentIdentityVersion: () => documentIdentityVersionRef.current,
    setFilePath,
    setFileMetadata,
    setLastSavedMarkdown,
    setAutosaveStatus,
    setLastAutosavedAt,
    setExternalConflict,
    setSettings,
    commitMarkdownEdit: commitEditorMarkdownEdit,
    confirmVisualRoundTripWrite,
    confirmText,
    pushToast,
    host,
  });

  const commitOpenedDocument = useCallback((
    path: string | null,
    content: string,
    metadata: FileMetadata,
    preferredMode?: EditorMode,
    savedMarkdown = content,
    options: CommitOpenedDocumentOptions = {},
  ) => {
    openRequestIdRef.current += 1;
    documentIdentityVersionRef.current += 1;
    if (!options.preserveStartupOpenFailure) {
      setStartupDocumentOpenFailure(null);
    }
    const parsedDocument = metadata.lastKnownSizeBytes > SOURCE_ONLY_FILE_BYTES
      ? undefined
      : safeParseScienfyDocument(content);
    validateNow(content, metadata.lastKnownSizeBytes, parsedDocument);
    onDocumentReplaced?.();
    const transition = buildOpenedDocumentTransition({
      path,
      content,
      metadata,
      preferredMode,
      savedMarkdown,
      parsedDocument: parsedDocument
        ? {
            visualStyle: parsedDocument.visualStyle,
            documentType: parsedDocument.documentType,
          }
        : null,
      normalizeVisualStyle: normalizeVisualStyleId,
    });
    applyDocumentSessionState(transition.state);
    resetBackupSession();
    if (transition.recentFilePath) onOpenedFilePath?.(transition.recentFilePath);

    if (transition.recentFilePath) {
      const recentSettings = host.settings.rememberRecentFile(transition.recentFilePath);
      setSettings(Object.keys(transition.settingsPatch).length > 0
        ? host.settings.updateSettings({ ...recentSettings, ...transition.settingsPatch })
        : recentSettings);
    } else if (Object.keys(transition.settingsPatch).length > 0) {
      setSettings(host.settings.updateSettings(transition.settingsPatch));
    }
  }, [applyDocumentSessionState, host, onDocumentReplaced, onOpenedFilePath, resetBackupSession, setSettings, validateNow]);

  const recordStartupOpenFailure = useCallback((
    kind: StartupOpenFailureKind,
    path: string | null,
    error?: unknown,
  ) => {
    const failure = createStartupOpenFailure({ kind, path, error });
    setStartupDocumentOpenFailure(failure);
    recordDocumentOpenDiagnostic(
      host.recovery,
      startupOpenDiagnosticEvent(kind),
      failure.detail ? `${failure.message} ${failure.detail}` : failure.message,
      failure.path,
    );
    return failure;
  }, [host.recovery]);

  const recordStartupFallbackCommitted = useCallback((markdownForFallback: string) => {
    recordDocumentOpenDiagnostic(
      host.recovery,
      'startup-open-fallback-committed',
      startupDocumentOpenFailure
        ? 'Startup open fallback document committed after a launch failure.'
        : 'Startup fallback document committed after no startup document was provided.',
      startupDocumentOpenFailure?.path ?? null,
      markdownForFallback,
    );
  }, [host.recovery, startupDocumentOpenFailure]);

  const adoptReviewedDiskMerge = useCallback((content: string, diskContent: string, diskMetadata: FileMetadata) => {
    const parsedDocument = safeParseScienfyDocument(content);
    validateNow(content, diskMetadata.lastKnownSizeBytes, parsedDocument);
    const transition = buildReviewedDiskMergeTransition(content, diskContent, diskMetadata);
    setMarkdown(transition.state.markdown);
    markdownRef.current = transition.state.markdown;
    resetDocumentHistory();
    setLastSavedMarkdown(transition.state.lastSavedMarkdown);
    setFileMetadata(transition.state.fileMetadata);
    setAutosaveStatus(transition.state.autosaveStatus);
    setLastAutosavedAt(transition.state.lastAutosavedAt);
    setExternalConflict(transition.state.externalConflict);
  }, [validateNow]);

  const confirmDiscardDirty = useCallback(async () => {
    if (!dirty) return true;
    return confirmText({
      title: 'Discard unsaved changes?',
      message: 'This document has unsaved changes. Discard them and continue?',
      okLabel: 'Discard',
      cancelLabel: 'Cancel',
    });
  }, [confirmText, dirty]);

  const markExternalConflict = useCallback(() => {
    setAutosaveStatus('conflict');
    setExternalConflict(true);
  }, []);

  const adoptSameContentExternalChange = useCallback((path: string, content: string, metadata: FileMetadata) => {
    if (activeFilePathRef.current !== path) return;
    const visualState = readVisualEditorState();
    const currentMarkdown = visualState?.markdown ?? markdownRef.current;
    if (currentMarkdown !== content) return;
    const committedMarkdown = commitVisualEditorReadResult(visualState, commitEditorMarkdownEdit);
    markdownRef.current = committedMarkdown ?? content;
    setMarkdown((current) => current === content ? current : content);
    setLastSavedMarkdown(content);
    setFileMetadata(metadata);
    setAutosaveStatus('saved');
    setLastAutosavedAt(null);
    setExternalConflict(false);
  }, [commitEditorMarkdownEdit]);

  const getCurrentMarkdownForDiskCheck = useCallback(() => (
    readVisualEditorState()?.markdown ?? markdownRef.current
  ), []);

  useExternalChangeDetection({
    filePath,
    fileMetadata,
    getCurrentMarkdown: getCurrentMarkdownForDiskCheck,
    onConflict: markExternalConflict,
    onSyncedExternalChange: adoptSameContentExternalChange,
    onCloudPlaceholder: (message) => pushToast(message, 'warning'),
    host,
  });

  const { cancelAutosave, flushAutosave, resumeAutosave } = useAutosaveTimer({
    filePath,
    markdown,
    dirty,
    externalConflict,
    autosaveBlocked,
    saveCurrent,
    setAutosaveStatus,
  });

  const { closeDialogOpen, setCloseDialogOpen, closeWindow } = useWindowCloseGuard({
    dirty,
    onCloseRequested: cancelAutosave,
  });

  const settleDirtyDocumentBeforeReplace = useCallback(async () => {
    const step = nextDirtyReplacementStep({ dirty, filePath, externalConflict, autosaveBlocked });
    if (step === 'continue') return true;
    if (step === 'flush-autosave') {
      const saved = await flushAutosave();
      if (saved) return true;
    }
    return confirmDiscardDirty();
  }, [autosaveBlocked, confirmDiscardDirty, dirty, externalConflict, filePath, flushAutosave]);

  const preserveDirtyDraftBeforeExternalOpen = useCallback(() => {
    if (!dirty) return;
    const currentMarkdown = readVisualEditorState()?.markdown ?? markdownRef.current;
    markdownRef.current = currentMarkdown;
    if (filePath) {
      host.recovery.saveFileDraft(filePath, currentMarkdown, Date.now(), fileMetadata);
      return;
    }
    if (host.recovery.shouldPersistUntitledDraft(currentMarkdown, initialMarkdown, { suppressBundledWelcome: true })) {
      host.recovery.saveUntitledDraft(currentMarkdown);
    }
  }, [dirty, fileMetadata, filePath, host, initialMarkdown]);

  const handleCloseCancel = useCallback(() => {
    setCloseDialogOpen(false);
    resumeAutosave();
  }, [resumeAutosave, setCloseDialogOpen]);

  const handleOpen = useCallback(async (explicitPath?: string, options: OpenDocumentOptions = {}) => {
    const requestId = openRequestIdRef.current + 1;
    openRequestIdRef.current = requestId;
    return openDocumentForSession({
      explicitPath,
      options,
      host,
      confirmText,
      pushToast,
      setSettings,
      isLatestOpenRequest: () => openRequestIdRef.current === requestId,
      isExternalLaunchDocumentCurrent: (path) => activeFilePathRef.current === path,
      getCurrentMarkdown: () => markdownRef.current,
      settleDirtyDocumentBeforeReplace,
      preserveDirtyDraftBeforeExternalOpen,
      showDocumentOpenStatus,
      clearDocumentOpenStatus,
      commitOpenedDocument,
    });
  }, [clearDocumentOpenStatus, commitOpenedDocument, confirmText, host, preserveDirtyDraftBeforeExternalOpen, pushToast, setSettings, settleDirtyDocumentBeforeReplace, showDocumentOpenStatus]);

  const handleExternalOpen = useCallback(async (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return false;
    return handleOpen(trimmed, { preferredMode: 'visual', externalLaunch: true, draftRestore: 'auto' });
  }, [handleOpen]);

  const openLaunchPathAndClear = useCallback(async (
    path: string,
    options: { markStartupFailure?: boolean } = {},
  ) => {
    const trimmed = path.trim();
    if (!trimmed) return false;
    const launchDecision = decideLaunchDuplicate({
      requestedPath: trimmed,
      activePath: activeFilePathRef.current,
      inFlightPathKeys: launchOpenInFlightKeysRef.current,
      lastLaunchOpen: lastLaunchOpenRef.current,
      nowMs: Date.now(),
      duplicateWindowMs: LAUNCH_DUPLICATE_SUPPRESSION_MS,
    });
    if (launchDecision.duplicate) {
      recordDocumentOpenDiagnostic(
        host.recovery,
        'document-open-duplicate-skipped',
        launchDecision.diagnosticMessage,
        launchDecision.path,
      );
      await host.launch.clearPendingMarkdownOpen(launchDecision.path).catch((error) => {
        console.warn('Could not clear pending document-open event.', error);
      });
      return true;
    }
    try {
      launchOpenInFlightKeysRef.current.add(launchDecision.pathKey);
      const opened = await handleExternalOpen(launchDecision.path);
      if (opened) {
        lastLaunchOpenRef.current = { path: launchDecision.path, pathKey: launchDecision.pathKey, openedAt: Date.now() };
        await host.launch.clearPendingMarkdownOpen(launchDecision.path).catch((error) => {
          console.warn('Could not clear pending document-open event.', error);
        });
      } else if (options.markStartupFailure) {
        recordStartupOpenFailure('open-failed', launchDecision.path);
      }
      return opened;
    } catch (error) {
      console.warn('Document launch open failed.', error);
      if (options.markStartupFailure) recordStartupOpenFailure('open-failed', launchDecision.path, error);
      pushToast('Could not open the requested document.', 'error');
      return false;
    } finally {
      launchOpenInFlightKeysRef.current.delete(launchDecision.pathKey);
    }
  }, [handleExternalOpen, host, pushToast, recordStartupOpenFailure]);

  const drainPendingLaunchPath = useCallback(async () => {
    if (pendingLaunchDrainInFlightRef.current) return false;
    pendingLaunchDrainInFlightRef.current = true;
    try {
      const pendingPath = await host.launch.peekPendingMarkdownOpen();
      if (!pendingPath?.trim()) return false;
      return openLaunchPathAndClear(pendingPath);
    } catch (error) {
      console.warn('Could not check for pending document-open events.', error);
      return false;
    } finally {
      pendingLaunchDrainInFlightRef.current = false;
    }
  }, [host, openLaunchPathAndClear]);

  const handleReloadFromDisk = useCallback(async () => {
    if (!filePath) return false;
    if (dirty) {
      const reload = await confirmText({
        title: 'Reload disk version?',
        message: 'Reloading discards unsaved local edits in the editor. Recovery drafts are kept until the disk version opens successfully.',
        okLabel: 'Reload',
        cancelLabel: 'Cancel',
      });
      if (!reload) return false;
    }
    return handleOpen(filePath, {
      preferredMode: mode,
      draftRestore: 'skip',
      skipDirtySettlement: true,
    });
  }, [confirmText, dirty, filePath, handleOpen, mode]);

  useEffect(() => {
    if (!isTauriRuntime() || initialOpenCheckedRef.current) return undefined;
    initialOpenCheckedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        setStartupDocumentOpenFailure(null);
        const path = await withTimeout(
          host.launch.getInitialMarkdownPath(),
          STARTUP_PATH_TIMEOUT_MS,
          'Startup document path lookup took too long.',
        );
        if (cancelled) return;
        if (!path?.trim()) {
          recordDocumentOpenDiagnostic(
            host.recovery,
            'startup-open-no-path',
            'No startup document path was provided.',
          );
          await restoreUntitledDraftIfAvailable(() => cancelled);
          return;
        }
        setStartupDocumentOpenPending(true);
        const opened = await openLaunchPathAndClear(path, { markStartupFailure: true });
        if (!opened) {
          if (!cancelled) {
            await restoreUntitledDraftIfAvailable(() => cancelled);
          }
          return;
        }
        if (!cancelled && !activeFilePathRef.current && markdownRef.current === initialMarkdown) {
          await restoreUntitledDraftIfAvailable(() => cancelled);
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          recordStartupOpenFailure('path-lookup-failed', null, error);
          pushToast('Could not open the startup document.', 'error');
          await restoreUntitledDraftIfAvailable(() => cancelled);
        }
      } finally {
        startupDocumentOpenSettledRef.current = true;
        if (!cancelled) {
          setStartupDocumentOpenPending(false);
          if (singleInstanceListenerReadyRef.current) {
            void drainPendingLaunchPath();
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void host.launch.listenSingleInstanceOpen((path) => {
      if (!path.trim()) return;
      void openLaunchPathAndClear(path);
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
      singleInstanceListenerReadyRef.current = true;
      if (startupDocumentOpenSettledRef.current) {
        void drainPendingLaunchPath();
      }
    }).catch((error) => {
      console.warn('Single-instance open listener could not be registered.', error);
    });
    return () => {
      disposed = true;
      singleInstanceListenerReadyRef.current = false;
      unlisten?.();
    };
  }, [drainPendingLaunchPath, host, openLaunchPathAndClear]);

  const retryStartupDocumentOpen = useCallback(async () => {
    const failure = startupDocumentOpenFailure;
    if (!failure) return false;
    recordDocumentOpenDiagnostic(
      host.recovery,
      'startup-open-retry-requested',
      failure.path
        ? 'Retry requested for failed startup document.'
        : 'Retry requested for startup document path lookup.',
      failure.path,
    );
    setStartupDocumentOpenPending(true);
    setStartupDocumentOpenFailure(null);
    try {
      if (failure.path?.trim()) {
        const opened = await openLaunchPathAndClear(failure.path, { markStartupFailure: true });
        if (!opened) await restoreUntitledDraftIfAvailable(() => false);
        return opened;
      }
      const path = await withTimeout(
        host.launch.getInitialMarkdownPath(),
        STARTUP_PATH_TIMEOUT_MS,
        'Startup document path lookup took too long.',
      );
      if (!path?.trim()) {
        recordDocumentOpenDiagnostic(
          host.recovery,
          'startup-open-no-path',
          'No startup document path was provided during retry.',
        );
        await restoreUntitledDraftIfAvailable(() => false);
        return false;
      }
      const opened = await openLaunchPathAndClear(path, { markStartupFailure: true });
      if (!opened) await restoreUntitledDraftIfAvailable(() => false);
      return opened;
    } catch (error) {
      recordStartupOpenFailure('path-lookup-failed', null, error);
      pushToast('Could not open the startup document.', 'error');
      await restoreUntitledDraftIfAvailable(() => false);
      return false;
    } finally {
      setStartupDocumentOpenPending(false);
    }
  }, [host, openLaunchPathAndClear, pushToast, recordStartupOpenFailure, restoreUntitledDraftIfAvailable, startupDocumentOpenFailure]);

  const openStartupDocumentFallbackPicker = useCallback(async () => {
    recordDocumentOpenDiagnostic(
      host.recovery,
      'startup-open-picker-requested',
      'Open-file action requested from the startup failure banner.',
      startupDocumentOpenFailure?.path ?? null,
    );
    return handleOpen(undefined, { preferredMode: 'visual' });
  }, [handleOpen, host.recovery, startupDocumentOpenFailure]);

  const dismissStartupDocumentOpenFailure = useCallback(() => {
    recordDocumentOpenDiagnostic(
      host.recovery,
      'startup-open-failure-dismissed',
      'Startup failure banner dismissed.',
      startupDocumentOpenFailure?.path ?? null,
    );
    setStartupDocumentOpenFailure(null);
  }, [host.recovery, startupDocumentOpenFailure]);

  const handleNew = useCallback(async () => {
    try {
      openRequestIdRef.current += 1;
      if (!(await settleDirtyDocumentBeforeReplace())) return;
      commitOpenedDocument(null, '', DEFAULT_METADATA, 'visual');
    } catch (error) {
      console.warn('New document command failed.', error);
      pushToast(error instanceof Error ? error.message : 'Could not create a new document.', 'error');
    }
  }, [commitOpenedDocument, pushToast, settleDirtyDocumentBeforeReplace]);

  const handleNewFromTemplate = useCallback(async (template: ScienfyTemplateId) => {
    try {
      openRequestIdRef.current += 1;
      if (!(await settleDirtyDocumentBeforeReplace())) return;
      const content = createScienfyTemplate(template);
      commitOpenedDocument(null, content, DEFAULT_METADATA);
      pushToast('Layer II template created', 'success');
    } catch (error) {
      console.warn('New document from template command failed.', error);
      pushToast(error instanceof Error ? error.message : 'Could not create a document from this template.', 'error');
    }
  }, [commitOpenedDocument, pushToast, settleDirtyDocumentBeforeReplace]);

  const handleCloseSave = useCallback(async () => {
    try {
      const saved = filePath && !externalConflict && !autosaveBlocked ? await flushAutosave() : await saveCurrent();
      if (!saved) return;
      setCloseDialogOpen(false);
      await closeWindow();
    } catch (error) {
      console.warn('Save and close command failed.', error);
      pushToast(error instanceof Error ? error.message : 'Could not close the window after saving.', 'error');
    }
  }, [autosaveBlocked, closeWindow, externalConflict, filePath, flushAutosave, pushToast, saveCurrent, setCloseDialogOpen]);

  const handleCloseDiscard = useCallback(async () => {
    try {
      await closeWindow();
      if (filePath) {
        void host.recovery.clearFileDraftAsync(filePath);
      } else {
        void host.recovery.clearUntitledDraftAsync();
      }
      setCloseDialogOpen(false);
    } catch (error) {
      console.warn('Discard and close command failed.', error);
      pushToast(error instanceof Error ? error.message : 'Could not close the window.', 'error');
    }
  }, [closeWindow, filePath, host, pushToast, setCloseDialogOpen]);

  return {
    markdown,
    setMarkdown,
    commitMarkdownEdit,
    commitEditorMarkdownEdit,
    undoDocumentEdit,
    redoDocumentEdit,
    lastSavedMarkdown,
    filePath,
    fileMetadata,
    mode,
    setMode,
    autosaveStatus,
    lastAutosavedAt,
    saveQueueDepth,
    startupDocumentOpenPending,
    startupDocumentOpenFailed,
    startupDocumentOpenFailure,
    documentOpenStatus,
    externalConflict,
    dirty,
    validation,
    validateNow,
    layerTwoDocument,
    bibliographyLoading,
    documentParsingPending,
    validationPending,
    linkedVariableLoading,
    reloadBibliography,
    closeDialogOpen,
    setCloseDialogOpen,
    closeWindow,
    cancelAutosave,
    resumeAutosave,
    saveCurrent,
    confirmVisualRoundTripWrite,
    ensureDocumentPathForAssets,
    settleDirtyDocumentBeforeReplace,
    commitOpenedDocument,
    adoptReviewedDiskMerge,
    handleOpen,
    handleReloadFromDisk,
    handleNew,
    handleNewFromTemplate,
    retryStartupDocumentOpen,
    openStartupDocumentFallbackPicker,
    dismissStartupDocumentOpenFailure,
    recordStartupFallbackCommitted,
    handleCloseSave,
    handleCloseDiscard,
    handleCloseCancel,
  };
}

function visualRoundTripRiskKey(messages: string[]): string {
  return messages.join('\n');
}
