import { useCallback, useEffect } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, Dispatch, DragEvent as ReactDragEvent, MutableRefObject, SetStateAction } from 'react';
import type { EditorMode, FileMetadata } from '../documentState';
import { DEFAULT_METADATA } from '../documentState';
import { createInsertionAuthorshipMark } from '../../markdown/authorship';
import type { AuthorshipMark } from '../../markdown/authorship';
import { createDiffHunks, createReviewPlan } from '@sciemd/core';
import type { DiffHunk, ReviewPlan } from '@sciemd/core';
import { isMarkdownPath } from '../../markdown/supportedMarkdown';
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

interface DocumentDropPasteParams {
  markdownRef: MutableRefObject<string>;
  documentEpochRef: MutableRefObject<number>;
  insertImageBlob: (blob: Blob, preferredName?: string) => Promise<void>;
  insertImageFromPath: (imagePath: string, promptForAlt?: boolean) => Promise<void>;
  openDocumentPath: (path: string) => Promise<void>;
  settleDirtyDocumentBeforeReplace: () => Promise<boolean>;
  commitOpenedDocument: (path: string | null, content: string, metadata: FileMetadata, preferredMode?: EditorMode) => void;
  validateNow: (markdown: string, sizeBytes?: number) => unknown;
  setAuthorshipMarks: Dispatch<SetStateAction<AuthorshipMark[]>>;
  setPasteReview: Dispatch<SetStateAction<PasteReviewState | null>>;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  platformHost?: DesktopPlatformHost;
}

export function useDocumentDropPaste({
  markdownRef,
  documentEpochRef,
  insertImageBlob,
  insertImageFromPath,
  openDocumentPath,
  settleDirtyDocumentBeforeReplace,
  commitOpenedDocument,
  validateNow,
  setAuthorshipMarks,
  setPasteReview,
  pushToast,
  platformHost = desktopPlatformHost,
}: DocumentDropPasteParams) {
  const handleDroppedPaths = useCallback(async (paths: string[]) => {
    const markdownPath = paths.find(isMarkdownPath);
    if (markdownPath) {
      await openDocumentPath(markdownPath);
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

    const text = event.clipboardData.getData('text/plain');
    if (text.length > PASTE_REVIEW_THRESHOLD_CHARS) {
      const before = markdownRef.current;
      const pasteDocumentEpoch = documentEpochRef.current;
      window.setTimeout(() => {
        if (documentEpochRef.current !== pasteDocumentEpoch) return;
        const after = markdownRef.current;
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
  }, [documentEpochRef, insertImageBlob, markdownRef, pushToast, setAuthorshipMarks, setPasteReview, validateNow]);

  const handleDropCapture = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;

    const markdownFile = files.find((file) => isMarkdownPath(file.name));
    if (markdownFile) {
      event.preventDefault();
      void (async () => {
        if (!(await settleDirtyDocumentBeforeReplace())) return;
        const content = await markdownFile.text();
        validateNow(content);
        commitOpenedDocument(null, content, DEFAULT_METADATA, 'visual');
      })().catch((error) => {
        console.warn('Dropped Markdown file could not be opened.', error);
        pushToast(error instanceof Error ? error.message : 'Could not open dropped Markdown.', 'error');
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
