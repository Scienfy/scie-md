import { RotateCcw } from 'lucide-react';
import type { AutosaveStatus } from '../app/documentState';
import type { MarkdownHeading } from '@sciemd/core';

interface StatusBarProps {
  autosaveStatus: AutosaveStatus;
  statusText: string;
  headingPath: MarkdownHeading[];
  wordCount: number;
  manuscriptScore: number;
  manuscriptStatus: 'ready' | 'needs-review' | 'blocked';
  errors: string[];
  warnings: string[];
  externalConflict: boolean;
  filePath: string | null;
  onReviewConflict: () => void;
  onSaveAnyway: () => void;
  onReveal: () => void;
  onReload: () => void;
  onJumpToHeading: (heading: MarkdownHeading) => void;
  onOpenReadiness: () => void;
  onOpenValidation: () => void;
  onSaveNow: () => void;
}

export function StatusBar({
  autosaveStatus,
  statusText,
  headingPath,
  wordCount,
  manuscriptScore,
  manuscriptStatus,
  errors,
  warnings,
  externalConflict,
  filePath,
  onReviewConflict,
  onSaveAnyway,
  onReveal,
  onReload,
  onJumpToHeading,
  onOpenReadiness,
  onOpenValidation,
  onSaveNow,
}: StatusBarProps) {
  const score = Math.max(0, Math.min(100, manuscriptScore));
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;
  const currentHeading = headingPath.at(-1);
  const currentHeadingPath = headingPath.map((heading) => heading.text).join(' / ');

  return (
    <footer className="statusbar">
      <div className="status-left">
        <span className={`status-dot ${autosaveStatus}`} />
        <span className="status-save-text">{statusText}</span>
        {!filePath && (
          <button type="button" className="status-inline-action warning" onClick={onSaveNow}>
            Save now
          </button>
        )}
        {currentHeading && (
          <nav className="status-breadcrumb" aria-label="Current section">
            <span className="status-breadcrumb-segment">
              <button
                type="button"
                onClick={() => onJumpToHeading(currentHeading)}
                title={`Current section: ${currentHeadingPath}`}
              >
                {currentHeading.text}
              </button>
            </span>
          </nav>
        )}
        <span className="status-word-count">{wordCount.toLocaleString()} words</span>
        <button
          type="button"
          className={`status-readiness ${manuscriptStatus}`}
          aria-label={`Submission readiness ${score} out of 100. Open review panel.`}
          title={`Submission readiness ${score}/100. Open review panel.`}
          onClick={onOpenReadiness}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r={radius} />
            <circle cx="10" cy="10" r={radius} style={{ strokeDasharray: circumference, strokeDashoffset }} />
          </svg>
          <span className="status-readiness-label">Readiness</span>
          <span>{score}</span>
        </button>
        {errors.length > 0 && (
          <button type="button" className="status-badge error" aria-label={`${errors.length} validation errors. Open validation panel.`} title={`${errors[0]} Open validation panel.`} onClick={onOpenValidation}>
            {errors.length}
          </button>
        )}
        {warnings.length > 0 && (
          <button type="button" className="status-badge warning" aria-label={`${warnings.length} validation warnings. Open validation panel.`} title={`${warnings[0]} Open validation panel.`} onClick={onOpenValidation}>
            {warnings.length}
          </button>
        )}
      </div>
      <div className="status-actions">
        {externalConflict && filePath && <button type="button" onClick={onReviewConflict}>Review Disk Changes</button>}
        {externalConflict && filePath && <button type="button" onClick={onSaveAnyway}>Save Anyway</button>}
        {filePath && <button type="button" onClick={onReveal}>Reveal in Explorer</button>}
        <button type="button" aria-label="Reload from disk" title="Reload from disk" disabled={!filePath} onClick={onReload}>
          <RotateCcw size={15} />Reload
        </button>
      </div>
    </footer>
  );
}
