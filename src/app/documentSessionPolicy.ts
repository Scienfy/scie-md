import type { DocumentFormat } from '@sciemd/core';
import type { EditorMode, FileMetadata } from './documentState';
import { SOURCE_ONLY_FILE_BYTES } from '../markdown/supportedMarkdown';

export interface ExternalLaunchDraftRestoreDecision {
  stillCurrentDocument: boolean;
  currentSourceText: string;
  diskSourceText: string;
  draftSourceText: string | null;
  draftRestoreOfferable: boolean;
}

export interface DirtyReplacementDecision {
  dirty: boolean;
  filePath: string | null;
  externalConflict: boolean;
  autosaveBlocked: boolean;
}

export function openedDocumentMode(
  metadata: Pick<FileMetadata, 'lastKnownSizeBytes'>,
  preferredMode?: EditorMode,
  format: DocumentFormat = 'markdown',
): EditorMode {
  if (metadata.lastKnownSizeBytes > SOURCE_ONLY_FILE_BYTES) return 'source';
  if (format === 'plainText') return 'source';
  if (format !== 'markdown') return preferredMode ?? 'visual';
  return preferredMode ?? 'visual';
}

export function shouldRestoreExternalLaunchDraft({
  stillCurrentDocument,
  currentSourceText,
  diskSourceText,
  draftSourceText,
  draftRestoreOfferable,
}: ExternalLaunchDraftRestoreDecision): boolean {
  return stillCurrentDocument
    && draftRestoreOfferable
    && draftSourceText !== null
    && draftSourceText !== diskSourceText
    && currentSourceText === diskSourceText;
}

export function shouldFlushAutosaveBeforeReplacingDocument({
  dirty,
  filePath,
  externalConflict,
  autosaveBlocked,
}: DirtyReplacementDecision): boolean {
  return dirty && Boolean(filePath) && !externalConflict && !autosaveBlocked;
}
