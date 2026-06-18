import { useCallback, useEffect } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, Dispatch, DragEvent as ReactDragEvent, MutableRefObject, SetStateAction } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { EditorMode, FileMetadata } from '../documentState';
import { DEFAULT_METADATA } from '../documentState';
import { isImagePath } from '../../services/assetService';
import { createInsertionAuthorshipMark } from '../../markdown/authorship';
import type { AuthorshipMark } from '../../markdown/authorship';
import { createDiffHunks } from '../../markdown/diffReview';
import type { DiffHunk } from '../../markdown/diffReview';
import { createReviewPlan } from '../../markdown/reviewPlan';
import type { ReviewPlan } from '../../markdown/reviewPlan';
import { isMarkdownPath } from '../../markdown/supportedMarkdown';
import { isTauriRuntime } from '../runtime';

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
  insertImageBlob: (blob: Blob, preferredName?: string) => Promise<void>;
  insertImageFromPath: (imagePath: string, promptForAlt?: boolean) => Promise<void>;
  openDocumentPath: (path: string) => Promise<void>;
  settleDirtyDocumentBeforeReplace: () => Promise<boolean>;
  commitOpenedDocument: (path: string | null, content: string, metadata: FileMetadata, preferredMode?: EditorMode) => void;
  validateNow: (markdown: string, sizeBytes?: number) => { sourceOnly: boolean };
  setAuthorshipMarks: Dispatch<SetStateAction<AuthorshipMark[]>>;
  setPasteReview: Dispatch<SetStateAction<PasteReviewState | null>>;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function useDocumentDropPaste({
  markdownRef,
  insertImageBlob,
  insertImageFromPath,
  openDocumentPath,
  settleDirtyDocumentBeforeReplace,
  commitOpenedDocument,
  validateNow,
  setAuthorshipMarks,
  setPasteReview,
  pushToast,
}: DocumentDropPasteParams) {
  const handleDroppedPaths = useCallback(async (paths: string[]) => {
    const markdownPath = paths.find(isMarkdownPath);
    if (markdownPath) {
      await openDocumentPath(markdownPath);
      return;
    }

    for (const imagePath of paths.filter(isImagePath)) {
      await insertImageFromPath(imagePath, false);
    }
  }, [insertImageFromPath, openDocumentPath]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === 'drop') {
        void handleDroppedPaths(event.payload.paths);
      }
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      unlisten?.();
    };
  }, [handleDroppedPaths]);

  const handlePasteCapture = useCallback((event: ReactClipboardEvent<HTMLElement>) => {
    const imageItem = Array.from(event.clipboardData.items).find((item) => item.type.startsWith('image/'));
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file) {
        event.preventDefault();
        void insertImageBlob(file, file.name);
        return;
      }
    }

    const text = event.clipboardData.getData('text/plain');
    if (text.length > PASTE_REVIEW_THRESHOLD_CHARS) {
      const before = markdownRef.current;
      window.setTimeout(() => {
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
  }, [insertImageBlob, markdownRef, pushToast, setAuthorshipMarks, setPasteReview, validateNow]);

  const handleDropCapture = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;

    const markdownFile = files.find((file) => isMarkdownPath(file.name));
    if (markdownFile) {
      event.preventDefault();
      void (async () => {
        if (!(await settleDirtyDocumentBeforeReplace())) return;
        const content = await markdownFile.text();
        const nextValidation = validateNow(content);
        commitOpenedDocument(null, content, DEFAULT_METADATA, nextValidation.sourceOnly ? 'source' : 'visual');
      })();
      return;
    }

    const imageFiles = files.filter((file) => file.type.startsWith('image/') || isImagePath(file.name));
    if (imageFiles.length > 0) {
      event.preventDefault();
      void Promise.all(imageFiles.map((file) => insertImageBlob(file, file.name)));
    }
  }, [commitOpenedDocument, insertImageBlob, settleDirtyDocumentBeforeReplace, validateNow]);

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
