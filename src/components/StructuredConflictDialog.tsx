import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileText, GitCompareArrows, RotateCcw, Save, ShieldAlert, X } from 'lucide-react';
import type { JsonStructuralReviewPlan, StructuredExternalConflictReviewPlan, StructuredReviewPlan } from '@sciemd/core';
import { ModalShell } from './ModalShell';

interface StructuredConflictDialogProps {
  open: boolean;
  formatLabel: string;
  filePath: string | null;
  currentSource: string;
  diskSource: string;
  jsonReview?: JsonStructuralReviewPlan | null;
  externalReview?: StructuredExternalConflictReviewPlan | null;
  reviewPlan?: StructuredReviewPlan | null;
  onKeepCurrent: () => void;
  onReloadDisk: () => void;
  onSaveAs: () => void;
  onSaveAnyway: () => void;
  onApplyJsonReview?: (rejectedDiskChangeIds: Set<string>) => void;
  onApplyStructuredReview?: (rejectedDiskChangeIds: Set<string>) => void;
  onClose: () => void;
}

export function StructuredConflictDialog({
  open,
  formatLabel,
  filePath,
  currentSource,
  diskSource,
  jsonReview = null,
  externalReview = null,
  reviewPlan = null,
  onKeepCurrent,
  onReloadDisk,
  onSaveAs,
  onSaveAnyway,
  onApplyJsonReview,
  onApplyStructuredReview,
  onClose,
}: StructuredConflictDialogProps) {
  if (!open) return null;

  return (
    <ModalShell open={open} titleId="structured-conflict-title" className="source-conflict-dialog" onCancel={onClose}>
      <header className="source-conflict-header">
        <div>
          <h2 id="structured-conflict-title">Source Conflict</h2>
          <p>Disk changed while this {formatLabel} file was open. Structured files are not line-merged with conflict markers.</p>
        </div>
        <button type="button" aria-label="Close source conflict" onClick={onClose}><X size={16} /></button>
      </header>

      <div className="source-conflict-summary" role="status">
        <dl>
          <div>
            <dt>Format</dt>
            <dd>{formatLabel}</dd>
          </div>
          <div>
            <dt>Path</dt>
            <dd>{filePath ?? 'Untitled'}</dd>
          </div>
          <div>
            <dt>Current source</dt>
            <dd>{formatSourceSize(currentSource)}</dd>
          </div>
          <div>
            <dt>Disk source</dt>
            <dd>{formatSourceSize(diskSource)}</dd>
          </div>
          {reviewPlan && (
            <>
              <div>
                <dt>Review</dt>
                <dd>{reviewPlan.summary}</dd>
              </div>
              <div>
                <dt>Target</dt>
                <dd title={reviewPlan.transaction.target.label}>{reviewPlan.transaction.target.label}</dd>
              </div>
              <div>
                <dt>Risk</dt>
                <dd>{reviewPlan.riskLabel}</dd>
              </div>
            </>
          )}
        </dl>
      </div>

      {jsonReview && (
        <JsonStructuralReviewPanel
          review={jsonReview}
          onApplyReview={onApplyJsonReview}
        />
      )}

      {externalReview && (
        <StructuredExternalReviewPanel
          review={externalReview}
          onApplyReview={onApplyStructuredReview}
        />
      )}

      <section className="source-conflict-actions" aria-label="Structured conflict actions">
        <button type="button" onClick={onKeepCurrent}>
          <FileText size={16} />
          <span>
            <strong>Keep Current</strong>
            <small>Leave the in-memory source unchanged.</small>
          </span>
        </button>
        <button type="button" onClick={onReloadDisk}>
          <RotateCcw size={16} />
          <span>
            <strong>Reload Disk</strong>
            <small>Replace the editor with the latest disk version.</small>
          </span>
        </button>
        <button type="button" onClick={onSaveAs}>
          <Save size={16} />
          <span>
            <strong>Save As</strong>
            <small>Write the current source to a different file.</small>
          </span>
        </button>
        <button type="button" data-variant="warning" onClick={onSaveAnyway}>
          <ShieldAlert size={16} />
          <span>
            <strong>Save Anyway</strong>
            <small>Back up the disk version, then overwrite it.</small>
          </span>
        </button>
      </section>
    </ModalShell>
  );
}

