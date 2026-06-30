import { Check, ChevronDown, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { DiffHunk, ReviewPlan, ReviewUnit } from '@sciemd/core';
import type { ProtectedChange } from '@sciemd/core';
import { ModalShell } from './ModalShell';
import { ReviewUnitBody } from './ReviewUnitBody';

interface DiffReviewDialogProps {
  open: boolean;
  hunks: DiffHunk[];
  reviewPlan?: ReviewPlan;
  largeChangeSummary?: string;
  protectedChanges?: ProtectedChange[];
  onApply: (rejectedUnitIds: Set<string>, rejectedRawHunkIds?: Set<string>) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onClose: () => void;
  onFocusLine?: (line: number) => void;
}

const EMPTY_PROTECTED_CHANGES: ProtectedChange[] = [];

export function DiffReviewDialog({
  open,
  hunks,
  reviewPlan,
  largeChangeSummary,
  protectedChanges = EMPTY_PROTECTED_CHANGES,
  onApply,
  onAcceptAll,
  onRejectAll,
  onClose,
  onFocusLine,
}: DiffReviewDialogProps) {
  const reviewUnits = useMemo(() => reviewPlan?.units ?? hunks.map(rawHunkToReviewUnit), [hunks, reviewPlan]);
  const bulkReview = Boolean(largeChangeSummary);
  const unitIds = useMemo(() => reviewUnits.map((unit) => unit.id), [reviewUnits]);
  const protectedRawHunkIds = useMemo(
    () => new Set(protectedChanges.map((change) => change.hunkId)),
    [protectedChanges],
  );
  const protectedUnitIds = useMemo(() => (
    new Set(reviewUnits
      .filter((unit) => unit.rawHunkIds.some((id) => protectedRawHunkIds.has(id)))
      .map((unit) => unit.id))
  ), [protectedRawHunkIds, reviewUnits]);
  const defaultSelectedUnitIds = useMemo(
    () => unitIds.filter((id) => !protectedUnitIds.has(id)),
    [protectedUnitIds, unitIds],
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultSelectedUnitIds));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const changedLines = useMemo(() => reviewUnits.reduce((total, unit) => (
    total + Math.max(unit.displayHunk.beforeLines.length, unit.displayHunk.afterLines.length)
  ), 0), [reviewUnits]);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(defaultSelectedUnitIds));
    setExpandedId(reviewUnits[0]?.id ?? null);
  }, [defaultSelectedUnitIds, open, reviewUnits]);

  if (!open) return null;

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandUnit = (unit: ReviewUnit) => {
    setExpandedId((current) => current === unit.id ? null : unit.id);
    onFocusLine?.(unit.beforeStart + 1);
  };

  const acceptSelected = () => {
    if (bulkReview) {
      if (protectedRawHunkIds.size > 0) {
        onApply(new Set(), new Set(protectedRawHunkIds));
        return;
      }
      onAcceptAll();
      return;
    }
    const rejectedUnitIds = new Set(unitIds.filter((id) => !selected.has(id)));
    onApply(rejectedUnitIds);
  };

  const rejectSelected = () => {
    if (bulkReview) {
      onRejectAll();
      return;
    }
    onApply(new Set([...protectedUnitIds, ...selected]));
  };

  return (
    <ModalShell open={open} titleId="diff-title" className="diff-dialog review-dialog" backdropClassName="diff-backdrop" onCancel={onClose}>
      <header className="review-dialog-header">
        <div>
          <h2 id="diff-title">Review Pasted Changes</h2>
          <p>{largeChangeSummary ?? `${reviewUnits.length} edit${reviewUnits.length === 1 ? '' : 's'} - ${changedLines} visible line${changedLines === 1 ? '' : 's'}`}</p>
        </div>
        <button type="button" aria-label="Close review" onClick={onClose}><X size={16} /></button>
      </header>
      {protectedChanges.length > 0 && (
        <div className="diff-protected-warning" role="alert">
          <strong>Protected section changed.</strong>
          <span>Locked edits are deselected by default. Select one only if you intentionally want to accept that change.</span>
        </div>
      )}
      <div className="review-card-list">
        {bulkReview ? (
          <section className="review-change-card expanded">
            <div className="review-change-card-main">
              <span className="review-change-index">Full change</span>
              <h3>Large pasted edit</h3>
              <p>{largeChangeSummary}</p>
            </div>
          </section>
        ) : reviewUnits.length === 0 ? (
          <p className="empty-state">Only review metadata changed.</p>
        ) : reviewUnits.map((unit, index) => {
          const isSelected = selected.has(unit.id);
          const isExpanded = expandedId === unit.id;
          const isProtected = protectedUnitIds.has(unit.id);
          return (
            <section
              key={unit.id}
              className={`review-change-card ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''} ${isProtected ? 'protected' : ''}`}
            >
              <div className="review-change-card-shell">
                <button
                  type="button"
                  className="review-change-selector"
                  aria-label={`${isSelected ? 'Deselect' : 'Select'} edit ${index + 1}`}
                  aria-pressed={isSelected}
                  onClick={() => toggleSelected(unit.id)}
                >
                  {isSelected && <Check size={14} />}
                </button>
                <button
                  type="button"
                  className="review-change-summary"
                  aria-expanded={isExpanded}
                  onClick={() => expandUnit(unit)}
                >
                  <span className="review-change-index">Edit {index + 1}</span>
                  <span className="review-change-title">{summaryTitle(unit)}</span>
                  <span className="review-change-text">{summarizeMarkdown(unit.afterMarkdown || unit.beforeMarkdown)}</span>
                  {isProtected && <em>locked content</em>}
                </button>
                <button
                  type="button"
                  className="review-change-expand"
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} edit ${index + 1}`}
                  onClick={() => expandUnit(unit)}
                >
                  <ChevronDown size={16} />
                </button>
              </div>
              <div className="review-change-detail" aria-hidden={!isExpanded}>
                {isExpanded && (
                  <ReviewUnitBody
                    unit={unit}
                    beforeLabel="Original"
                    afterLabel="Edited"
                  />
                )}
              </div>
            </section>
          );
        })}
      </div>
      <footer className="review-dialog-actions">
        <span>{bulkReview ? 'Large edit' : `${selected.size} selected`}</span>
        <div>
          <button type="button" onClick={rejectSelected}>Reject selected</button>
          <button type="button" className="primary" onClick={acceptSelected}>Accept selected</button>
        </div>
      </footer>
    </ModalShell>
  );
}

function rawHunkToReviewUnit(hunk: DiffHunk): ReviewUnit {
  return {
    id: hunk.id,
    beforeStart: hunk.beforeStart,
    beforeEnd: hunk.beforeEnd,
    afterStart: hunk.afterStart,
    afterEnd: hunk.afterEnd,
    rawHunkIds: [hunk.id],
    textHunkIds: [hunk.id],
    attachedMetadataHunkIds: [],
    beforeMarkdown: hunk.beforeLines.join('\n'),
    afterMarkdown: hunk.afterLines.join('\n'),
    displayHunk: hunk,
    noteChanges: [],
    relatedNoteIds: [],
  };
}

function summaryTitle(unit: ReviewUnit): string {
  if (unit.beforeMarkdown.trim() && unit.afterMarkdown.trim()) return 'Text revised';
  if (unit.afterMarkdown.trim()) return 'Text added';
  if (unit.beforeMarkdown.trim()) return 'Text removed';
  return 'Metadata changed';
}

function summarizeMarkdown(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/[#*_`>\[\](){}|~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'No visible text.';
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)?.map((item) => item.trim()).filter(Boolean) ?? [text];
  const preview = sentences.slice(0, 2).join(' ');
  return preview.length > 190 ? `${preview.slice(0, 187).trimEnd()}...` : preview;
}
