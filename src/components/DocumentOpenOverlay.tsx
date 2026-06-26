import { Loader2 } from 'lucide-react';
import type { DocumentOpenStatus } from '../app/documentOpenStatus';

interface DocumentOpenOverlayProps {
  status: DocumentOpenStatus | null;
}

export function DocumentOpenOverlay({ status }: DocumentOpenOverlayProps) {
  if (!status) return null;

  return (
    <div className="document-open-backdrop" role="status" aria-live="polite" aria-busy="true">
      <div className="document-open-panel">
        <Loader2 className="document-open-spinner" size={28} aria-hidden="true" />
        <div className="document-open-copy">
          <p className="document-open-title">{status.message}</p>
          <p className="document-open-file" title={status.fileName}>{status.fileName}</p>
          <p className="document-open-detail">{status.detail}</p>
        </div>
      </div>
    </div>
  );
}
