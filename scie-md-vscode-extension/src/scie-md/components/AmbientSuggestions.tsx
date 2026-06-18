import { AlertTriangle, Sparkles } from 'lucide-react';
import type { ValidationIssue } from '../markdown/markdownValidation';

interface AmbientSuggestionsProps {
  issues: ValidationIssue[];
  hasPasteReview: boolean;
  onOpenPasteReview: () => void;
}

export function AmbientSuggestions({ issues, hasPasteReview, onOpenPasteReview }: AmbientSuggestionsProps) {
  const visibleIssues = issues.slice(0, 3);
  if (!hasPasteReview && visibleIssues.length === 0) return null;

  return (
    <div className="ambient-strip" aria-label="Document suggestions">
      {hasPasteReview && (
        <button className="ambient-pill ai-review" onClick={onOpenPasteReview}>
          <Sparkles size={14} />
          Review pasted changes
        </button>
      )}
      {visibleIssues.map((issue) => (
        <span key={`${issue.code}-${issue.message}`} className={`ambient-pill ${issue.severity}`}>
          <AlertTriangle size={14} />
          {issue.message}
        </span>
      ))}
    </div>
  );
}
