import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { AutosaveStatus, EditorMode, FileMetadata } from '../documentState';
import { DEFAULT_METADATA, isDirty } from '../documentState';
import { createDocumentOpenStatus } from '../documentOpenStatus';
import type { DocumentOpenPhase, DocumentOpenStatus } from '../documentOpenStatus';
import { useAutosaveTimer } from './useAutosaveTimer';
import { useDocumentValidator } from './useDocumentValidator';
import { useExternalChangeDetection } from './useExternalChangeDetection';
import { useLayerTwoDocument } from './useLayerTwoDocument';
import { useSaveOperations } from './useSaveOperations';
import { useWindowCloseGuard } from './useWindowCloseGuard';
import {
  clearPendingMarkdownOpen,
  getInitialMarkdownPath,
  peekPendingMarkdownOpen,
  pickMarkdownFile,
  readTextFile,
} from '../../services/fileService';
import { appendDiagnosticsEvent } from '../../services/nativeRecoveryService';
import {
  clearFileDraft,
  clearUntitledDraft,
  isBundledWelcomeMarkdown,
  loadFileDraftAsync,
  loadUntitledDraftAsync,
  saveFileDraft,
  saveUntitledDraft,
  shouldOfferFileDraftRestore,
  shouldPersistUntitledDraft,
} from '../../services/draftRecoveryService';
import { forgetRecentFile, rememberRecentFile, updateSettings } from '../../services/settingsService';
import type { DocumentType, PersistedSettings } from '../../services/settingsService';
import { normalizeVisualStyleId } from '../../services/visualStyleService';
import type { VisualStyleId } from '../../services/visualStyleService';
import { createScienfyTemplate } from '../../domain/document/templates';
import type { ScienfyTemplateId } from '../../domain/document/templates';
import { safeParseScienfyDocument } from '../../domain/document/documentModel';
import type { AuthorshipMark } from '../../markdown/authorship';
import { SOURCE_ONLY_FILE_BYTES } from '../../markdown/supportedMarkdown';
import { flushVisualEditorState } from '../../components/visualEditorStateSync';
import {
  createDocumentHistory,
  recordDocumentEdit,
  redoDocumentHistory,
  resetDocumentHistory as clearDocumentHistory,
  undoDocumentHistory,
} from '../../markdown/documentHistory';
import type { ConfirmState } from './useDialogs';
import { isTauriRuntime } from '../runtime';

interface DocumentSessionParams {
  initialMarkdown: string;
  setSettings: Dispatch<SetStateAction<PersistedSettings>>;
  setAuthorshipMarks: Dispatch<SetStateAction<AuthorshipMark[]>>;
  onDocumentReplaced?: () => void;
  onOpenedFilePath?: (path: string) => void;
  confirmText: (state: ConfirmState) => Promise<boolean>;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}

interface OpenDocumentOptions {
  preferredMode?: EditorMode;
  externalLaunch?: boolean;
  draftRestore?: 'prompt' | 'auto' | 'skip';
  skipDirtySettlement?: boolean;
}

const DOCUMENT_OPEN_STATUS_DELAY_MS = 650;
const IMMEDIATE_PREPARING_OVERLAY_BYTES = 512 * 1024;
const STARTUP_PATH_TIMEOUT_MS = 5_000;
const FILE_READ_TIMEOUT_MS = 20_000;
const DRAFT_RESTORE_TIMEOUT_MS = 1_500;
const LAUNCH_DUPLICATE_SUPPRESSION_MS = 3_000;

