import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriRuntime } from '../runtime';

interface UseWindowCloseGuardOptions {
  dirty: boolean;
  onCloseRequested: () => void;
}

export function useWindowCloseGuard({ dirty, onCloseRequested }: UseWindowCloseGuardOptions) {
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const allowCloseRef = useRef(false);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested((event) => {
      if (allowCloseRef.current || !dirty) return;
      event.preventDefault();
      onCloseRequested();
      setCloseDialogOpen(true);
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      unlisten?.();
    };
  }, [dirty, onCloseRequested]);

  const closeWindow = useCallback(async () => {
    allowCloseRef.current = true;
    if (isTauriRuntime()) {
      try {
        await getCurrentWindow().close();
      } finally {
        window.setTimeout(() => {
          allowCloseRef.current = false;
        }, 1000);
      }
    } else {
      window.close();
      window.setTimeout(() => {
        allowCloseRef.current = false;
      }, 1000);
    }
  }, []);

  return { closeDialogOpen, setCloseDialogOpen, closeWindow };
}
