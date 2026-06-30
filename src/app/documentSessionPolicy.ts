import type { EditorMode, FileMetadata } from './documentState';
import { SOURCE_ONLY_FILE_BYTES } from '../markdown/supportedMarkdown';

export interface ExternalLaunchDraftRestoreDecision {
  stillCurrentDocument: boolean;
  currentMarkdown: string;
  diskMarkdown: string;
  draftMarkdown: string | null;
  draftRestoreOfferable: boolean;
}

export interface DirtyReplacementDecision {
  dirty: boolean;
  filePath: string | null;
  externalConflict: boolean;
  autosaveBlocked: boolean;
}

export function openedDocumentMode(metadata: Pick<FileMetadata, 'lastKnownSizeBytes'>, preferredMode?: EditorMode): EditorMode {
  if (metadata.lastKnownSizeBytes > SOURCE_ONLY_FILE_BYTES) return 'source';
  return preferredMode ?? 'visual';
}

export function shouldRestoreExternalLaunchDraft({
  stillCurrentDocument,
  currentMarkdown,
  diskMarkdown,
  draftMarkdown,
  draftRestoreOfferable,
}: ExternalLaunchDraftRestoreDecision): boolean {
  return stillCurrentDocument
    && draftRestoreOfferable
    && draftMarkdown !== null
    && draftMarkdown !== diskMarkdown
    && currentMarkdown === diskMarkdown;
}

export function shouldFlushAutosaveBeforeReplacingDocument({
  dirty,
  filePath,
  externalConflict,
  autosaveBlocked,
}: DirtyReplacementDecision): boolean {
  return dirty && Boolean(filePath) && !externalConflict && !autosaveBlocked;
}
