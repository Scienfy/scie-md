import { AlertCircle, CheckCircle2, ClipboardList, Loader2, X } from 'lucide-react';
import type { ExportFormat } from '../export/exportTypes';

export interface ExportStatusBannerState {
  tone: 'info' | 'success' | 'error';
  format: ExportFormat;
  message: string;
  outputPath?: string;
}

interface ExportStatusBannerProps {
  status: ExportStatusBannerState;
  busy?: boolean;
  onOpenLog: () => void;
  onDismiss?: () => void;
}

export function ExportStatusBanner({ status, busy = false, onOpenLog, onDismiss }: ExportStatusBannerProps) {
  const Icon = busy ? Loader2 : status.tone === 'error' ? AlertCircle : CheckCircle2;
  const title = busy
    ? `Exporting ${formatLabel(status.format)}`
    : status.tone === 'error'
      ? `${formatLabel(status.format)} export failed`
      : `${formatLabel(status.format)} export finished`;

  return (
    <div className={`export-status-banner is-${status.tone}`} role={status.tone === 'error' ? 'alert' : 'status'} aria-live={status.tone === 'error' ? 'assertive' : 'polite'}>
      <Icon className={busy ? 'is-spinning' : undefined} size={18} />
      <div className="export-status-copy">
        <strong>{title}</strong>
        <span>{status.message}</span>
        {status.outputPath && !status.message.includes(status.outputPath) && <code>{status.outputPath}</code>}
      </div>
      <button type="button" title="Show export log" aria-label="Show export log" onClick={onOpenLog}>
        <ClipboardList size={16} />
      </button>
      {onDismiss && (
        <button type="button" title="Dismiss export status" aria-label="Dismiss export status" onClick={onDismiss}>
          <X size={16} />
        </button>
      )}
    </div>
  );
}

function formatLabel(format: ExportFormat): string {
  return format === 'html' ? 'HTML' : format.toUpperCase();
}