function StructuredExternalReviewPanel({
  review,
  onApplyReview,
}: {
  review: StructuredExternalConflictReviewPlan;
  onApplyReview?: (rejectedDiskChangeIds: Set<string>) => void;
}) {
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setRejectedIds(new Set());
  }, [review]);
  const counts = useMemo(() => ({
    conflicts: review.entries.filter((entry) => entry.conflict).length,
    warnings: review.entries.filter((entry) => entry.warnings.length > 0).length,
  }), [review.entries]);

  if (review.status === 'fallback') {
    return (
      <section className="source-conflict-json-review fallback" aria-label="Structured source review unavailable">
        <div className="source-conflict-json-review-header">
          <AlertTriangle size={16} />
          <div>
            <strong>Structured Review Unavailable</strong>
            <small>{review.fallbackReason ?? 'Use the file-level conflict actions below.'}</small>
          </div>
        </div>
        {review.diagnostics.length > 0 && (
          <ul className="source-conflict-json-diagnostics">
            {review.diagnostics.slice(0, 4).map((diagnostic) => (
              <li key={`${diagnostic.code}-${diagnostic.message}`}>{diagnostic.message}</li>
            ))}
          </ul>
        )}
        <div className="source-conflict-source-preview" aria-label="Source diff preview">
          <div>
            <b>Current</b>
            <pre>{sourceExcerpt(review.currentSource)}</pre>
          </div>
          <div>
            <b>Disk</b>
            <pre>{sourceExcerpt(review.diskSource)}</pre>
          </div>
        </div>
      </section>
    );
  }

  const toggleEntry = (id: string) => {
    setRejectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <section className="source-conflict-json-review" aria-label="Structured source review">
      <div className="source-conflict-json-review-header">
        <GitCompareArrows size={16} />
        <div>
          <strong>{structuredReviewTitle(review)}</strong>
          <small>
            {review.entries.length.toLocaleString()} disk change{review.entries.length === 1 ? '' : 's'}
            {counts.conflicts ? `, ${counts.conflicts.toLocaleString()} touched locally` : ''}
            {counts.warnings ? `, ${counts.warnings.toLocaleString()} warning${counts.warnings === 1 ? '' : 's'}` : ''}
          </small>
        </div>
      </div>
      {review.entries.length === 0 ? (
        <p className="source-conflict-json-empty">No disk structured changes were detected.</p>
      ) : (
        <div className="source-conflict-json-list">
          {review.entries.map((entry) => {
            const useDisk = !rejectedIds.has(entry.id);
            return (
              <label key={entry.id} className={`source-conflict-json-entry ${entry.conflict ? 'conflict' : ''}`}>
                <input
                  type="checkbox"
                  checked={useDisk}
                  onChange={() => toggleEntry(entry.id)}
                />
                <span className="source-conflict-json-entry-body">
                  <span className="source-conflict-json-entry-title">
                    <strong>{entry.displayTarget}</strong>
                    <small>{entry.changeKind}{entry.conflict ? ' - local edit also touched this target' : ''}</small>
                  </span>
                  <span className="source-conflict-json-values">
                    <span><b>Current</b>{entry.currentPreview}</span>
                    <span><b>Disk</b>{entry.diskPreview}</span>
                  </span>
                  {entry.warnings.map((warning) => (
                    <small key={warning} className="source-conflict-json-warning">{warning}</small>
                  ))}
                </span>
              </label>
            );
          })}
        </div>
      )}
      <button
        type="button"
        className="source-conflict-json-apply"
        disabled={!onApplyReview || review.entries.length === 0}
        onClick={() => onApplyReview?.(new Set(rejectedIds))}
      >
        Apply Selected Changes
      </button>
    </section>
  );
}

