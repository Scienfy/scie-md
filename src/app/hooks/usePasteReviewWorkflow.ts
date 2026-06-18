import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { createInsertionAuthorshipMark } from '../../markdown/authorship';
import type { AuthorshipMark } from '../../markdown/authorship';
import { detectEditorNoteLifecycleIssues } from '../../markdown/editorComments';
import { detectProtectedChanges } from '../../markdown/protectedBlocks';
import { applyReviewPlanDecisions, reviewUnitIdsForRawHunkIds } from '../../markdown/reviewPlan';
import type { PasteReviewState } from './useDocumentDropPaste';

interface PasteReviewWorkflowParams {
  setMarkdown: Dispatch<SetStateAction<string>>;
  setAuthorshipMarks: Dispatch<SetStateAction<AuthorshipMark[]>>;
  setPasteReview: Dispatch<SetStateAction<PasteReviewState | null>>;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function usePasteReviewWorkflow({
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
  }, [pushToast, setAuthorshipMarks, setMarkdown, setPasteReview]);

  const rejectPasteReview = useCallback(() => {
    setPasteReview((current) => {
      if (current) {
        if (current.bulkReview) {
          setMarkdown(current.before);
          return null;
        }
        const rejectedUnitIds = new Set(current.reviewPlan.units.map((unit) => unit.id));
        setMarkdown(applyReviewPlanDecisions(current.before, current.after, current.reviewPlan, rejectedUnitIds));
      }
      return null;
    });
    setAuthorshipMarks([]);
    pushToast('Pasted text edits rejected', 'warning');
  }, [pushToast, setAuthorshipMarks, setMarkdown, setPasteReview]);

  const applyPasteReview = useCallback((rejectedUnitIds: Set<string>, rejectedRawHunkIds = new Set<string>()) => {
    let missingHumanSummaryCount = 0;
    setPasteReview((current) => {
      if (!current) return null;
      const nextMarkdown = applyReviewPlanDecisions(current.before, current.after, current.reviewPlan, rejectedUnitIds, rejectedRawHunkIds);
      setMarkdown(nextMarkdown);
      const authorshipMark = createInsertionAuthorshipMark(current.before, nextMarkdown, Date.now(), 'Accepted LLM edit');
      setAuthorshipMarks(authorshipMark ? [authorshipMark] : []);
      const noteIssues = detectEditorNoteLifecycleIssues(current.before, nextMarkdown);
      missingHumanSummaryCount = noteIssues.length;
      return null;
    });
    pushToast(
      missingHumanSummaryCount > 0
        ? `${missingHumanSummaryCount} completed LLM note${missingHumanSummaryCount === 1 ? '' : 's'} missing a Note to Human summary.`
        : 'Pasted changes reviewed',
      missingHumanSummaryCount > 0 ? 'warning' : 'success',
    );
  }, [pushToast, setAuthorshipMarks, setMarkdown, setPasteReview]);

  return {
    openPasteReview,
    closePasteReview,
    acceptPasteReview,
    rejectPasteReview,
    applyPasteReview,
  };
}