export function useDocumentSession({
  initialMarkdown,
  setSettings,
  setAuthorshipMarks,
  onDocumentReplaced,
  onOpenedFilePath,
  confirmText,
  pushToast,
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
  const [startupDocumentOpenFailed, setStartupDocumentOpenFailed] = useState(false);
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

  const {
    document: layerTwoDocument,
    parsedMarkdown,
    bibliographyLoading,
    reloadBibliography,
  } = useLayerTwoDocument(markdown, filePath);
  const { validation, validateNow } = useDocumentValidator(markdown, layerTwoDocument, parsedMarkdown);
  const dirty = isDirty(markdown, lastSavedMarkdown);
  const autosaveBlocked = false;

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
    const current = flushVisualEditorState() ?? markdownRef.current;
    markdownRef.current = current;
    const previous = undoDocumentHistory(documentHistoryRef.current, current);
    if (previous === null) return false;
    markdownRef.current = previous;
    setMarkdown(previous);
    return true;
  }, [clearEditorEditGroup]);

  const redoDocumentEdit = useCallback(() => {
    clearEditorEditGroup();
    const current = flushVisualEditorState() ?? markdownRef.current;
    markdownRef.current = current;
    const next = redoDocumentHistory(documentHistoryRef.current, current);
    if (next === null) return false;
    markdownRef.current = next;
    setMarkdown(next);
    return true;
  }, [clearEditorEditGroup]);

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
      const draft = await loadUntitledDraftAsync();
    if (isCancelled() || !draft || draft.markdown === initialMarkdown) return;
      if (isBundledWelcomeMarkdown(draft.markdown) && isBundledWelcomeMarkdown(initialMarkdown)) {
        clearUntitledDraft();
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
        clearUntitledDraft();
        pushToast('Previous unsaved draft discarded.', 'info');
        return;
      }
      if (activeFilePathRef.current !== restoreBaselinePath || markdownRef.current !== restoreBaselineMarkdown) {
        pushToast('Previous unsaved draft was kept because another document is now active.', 'warning');
        return;
      }

      onDocumentReplaced?.();
      setMarkdown(draft.markdown);
      markdownRef.current = draft.markdown;
      resetDocumentHistory();
      setLastSavedMarkdown(initialMarkdown);
      setFilePath(null);
      setFileMetadata(DEFAULT_METADATA);
      setMode('visual');
      setAutosaveStatus('idle');
      setLastAutosavedAt(null);
      setExternalConflict(false);
      setAuthorshipMarks([]);
      pushToast('Restored unsaved draft.', 'warning');
  }, [confirmText, initialMarkdown, onDocumentReplaced, pushToast, resetDocumentHistory, setAuthorshipMarks]);

  useEffect(() => {
    if (draftRestoreCheckedRef.current) return undefined;
    draftRestoreCheckedRef.current = true;
    if (isTauriRuntime()) return undefined;

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
      clearUntitledDraft();
      if (markdown === lastSavedMarkdown) {
        clearFileDraft(filePath);
        return undefined;
      }
      const timer = window.setTimeout(() => {
        saveFileDraft(filePath, markdown, Date.now(), fileMetadata);
      }, 600);
      return () => window.clearTimeout(timer);
    }
    if (!shouldPersistUntitledDraft(markdown, initialMarkdown, { suppressBundledWelcome: true })) {
      clearUntitledDraft();
      return undefined;
    }
    const timer = window.setTimeout(() => {
      saveUntitledDraft(markdown);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [fileMetadata, filePath, initialMarkdown, lastSavedMarkdown, markdown]);

  useEffect(() => {
    const flushRecoveryDraft = () => {
      const currentMarkdown = flushVisualEditorState() ?? markdownRef.current;
      markdownRef.current = currentMarkdown;
      if (filePath) {
        if (currentMarkdown === lastSavedMarkdown) {
          clearFileDraft(filePath);
        } else {
          saveFileDraft(filePath, currentMarkdown, Date.now(), fileMetadata);
        }
        return;
      }
      if (shouldPersistUntitledDraft(currentMarkdown, initialMarkdown, { suppressBundledWelcome: true })) {
        saveUntitledDraft(currentMarkdown);
      } else {
        clearUntitledDraft();
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
  }, [fileMetadata, filePath, initialMarkdown, lastSavedMarkdown]);

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
    confirmText,
    pushToast,
  });

  const commitOpenedDocument = useCallback((path: string | null, content: string, metadata: FileMetadata, preferredMode?: EditorMode, savedMarkdown = content) => {
    openRequestIdRef.current += 1;
    documentIdentityVersionRef.current += 1;
    const parsedDocument = metadata.lastKnownSizeBytes > SOURCE_ONLY_FILE_BYTES
      ? undefined
      : safeParseScienfyDocument(content);
    validateNow(content, metadata.lastKnownSizeBytes, parsedDocument);
    onDocumentReplaced?.();
    setMarkdown(content);
    markdownRef.current = content;
    resetDocumentHistory();
    setLastSavedMarkdown(savedMarkdown);
    activeFilePathRef.current = path;
    setFilePath(path);
    setFileMetadata(metadata);
    setMode(openedDocumentMode(metadata, preferredMode));
    setAutosaveStatus(path ? 'saved' : 'idle');
    setLastAutosavedAt(null);
    setExternalConflict(false);
    setAuthorshipMarks([]);
    resetBackupSession();
    if (path) onOpenedFilePath?.(path);

    const settingsPatch: Partial<{ visualStyle: VisualStyleId; documentType: DocumentType }> = {};
    if (parsedDocument) {
      const parsedVisualStyle = normalizeVisualStyleId(parsedDocument.visualStyle);
      if (parsedVisualStyle) settingsPatch.visualStyle = parsedVisualStyle;
      const documentType = settingsDocumentTypeFor(parsedDocument.documentType);
      if (documentType) settingsPatch.documentType = documentType;
    }
    if (path) {
      const recentSettings = rememberRecentFile(path);
      setSettings(Object.keys(settingsPatch).length > 0
        ? updateSettings({ ...recentSettings, ...settingsPatch })
        : recentSettings);
    } else if (Object.keys(settingsPatch).length > 0) {
      setSettings(updateSettings(settingsPatch));
    }
  }, [onDocumentReplaced, onOpenedFilePath, resetBackupSession, setAuthorshipMarks, setSettings, validateNow]);

  const adoptReviewedDiskMerge = useCallback((content: string, diskContent: string, diskMetadata: FileMetadata) => {
    const parsedDocument = safeParseScienfyDocument(content);
    validateNow(content, diskMetadata.lastKnownSizeBytes, parsedDocument);
    setMarkdown(content);
    markdownRef.current = content;
    resetDocumentHistory();
    setLastSavedMarkdown(diskContent);
    setFileMetadata(diskMetadata);
    setAutosaveStatus(content === diskContent ? 'saved' : 'pending');
    setLastAutosavedAt(null);
    setExternalConflict(false);
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

  const getCurrentMarkdownForDiskCheck = useCallback(() => (
    flushVisualEditorState() ?? markdownRef.current
  ), []);

  useExternalChangeDetection({
    filePath,
    fileMetadata,
    getCurrentMarkdown: getCurrentMarkdownForDiskCheck,
    onConflict: markExternalConflict,
    onCloudPlaceholder: (message) => pushToast(message, 'warning'),
  });

  const { cancelAutosave, flushAutosave } = useAutosaveTimer({
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
    if (!dirty) return true;
    if (filePath && !externalConflict && !autosaveBlocked) {
      const saved = await flushAutosave();
      if (saved) return true;
    }
    return confirmDiscardDirty();
  }, [autosaveBlocked, confirmDiscardDirty, dirty, externalConflict, filePath, flushAutosave]);

  const preserveDirtyDraftBeforeExternalOpen = useCallback(() => {
    if (!dirty) return;
    const currentMarkdown = flushVisualEditorState() ?? markdownRef.current;
    markdownRef.current = currentMarkdown;
    if (filePath) {
      saveFileDraft(filePath, currentMarkdown, Date.now(), fileMetadata);
      return;
    }
    if (shouldPersistUntitledDraft(currentMarkdown, initialMarkdown, { suppressBundledWelcome: true })) {
      saveUntitledDraft(currentMarkdown);
    }
  }, [dirty, fileMetadata, filePath, initialMarkdown]);

  const handleOpen = useCallback(async (explicitPath?: string, options: OpenDocumentOptions = {}) => {
    const requestId = openRequestIdRef.current + 1;
    openRequestIdRef.current = requestId;
    const isLatestOpenRequest = () => openRequestIdRef.current === requestId;
    let selectedPath = explicitPath ?? null;
    let openStatusToken: number | null = null;
    let committedDocument = false;
    const showOpeningPhase = (phase: DocumentOpenPhase, options: { immediate?: boolean } = {}) => {
      if (!selectedPath || !isLatestOpenRequest()) return;
      openStatusToken = showDocumentOpenStatus(selectedPath, phase, options);
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
        if (!(await settleDirtyDocumentBeforeReplace())) {
          return false;
        }
      } else if (!(await settleDirtyDocumentBeforeReplace())) {
        return false;
      }
      if (!isLatestOpenRequest()) return false;
      selectedPath = explicitPath ?? (await pickMarkdownFile());
      if (!selectedPath) return false;
      if (!isLatestOpenRequest()) return false;
      recordDocumentOpenDiagnostic('document-open-selected', 'Document open path selected.', selectedPath);
      showOpeningPhase('reading');
      const response = await withTimeout(
        readTextFile(selectedPath),
        FILE_READ_TIMEOUT_MS,
        `Reading ${displayNameForPath(selectedPath)} took too long.`,
      );
      recordDocumentOpenDiagnostic(
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
          'document-open-committed',
          'External launch document committed before draft recovery.',
          selectedPath,
          response.content,
        );
        if (options.draftRestore !== 'skip') {
          void restoreExternalLaunchDraftAfterCommit(
            selectedPath,
            response,
            options.preferredMode,
            () => activeFilePathRef.current === selectedPath,
          );
        }
        return true;
      }
      const draft = options.draftRestore === 'skip'
        ? null
        : await loadFileDraftWithTimeout(selectedPath);
      if (!isLatestOpenRequest()) return false;
      if (draft && draft.markdown !== response.content && shouldOfferFileDraftRestore(draft, response.metadata)) {
        if (options.draftRestore === 'auto') {
          showOpeningPhase('restoring', { immediate: true });
          if (!isLatestOpenRequest()) return false;
          commitOpenedDocument(selectedPath, draft.markdown, response.metadata, options.preferredMode, response.content);
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
          commitOpenedDocument(selectedPath, draft.markdown, response.metadata, options.preferredMode ?? 'visual', response.content);
          committedDocument = true;
          pushToast('Restored unsaved file draft.', 'warning');
          return true;
        }
        clearFileDraft(selectedPath);
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
        setSettings(forgetRecentFile(selectedPath));
      }
      pushToast(/File access denied/i.test(message) ? 'Use Open or Files to grant access to this document again.' : message || 'Open failed.', 'error');
      return false;
    } finally {
      clearOpeningStatus(committedDocument ? 220 : 0);
    }
  }, [clearDocumentOpenStatus, commitOpenedDocument, confirmText, preserveDirtyDraftBeforeExternalOpen, pushToast, setSettings, settleDirtyDocumentBeforeReplace, showDocumentOpenStatus]);

  const restoreExternalLaunchDraftAfterCommit = useCallback(async (
    path: string,
    response: Awaited<ReturnType<typeof readTextFile>>,
    preferredMode: EditorMode | undefined,
    isStillCurrentDocument: () => boolean,
  ) => {
    recordDocumentOpenDiagnostic('document-open-draft-check-start', 'Checking launch document recovery draft.', path);
    const draft = await loadFileDraftWithTimeout(path);
    if (!isStillCurrentDocument()) return;
    if (draft && draft.markdown !== response.content && shouldOfferFileDraftRestore(draft, response.metadata)) {
      commitOpenedDocument(path, draft.markdown, response.metadata, preferredMode, response.content);
      recordDocumentOpenDiagnostic(
        'document-open-draft-restored',
        'Launch document recovery draft restored after disk document opened.',
        path,
        draft.markdown,
      );
      pushToast('Restored unsaved file draft.', 'warning');
      return;
    }
    if (draft && draft.markdown !== response.content) {
      pushToast('An older recovery draft exists, but the disk file changed after it. Opened the disk version and kept the draft.', 'warning');
    }
  }, [commitOpenedDocument, pushToast]);

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
    const launchPathKey = keyForLaunchPath(trimmed);
    const activePathKey = activeFilePathRef.current ? keyForLaunchPath(activeFilePathRef.current) : '';
    const lastLaunchOpen = lastLaunchOpenRef.current;
    const launchOpenInFlight = launchOpenInFlightKeysRef.current.has(launchPathKey);
    const launchOpenedRecently = lastLaunchOpen?.pathKey === launchPathKey
      && Date.now() - lastLaunchOpen.openedAt <= LAUNCH_DUPLICATE_SUPPRESSION_MS;
    if (activePathKey === launchPathKey || launchOpenInFlight || launchOpenedRecently) {
      recordDocumentOpenDiagnostic(
        'document-open-duplicate-skipped',
        launchOpenInFlight
          ? 'Skipped duplicate launch path while the document open was already in flight.'
          : 'Skipped duplicate launch path because the document was already active or just opened.',
        trimmed,
      );
      await clearPendingMarkdownOpen(trimmed).catch((error) => {
        console.warn('Could not clear pending document-open event.', error);
      });
      return true;
    }
    try {
      launchOpenInFlightKeysRef.current.add(launchPathKey);
      const opened = await handleExternalOpen(trimmed);
      if (opened) {
        lastLaunchOpenRef.current = { path: trimmed, pathKey: launchPathKey, openedAt: Date.now() };
        await clearPendingMarkdownOpen(trimmed).catch((error) => {
          console.warn('Could not clear pending document-open event.', error);
        });
      } else if (options.markStartupFailure) {
        setStartupDocumentOpenFailed(true);
      }
      return opened;
    } catch (error) {
      console.warn('Document launch open failed.', error);
      if (options.markStartupFailure) setStartupDocumentOpenFailed(true);
      pushToast('Could not open the requested document.', 'error');
      return false;
    } finally {
      launchOpenInFlightKeysRef.current.delete(launchPathKey);
    }
  }, [handleExternalOpen, pushToast]);

  const drainPendingLaunchPath = useCallback(async () => {
    if (pendingLaunchDrainInFlightRef.current) return false;
    pendingLaunchDrainInFlightRef.current = true;
    try {
      const pendingPath = await peekPendingMarkdownOpen();
      if (!pendingPath?.trim()) return false;
      return openLaunchPathAndClear(pendingPath);
    } catch (error) {
      console.warn('Could not check for pending document-open events.', error);
      return false;
    } finally {
      pendingLaunchDrainInFlightRef.current = false;
    }
  }, [openLaunchPathAndClear]);

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
        setStartupDocumentOpenFailed(false);
        const path = await withTimeout(
          getInitialMarkdownPath(),
          STARTUP_PATH_TIMEOUT_MS,
          'Startup document path lookup took too long.',
        );
        if (cancelled) return;
        if (!path?.trim()) {
          await restoreUntitledDraftIfAvailable(() => cancelled);
          return;
        }
        setStartupDocumentOpenPending(true);
        const opened = await openLaunchPathAndClear(path, { markStartupFailure: true });
        if (!opened) return;
        if (!cancelled && !activeFilePathRef.current && markdownRef.current === initialMarkdown) {
          await restoreUntitledDraftIfAvailable(() => cancelled);
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setStartupDocumentOpenFailed(true);
          pushToast('Could not open the startup document.', 'error');
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
  }, [drainPendingLaunchPath, initialMarkdown, openLaunchPathAndClear, pushToast, restoreUntitledDraftIfAvailable]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<string>('single-instance-open', (event) => {
      const path = typeof event.payload === 'string' ? event.payload : '';
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
  }, [drainPendingLaunchPath, openLaunchPathAndClear]);

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
        clearFileDraft(filePath);
      } else {
        clearUntitledDraft();
      }
      setCloseDialogOpen(false);
    } catch (error) {
      console.warn('Discard and close command failed.', error);
      pushToast(error instanceof Error ? error.message : 'Could not close the window.', 'error');
    }
  }, [closeWindow, filePath, pushToast, setCloseDialogOpen]);

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
    documentOpenStatus,
    externalConflict,
    dirty,
    validation,
    validateNow,
    layerTwoDocument,
    bibliographyLoading,
    reloadBibliography,
    closeDialogOpen,
    setCloseDialogOpen,
    closeWindow,
    cancelAutosave,
    saveCurrent,
    ensureDocumentPathForAssets,
    settleDirtyDocumentBeforeReplace,
    commitOpenedDocument,
    adoptReviewedDiskMerge,
    handleOpen,
    handleReloadFromDisk,
    handleNew,
    handleNewFromTemplate,
    handleCloseSave,
    handleCloseDiscard,
  };
}

