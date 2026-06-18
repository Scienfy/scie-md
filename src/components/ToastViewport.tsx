import { X } from 'lucide-react';
import type { CSSProperties, FocusEvent } from 'react';

export interface ToastMessage {
  id: number;
  tone: 'info' | 'success' | 'warning' | 'error';
  text: string;
  durationMs: number | null;
}

interface ToastViewportProps {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
  onPause: (id: number) => void;
  onResume: (id: number) => void;
}

export function ToastViewport({ toasts, onDismiss, onPause, onResume }: ToastViewportProps) {
  if (toasts.length === 0) return null;
  const assertiveToasts = toasts.filter((toast) => toast.tone === 'error');
  const politeToasts = toasts.filter((toast) => toast.tone !== 'error');

  return (
    <div className="toast-viewports">
      <ToastRegion
        kind="assertive"
        toasts={assertiveToasts}
        onDismiss={onDismiss}
        onPause={onPause}
        onResume={onResume}
      />
      <ToastRegion
        kind="polite"
        toasts={politeToasts}
        onDismiss={onDismiss}
        onPause={onPause}
        onResume={onResume}
      />
    </div>
  );
}

function ToastRegion({ kind, toasts, onDismiss, onPause, onResume }: {
  kind: 'polite' | 'assertive';
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
  onPause: (id: number) => void;
  onResume: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      className={`toast-viewport toast-viewport-${kind}`}
      role={kind === 'assertive' ? 'alert' : 'status'}
      aria-live={kind}
      aria-atomic="true"
    >
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={onDismiss}
          onPause={onPause}
          onResume={onResume}
        />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss, onPause, onResume }: {
  toast: ToastMessage;
  onDismiss: (id: number) => void;
  onPause: (id: number) => void;
  onResume: (id: number) => void;
}) {
  const style = toast.durationMs === null
    ? undefined
    : ({ '--toast-duration': `${toast.durationMs}ms` } as CSSProperties);
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (!nextTarget || !event.currentTarget.contains(nextTarget)) onResume(toast.id);
  };
  return (
    <div
      className={`toast ${toast.tone} ${toast.durationMs === null ? 'is-persistent' : ''}`.trim()}
      style={style}
      onMouseEnter={() => onPause(toast.id)}
      onMouseLeave={() => onResume(toast.id)}
      onFocus={() => onPause(toast.id)}
      onBlur={handleBlur}
    >
      <span>{toast.text}</span>
      <button aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}><X size={14} /></button>
    </div>
  );
}