function JsonStructuralReviewPanel({
  review,
  onApplyReview,
}: {
  review: JsonStructuralReviewPlan;
  onApplyReview?: (rejectedDiskChangeIds: Set<string>) => void;
}) {
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setRejectedIds(new Set());
  }, [review]);
  const counts = useMemo(() => ({
    conflicts: review.entries.filter((entry) => entry.conflict).length,
    warnings: review.entries.filter((entry) => entry.warnings.length > 0).length,
  }), [review.entries]);

  if (review.status === 'fallback') {
    return (
      <section className="source-conflict-json-review fallback" aria-label="JSON structural review unavailable">
        <div className="source-conflict-json-review-header">
          <AlertTriangle size={16} />
          <div>
            <strong>Path Review Unavailable</strong>
            <small>{review.fallbackReason ?? 'Use the file-level conflict actions below.'}</small>
          </div>
        </div>
        {review.diagnostics.length > 0 && (
          <ul className="source-conflict-json-diagnostics">
            {review.diagnostics.slice(0, 4).map((diagnostic) => (
              <li key={`${diagnostic.code}-${diagnostic.message}`}>{diagnostic.message}</li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  const toggleEntry = (id: string) => {
    setRejectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <section className="source-conflict-json-review" aria-label="JSON structural path review">
      <div className="source-conflict-json-review-header">
        <GitCompareArrows size={16} />
        <div>
          <strong>JSON Path Review</strong>
          <small>
            {review.entries.length.toLocaleString()} disk path change{review.entries.length === 1 ? '' : 's'}
            {counts.conflicts ? `, ${counts.conflicts.toLocaleString()} touched locally` : ''}
            {counts.warnings ? `, ${counts.warnings.toLocaleString()} array-index warning${counts.warnings === 1 ? '' : 's'}` : ''}
          </small>
        </div>
      </div>
      {review.entries.length === 0 ? (
        <p className="source-conflict-json-empty">No disk JSON path changes were detected.</p>
      ) : (
        <div className="source-conflict-json-list">
          {review.entries.map((entry) => {
            const useDisk = !rejectedIds.has(entry.id);
            return (
              <label key={entry.id} className={`source-conflict-json-entry ${entry.conflict ? 'conflict' : ''}`}>
                <input
                  type="checkbox"
                  checked={useDisk}
                  onChange={() => toggleEntry(entry.id)}
                />
                <span className="source-conflict-json-entry-body">
                  <span className="source-conflict-json-entry-title">
                    <strong>{entry.displayPath}</strong>
                    <small>{entry.kind}{entry.conflict ? ' - local edit also touched this path' : ''}</small>
                  </span>
                  <span className="source-conflict-json-values">
                    <span><b>Current</b>{entry.currentPreview}</span>
                    <span><b>Disk</b>{entry.diskPreview}</span>
                  </span>
                  {entry.warnings.map((warning) => (
                    <small key={warning} className="source-conflict-json-warning">{warning}</small>
                  ))}
                </span>
              </label>
            );
          })}
        </div>
      )}
      <button
        type="button"
        className="source-conflict-json-apply"
        disabled={!onApplyReview || review.entries.length === 0}
        onClick={() => onApplyReview?.(new Set(rejectedIds))}
      >
        Apply Selected Paths
      </button>
    </section>
  );
}

function formatSourceSize(source: string): string {
  const characters = source.length;
  const bytes = new TextEncoder().encode(source).length;
  return `${characters.toLocaleString()} character${characters === 1 ? '' : 's'} / ${bytes.toLocaleString()} byte${bytes === 1 ? '' : 's'}`;
}

function structuredReviewTitle(review: StructuredExternalConflictReviewPlan): string {
  if (review.format === 'jsonl') return 'JSONL Line Review';
  if (review.format === 'csv' || review.format === 'tsv') return 'Table Cell Review';
  if (review.format === 'yaml') return 'YAML Path Review';
  if (review.format === 'toml') return 'TOML Path Review';
  return 'Structured Source Review';
}

function sourceExcerpt(source: string): string {
  if (source.length <= 800) return source;
  return `${source.slice(0, 800)}\n...`;
}
