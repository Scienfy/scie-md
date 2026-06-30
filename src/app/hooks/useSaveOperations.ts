import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AutosaveStatus, FileMetadata } from '../documentState';
import { DEFAULT_METADATA, UNTITLED_NAME, metadataChanged } from '../documentState';
import { BACKUP_INTERVAL_MS, markAutosaveBackupCreated, shouldCreateAutosaveBackup } from '../../services/autosaveService';
import type { PersistedSettings } from '../../services/settingsService';
import type { ConfirmState } from './useDialogs';
import { parseFrontmatter } from '@sciemd/core';
import { commitVisualEditorReadResult, readVisualEditorState } from '../../components/visualEditorStateSync';
import type { DocumentHost } from '../host/documentHost';

export interface VisualRoundTripWriteContext {
  autosave: boolean;
  forceSaveAs: boolean;
  forceOverwrite: boolean;
  reason: 'save';
}

interface SaveOperationsParams {
  filePath: string | null;
  fileMetadata: FileMetadata;
  markdown: string;
  getDocumentIdentityVersion: () => number;
  setFilePath: (path: string) => void;
  setFileMetadata: (metadata: FileMetadata) => void;
  setLastSavedMarkdown: (markdown: string) => void;
  setAutosaveStatus: (status: AutosaveStatus) => void;
  setLastAutosavedAt: (timestamp: number | null) => void;
  setExternalConflict: (conflict: boolean) => void;
  setSettings: Dispatch<SetStateAction<PersistedSettings>>;
  commitMarkdownEdit: (markdown: string) => void;
  confirmVisualRoundTripWrite?: (markdown: string, context: VisualRoundTripWriteContext) => Promise<boolean>;
  confirmText: (state: ConfirmState) => Promise<boolean>;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  host: DocumentHost;
}

