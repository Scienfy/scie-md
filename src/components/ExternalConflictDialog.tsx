import { Check, ChevronDown, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { DiffHunk } from '../markdown/diffReview';
import type { ProtectedChange } from '../markdown/protectedBlocks';
import type { ReviewUnit } from '../markdown/reviewPlan';
import { ModalShell } from './ModalShell';
import { ReviewUnitBody } from './ReviewUnitBody';

interface ExternalConflictDialogProps {
  open: boolean;
  hunks: DiffHunk[];
  protectedChanges?: ProtectedChange[];
  onApplyReview: (rejectedDiskHunkIds: Set<string>) => void;
  onClose: () => void;
  onFocusLine?: (line: number) => void;
}

const EMPTY_PROTECTED_CHANGES: ProtectedChange[] = [];

export function ExternalConflictDialog({
  open,
  hunks,
  protectedChanges = EMPTY_PROTECTED_CHANGES,
  onApplyReview,
  onClose,
  onFocusLine,
}: ExternalConflictDialogProps) {
  const reviewUnits = useMemo(() => hunks.map(rawHunkToReviewUnit), [hunks]);
  const unitIds = useMemo(() => reviewUnits.map((unit) => unit.id), [reviewUnits]);
  const protectedHunkIds = useMemo(
    () => new Set(protectedChanges.map((change) => change.hunkId)),
    [protectedChanges],
  );
  const protectedUnitIds = useMemo(() => (
    new Set(reviewUnits
      .filter((unit) => unit.rawHunkIds.some((id) => protectedHunkIds.has(id)))
      .map((unit) => unit.id))
  ), [protectedHunkIds, reviewUnits]);
  const defaultSelectedUnitIds = useMemo(
    () => unitIds.filter((id) => !protectedUnitIds.has(id)),
    [protectedUnitIds, unitIds],
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultSelectedUnitIds));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const changedLines = useMemo(() => hunks.reduce((total, hunk) => total + hunk.diffLines.length, 0), [hunks]);

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

  const acceptSelectedDiskChanges = () => {
    const rejectedDiskHunkIds = new Set(unitIds.filter((id) => !selected.has(id)));
    onApplyReview(rejectedDiskHunkIds);
  };

  const rejectSelectedDiskChanges = () => {
    const rejectedDiskHunkIds = new Set(protectedHunkIds);
    for (const unit of reviewUnits) {
      if (!selected.has(unit.id)) continue;
      for (const hunkId of unit.rawHunkIds) rejectedDiskHunkIds.add(hunkId);
    }
    onApplyReview(rejectedDiskHunkIds);
  };

  return (
    <ModalShell open={open} titleId="external-conflict-title" className="diff-dialog review-dialog" backdropClassName="diff-backdrop" onCancel={onClose}>
      <header className="review-dialog-header">
        <div>
          <h2 id="external-conflict-title">Review Disk Changes</h2>
          <p>Disk changed while this document was open. Select the changed cards you want to act on.</p>
          <p>{hunks.length} change{hunks.length === 1 ? '' : 's'} - {changedLines} changed line{changedLines === 1 ? '' : 's'}</p>
        </div>
        <button type="button" aria-label="Close external change review" onClick={onClose}><X size={16} /></button>
      </header>
      {protectedChanges.length > 0 && (
        <div className="diff-protected-warning" role="alert">
          <strong>Disk edited locked content.</strong>
          <span>Locked edits are deselected by default. Select one only if you intentionally want to accept that disk change.</span>
        </div>
      )}
      <div className="review-card-list">
        {reviewUnits.length === 0 ? (
          <p className="empty-state">No textual difference was found; only file metadata changed.</p>
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
                  aria-label={`${isSelected ? 'Deselect' : 'Select'} disk change ${index + 1}`}
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
                  <span className="review-change-index">Change {index + 1}</span>
                  <span className="review-change-title">{summaryTitle(unit)}</span>
                  <span className="review-change-text">{summarizeMarkdown(unit.afterMarkdown || unit.beforeMarkdown)}</span>
                  {isProtected && <em>locked content</em>}
                </button>
                <button
                  type="button"
                  className="review-change-expand"
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} disk change ${index + 1}`}
                  onClick={() => expandUnit(unit)}
                >
                  <ChevronDown size={16} />
                </button>
              </div>
              <div className="review-change-detail" aria-hidden={!isExpanded}>
                {isExpanded && (
                  <ReviewUnitBody
                    unit={unit}
                    beforeLabel="Current document"
                    afterLabel="Disk version"
                  />
                )}
              </div>
            </section>
          );
        })}
      </div>
      <footer className="review-dialog-actions">
        <span>{selected.size} selected</span>
        <div>
          <button type="button" onClick={rejectSelectedDiskChanges}>Reject selected</button>
          <button type="button" className="primary" onClick={acceptSelectedDiskChanges}>Accept selected</button>
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
  if (unit.beforeMarkdown.trim() && unit.afterMarkdown.trim()) return 'Text revised on disk';
  if (unit.afterMarkdown.trim()) return 'Text added on disk';
  if (unit.beforeMarkdown.trim()) return 'Text removed on disk';
  return 'Metadata changed on disk';
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
