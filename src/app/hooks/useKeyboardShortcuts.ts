import { useEffect } from 'react';
import { findKeyboardShortcut, KeyboardShortcutAction } from '../keyboardShortcuts';

interface KeyboardShortcutHandlers {
  onSave: () => void;
  onSaveAs: () => void;
  onOpen: () => void;
  onNew: () => void;
  onFind: () => void;
  onPrint: () => void;
  onCommandPalette: () => void;
  onToggleOutline: () => void;
  onShortcutSheet: () => void;
  onIncreaseFont: () => void;
  onDecreaseFont: () => void;
  onResetFont: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

interface KeyboardShortcutOptions {
  enabled?: boolean;
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers, options: KeyboardShortcutOptions = {}) {
  const enabled = options.enabled ?? true;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTextInputOutsideEditor(event.target)) return;
      if (!enabled) return;
      const shortcut = findKeyboardShortcut(event);
      if (!shortcut) return;
      event.preventDefault();
      handlerByAction(handlers, shortcut.action)();
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [enabled, handlers]);
}

function handlerByAction(handlers: KeyboardShortcutHandlers, action: KeyboardShortcutAction): () => void {
  switch (action) {
    case 'save': return handlers.onSave;
    case 'saveAs': return handlers.onSaveAs;
    case 'open': return handlers.onOpen;
    case 'new': return handlers.onNew;
    case 'find': return handlers.onFind;
    case 'print': return handlers.onPrint;
    case 'commandPalette': return handlers.onCommandPalette;
    case 'toggleOutline': return handlers.onToggleOutline;
    case 'shortcutSheet': return handlers.onShortcutSheet;
    case 'increaseFont': return handlers.onIncreaseFont;
    case 'decreaseFont': return handlers.onDecreaseFont;
    case 'resetFont': return handlers.onResetFont;
    case 'undo': return handlers.onUndo;
    case 'redo': return handlers.onRedo;
  }
}

function isTextInputOutsideEditor(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('input, textarea, select')) return true;
  if (target.closest('.ProseMirror, .cm-editor')) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}
