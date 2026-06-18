import { FormEvent, useEffect, useState } from 'react';
import { ModalShell } from './ModalShell';
import { DialogActions } from './DialogActions';

interface PromptDialogProps {
  open: boolean;
  title: string;
  label: string;
  defaultValue?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({ open, title, label, defaultValue = '', onSubmit, onCancel }: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (open) setValue(defaultValue);
  }, [defaultValue, open]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(value);
  };

  return (
    <ModalShell open={open} titleId="prompt-title" onCancel={onCancel}>
      <form onSubmit={handleSubmit}>
        <h2 id="prompt-title">{title}</h2>
        <label className="prompt-label">
          <span>{label}</span>
          <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} />
        </label>
        <DialogActions>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button className="primary" type="submit">OK</button>
        </DialogActions>
      </form>
    </ModalShell>
  );
}
