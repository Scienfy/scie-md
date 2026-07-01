import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { FileMetadata } from '../documentState';
import { metadataChanged } from '../documentState';
import type { DocumentHost } from '../host/documentHost';
import { createAcceptedHunkAuthorshipMarks } from '../../markdown/authorship';
import type { AuthorshipMark } from '../../markdown/authorship';
import {
  applyJsonStructuralReviewDecisions,
  applyStructuredExternalConflictReviewDecisions,
  applyThreeWayDiffDecisions,
  createDiffHunks,
  createJsonStructuralReview,
  createStructuredExternalConflictReview,
} from '@sciemd/core';
import type { DiffHunk, DocumentFormat, JsonStructuralReviewPlan, StructuredExternalConflictReviewPlan } from '@sciemd/core';
import { detectProtectedChanges } from '@sciemd/core';
import { canUseLineConflictReview, conflictReviewKindForFormat } from '../documentConflictPolicy';

export interface ExternalLineConflictReviewState {
  kind: 'line-review';
  filePath: string;
  documentEpoch: number;
  hunks: DiffHunk[];
  baseMarkdown: string;
  diskMarkdown: string;
  diskMetadata: FileMetadata;
}

export interface StructuredSourceConflictReviewState {
  kind: 'structured-source';
  filePath: string;
  documentEpoch: number;
  format: DocumentFormat;
  baseSource: string;
  currentSource: string;
  diskSource: string;
  diskMetadata: FileMetadata;
  jsonReview: JsonStructuralReviewPlan | null;
  structuredReview: StructuredExternalConflictReviewPlan | null;
}

export type ExternalConflictReviewState = ExternalLineConflictReviewState | StructuredSourceConflictReviewState;

interface ExternalConflictReviewWorkflowParams {
  filePath: string | null;
  documentEpochRef: MutableRefObject<number>;
  format: DocumentFormat;
  sourceText: string;
  lastSavedSourceText: string;
  adoptReviewedDiskMerge: (content: string, diskContent: string, diskMetadata: FileMetadata) => void;
  setAuthorshipMarks: Dispatch<SetStateAction<AuthorshipMark[]>>;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  host: DocumentHost;
}