export function useSaveOperations({
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
  commitMarkdownEdit,
  confirmVisualRoundTripWrite,
  confirmText,
  pushToast,
  host,
}: SaveOperationsParams) {
  const backupScheduleRef = useRef({ sessionBackupDone: false, lastBackupAtMs: 0 });
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const saveQueueDepthRef = useRef(0);
  const filePathRef = useRef(filePath);
  const fileMetadataRef = useRef(fileMetadata);
  const markdownRef = useRef(markdown);
  const [saveQueueDepth, setSaveQueueDepth] = useState(0);

  useEffect(() => {
    filePathRef.current = filePath;
  }, [filePath]);

  useEffect(() => {
    fileMetadataRef.current = fileMetadata;
  }, [fileMetadata]);

  useEffect(() => {
    markdownRef.current = markdown;
  }, [markdown]);

  const updateSaveQueueDepth = useCallback((delta: number) => {
    saveQueueDepthRef.current = Math.max(0, saveQueueDepthRef.current + delta);
    setSaveQueueDepth(saveQueueDepthRef.current);
  }, []);

  const resetBackupSession = useCallback(() => {
    backupScheduleRef.current = { sessionBackupDone: false, lastBackupAtMs: 0 };
  }, []);

  const saveCurrent = useCallback(async (options: { autosave?: boolean; forceSaveAs?: boolean; forceOverwrite?: boolean } = {}) => {
    const requestedOptions = {
      autosave: options.autosave ?? false,
      forceSaveAs: options.forceSaveAs ?? false,
      forceOverwrite: options.forceOverwrite ?? false,
    };
    const visualState = readVisualEditorState();
    const outputMarkdown = visualState?.markdown ?? markdownRef.current;
    const visualWriteAllowed = await confirmVisualRoundTripWrite?.(outputMarkdown, {
      ...requestedOptions,
      reason: 'save',
    });
    if (visualWriteAllowed === false) return false;
    const flushedMarkdown = commitVisualEditorReadResult(visualState, commitMarkdownEdit);
    markdownRef.current = flushedMarkdown ?? outputMarkdown;
    const snapshot = {
      ...requestedOptions,
      sourceDocumentIdentityVersion: getDocumentIdentityVersion(),
      sourcePath: filePathRef.current,
      sourceMetadata: fileMetadataRef.current,
      sourceMarkdown: markdownRef.current,
    };
    const isSnapshotCurrent = () => (
      getDocumentIdentityVersion() === snapshot.sourceDocumentIdentityVersion
      && filePathRef.current === snapshot.sourcePath
    );
    const recordSaveDiagnostic = (eventType: string, message: string, documentPath = snapshot.sourcePath) => {
      void host.recovery.appendDiagnosticsEvent({
        eventType,
        message,
        documentPath,
        markdownBytes: byteLength(snapshot.sourceMarkdown),
      });
    };

    const runSave = async (): Promise<string | false> => {
      if (!isSnapshotCurrent()) return false;
      let targetPath: string | null = null;
      try {
        targetPath = snapshot.forceSaveAs || !snapshot.sourcePath
          ? await host.dialog.pickSavePath(suggestedMarkdownSavePath(snapshot.sourceMarkdown, snapshot.sourcePath))
          : snapshot.sourcePath;
      } catch (error) {
        recordSaveDiagnostic('save-dialog-failed', saveErrorMessage(error, 'Could not open the Save As dialog.'), targetPath);
        if (isSnapshotCurrent()) {
          console.error(error);
          setAutosaveStatus('error');
          pushToast(error instanceof Error ? error.message : 'Could not open the Save As dialog.', 'error');
        }
        return false;
      }
      if (!targetPath) return false;
      if (!isSnapshotCurrent()) return false;

      setAutosaveStatus('saving');

      const latestSourceMetadata = () => (
        targetPath === snapshot.sourcePath && filePathRef.current === snapshot.sourcePath
          ? fileMetadataRef.current
          : snapshot.sourceMetadata
      );
      let metadataForWrite = targetPath === snapshot.sourcePath ? latestSourceMetadata() : DEFAULT_METADATA;
      let existingMetadata: FileMetadata | null = null;
      let externalBackupCreated = false;
      let forceOverwriteConfirmed = false;
      let backupWarning = false;
      let sourceTargetWasMissing = false;
      const tryCreateBackupSnapshot = async (label: string): Promise<boolean> => {
        try {
          await host.file.createBackupSnapshot(targetPath, label);
          return true;
        } catch (backupError) {
          backupWarning = true;
          console.warn(`Backup snapshot (${label}) could not be created.`, backupError);
          return false;
        }
      };
      const confirmForceOverwrite = async () => {
        if (!snapshot.forceOverwrite || forceOverwriteConfirmed) return true;
        const overwrite = await confirmText({
          title: 'Overwrite disk version?',
          message: 'This writes your current ScieMD document over the changed disk file. A backup of the disk version will be created first.',
          okLabel: 'Overwrite',
          cancelLabel: 'Cancel',
        });
        forceOverwriteConfirmed = overwrite;
        return overwrite;
      };

      try {
        const preliminaryMetadata = await host.file.statFile(targetPath, { contentHash: false });
        if (isCloudPlaceholderMetadata(preliminaryMetadata)) {
          host.recovery.saveFileDraft(targetPath, snapshot.sourceMarkdown, Date.now(), snapshot.sourceMetadata);
          if (isSnapshotCurrent()) {
            setAutosaveStatus('error');
            pushToast(
              snapshot.autosave
                ? 'Autosave paused: this file is cloud-only. Download or pin it locally, then save again.'
                : 'This file is cloud-only. Download or pin it locally before saving so ScieMD does not block on cloud rehydration.',
              'warning',
            );
          }
          return false;
        }
        existingMetadata = await host.file.statFile(targetPath, { contentHash: true });
        if (targetPath !== snapshot.sourcePath) metadataForWrite = existingMetadata;
      } catch (error) {
        if (targetPath !== snapshot.sourcePath && isMissingFileStatError(error)) {
          existingMetadata = null;
        } else if (targetPath === snapshot.sourcePath && snapshot.forceOverwrite && isMissingFileStatError(error)) {
          existingMetadata = null;
          metadataForWrite = latestSourceMetadata();
          sourceTargetWasMissing = true;
        } else {
          recordSaveDiagnostic(
            snapshot.autosave ? 'autosave-verify-failed' : 'save-verify-failed',
            saveErrorMessage(error, 'Could not verify the disk file before saving.'),
            targetPath,
          );
          host.recovery.saveFileDraft(targetPath, snapshot.sourceMarkdown, Date.now(), snapshot.sourceMetadata);
          if (isSnapshotCurrent()) {
            setAutosaveStatus('error');
            pushToast(
              snapshot.autosave
                ? 'Autosave paused: ScieMD could not verify the disk file before saving. Your in-memory draft was preserved.'
                : `Could not verify the disk file before saving: ${error instanceof Error ? error.message : String(error)}`,
              'error',
            );
          }
          return false;
        }
      }
      if (!isSnapshotCurrent()) return false;

      if (targetPath !== snapshot.sourcePath && existingMetadata && !snapshot.autosave) {
        const replace = await confirmText({
          title: 'Replace existing Markdown file?',
          message: 'The selected Save As target already exists. Replace it with this ScieMD document? A backup of the target file will be created first.',
          okLabel: 'Replace',
          cancelLabel: 'Cancel',
        });
        if (!replace) {
          if (isSnapshotCurrent()) setAutosaveStatus(filePathRef.current ? 'pending' : 'idle');
          return false;
        }
      }

      if (targetPath === snapshot.sourcePath && existingMetadata && metadataChanged(snapshot.sourceMetadata, existingMetadata)) {
        recordSaveDiagnostic(
          snapshot.autosave ? 'autosave-external-change-detected' : 'save-external-change-detected',
          'The disk file changed before ScieMD could save the current document.',
          targetPath,
        );
        host.recovery.saveFileDraft(targetPath, snapshot.sourceMarkdown, Date.now(), snapshot.sourceMetadata);
        if (isSnapshotCurrent()) {
          setAutosaveStatus('conflict');
          setExternalConflict(true);
        }
        if (snapshot.autosave) return false;
        if (snapshot.forceOverwrite) {
          if (!(await confirmForceOverwrite())) return false;
        } else {
          const overwrite = await confirmText({
            title: 'External change detected',
            message: 'This file changed outside ScieMD. Overwrite the disk version? A backup of the disk version will be created first.',
            okLabel: 'Overwrite',
            cancelLabel: 'Cancel',
          });
          if (!overwrite) return false;
        }
        externalBackupCreated = await tryCreateBackupSnapshot('external');
        metadataForWrite = existingMetadata;
      }

      try {
        if (targetPath === snapshot.sourcePath) {
          const preWriteMetadata = await host.file.statFile(targetPath, { contentHash: true }).catch(() => null);
          if (preWriteMetadata && metadataChanged(metadataForWrite, preWriteMetadata)) {
            existingMetadata = preWriteMetadata;
            metadataForWrite = preWriteMetadata;
            externalBackupCreated = false;
            if (!snapshot.forceOverwrite) {
              recordSaveDiagnostic(
                snapshot.autosave ? 'autosave-prewrite-conflict' : 'save-prewrite-conflict',
                'The disk file changed just before ScieMD could write the current document.',
                targetPath,
              );
              host.recovery.saveFileDraft(targetPath, snapshot.sourceMarkdown, Date.now(), snapshot.sourceMetadata);
              if (isSnapshotCurrent()) {
                setAutosaveStatus('conflict');
                setExternalConflict(true);
                pushToast(
                  snapshot.autosave
                    ? 'Autosave paused: the file changed on disk just before saving. Your in-memory draft was preserved.'
                    : 'External change detected just before saving. Review disk changes or use Save Anyway.',
                  'warning',
                );
              }
              return false;
            }
            if (!(await confirmForceOverwrite())) return false;
          }
        }
        if (!isSnapshotCurrent()) return false;

        if (existingMetadata) {
          if (!snapshot.autosave && !externalBackupCreated) {
            await tryCreateBackupSnapshot('manual');
          } else if (snapshot.autosave && shouldCreateAutosaveBackup(backupScheduleRef.current, Date.now(), BACKUP_INTERVAL_MS)) {
            if (await tryCreateBackupSnapshot('autosave')) {
              backupScheduleRef.current = markAutosaveBackupCreated(backupScheduleRef.current, Date.now());
            }
          }
        }

        const expectedMetadata = targetPath === snapshot.sourcePath
          ? (sourceTargetWasMissing ? null : existingMetadata ?? snapshot.sourceMetadata)
          : existingMetadata;
        const nextMetadata = await host.file.writeTextFileAtomic(targetPath, snapshot.sourceMarkdown, metadataForWrite, expectedMetadata);
        if (!isSnapshotCurrent()) return false;
        filePathRef.current = targetPath;
        fileMetadataRef.current = nextMetadata;
        setFilePath(targetPath);
        setFileMetadata(nextMetadata);
        setLastSavedMarkdown(snapshot.sourceMarkdown);
        setAutosaveStatus('saved');
        setLastAutosavedAt(Date.now());
        setExternalConflict(false);
        setSettings(host.settings.rememberRecentFile(targetPath));
        host.recovery.clearFileDraft(targetPath);
        if (snapshot.sourcePath && snapshot.sourcePath !== targetPath) {
          host.recovery.clearFileDraft(snapshot.sourcePath);
        }
        if (!snapshot.autosave) {
          pushToast(
            backupWarning ? 'Document saved, but backup snapshot could not be created.' : 'Saved',
            backupWarning ? 'warning' : 'success',
          );
        }
        return targetPath;
      } catch (error) {
        console.error(error);
        if (isExternalChangeSaveError(error)) {
          recordSaveDiagnostic(
            snapshot.autosave ? 'autosave-write-conflict' : 'save-write-conflict',
            saveErrorMessage(error, 'The file changed on disk before ScieMD could save.'),
            targetPath,
          );
          if (snapshot.sourcePath) host.recovery.saveFileDraft(snapshot.sourcePath, snapshot.sourceMarkdown, Date.now(), snapshot.sourceMetadata);
          if (isSnapshotCurrent()) {
            setAutosaveStatus('conflict');
            setExternalConflict(true);
            pushToast(
              snapshot.autosave
                ? 'Autosave paused: the file changed on disk. Your in-memory draft was preserved for recovery.'
                : 'External change detected. Reload, Save As, or use Save Anyway after reviewing the disk version.',
              'warning',
            );
          }
          return false;
        }
        recordSaveDiagnostic(
          snapshot.autosave ? 'autosave-failed' : 'save-failed',
          saveErrorMessage(error, 'Save failed.'),
          targetPath,
        );
        if (snapshot.sourcePath) host.recovery.saveFileDraft(snapshot.sourcePath, snapshot.sourceMarkdown, Date.now(), snapshot.sourceMetadata);
        if (isSnapshotCurrent()) {
          setAutosaveStatus('error');
          pushToast(
            snapshot.autosave
              ? `Autosave failed: ${error instanceof Error ? error.message : 'Save failed.'}`
              : error instanceof Error ? error.message : 'Save failed.',
            'error',
          );
        }
        return false;
      }
    };

    updateSaveQueueDepth(1);
    const queuedSave: Promise<string | false> = saveQueueRef.current.then(runSave, runSave);
    const handledSave: Promise<string | false> = queuedSave.catch((error): false => {
      console.error('Save queue chain error:', error);
      recordSaveDiagnostic('save-queue-failed', saveErrorMessage(error, 'Save queue failed before the document could be written.'));
      if (isSnapshotCurrent()) {
        setAutosaveStatus('error');
        pushToast(error instanceof Error ? error.message : 'Save queue failed before the document could be written.', 'error');
      }
      return false;
    });
    saveQueueRef.current = handledSave.finally(() => updateSaveQueueDepth(-1));
    return handledSave;
  }, [commitMarkdownEdit, confirmText, confirmVisualRoundTripWrite, getDocumentIdentityVersion, host, pushToast, setAutosaveStatus, setExternalConflict, setFileMetadata, setFilePath, setLastAutosavedAt, setLastSavedMarkdown, setSettings, updateSaveQueueDepth]);

  const ensureDocumentPathForAssets = useCallback(async () => {
    if (filePath) return filePath;
    const savedPath = await saveCurrent({ forceSaveAs: true });
    return typeof savedPath === 'string' ? savedPath : null;
  }, [filePath, saveCurrent]);

  return { saveCurrent, ensureDocumentPathForAssets, resetBackupSession, saveQueueDepth };
}

