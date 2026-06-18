import { useCallback, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { FileMetadata } from '../documentState';
import { readTextFile } from '../../services/fileService';
import { createAcceptedHunkAuthorshipMarks } from '../../markdown/authorship';
import type { AuthorshipMark } from '../../markdown/authorship';
import { applyThreeWayDiffDecisions, createDiffHunks } from '../../markdown/diffReview';
import type { DiffHunk } from '../../markdown/diffReview';
import { detectProtectedChanges } from '../../markdown/protectedBlocks';

interface ExternalConflictReviewState {
  hunks: DiffHunk[];
  baseMarkdown: string;
  diskMarkdown: string;
  diskMetadata: FileMetadata;
}

interface ExternalConflictReviewWorkflowParams {
  filePath: string | null;
  markdown: string;
  lastSavedMarkdown: string;
  adoptReviewedDiskMerge: (content: string, diskContent: string, diskMetadata: FileMetadata) => void;
  setAuthorshipMarks: Dispatch<SetStateAction<AuthorshipMark[]>>;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function useExternalConflictReviewWorkflow({
  filePath,
  markdown,
  lastSavedMarkdown,
  adoptReviewedDiskMerge,
  setAuthorshipMarks,
  pushToast,
}: ExternalConflictReviewWorkflowParams) {
  const [externalConflictReview, setExternalConflictReview] = useState<ExternalConflictReviewState | null>(null);
  const externalProtectedChanges = useMemo(
    () => externalConflictReview ? detectProtectedChanges(externalConflictReview.baseMarkdown, externalConflictReview.hunks) : [],
    [externalConflictReview],
  );

  const openExternalConflictReview = useCallback(async () => {
    if (!filePath) return;
    try {
      const response = await readTextFile(filePath);
      setExternalConflictReview({
        hunks: createDiffHunks(lastSavedMarkdown, response.content),
        baseMarkdown: lastSavedMarkdown,
        diskMarkdown: response.content,
        diskMetadata: response.metadata,
      });
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not load disk version for review.', 'error');
    }
  }, [filePath, lastSavedMarkdown, pushToast]);

  const closeExternalConflictReview = useCallback(() => {
    setExternalConflictReview(null);
  }, []);

  const applyReviewedMerge = useCallback((rejectedDiskHunkIds: Set<string>, successMessage: string) => {
    if (!externalConflictReview) return;
    const merged = applyThreeWayDiffDecisions(
      externalConflictReview.baseMarkdown,
      markdown,
      externalConflictReview.diskMarkdown,
      externalConflictReview.hunks,
      rejectedDiskHunkIds,
    );
    const marks = createAcceptedHunkAuthorshipMarks(
      merged,
      externalConflictReview.hunks,
      rejectedDiskHunkIds,
      Date.now(),
      'Accepted external edit',
    );
    if (marks.length > 0) {
      setAuthorshipMarks((current) => [...current, ...marks].slice(-12));
    }
    adoptReviewedDiskMerge(merged, externalConflictReview.diskMarkdown, externalConflictReview.diskMetadata);
    setExternalConflictReview(null);
    pushToast(successMessage, 'success');
  }, [adoptReviewedDiskMerge, externalConflictReview, markdown, pushToast, setAuthorshipMarks]);

  const reloadReviewedDiskVersion = useCallback(() => {
    applyReviewedMerge(new Set(), 'Applied disk changes and preserved non-conflicting local edits');
  }, [applyReviewedMerge]);

  const applyExternalConflictReview = useCallback((rejectedDiskHunkIds: Set<string>) => {
    if (!externalConflictReview) return;
    applyReviewedMerge(
      rejectedDiskHunkIds,
      rejectedDiskHunkIds.size === 0
        ? 'Accepted disk changes'
        : rejectedDiskHunkIds.size === externalConflictReview.hunks.length
          ? 'Kept current document changes'
          : 'Applied selected disk changes',
    );
  }, [applyReviewedMerge, externalConflictReview]);

  return {
    externalConflictReview,
    externalProtectedChanges,
    openExternalConflictReview,
    closeExternalConflictReview,
    reloadReviewedDiskVersion,
    applyExternalConflictReview,
  };
}
