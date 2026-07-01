import type { AutosaveStatus, EditorMode, FileMetadata } from '../documentState';
import { DEFAULT_METADATA } from '../documentState';
import { openedDocumentMode, shouldFlushAutosaveBeforeReplacingDocument } from '../documentSessionPolicy';
import type { AuthorshipMark } from '../../markdown/authorship';
import type { DocumentType } from '../../services/settingsService';
import type { VisualStyleId } from '../../services/visualStyleService';
import { formatFromPath } from '@sciemd/core';
import type { DocumentFormat } from '@sciemd/core';

export interface ParsedDocumentSessionHints {
  visualStyle: string | null;
  documentType: string | null;
}

export interface DocumentSessionState {
  sourceText: string;
  lastSavedSourceText: string;
  /** @deprecated Compatibility alias for Markdown-specific consumers while the shell becomes format-generic. */
  markdown: string;
  /** @deprecated Compatibility alias for Markdown-specific consumers while the shell becomes format-generic. */
  lastSavedMarkdown: string;
  format: DocumentFormat;
  filePath: string | null;
  fileMetadata: FileMetadata;
  mode: EditorMode;
  autosaveStatus: AutosaveStatus;
  lastAutosavedAt: number | null;
  externalConflict: boolean;
  authorshipMarks: AuthorshipMark[];
}

export interface OpenedDocumentInput {
  path: string | null;
  content: string;
  metadata: FileMetadata;
  format?: DocumentFormat;
  preferredMode?: EditorMode;
  savedSourceText?: string;
  /** @deprecated Use savedSourceText for non-Markdown-safe app/session boundaries. */
  savedMarkdown?: string;
  parsedDocument?: ParsedDocumentSessionHints | null;
  normalizeVisualStyle: (value: string | null) => VisualStyleId | null;
}

export interface OpenedDocumentTransition {
  state: DocumentSessionState;
  settingsPatch: Partial<{ visualStyle: VisualStyleId; documentType: DocumentType }>;
  recentFilePath: string | null;
}

export interface DiskMergeTransition {
  state: Pick<
    DocumentSessionState,
    | 'sourceText'
    | 'lastSavedSourceText'
    | 'markdown'
    | 'lastSavedMarkdown'
    | 'fileMetadata'
    | 'autosaveStatus'
    | 'lastAutosavedAt'
    | 'externalConflict'
  >;
}

export interface UntitledDraftRestoreDecision {
  action: 'skip' | 'clear-bundled-welcome' | 'prompt';
}

export interface UntitledDraftRestoreTransition {
  state: DocumentSessionState;
  toast: { text: string; tone: 'warning' };
}

export interface DirtyReplacementInput {
  dirty: boolean;
  filePath: string | null;
  externalConflict: boolean;
  autosaveBlocked: boolean;
}

export type DirtyReplacementStep = 'continue' | 'flush-autosave' | 'confirm-discard';

export interface LaunchDuplicateInput {
  requestedPath: string;
  activePath: string | null;
  inFlightPathKeys: ReadonlySet<string>;
  lastLaunchOpen: { pathKey: string; openedAt: number } | null;
  nowMs: number;
  duplicateWindowMs: number;
}

export type LaunchDuplicateDecision =
  | { duplicate: false; path: string; pathKey: string }
  | { duplicate: true; path: string; pathKey: string; reason: 'active' | 'in-flight' | 'recent'; diagnosticMessage: string };

export const IMMEDIATE_PREPARING_OVERLAY_BYTES = 512 * 1024;
export const COMMITTED_OPEN_STATUS_CLEAR_DELAY_MS = 220;
export const DEFAULT_DOCUMENT_FORMAT: DocumentFormat = 'markdown';

export function createInitialDocumentSessionState(initialSourceText: string): DocumentSessionState {
  return {
    sourceText: initialSourceText,
    lastSavedSourceText: initialSourceText,
    markdown: initialSourceText,
    lastSavedMarkdown: initialSourceText,
    format: DEFAULT_DOCUMENT_FORMAT,
    filePath: null,
    fileMetadata: DEFAULT_METADATA,
    mode: 'visual',
    autosaveStatus: 'idle',
    lastAutosavedAt: null,
    externalConflict: false,
    authorshipMarks: [],
  };
}

export function buildOpenedDocumentTransition({
  path,
  content,
  metadata,
  format = inferDocumentFormat(path, DEFAULT_DOCUMENT_FORMAT),
  preferredMode,
  savedSourceText,
  savedMarkdown,
  parsedDocument,
  normalizeVisualStyle,
}: OpenedDocumentInput): OpenedDocumentTransition {
  const resolvedSavedSourceText = savedSourceText ?? savedMarkdown ?? content;
  const settingsPatch: OpenedDocumentTransition['settingsPatch'] = {};
  if (parsedDocument) {
    const parsedVisualStyle = normalizeVisualStyle(parsedDocument.visualStyle);
    if (parsedVisualStyle) settingsPatch.visualStyle = parsedVisualStyle;
    const documentType = settingsDocumentTypeFor(parsedDocument.documentType);
    if (documentType) settingsPatch.documentType = documentType;
  }

  return {
    state: {
      sourceText: content,
      lastSavedSourceText: resolvedSavedSourceText,
      markdown: content,
      lastSavedMarkdown: resolvedSavedSourceText,
      format,
      filePath: path,
      fileMetadata: metadata,
      mode: openedDocumentMode(metadata, preferredMode, format),
      autosaveStatus: path ? 'saved' : 'idle',
      lastAutosavedAt: null,
      externalConflict: false,
      authorshipMarks: [],
    },
    settingsPatch,
    recentFilePath: path,
  };
}

