import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { FileMetadata } from '../documentState';
import { metadataChanged } from '../documentState';
import type { DocumentHost } from '../host/documentHost';
import { createAcceptedHunkAuthorshipMarks } from '../../markdown/authorship';
import type { AuthorshipMark } from '../../markdown/authorship';
import { applyThreeWayDiffDecisions, createDiffHunks } from '@sciemd/core';
import type { DiffHunk } from '@sciemd/core';
import { detectProtectedChanges } from '@sciemd/core';

interface ExternalConflictReviewState {
  filePath: string;
  documentEpoch: number;
  hunks: DiffHunk[];
  baseMarkdown: string;
  diskMarkdown: string;
  diskMetadata: FileMetadata;
}

interface ExternalConflictReviewWorkflowParams {
  filePath: string | null;
  documentEpochRef: MutableRefObject<number>;
  markdown: string;
  lastSavedMarkdown: string;
  adoptReviewedDiskMerge: (content: string, diskContent: string, diskMetadata: FileMetadata) => void;
  setAuthorshipMarks: Dispatch<SetStateAction<AuthorshipMark[]>>;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  host: DocumentHost;
}

export function useExternalConflictReviewWorkflow({
  filePath,
  documentEpochRef,
  markdown,
  lastSavedMarkdown,
  adoptReviewedDiskMerge,
  setAuthorshipMarks,
  pushToast,
  host,
}: ExternalConflictReviewWorkflowParams) {
  const [externalConflictReview, setExternalConflictReview] = useState<ExternalConflictReviewState | null>(null);
  useEffect(() => {
    setExternalConflictReview((current) => {
      if (!current) return current;
      return current.filePath === filePath && current.documentEpoch === documentEpochRef.current
        ? current
        : null;
    });
  }, [documentEpochRef, filePath]);

  const externalProtectedChanges = useMemo(
    () => externalConflictReview ? detectProtectedChanges(externalConflictReview.baseMarkdown, externalConflictReview.hunks) : [],
    [externalConflictReview],
  );

  const openExternalConflictReview = useCallback(async () => {
    if (!filePath) return;
    try {
      const response = await host.file.readTextFile(filePath);
      setExternalConflictReview({
        filePath,
        documentEpoch: documentEpochRef.current,
        hunks: createDiffHunks(lastSavedMarkdown, response.content),
        baseMarkdown: lastSavedMarkdown,
        diskMarkdown: response.content,
        diskMetadata: response.metadata,
      });
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not load disk version for review.', 'error');
    }
  }, [documentEpochRef, filePath, host.file, lastSavedMarkdown, pushToast]);

  const closeExternalConflictReview = useCallback(() => {
    setExternalConflictReview(null);
  }, []);

  const applyReviewedMerge = useCallback(async (rejectedDiskHunkIds: Set<string>, successMessage: string) => {
    if (!externalConflictReview) return;
    if (externalConflictReview.filePath !== filePath || externalConflictReview.documentEpoch !== documentEpochRef.current) {
      setExternalConflictReview(null);
      pushToast('Disk review was closed because the document changed before it was applied.', 'warning');
      return;
    }
    let latestDisk;
    try {
      latestDisk = await host.file.readTextFile(externalConflictReview.filePath);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not refresh disk version before applying review.', 'error');
      return;
    }
    if (
      latestDisk.content !== externalConflictReview.diskMarkdown
      || metadataChanged(externalConflictReview.diskMetadata, latestDisk.metadata)
    ) {
      setExternalConflictReview({
        ...externalConflictReview,
        hunks: createDiffHunks(lastSavedMarkdown, latestDisk.content),
        baseMarkdown: lastSavedMarkdown,
        diskMarkdown: latestDisk.content,
        diskMetadata: latestDisk.metadata,
      });
      pushToast('Disk changed again while review was open. Review refreshed before applying.', 'warning');
      return;
    }
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
  }, [adoptReviewedDiskMerge, documentEpochRef, externalConflictReview, filePath, host.file, lastSavedMarkdown, markdown, pushToast, setAuthorshipMarks]);

  const reloadReviewedDiskVersion = useCallback(() => {
    void applyReviewedMerge(new Set(), 'Applied disk changes and preserved non-conflicting local edits');
  }, [applyReviewedMerge]);

  const applyExternalConflictReview = useCallback((rejectedDiskHunkIds: Set<string>) => {
    if (!externalConflictReview) return;
    void applyReviewedMerge(
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