export function useExternalConflictReviewWorkflow({
  filePath,
  documentEpochRef,
  format,
  sourceText,
  lastSavedSourceText,
  adoptReviewedDiskMerge,
  setAuthorshipMarks,
  pushToast,
  host,
}: ExternalConflictReviewWorkflowParams) {
  const [externalConflictReview, setExternalConflictReview] = useState<ExternalConflictReviewState | null>(null);
  useEffect(() => {
    setExternalConflictReview((current) => {
      if (!current) return current;
      if (current.filePath !== filePath || current.documentEpoch !== documentEpochRef.current) return null;
      if (current.kind === 'line-review') return canUseLineConflictReview(format) ? current : null;
      return current.format === format ? current : null;
    });
  }, [documentEpochRef, filePath, format]);

  const externalProtectedChanges = useMemo(
    () => externalConflictReview?.kind === 'line-review'
      ? detectProtectedChanges(externalConflictReview.baseMarkdown, externalConflictReview.hunks)
      : [],
    [externalConflictReview],
  );

  const openExternalConflictReview = useCallback(async () => {
    if (!filePath) return;
    try {
      const response = await host.file.readTextFile(filePath);
      if (conflictReviewKindForFormat(format) === 'line-review') {
        setExternalConflictReview({
          kind: 'line-review',
          filePath,
          documentEpoch: documentEpochRef.current,
          hunks: createDiffHunks(lastSavedSourceText, response.content),
          baseMarkdown: lastSavedSourceText,
          diskMarkdown: response.content,
          diskMetadata: response.metadata,
        });
        return;
      }
      setExternalConflictReview({
        kind: 'structured-source',
        filePath,
        documentEpoch: documentEpochRef.current,
        format,
        baseSource: lastSavedSourceText,
        currentSource: sourceText,
        diskSource: response.content,
        diskMetadata: response.metadata,
        jsonReview: format === 'json'
          ? createJsonStructuralReview(lastSavedSourceText, sourceText, response.content)
          : null,
        structuredReview: format === 'json'
          ? null
          : createStructuredExternalConflictReview(format, lastSavedSourceText, sourceText, response.content),
      });
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not load disk version for review.', 'error');
    }
  }, [documentEpochRef, filePath, format, host.file, lastSavedSourceText, sourceText, pushToast]);

  const closeExternalConflictReview = useCallback(() => {
    setExternalConflictReview(null);
  }, []);

  const applyReviewedMerge = useCallback(async (rejectedDiskHunkIds: Set<string>, successMessage: string) => {
    if (!externalConflictReview) return;
    if (externalConflictReview.kind !== 'line-review') {
      pushToast('Source conflict is open for this structured file. Choose Keep Current, Reload Disk, Save As, or Save Anyway.', 'warning');
      return;
    }
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
        hunks: createDiffHunks(lastSavedSourceText, latestDisk.content),
        baseMarkdown: lastSavedSourceText,
        diskMarkdown: latestDisk.content,
        diskMetadata: latestDisk.metadata,
      });
      pushToast('Disk changed again while review was open. Review refreshed before applying.', 'warning');
      return;
    }
    const merged = applyThreeWayDiffDecisions(
      externalConflictReview.baseMarkdown,
      sourceText,
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
  }, [adoptReviewedDiskMerge, documentEpochRef, externalConflictReview, filePath, host.file, lastSavedSourceText, sourceText, pushToast, setAuthorshipMarks]);

  const reloadReviewedDiskVersion = useCallback(() => {
    void applyReviewedMerge(new Set(), 'Applied disk changes and preserved non-conflicting local edits');
  }, [applyReviewedMerge]);

  const applyExternalConflictReview = useCallback((rejectedDiskHunkIds: Set<string>) => {
    if (!externalConflictReview) return;
    if (externalConflictReview.kind !== 'line-review') {
      pushToast('Source conflict is open for this structured file. Choose Keep Current, Reload Disk, Save As, or Save Anyway.', 'warning');
      return;
    }
    void applyReviewedMerge(
      rejectedDiskHunkIds,
      rejectedDiskHunkIds.size === 0
        ? 'Accepted disk changes'
        : rejectedDiskHunkIds.size === externalConflictReview.hunks.length
          ? 'Kept current document changes'
          : 'Applied selected disk changes',
    );
  }, [applyReviewedMerge, externalConflictReview, pushToast]);

  const applyStructuredJsonConflictReview = useCallback(async (rejectedDiskChangeIds: Set<string>) => {
    if (!externalConflictReview || externalConflictReview.kind !== 'structured-source' || externalConflictReview.format !== 'json') {
      pushToast('JSON structural review is not open.', 'warning');
      return;
    }
    if (externalConflictReview.filePath !== filePath || externalConflictReview.documentEpoch !== documentEpochRef.current) {
      setExternalConflictReview(null);
      pushToast('JSON structural review was closed because the document changed before it was applied.', 'warning');
      return;
    }

    let latestDisk;
    try {
      latestDisk = await host.file.readTextFile(externalConflictReview.filePath);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not refresh disk version before applying JSON review.', 'error');
      return;
    }
    if (
      latestDisk.content !== externalConflictReview.diskSource
      || metadataChanged(externalConflictReview.diskMetadata, latestDisk.metadata)
    ) {
      const refreshedReview = createJsonStructuralReview(
        externalConflictReview.baseSource,
        sourceText,
        latestDisk.content,
      );
      setExternalConflictReview({
        ...externalConflictReview,
        currentSource: sourceText,
        diskSource: latestDisk.content,
        diskMetadata: latestDisk.metadata,
        jsonReview: refreshedReview,
      });
      pushToast('Disk changed again while JSON review was open. Review refreshed before applying.', 'warning');
      return;
    }

    const review = createJsonStructuralReview(
      externalConflictReview.baseSource,
      sourceText,
      externalConflictReview.diskSource,
    );
    if (review.status !== 'ready') {
      setExternalConflictReview({
        ...externalConflictReview,
        currentSource: sourceText,
        jsonReview: review,
      });
      pushToast(review.fallbackReason ?? 'JSON structural review is not available for this conflict.', 'warning');
      return;
    }

    const merge = applyJsonStructuralReviewDecisions(review, rejectedDiskChangeIds);
    if (!merge.ok || merge.nextSource === undefined) {
      pushToast(merge.unsupportedReason ?? 'Could not apply selected JSON paths.', 'warning');
      return;
    }

    adoptReviewedDiskMerge(merge.nextSource, externalConflictReview.diskSource, externalConflictReview.diskMetadata);
    setExternalConflictReview(null);
    const acceptedCount = review.entries.length - rejectedDiskChangeIds.size;
    pushToast(
      acceptedCount === 0
        ? 'Kept current JSON changes'
        : acceptedCount === review.entries.length
          ? 'Accepted disk JSON changes'
          : 'Applied selected disk JSON changes',
      'success',
    );
  }, [adoptReviewedDiskMerge, documentEpochRef, externalConflictReview, filePath, host.file, sourceText, pushToast]);

  const applyStructuredConflictReview = useCallback(async (rejectedDiskChangeIds: Set<string>) => {
    if (!externalConflictReview || externalConflictReview.kind !== 'structured-source' || externalConflictReview.format === 'json') {
      pushToast('Structured source review is not open for this format.', 'warning');
      return;
    }
    if (externalConflictReview.filePath !== filePath || externalConflictReview.documentEpoch !== documentEpochRef.current) {
      setExternalConflictReview(null);
      pushToast('Structured source review was closed because the document changed before it was applied.', 'warning');
      return;
    }

    let latestDisk;
    try {
      latestDisk = await host.file.readTextFile(externalConflictReview.filePath);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not refresh disk version before applying structured review.', 'error');
      return;
    }
    if (
      latestDisk.content !== externalConflictReview.diskSource
      || metadataChanged(externalConflictReview.diskMetadata, latestDisk.metadata)
    ) {
      const refreshedReview = createStructuredExternalConflictReview(
        externalConflictReview.format,
        externalConflictReview.baseSource,
        sourceText,
        latestDisk.content,
      );
      setExternalConflictReview({
        ...externalConflictReview,
        currentSource: sourceText,
        diskSource: latestDisk.content,
        diskMetadata: latestDisk.metadata,
        structuredReview: refreshedReview,
      });
      pushToast('Disk changed again while structured review was open. Review refreshed before applying.', 'warning');
      return;
    }

    const review = createStructuredExternalConflictReview(
      externalConflictReview.format,
      externalConflictReview.baseSource,
      sourceText,
      externalConflictReview.diskSource,
    );
    if (review.status !== 'ready') {
      setExternalConflictReview({
        ...externalConflictReview,
        currentSource: sourceText,
        structuredReview: review,
      });
      pushToast(review.fallbackReason ?? 'Structured source review is not available for this conflict.', 'warning');
      return;
    }

    const merge = applyStructuredExternalConflictReviewDecisions(review, rejectedDiskChangeIds);
    if (!merge.ok || merge.nextSource === undefined) {
      pushToast(merge.unsupportedReason ?? 'Could not apply selected structured changes.', 'warning');
      return;
    }

    adoptReviewedDiskMerge(merge.nextSource, externalConflictReview.diskSource, externalConflictReview.diskMetadata);
    setExternalConflictReview(null);
    const acceptedCount = review.entries.length - rejectedDiskChangeIds.size;
    pushToast(
      acceptedCount === 0
        ? `Kept current ${externalConflictReview.format.toUpperCase()} changes`
        : acceptedCount === review.entries.length
          ? `Accepted disk ${externalConflictReview.format.toUpperCase()} changes`
          : `Applied selected disk ${externalConflictReview.format.toUpperCase()} changes`,
      'success',
    );
  }, [adoptReviewedDiskMerge, documentEpochRef, externalConflictReview, filePath, host.file, sourceText, pushToast]);

  return {
    externalConflictReview,
    externalProtectedChanges,
    openExternalConflictReview,
    closeExternalConflictReview,
    reloadReviewedDiskVersion,
    applyExternalConflictReview,
    applyStructuredJsonConflictReview,
    applyStructuredConflictReview,
  };
}