export function buildReviewedDiskMergeTransition(
  content: string,
  diskContent: string,
  diskMetadata: FileMetadata,
): DiskMergeTransition {
  return {
    state: {
      sourceText: content,
      lastSavedSourceText: diskContent,
      markdown: content,
      lastSavedMarkdown: diskContent,
      fileMetadata: diskMetadata,
      autosaveStatus: content === diskContent ? 'saved' : 'pending',
      lastAutosavedAt: null,
      externalConflict: false,
    },
  };
}

export function decideUntitledDraftRestore(params: {
  draftSourceText?: string | null;
  draftMarkdown: string | null;
  initialSourceText?: string;
  initialMarkdown: string;
  draftIsBundledWelcome: boolean;
  initialIsBundledWelcome: boolean;
}): UntitledDraftRestoreDecision {
  const draftSourceText = params.draftSourceText ?? params.draftMarkdown;
  const initialSourceText = params.initialSourceText ?? params.initialMarkdown;
  const { draftIsBundledWelcome, initialIsBundledWelcome } = params;
  if (draftSourceText === null || draftSourceText === initialSourceText) return { action: 'skip' };
  if (draftIsBundledWelcome && initialIsBundledWelcome) return { action: 'clear-bundled-welcome' };
  return { action: 'prompt' };
}

export function buildUntitledDraftRestoreTransition(
  draftSourceText: string,
  initialSourceText: string,
  format: DocumentFormat = DEFAULT_DOCUMENT_FORMAT,
): UntitledDraftRestoreTransition {
  return {
    state: {
      sourceText: draftSourceText,
      lastSavedSourceText: initialSourceText,
      markdown: draftSourceText,
      lastSavedMarkdown: initialSourceText,
      format,
      filePath: null,
      fileMetadata: DEFAULT_METADATA,
      mode: openedDocumentMode(DEFAULT_METADATA, undefined, format),
      autosaveStatus: 'idle',
      lastAutosavedAt: null,
      externalConflict: false,
      authorshipMarks: [],
    },
    toast: { text: 'Restored unsaved draft.', tone: 'warning' },
  };
}

export function nextDirtyReplacementStep(input: DirtyReplacementInput): DirtyReplacementStep {
  if (!input.dirty) return 'continue';
  if (shouldFlushAutosaveBeforeReplacingDocument(input)) return 'flush-autosave';
  return 'confirm-discard';
}

export function decideLaunchDuplicate({
  requestedPath,
  activePath,
  inFlightPathKeys,
  lastLaunchOpen,
  nowMs,
  duplicateWindowMs,
}: LaunchDuplicateInput): LaunchDuplicateDecision {
  const path = requestedPath.trim();
  const pathKey = keyForLaunchPath(path);
  const activePathKey = activePath ? keyForLaunchPath(activePath) : '';
  if (activePathKey === pathKey) {
    return {
      duplicate: true,
      path,
      pathKey,
      reason: 'active',
      diagnosticMessage: 'Skipped duplicate launch path because the document was already active or just opened.',
    };
  }
  if (inFlightPathKeys.has(pathKey)) {
    return {
      duplicate: true,
      path,
      pathKey,
      reason: 'in-flight',
      diagnosticMessage: 'Skipped duplicate launch path while the document open was already in flight.',
    };
  }
  if (lastLaunchOpen?.pathKey === pathKey && nowMs - lastLaunchOpen.openedAt <= duplicateWindowMs) {
    return {
      duplicate: true,
      path,
      pathKey,
      reason: 'recent',
      diagnosticMessage: 'Skipped duplicate launch path because the document was already active or just opened.',
    };
  }
  return { duplicate: false, path, pathKey };
}

export function shouldShowImmediatePreparingOverlay(sizeBytes: number): boolean {
  return sizeBytes >= IMMEDIATE_PREPARING_OVERLAY_BYTES;
}

export function documentOpenStatusClearDelay(committedDocument: boolean): number {
  return committedDocument ? COMMITTED_OPEN_STATUS_CLEAR_DELAY_MS : 0;
}

export function displayNameForPath(path: string): string {
  const parts = path.trim().split(/[\\/]+/);
  return parts[parts.length - 1] || 'document';
}

export function inferDocumentFormat(
  path: string | null | undefined,
  fallback: DocumentFormat = DEFAULT_DOCUMENT_FORMAT,
): DocumentFormat {
  return formatFromPath(path) ?? fallback;
}

export function keyForLaunchPath(path: string): string {
  return path.trim().replace(/\//g, '\\').toLowerCase();
}

export function settingsDocumentTypeFor(value: string | null): DocumentType | null {
  if (value === 'lab-note' || value === 'report' || value === 'memo' || value === 'notes' || value === 'other') return value;
  if (value === 'paper') return 'report';
  return null;
}