function settingsDocumentTypeFor(value: string | null): DocumentType | null {
  if (value === 'lab-note' || value === 'report' || value === 'memo' || value === 'notes' || value === 'other') return value;
  if (value === 'paper') return 'report';
  return null;
}

function openedDocumentMode(metadata: FileMetadata, preferredMode?: EditorMode): EditorMode {
  return preferredMode ?? 'visual';
}

function shouldShowImmediatePreparingOverlay(sizeBytes: number): boolean {
  return sizeBytes >= IMMEDIATE_PREPARING_OVERLAY_BYTES;
}

async function loadFileDraftWithTimeout(path: string) {
  try {
    return await withTimeout(
      loadFileDraftAsync(path),
      DRAFT_RESTORE_TIMEOUT_MS,
      `Recovery draft lookup for ${displayNameForPath(path)} took too long.`,
    );
  } catch (error) {
    recordDocumentOpenDiagnostic(
      'document-open-draft-check-skipped',
      error instanceof Error ? error.message : 'Recovery draft lookup was skipped.',
      path,
    );
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  });
}

function displayNameForPath(path: string): string {
  const parts = path.trim().split(/[\\/]+/);
  return parts[parts.length - 1] || 'document';
}

function keyForLaunchPath(path: string): string {
  return path.trim().replace(/\//g, '\\').toLowerCase();
}

function recordDocumentOpenDiagnostic(
  eventType: string,
  message: string,
  documentPath?: string | null,
  markdown?: string,
): void {
  void appendDiagnosticsEvent({
    eventType,
    message,
    documentPath: documentPath ?? null,
    markdownBytes: typeof markdown === 'string' ? byteLength(markdown) : null,
  });
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  return unescape(encodeURIComponent(value)).length;
}

function waitForDocumentOpenPaint(): Promise<void> {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}
