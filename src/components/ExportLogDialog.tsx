import type { ExportLogEntry } from '../export/exportTypes';
import { ModalShell } from './ModalShell';
import { DialogActions } from './DialogActions';

interface ExportLogDialogProps {
  open: boolean;
  entries: ExportLogEntry[];
  onClose: () => void;
}

export function ExportLogDialog({ open, entries, onClose }: ExportLogDialogProps) {
  return (
    <ModalShell open={open} titleId="export-log-title" className="export-log-dialog" onCancel={onClose}>
      <header className="dialog-header">
        <div>
          <h2 id="export-log-title">Export log</h2>
          <p>Detailed steps from the most recent export attempt.</p>
        </div>
      </header>
      <div className="export-log-list">
        {entries.length === 0 ? (
          <p className="muted">No export activity yet.</p>
        ) : entries.map((entry, index) => (
          <div key={`${entry.timestamp}-${index}`} className={`export-log-entry is-${entry.level}`}>
            <span className="export-log-phase">{entry.phase}</span>
            <span className="export-log-message">{entry.message}</span>
            {typeof entry.durationMs === 'number' && <span className="export-log-duration">{Math.round(entry.durationMs)} ms</span>}
          </div>
        ))}
      </div>
      <DialogActions>
        <button type="button" onClick={onClose}>Close</button>
      </DialogActions>
    </ModalShell>
  );
}
