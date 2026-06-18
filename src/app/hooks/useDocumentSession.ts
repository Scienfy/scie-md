import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { AutosaveStatus, EditorMode, FileMetadata } from '../documentState';
import { DEFAULT_METADATA, isDirty } from '../documentState';
import { useAutosaveTimer } from './useAutosaveTimer';
import { useDocumentValidator } from './useDocumentValidator';
import { useExternalChangeDetection } from './useExternalChangeDetection';
import { useLayerTwoDocument } from './useLayerTwoDocument';
import { useSaveOperations } from './useSaveOperations';
import { useWindowCloseGuard } from './useWindowCloseGuard';
import { getInitialMarkdownPath, pickMarkdownFile, readTextFile } from '../../services/fileService';
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
  confirmText: (state: ConfirmState) => Promise<boolean>;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function useDocumentSession({
  initialMarkdown,
  setSettings,
  setAuthorshipMarks,
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
  const [fileMetadata, setFileMetadata] = useState<FileMetadata>(DEFAULT_METADATA);
  const [mode, setMode] = useState<EditorMode>('visual');
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('idle');
  const [lastAutosavedAt, setLastAutosavedAt] = useState<number | null>(null);
  const [externalConflict, setExternalConflict] = useState(false);
  const lastDraftWarningRef = useRef('');

  const {
    document: layerTwoDocument,
    parsedMarkdown,
    bibliographyLoading,
    reloadBibliography,
  } = useLayerTwoDocument(markdown, filePath);
  const { validation, validateNow } = useDocumentValidator(markdown, layerTwoDocument, parsedMarkdown);
  const dirty = isDirty(markdown, lastSavedMarkdown);
  const autosaveBlocked = mode === 'visual' && validation.formattingWillNormalize;

  useEffect(() => {
    markdownRef.current = markdown;
  }, [markdown]);

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

  useEffect(() => {
    if (draftRestoreCheckedRef.current) return undefined;
    draftRestoreCheckedRef.current = true;

    let cancelled = false;
    void (async () => {
      const initialOpenPath = isTauriRuntime()
        ? await getInitialMarkdownPath().catch(() => null)
        : null;
      if (cancelled || initialOpenPath) return;

      const draft = await loadUntitledDraftAsync();
      if (cancelled || !draft || draft.markdown === initialMarkdown) return;
      if (isBundledWelcomeMarkdown(draft.markdown) && isBundledWelcomeMarkdown(initialMarkdown)) {
        clearUntitledDraft();
        return;
      }
      const shouldRestore = await confirmText({
        title: 'Restore unsaved draft?',
        message: 'An unsaved draft from the previous session was found. Restore it in source mode so it can be reviewed safely?',
        okLabel: 'Restore',
        cancelLabel: 'Discard',
      });
      if (cancelled) return;
      if (!shouldRestore) {
        clearUntitledDraft();
        pushToast('Previous unsaved draft discarded.', 'info');
        return;
      }

      setMarkdown(draft.markdown);
      markdownRef.current = draft.markdown;
      resetDocumentHistory();
      setLastSavedMarkdown(initialMarkdown);
      setFilePath(null);
      setFileMetadata(DEFAULT_METADATA);
      setMode('source');
      setAutosaveStatus('idle');
      setLastAutosavedAt(null);
      setExternalConflict(false);
      setAuthorshipMarks([]);
      pushToast('Restored unsaved draft in source mode.', 'warning');
    })();

    return () => {
      cancelled = true;
    };
  }, [confirmText, initialMarkdown, pushToast, setAuthorshipMarks]);

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
    const parsedDocument = safeParseScienfyDocument(content);
    const nextValidation = validateNow(content, metadata.lastKnownSizeBytes, parsedDocument);
    setMarkdown(content);
    markdownRef.current = content;
    resetDocumentHistory();
    setLastSavedMarkdown(savedMarkdown);
    setFilePath(path);
    setFileMetadata(metadata);
    setMode(preferredMode ?? (nextValidation.sourceOnly || nextValidation.formattingWillNormalize ? 'source' : 'visual'));
    setAutosaveStatus(path ? 'saved' : 'idle');
    setLastAutosavedAt(null);
    setExternalConflict(false);
    setAuthorshipMarks([]);
    resetBackupSession();

    const settingsPatch: Partial<{ visualStyle: VisualStyleId; documentType: DocumentType }> = {};
    const parsedVisualStyle = normalizeVisualStyleId(parsedDocument.visualStyle);
    if (parsedVisualStyle) settingsPatch.visualStyle = parsedVisualStyle;
    const documentType = settingsDocumentTypeFor(parsedDocument.documentType);
    if (documentType) settingsPatch.documentType = documentType;
    if (path) {
      const recentSettings = rememberRecentFile(path);
      setSettings(Object.keys(settingsPatch).length > 0 ? updateSettings(settingsPatch) : recentSettings);
    } else if (Object.keys(settingsPatch).length > 0) {
      setSettings(updateSettings(settingsPatch));
    }
  }, [resetBackupSession, setAuthorshipMarks, setSettings, validateNow]);

  const adoptReviewedDiskMerge = useCallback((content: string, diskContent: string, diskMetadata: FileMetadata) => {
    const parsedDocument = safeParseScienfyDocument(content);
    const nextValidation = validateNow(content, diskMetadata.lastKnownSizeBytes, parsedDocument);
    setMarkdown(content);
    markdownRef.current = content;
    resetDocumentHistory();
    setLastSavedMarkdown(diskContent);
    setFileMetadata(diskMetadata);
    setMode((currentMode) => nextValidation.sourceOnly && currentMode === 'visual' ? 'source' : currentMode);
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

  const handleOpen = useCallback(async (explicitPath?: string) => {
    if (!(await settleDirtyDocumentBeforeReplace())) return;
    let selectedPath = explicitPath ?? null;
    try {
      selectedPath = explicitPath ?? (await pickMarkdownFile());
      if (!selectedPath) return;
      const response = await readTextFile(selectedPath);
      const draft = await loadFileDraftAsync(selectedPath);
      if (draft && draft.markdown !== response.content && shouldOfferFileDraftRestore(draft, response.metadata)) {
        const restoreDraft = await confirmText({
          title: 'Restore unsaved file draft?',
          message: 'ScieMD found unsaved edits for this file from a previous session. Restore that draft in source mode instead of the disk version?',
          okLabel: 'Restore draft',
          cancelLabel: 'Open disk version',
        });
        if (restoreDraft) {
          commitOpenedDocument(selectedPath, draft.markdown, response.metadata, 'source', response.content);
          pushToast('Restored unsaved file draft in source mode.', 'warning');
          return;
        }
        clearFileDraft(selectedPath);
      } else if (draft && draft.markdown !== response.content) {
        pushToast('An older recovery draft exists, but the disk file changed after it. Opened the disk version and kept the draft.', 'warning');
      }
      commitOpenedDocument(selectedPath, response.content, response.metadata);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      if (selectedPath && !/File access denied/i.test(message)) {
        setSettings(forgetRecentFile(selectedPath));
      }
      pushToast(/File access denied/i.test(message) ? 'Use Open or Files to grant access to this document again.' : message || 'Open failed.', 'error');
    }
  }, [commitOpenedDocument, confirmText, pushToast, setSettings, settleDirtyDocumentBeforeReplace]);

  useEffect(() => {
    if (!isTauriRuntime() || initialOpenCheckedRef.current) return undefined;
    initialOpenCheckedRef.current = true;
    let cancelled = false;
    void getInitialMarkdownPath()
      .then((path) => {
        if (cancelled || !path?.trim()) return;
        void handleOpen(path);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) pushToast('Could not open the startup document.', 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [handleOpen, pushToast]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<string>('single-instance-open', (event) => {
      const path = typeof event.payload === 'string' ? event.payload : '';
      if (!path.trim()) return;
      void handleOpen(path);
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handleOpen]);

  const handleNew = useCallback(async () => {
    if (!(await settleDirtyDocumentBeforeReplace())) return;
    commitOpenedDocument(null, '', DEFAULT_METADATA, 'visual');
  }, [commitOpenedDocument, settleDirtyDocumentBeforeReplace]);

  const handleNewFromTemplate = useCallback(async (template: ScienfyTemplateId) => {
    if (!(await settleDirtyDocumentBeforeReplace())) return;
    const content = createScienfyTemplate(template);
    commitOpenedDocument(null, content, DEFAULT_METADATA);
    pushToast('Layer II template created', 'success');
  }, [commitOpenedDocument, pushToast, settleDirtyDocumentBeforeReplace]);

  const handleCloseSave = useCallback(async () => {
    const saved = filePath && !externalConflict && !autosaveBlocked ? await flushAutosave() : await saveCurrent();
    if (!saved) return;
    setCloseDialogOpen(false);
    await closeWindow();
  }, [autosaveBlocked, closeWindow, externalConflict, filePath, flushAutosave, saveCurrent, setCloseDialogOpen]);

  const handleCloseDiscard = useCallback(async () => {
    if (filePath) {
      clearFileDraft(filePath);
    } else {
      clearUntitledDraft();
    }
    setCloseDialogOpen(false);
    await closeWindow();
  }, [closeWindow, filePath, setCloseDialogOpen]);

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
    saveCurrent,
    ensureDocumentPathForAssets,
    settleDirtyDocumentBeforeReplace,
    commitOpenedDocument,
    adoptReviewedDiskMerge,
    handleOpen,
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
