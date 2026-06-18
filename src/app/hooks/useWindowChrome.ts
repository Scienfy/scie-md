import { useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriRuntime } from '../runtime';

interface WindowChromeParams {
  dirty: boolean;
  setCloseDialogOpen: (open: boolean) => void;
  closeWindow: () => Promise<void>;
}

export function useWindowChrome({ dirty, setCloseDialogOpen, closeWindow }: WindowChromeParams) {
  const handleWindowMinimize = useCallback(() => {
    if (!isTauriRuntime()) return;
    void getCurrentWindow().minimize();
  }, []);

  const handleWindowMaximize = useCallback(() => {
    if (!isTauriRuntime()) return;
    void getCurrentWindow().toggleMaximize();
  }, []);

  const handleWindowClose = useCallback(() => {
    if (dirty) {
      setCloseDialogOpen(true);
      return;
    }
    void closeWindow();
  }, [closeWindow, dirty, setCloseDialogOpen]);

  const handleTitlebarMouseDown = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0 || !isTauriRuntime() || isInteractiveTitlebarTarget(event.target)) return;
    void getCurrentWindow().startDragging();
  }, []);

  const handleTitlebarDoubleClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0 || !isTauriRuntime() || isInteractiveTitlebarTarget(event.target)) return;
    void getCurrentWindow().toggleMaximize();
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
