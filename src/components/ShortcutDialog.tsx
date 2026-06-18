import { ModalShell } from './ModalShell';
import { DialogActions } from './DialogActions';
import { KEYBOARD_SHORTCUTS } from '../app/keyboardShortcuts';

interface ShortcutDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutDialog({ open, onClose }: ShortcutDialogProps) {
  return (
    <ModalShell open={open} titleId="shortcuts-title" className="shortcut-dialog" onCancel={onClose}>
        <h2 id="shortcuts-title">Keyboard Shortcuts</h2>
        <dl>
          {KEYBOARD_SHORTCUTS.map((shortcut) => (
            <div key={shortcut.action}>
              <dt>{shortcut.chords.map((chord) => chord.display).join(' / ')}</dt>
              <dd>{shortcut.label}</dd>
            </div>
          ))}
        </dl>
        <DialogActions>
          <button type="button" className="primary" onClick={onClose}>Done</button>
        </DialogActions>
    </ModalShell>
  );
}
