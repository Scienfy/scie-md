import { useCallback, useEffect } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, Dispatch, DragEvent as ReactDragEvent, MutableRefObject, SetStateAction } from 'react';
import type { EditorMode, FileMetadata } from '../documentState';
import { DEFAULT_METADATA } from '../documentState';
import { createInsertionAuthorshipMark } from '../../markdown/authorship';
import type { AuthorshipMark } from '../../markdown/authorship';
import {
  canonicalizeStructuredIngressText,
  createDiffHunks,
  createReviewPlan,
  formatBrowserTextIngressBudgetBytes,
  formatByteLengthUtf8,
  formatBytes,
  formatClipboardIngressBudgetBytes,
  formatRuntimePolicyFor,
  inferStructuredDocument,
} from '@sciemd/core';
import type { DelimitedTextConversionPreview, DiffHunk, DocumentFormat, ReviewPlan } from '@sciemd/core';
import { desktopPlatformHost } from '../host/desktopPlatformHost';
import type { DesktopPlatformHost } from '../host/platformHost';

export const PASTE_REVIEW_THRESHOLD_CHARS = 1500;
export const PASTE_REVIEW_MAX_UNITS = 300;
export const PASTE_REVIEW_MAX_CHANGED_LINES = 2500;
export const PASTE_REVIEW_MAX_CHANGED_CHARS = 300_000;

export interface PasteReviewState {
  before: string;
  after: string;
  hunks: DiffHunk[];
  reviewPlan: ReviewPlan;
  bulkReview?: {
    summary: string;
    unitCount: number;
    changedLines: number;
    changedChars: number;
  };
  open: boolean;
}

export interface TabularPasteState {
  source: string;
  preview: DelimitedTextConversionPreview;
  createdAtMs: number;
}

interface DocumentDropPasteParams {
  sourceTextRef: MutableRefObject<string>;
  documentEpochRef: MutableRefObject<number>;
  insertImageBlob: (blob: Blob, preferredName?: string) => Promise<void>;
  insertImageFromPath: (imagePath: string, promptForAlt?: boolean) => Promise<void>;
  openDocumentPath: (path: string) => Promise<void>;
  settleDirtyDocumentBeforeReplace: () => Promise<boolean>;
  commitOpenedDocument: (
    path: string | null,
    content: string,
    metadata: FileMetadata,
    preferredMode?: EditorMode,
    savedSourceText?: string,
    documentFormat?: DocumentFormat,
  ) => void;
  validateNow: (sourceText: string, sizeBytes?: number) => unknown;
  setAuthorshipMarks: Dispatch<SetStateAction<AuthorshipMark[]>>;
  setPasteReview: Dispatch<SetStateAction<PasteReviewState | null>>;
  setTabularPaste: Dispatch<SetStateAction<TabularPasteState | null>>;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  platformHost?: DesktopPlatformHost;
}

