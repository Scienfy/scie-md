import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { createInsertionAuthorshipMark } from '../../markdown/authorship';
import type { AuthorshipMark } from '../../markdown/authorship';
import { detectEditorNoteLifecycleIssues } from '@sciemd/core';
import { detectProtectedChanges } from '@sciemd/core';
import { applyReviewPlanDecisions, reviewUnitIdsForRawHunkIds } from '@sciemd/core';
import type { PasteReviewState } from './useDocumentDropPaste';

interface PasteReviewWorkflowParams {
  getCurrentMarkdown: () => string;
  setMarkdown: Dispatch<SetStateAction<string>>;
  setAuthorshipMarks: Dispatch<SetStateAction<AuthorshipMark[]>>;
  setPasteReview: Dispatch<SetStateAction<PasteReviewState | null>>;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function usePasteReviewWorkflow({
  getCurrentMarkdown,
  setMarkdown,
  setAuthorshipMarks,
  setPasteReview,
  pushToast,
}: PasteReviewWorkflowParams) {
  const openPasteReview = useCallback(() => {
    setPasteReview((current) => current ? { ...current, open: true } : current);
  }, [setPasteReview]);

  const closePasteReview = useCallback(() => {
    setPasteReview((current) => current ? { ...current, open: false } : current);
  }, [setPasteReview]);

  const acceptPasteReview = useCallback(() => {
    setPasteReview((current) => {
      if (!current) return null;
      if (getCurrentMarkdown() !== current.after) {
        pushToast('Paste review was closed because the document changed after the review was prepared.', 'warning');
        return null;
      }
      const protectedHunkIds = new Set(detectProtectedChanges(current.before, current.hunks).map((change) => change.hunkId));
      if (protectedHunkIds.size === 0) {
        const noteIssues = detectEditorNoteLifecycleIssues(current.before, current.after);
        pushToast(
          noteIssues.length > 0
            ? `${noteIssues.length} completed LLM note${noteIssues.length === 1 ? '' : 's'} missing a Note to Human summary.`
            : 'Pasted changes accepted',
          noteIssues.length > 0 ? 'warning' : 'success',
        );
        return null;
      }

      const protectedUnitIds = reviewUnitIdsForRawHunkIds(current.reviewPlan, protectedHunkIds);
      const nextMarkdown = applyReviewPlanDecisions(current.before, current.after, current.reviewPlan, protectedUnitIds, protectedHunkIds);
      setMarkdown(nextMarkdown);
      const authorshipMark = createInsertionAuthorshipMark(current.before, nextMarkdown, Date.now(), 'Accepted LLM edit');
      setAuthorshipMarks(authorshipMark ? [authorshipMark] : []);
      const noteIssues = detectEditorNoteLifecycleIssues(current.before, nextMarkdown);
      pushToast(
        noteIssues.length > 0
          ? `${noteIssues.length} completed LLM note${noteIssues.length === 1 ? '' : 's'} missing a Note to Human summary.`
          : 'Accepted paste changes outside locked sections',
        'warning',
      );
      return null;
    });
  }, [getCurrentMarkdown, pushToast, setAuthorshipMarks, setMarkdown, setPasteReview]);

  const rejectPasteReview = useCallback(() => {
    let staleReview = false;
    let rejectedReview = false;
    setPasteReview((current) => {
      if (current) {
        if (getCurrentMarkdown() !== current.after) {
          staleReview = true;
          pushToast('Paste review was closed because the document changed after the review was prepared.', 'warning');
          return null;
        }
        rejectedReview = true;
        if (current.bulkReview) {
          setMarkdown(current.before);
          return null;
        }
        const rejectedUnitIds = new Set(current.reviewPlan.units.map((unit) => unit.id));
        setMarkdown(applyReviewPlanDecisions(current.before, current.after, current.reviewPlan, rejectedUnitIds));
      }
      return null;
    });
    if (staleReview || !rejectedReview) return;
    setAuthorshipMarks([]);
    pushToast('Pasted text edits rejected', 'warning');
  }, [getCurrentMarkdown, pushToast, setAuthorshipMarks, setMarkdown, setPasteReview]);

  const applyPasteReview = useCallback((rejectedUnitIds: Set<string>, rejectedRawHunkIds = new Set<string>()) => {
    let missingHumanSummaryCount = 0;
    let staleReview = false;
    let appliedReview = false;
    setPasteReview((current) => {
      if (!current) return null;
      if (getCurrentMarkdown() !== current.after) {
        staleReview = true;
        pushToast('Paste review was closed because the document changed after the review was prepared.', 'warning');
        return null;
      }
      appliedReview = true;
      const nextMarkdown = applyReviewPlanDecisions(current.before, current.after, current.reviewPlan, rejectedUnitIds, rejectedRawHunkIds);
      setMarkdown(nextMarkdown);
      const authorshipMark = createInsertionAuthorshipMark(current.before, nextMarkdown, Date.now(), 'Accepted LLM edit');
      setAuthorshipMarks(authorshipMark ? [authorshipMark] : []);
      const noteIssues = detectEditorNoteLifecycleIssues(current.before, nextMarkdown);
      missingHumanSummaryCount = noteIssues.length;
      return null;
    });
    if (staleReview || !appliedReview) return;
    pushToast(
      missingHumanSummaryCount > 0
        ? `${missingHumanSummaryCount} completed LLM note${missingHumanSummaryCount === 1 ? '' : 's'} missing a Note to Human summary.`
        : 'Pasted changes reviewed',
      missingHumanSummaryCount > 0 ? 'warning' : 'success',
    );
  }, [getCurrentMarkdown, pushToast, setAuthorshipMarks, setMarkdown, setPasteReview]);

  return {
    openPasteReview,
    closePasteReview,
    acceptPasteReview,
    rejectPasteReview,
    applyPasteReview,
  };
}
