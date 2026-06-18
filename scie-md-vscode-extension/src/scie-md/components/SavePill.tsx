import { useEffect, useRef, useState } from 'react';
import type { AutosaveStatus } from '../app/documentState';

interface SavePillProps {
  status: AutosaveStatus;
  text: string;
  queueDepth?: number;
}

export function SavePill({ status, text, queueDepth = 0 }: SavePillProps) {
  const [visible, setVisible] = useState(false);
  const previousStatusRef = useRef(status);
  useEffect(() => {
    const active = queueDepth > 0 || status === 'pending' || status === 'saving' || status === 'conflict';
    const justSaved = status === 'saved' && previousStatusRef.current !== 'saved';
    previousStatusRef.current = status;

    if (active) {
      setVisible(true);
      return undefined;
    }
    if (justSaved) {
      setVisible(true);
      const timeout = window.setTimeout(() => setVisible(false), 2600);
      return () => window.clearTimeout(timeout);
    }
    setVisible(false);
    return undefined;
  }, [queueDepth, status, text]);

  if (!visible) return null;

  const label = queueDepth > 1 ? `${queueDepth} saves pending...` : text;
  return (
    <div className={`save-pill ${status}`} role="status" aria-live="polite">
      <span>{label}</span>
      <i />
    </div>
  );
}