export function useDocumentDropPaste({
  sourceTextRef,
  documentEpochRef,
  insertImageBlob,
  insertImageFromPath,
  openDocumentPath,
  settleDirtyDocumentBeforeReplace,
  commitOpenedDocument,
  validateNow,
  setAuthorshipMarks,
  setPasteReview,
  setTabularPaste,
  pushToast,
  platformHost = desktopPlatformHost,
}: DocumentDropPasteParams) {
  const handleDroppedPaths = useCallback(async (paths: string[]) => {
    const documentPath = paths.find((path) => isDroppedDocumentFormat(inferStructuredDocument({
      text: '',
      path,
      origin: 'drop',
      trust: 'userConfirmed',
    }).format));
    if (documentPath) {
      await openDocumentPath(documentPath);
      return;
    }

    for (const imagePath of paths.filter(platformHost.assets.isImagePath)) {
      await insertImageFromPath(imagePath, false);
    }
  }, [insertImageFromPath, openDocumentPath, platformHost]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void platformHost.dragDrop.listenDroppedPaths((paths) => {
      void handleDroppedPaths(paths).catch((error) => {
        console.warn('Dropped document paths could not be handled.', error);
        pushToast(error instanceof Error ? error.message : 'Could not handle dropped files.', 'error');
      });
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
    }).catch((error) => {
      console.warn('Drag and drop listener could not be registered.', error);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handleDroppedPaths, platformHost, pushToast]);

  const handlePasteCapture = useCallback((event: ReactClipboardEvent<HTMLElement>) => {
    const imageItem = Array.from(event.clipboardData.items).find((item) => item.type.startsWith('image/'));
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file) {
        event.preventDefault();
        void insertImageBlob(file, file.name).catch((error) => {
          console.warn('Pasted image could not be inserted.', error);
          pushToast(error instanceof Error ? error.message : 'Could not insert pasted image.', 'error');
        });
        return;
      }
    }

    const rawText = event.clipboardData.getData('text/plain');
    if (rawText && formatByteLengthUtf8(rawText) > formatClipboardIngressBudgetBytes(null)) {
      pushToast(
        `Large clipboard text was pasted without structured preview or diff review because it exceeds ${formatBytes(formatClipboardIngressBudgetBytes(null))}.`,
        'warning',
      );
      return;
    }

    const { text } = canonicalizeStructuredIngressText(rawText);
    const ingest = inferStructuredDocument({
      text,
      mimeType: 'text/plain',
      origin: 'clipboard',
      trust: 'transient',
    });
    if (ingest.tabularPreview) {
      event.preventDefault();
      setTabularPaste({
        source: text,
        preview: ingest.tabularPreview,
        createdAtMs: Date.now(),
      });
      pushToast('Delimited data detected. Choose an output format before inserting.', 'info');
      return;
    }

    if (text.length > PASTE_REVIEW_THRESHOLD_CHARS) {
      const before = sourceTextRef.current;
      const pasteDocumentEpoch = documentEpochRef.current;
      window.setTimeout(() => {
        if (documentEpochRef.current !== pasteDocumentEpoch) return;
        const after = sourceTextRef.current;
        validateNow(after);
        if (after === before) return;
        const hunks = createDiffHunks(before, after);
        if (hunks.length === 0) return;
        const preflightBulkReview = createBulkPasteReviewState(hunks);
        const reviewPlan = preflightBulkReview ? createBulkReviewPlan(hunks) : createReviewPlan(before, after, hunks);
        const bulkReview = preflightBulkReview ?? createBulkPasteReviewState(hunks, reviewPlan);
        const authorshipMark = createInsertionAuthorshipMark(before, after, Date.now(), 'Pasted LLM edit');
        if (authorshipMark) {
          setAuthorshipMarks((current) => [...current, authorshipMark].slice(-12));
        }
        setPasteReview({ before, after, hunks, reviewPlan, bulkReview, open: false });
        pushToast(
          bulkReview
            ? 'Large paste detected. Bulk review is available.'
            : 'Large paste detected. Review changes is available.',
          'info',
        );
      }, 80);
    }
  }, [documentEpochRef, insertImageBlob, pushToast, setAuthorshipMarks, setPasteReview, setTabularPaste, sourceTextRef, validateNow]);

  const handleDropCapture = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;

    const documentCandidate = files
      .map((file) => ({
        file,
        ingest: inferStructuredDocument({
          text: '',
          path: file.name,
          mimeType: file.type,
          origin: 'drop',
          trust: 'userConfirmed',
        }),
      }))
      .find((candidate) => isDroppedDocumentFormat(candidate.ingest.format));
    if (documentCandidate) {
      event.preventDefault();
      const { file: documentFile, ingest: initialIngest } = documentCandidate;
      const budgetBytes = formatBrowserTextIngressBudgetBytes(initialIngest.format);
      if (documentFile.size > budgetBytes) {
        pushToast(
          `${documentFile.name} is too large for browser drag-and-drop import (${formatBytes(documentFile.size)} > ${formatBytes(budgetBytes)}). Open it through the file picker instead.`,
          'warning',
        );
        return;
      }
      void (async () => {
        if (!(await settleDirtyDocumentBeforeReplace())) return;
        const { text: content } = canonicalizeStructuredIngressText(await documentFile.text());
        const ingest = inferStructuredDocument({
          text: content,
          path: documentFile.name,
          mimeType: documentFile.type,
          origin: 'drop',
          trust: 'userConfirmed',
        });
        commitOpenedDocument(null, content, DEFAULT_METADATA, 'visual', content, ingest.format);
      })().catch((error) => {
        console.warn('Dropped document file could not be opened.', error);
        pushToast(error instanceof Error ? error.message : 'Could not open dropped document.', 'error');
      });
      return;
    }

    const imageFiles = files.filter((file) => file.type.startsWith('image/') || platformHost.assets.isImagePath(file.name));
    if (imageFiles.length > 0) {
      event.preventDefault();
      void Promise.all(imageFiles.map((file) => insertImageBlob(file, file.name))).catch((error) => {
        console.warn('Dropped images could not be inserted.', error);
        pushToast(error instanceof Error ? error.message : 'Could not insert dropped images.', 'error');
      });
    }
  }, [commitOpenedDocument, insertImageBlob, platformHost, pushToast, settleDirtyDocumentBeforeReplace, validateNow]);

  return {
    handlePasteCapture,
    handleDropCapture,
  };
}

function isDroppedDocumentFormat(format: DocumentFormat): boolean {
  return formatRuntimePolicyFor(format).canOpenAsDocument;
}

function createBulkReviewPlan(hunks: DiffHunk[]): ReviewPlan {
  return {
    rawHunks: hunks,
    units: [],
    autoAcceptedMetadataHunkIds: [],
    autoAcceptedMetadata: [],
  };
}

function createBulkPasteReviewState(hunks: DiffHunk[], reviewPlan?: ReviewPlan): PasteReviewState['bulkReview'] {
  const unitCount = reviewPlan?.units.length ?? hunks.length;
  const changedLines = changedLineCount(hunks);
  const changedChars = changedCharacterCount(hunks);
  const reasons = [
    unitCount > PASTE_REVIEW_MAX_UNITS ? `${unitCount} edit blocks` : '',
    changedLines > PASTE_REVIEW_MAX_CHANGED_LINES ? `${changedLines} changed lines` : '',
    changedChars > PASTE_REVIEW_MAX_CHANGED_CHARS ? `${Math.round(changedChars / 1000)}k changed characters` : '',
  ].filter(Boolean);
  if (reasons.length === 0) return undefined;
  return {
    summary: `This paste is too large for per-edit review (${reasons.join(', ')}). Use the bulk decision controls to keep the editor responsive.`,
    unitCount,
    changedLines,
    changedChars,
  };
}

function changedLineCount(hunks: DiffHunk[]): number {
  return hunks.reduce((total, hunk) => total + Math.max(hunk.beforeLines.length, hunk.afterLines.length), 0);
}

function changedCharacterCount(hunks: DiffHunk[]): number {
  return hunks.reduce((total, hunk) => (
    total
    + hunk.beforeLines.reduce((sum, line) => sum + line.length, 0)
    + hunk.afterLines.reduce((sum, line) => sum + line.length, 0)
  ), 0);
}
