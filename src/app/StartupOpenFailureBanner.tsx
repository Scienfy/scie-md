import { AlertTriangle, FolderOpen, RefreshCw, X } from 'lucide-react';
import type { StartupOpenFailureState } from './startupOpenFailure';

interface StartupOpenFailureBannerProps {
  failure: StartupOpenFailureState;
  onRetry: () => void;
  onOpenDocument: () => void;
  onDismiss: () => void;
}

export function StartupOpenFailureBanner({
  failure,
  onRetry,
  onOpenDocument,
  onDismiss,
}: StartupOpenFailureBannerProps) {
  return (
    <div className="startup-open-failure-banner" role="alert">
      <AlertTriangle size={18} aria-hidden="true" />
      <div className="startup-open-failure-copy">
        <strong>{failure.title}</strong>
        <span>{failure.detail ? `${failure.message} ${failure.detail}` : failure.message}</span>
      </div>
      <div className="startup-open-failure-actions">
        {failure.canRetry && (
          <button type="button" onClick={onRetry} title="Retry startup document">
            <RefreshCw size={15} aria-hidden="true" />
            <span>Retry</span>
          </button>
        )}
        <button type="button" onClick={onOpenDocument} title="Open Markdown document">
          <FolderOpen size={15} aria-hidden="true" />
          <span>Open</span>
        </button>
        <button
          type="button"
          className="startup-open-failure-dismiss"
          onClick={onDismiss}
          title="Dismiss startup warning"
          aria-label="Dismiss startup warning"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
