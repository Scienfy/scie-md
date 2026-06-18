import { ModalShell } from './ModalShell';
import { DialogActions } from './DialogActions';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  okLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, okLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <ModalShell open={open} titleId="confirm-title" onCancel={onCancel}>
      <h2 id="confirm-title">{title}</h2>
      <p>{message}</p>
      <DialogActions>
        <button type="button" onClick={onCancel}>{cancelLabel}</button>
        <button type="button" className="primary" onClick={onConfirm}>{okLabel}</button>
      </DialogActions>
    </ModalShell>
  );
}
