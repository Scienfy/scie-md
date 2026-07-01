import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { ContextMenuItem, ContextMenuPosition, ContextMenuSection } from './ContextMenuCard';

export interface ContextMenuOpenState {
  position: ContextMenuPosition;
  ariaLabel: string;
  sections: ContextMenuSection[];
  restoreFocusTo?: HTMLElement | null;
}

export type ContextMenuCopyFeedback = (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;

export interface CopyContextMenuItemOptions {
  id: string;
  label: string;
  text: string;
  icon?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  onCopy?: (text: string, label: string) => void | Promise<void>;
  onCopyFeedback?: ContextMenuCopyFeedback;
}

export function contextMenuPositionFromEvent(event: Pick<MouseEvent<HTMLElement>, 'clientX' | 'clientY'>): ContextMenuPosition {
  return { x: event.clientX, y: event.clientY };
}

export function contextMenuPositionFromElement(element: HTMLElement): ContextMenuPosition {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) {
    return {
      x: Math.max(8, Math.round(window.innerWidth / 2)),
      y: Math.max(8, Math.round(window.innerHeight / 2)),
    };
  }
  return {
    x: Math.round(rect.left + Math.min(Math.max(rect.width / 2, 16), 32)),
    y: Math.round(rect.top + Math.min(Math.max(rect.height / 2, 16), rect.height || 32)),
  };
}

export function isKeyboardContextMenuEvent(event: Pick<KeyboardEvent<HTMLElement>, 'key' | 'shiftKey'>): boolean {
  return event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
}

export function openContextMenuFromEvent(
  event: MouseEvent<HTMLElement>,
  setContextMenu: (state: ContextMenuOpenState) => void,
  state: Omit<ContextMenuOpenState, 'position'>,
) {
  event.preventDefault();
  event.stopPropagation();
  setContextMenu({
    ...state,
    position: contextMenuPositionFromEvent(event),
    restoreFocusTo: state.restoreFocusTo ?? event.currentTarget,
  });
}

export function openContextMenuFromKeyboard(
  event: KeyboardEvent<HTMLElement>,
  setContextMenu: (state: ContextMenuOpenState) => void,
  state: Omit<ContextMenuOpenState, 'position'>,
  target: HTMLElement = event.currentTarget,
) {
  if (!isKeyboardContextMenuEvent(event)) return false;
  event.preventDefault();
  event.stopPropagation();
  setContextMenu({
    ...state,
    position: contextMenuPositionFromElement(target),
    restoreFocusTo: state.restoreFocusTo ?? target,
  });
  return true;
}

export function copyContextMenuItem({
  id,
  label,
  text,
  icon,
  disabled,
  disabledReason,
  onCopy,
  onCopyFeedback,
}: CopyContextMenuItemOptions): ContextMenuItem {
  return {
    id,
    label,
    icon,
    disabled,
    disabledReason,
    onSelect: disabled ? undefined : () => writeContextMenuClipboardText(text, label, onCopy, onCopyFeedback),
  };
}

export function copyContextMenuSection(
  id: string,
  label: string,
  icon: ReactNode,
  items: ContextMenuItem[],
): ContextMenuSection {
  return {
    items: [
      {
        id,
        label,
        icon,
        submenu: [
          {
            id: `${id}-options`,
            items,
          },
        ],
      },
    ],
  };
}

export async function writeContextMenuClipboardText(
  text: string,
  label = 'Text',
  onCopy?: (text: string, label: string) => void | Promise<void>,
  onCopyFeedback?: ContextMenuCopyFeedback,
): Promise<void> {
  try {
    if (onCopy) {
      await onCopy(text, label);
    } else {
      const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
      if (!clipboard?.writeText) {
        onCopyFeedback?.('Clipboard is not available in this window.', 'warning');
        return;
      }
      await clipboard.writeText(text);
    }
    onCopyFeedback?.(`${label} copied.`, 'success');
  } catch (error) {
    console.warn(`Could not copy ${label.toLowerCase()} from context menu.`, error);
    onCopyFeedback?.(`Could not copy ${label.toLowerCase()}.`, 'error');
  }
}
