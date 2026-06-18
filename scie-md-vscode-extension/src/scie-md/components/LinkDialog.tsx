import { FormEvent, useEffect, useState } from 'react';
import { DialogActions } from './DialogActions';
import { ModalShell } from './ModalShell';

interface LinkDialogProps {
  open: boolean;
  initialText: string;
  initialUrl?: string;
  onSubmit: (link: { text: string; url: string }) => void;
  onCancel: () => void;
}

export function LinkDialog({ open, initialText, initialUrl = '', onSubmit, onCancel }: LinkDialogProps) {
  const [text, setText] = useState(initialText);
  const [url, setUrl] = useState(initialUrl);

  useEffect(() => {
    if (!open) return;
    setText(initialText);
    setUrl(initialUrl);
  }, [initialText, initialUrl, open]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({ text, url });
  };

  return (
    <ModalShell open={open} titleId="link-dialog-title" onCancel={onCancel}>
      <form onSubmit={handleSubmit}>
        <h2 id="link-dialog-title">Insert link</h2>
        <label className="prompt-label">
          <span>Link text</span>
          <input
            autoFocus
            value={text}
            placeholder="Text shown in the document"
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <label className="prompt-label">
          <span>URL or path</span>
          <input
            value={url}
            placeholder="https://example.org or figures/data.csv"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <DialogActions>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button className="primary" type="submit">Insert link</button>
        </DialogActions>
      </form>
    </ModalShell>
  );
}
