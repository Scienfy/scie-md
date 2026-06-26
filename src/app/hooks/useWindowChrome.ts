import { useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriRuntime } from '../runtime';

interface WindowChromeParams {
  dirty: boolean;
  onDirtyCloseRequested?: () => void;
  setCloseDialogOpen: (open: boolean) => void;
  closeWindow: () => Promise<void>;
}

export function useWindowChrome({ dirty, onDirtyCloseRequested, setCloseDialogOpen, closeWindow }: WindowChromeParams) {
  const handleWindowMinimize = useCallback(() => {
    if (!isTauriRuntime()) return;
    void getCurrentWindow().minimize().catch((error) => {
      console.warn('Window minimize failed.', error);
    });
  }, []);

  const handleWindowMaximize = useCallback(() => {
    if (!isTauriRuntime()) return;
    void getCurrentWindow().toggleMaximize().catch((error) => {
      console.warn('Window maximize failed.', error);
    });
  }, []);

  const handleWindowClose = useCallback(() => {
    if (dirty) {
      onDirtyCloseRequested?.();
      setCloseDialogOpen(true);
      return;
    }
    void closeWindow().catch((error) => {
      console.warn('Window close failed.', error);
    });
  }, [closeWindow, dirty, onDirtyCloseRequested, setCloseDialogOpen]);

  const handleTitlebarMouseDown = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0 || !isTauriRuntime() || isInteractiveTitlebarTarget(event.target)) return;
    void getCurrentWindow().startDragging().catch((error) => {
      console.warn('Window drag failed.', error);
    });
  }, []);

  const handleTitlebarDoubleClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0 || !isTauriRuntime() || isInteractiveTitlebarTarget(event.target)) return;
    void getCurrentWindow().toggleMaximize().catch((error) => {
      console.warn('Window maximize failed.', error);
    });
  }, []);

  return {
    handleWindowMinimize,
    handleWindowMaximize,
    handleWindowClose,
    handleTitlebarMouseDown,
    handleTitlebarDoubleClick,
  };
}

function isInteractiveTitlebarTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('button, input, textarea, select, a, [role="button"], [role="menu"], [role="menuitem"]'));
}
