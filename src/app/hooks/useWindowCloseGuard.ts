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
  const dirtyRef = useRef(dirty);
  const onCloseRequestedRef = useRef(onCloseRequested);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    onCloseRequestedRef.current = onCloseRequested;
  }, [onCloseRequested]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested((event) => {
      if (allowCloseRef.current || !dirtyRef.current) return;
      event.preventDefault();
      onCloseRequestedRef.current();
      setCloseDialogOpen(true);
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
    }).catch((error) => {
      console.warn('Window close guard listener could not be registered.', error);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

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