function isCloudPlaceholderMetadata(metadata: FileMetadata | null): boolean {
  return metadata?.cloudState === 'cloud-placeholder' || metadata?.cloudState === 'cloud-recall-on-open';
}

export function suggestedMarkdownSavePath(markdown: string, sourcePath: string | null): string {
  if (sourcePath) return sourcePath;
  const title = documentTitleForFilename(markdown);
  if (!title) return UNTITLED_NAME;
  return `${slugifyFilename(title)}.md`;
}

function documentTitleForFilename(markdown: string): string | null {
  const frontmatter = parseFrontmatter(markdown);
  const title = typeof frontmatter.data.title === 'string' ? frontmatter.data.title.trim() : '';
  if (title) return title;
  const rawTitle = frontmatter.raw.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim() ?? '';
  if (rawTitle) return rawTitle.replace(/^["']|["']$/g, '').trim();
  const heading = markdown.match(/^#{1,6}\s+(.+?)\s*#*\s*$/m)?.[1]?.trim() ?? '';
  return heading || null;
}

function slugifyFilename(value: string): string {
  const cleaned = value
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96);
  const slug = cleaned
    .replace(/[^\p{L}\p{N}._ -]+/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[ .-]+|[ .-]+$/g, '');
  return slug || 'Untitled';
}

function isExternalChangeSaveError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /changed on disk|changed before ScieMD could save|changed before Scienfy could save/i.test(message);
}

function isMissingFileStatError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /could not resolve file path|not found|cannot find|no such file|os error 2/i.test(message);
}

function saveErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  return unescape(encodeURIComponent(value)).length;
}
