import { KeyboardEvent, PointerEvent, ReactNode, useEffect, useRef } from 'react';
import { focusFirstElement, trapTabKey } from './focusUtils';

interface ModalShellProps {
  open: boolean;
  titleId: string;
  className?: string;
  backdropClassName?: string;
  onCancel: () => void;
  children: ReactNode;
}

export function ModalShell({ open, titleId, className = '', backdropClassName = '', onCancel, children }: ModalShellProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const backdropPointerDownRef = useRef(false);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    body.classList.add('modal-open');

    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }

    window.setTimeout(() => focusFirstElement(contentRef.current ?? dialog), 0);

    return () => {
      body.style.overflow = previousOverflow;
      body.classList.remove('modal-open');
      if (dialog?.open) {
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      }
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    trapTabKey(contentRef.current, event.nativeEvent);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDialogElement>) => {
    backdropPointerDownRef.current = event.target === event.currentTarget;
  };

  const handlePointerUp = (event: PointerEvent<HTMLDialogElement>) => {
    if (backdropPointerDownRef.current && event.target === event.currentTarget) onCancel();
    backdropPointerDownRef.current = false;
  };

  return (
    <dialog
      ref={dialogRef}
      className={`dialog-backdrop ${backdropClassName}`.trim()}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      <div
        ref={contentRef}
        className={`dialog ${className}`.trim()}
        tabIndex={-1}
      >
        {children}
      </div>
    </dialog>
  );
}
