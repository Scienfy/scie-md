import { GitCompareArrows, X } from 'lucide-react';
import type { StructuredEditSourcePreview, StructuredReviewPlan } from '@sciemd/core';
import { DialogActions } from './DialogActions';
import { ModalShell } from './ModalShell';

interface StructuredEditReviewDialogProps {
  open: boolean;
  reviewPlan: StructuredReviewPlan | null;
  preview?: StructuredEditSourcePreview | null;
  title?: string;
  actionLabel?: string;
  closeLabel?: string;
  schemaGeneratedValueExplanation?: string;
  onApply: () => void;
  onCancel: () => void;
}

export function StructuredEditReviewDialog({
  open,
  reviewPlan,
  preview: previewOverride,
  title,
  actionLabel,
  closeLabel,
  schemaGeneratedValueExplanation,
  onApply,
  onCancel,
}: StructuredEditReviewDialogProps) {
  const preview = reviewPlan?.sourcePreview ?? previewOverride ?? null;
  if (!open || !preview) return null;
  const notes = Array.from(new Set([
    ...(reviewPlan?.notes ?? []),
    schemaGeneratedValueExplanation,
  ].filter((note): note is string => Boolean(note))));
  const titleText = title ?? reviewPlan?.title ?? 'Review Structured Source Change';
  const actionLabelText = actionLabel ?? reviewPlan?.actionLabel ?? 'Apply source change';
  const closeLabelText = closeLabel ?? 'Close structured source review';
  const noteTitle = schemaGeneratedValueExplanation ? 'Schema Generated Value' : 'Review Note';

  return (
    <ModalShell open={open} titleId="structured-edit-review-title" className="json-edit-review-dialog structured-edit-review-dialog" onCancel={onCancel}>
      <header className="json-edit-review-header">
        <div>
          <h2 id="structured-edit-review-title">{titleText}</h2>
          <p>{reviewPlan?.summary ?? preview.previewLabel}</p>
        </div>
        <button type="button" aria-label={closeLabelText} onClick={onCancel}><X size={16} /></button>
      </header>

      <section className="json-edit-review-summary" aria-label="Structured edit source summary">
        <div>
          <GitCompareArrows size={16} />
          <span>{preview.riskLabel}</span>
        </div>
        <dl>
          <div>
            <dt>Range</dt>
            <dd>Line {preview.range.line}, column {preview.range.column}</dd>
          </div>
          <div>
            <dt>Source edit</dt>
            <dd>{formatCharacterDelta(preview.range.removedLength, preview.range.insertedLength)}</dd>
          </div>
          {reviewPlan && (
            <div>
              <dt>Target</dt>
              <dd title={reviewPlan.transaction.target.label}>{reviewPlan.transaction.target.label}</dd>
            </div>
          )}
        </dl>
      </section>

      {notes.length > 0 && (
        <section className="json-edit-review-schema-note" aria-label="Structured edit review notes">
          <h3>{noteTitle}</h3>
          {notes.map((note) => <p key={note}>{note}</p>)}
        </section>
      )}

      <div className="json-edit-review-diff" aria-label="Structured source preview">
        <section>
          <h3>Before</h3>
          <pre>{preview.beforeSnippet}</pre>
          {preview.beforeTruncated && <small>Snippet truncated.</small>}
        </section>
        <section>
          <h3>After</h3>
          <pre>{preview.afterSnippet}</pre>
          {preview.afterTruncated && <small>Snippet truncated.</small>}
        </section>
      </div>

      <DialogActions>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" onClick={onApply}>{actionLabelText}</button>
      </DialogActions>
    </ModalShell>
  );
}

function formatCharacterDelta(removedLength: number, insertedLength: number): string {
  if (removedLength === 0 && insertedLength === 0) return 'No characters changed';
  if (removedLength === 0) return `${insertedLength.toLocaleString()} inserted`;
  if (insertedLength === 0) return `${removedLength.toLocaleString()} removed`;
  return `${removedLength.toLocaleString()} replaced by ${insertedLength.toLocaleString()}`;
}
