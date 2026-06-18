import { ModalShell } from './ModalShell';
import { DialogActions } from './DialogActions';

interface UnsavedDialogProps {
  open: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedDialog({ open, onSave, onDiscard, onCancel }: UnsavedDialogProps) {
  return (
    <ModalShell open={open} titleId="unsaved-title" onCancel={onCancel}>
      <h2 id="unsaved-title">Unsaved changes</h2>
      <p>Save changes before closing?</p>
      <DialogActions>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" onClick={onDiscard}>Discard</button>
        <button type="button" className="primary" onClick={onSave}>Save</button>
      </DialogActions>
    </ModalShell>
  );
}
