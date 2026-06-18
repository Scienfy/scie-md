import type { DocumentType } from '../services/settingsService';
import { ModalShell } from './ModalShell';
import { DialogActions } from './DialogActions';

interface DocumentTypeDialogProps {
  open: boolean;
  onSelect: (documentType: DocumentType) => void;
  onSkip: () => void;
}

const OPTIONS: Array<{ id: DocumentType; label: string; detail: string }> = [
  { id: 'lab-note', label: 'Lab note', detail: 'Room for methods, observations, tables, and linked data.' },
  { id: 'report', label: 'Report or manuscript', detail: 'Balanced page width for scientific drafts and export review.' },
  { id: 'memo', label: 'Memo', detail: 'Compact layout for fast writing, decisions, and revision notes.' },
  { id: 'notes', label: 'Notes', detail: 'Comfortable defaults for everyday Markdown writing.' },
  { id: 'other', label: 'Not sure yet', detail: 'Start with standard ScieMD defaults and change this later.' },
];

export function DocumentTypeDialog({ open, onSelect, onSkip }: DocumentTypeDialogProps) {
  return (
    <ModalShell open={open} titleId="document-type-title" className="document-type-dialog" onCancel={onSkip}>
      <h2 id="document-type-title">What are you writing?</h2>
      <p>Choose a starting layout. ScieMD tunes spacing, page width, and status context for the workspace while saved files remain plain Markdown. You can change this later in Settings.</p>
      <div className="document-type-options">
        {OPTIONS.map((option) => (
          <button key={option.id} type="button" onClick={() => onSelect(option.id)}>
            <span>{option.label}</span>
            <small>{option.detail}</small>
          </button>
        ))}
      </div>
      <DialogActions>
        <button type="button" onClick={onSkip}>Keep defaults</button>
      </DialogActions>
    </ModalShell>
  );
}
