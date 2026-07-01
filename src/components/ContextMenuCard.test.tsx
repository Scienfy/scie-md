import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ContextMenuCard,
  getContextMenuPosition,
  getContextSubmenuPosition,
  type ContextMenuSection,
} from './ContextMenuCard';
import {
  contextMenuPositionFromElement,
  contextMenuPositionFromEvent,
  copyContextMenuItem,
  copyContextMenuSection,
  isKeyboardContextMenuEvent,
  writeContextMenuClipboardText,
} from './contextMenuUtils';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

describe('ContextMenuCard', () => {
  beforeEach(() => {
    setViewport(1024, 768);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  it('renders grouped sections with icons, shortcut text, separators, and submenu chevrons', () => {
    renderMenu();

    expect(document.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('Row actions');
    expect(menuButton('Rename chat')?.querySelector('.context-menu-icon')?.textContent).toBe('P');
    expect(menuButton('Unpin chat')?.querySelector('.context-menu-shortcut')?.textContent).toBe('Ctrl+Alt+P');
    expect(menuButton('Copy')?.getAttribute('aria-haspopup')).toBe('menu');
    expect(menuButton('Copy')?.querySelector('.context-menu-chevron svg')).not.toBeNull();
    expect(document.querySelectorAll('.context-menu-separator')).toHaveLength(2);
    expect(menuButton('Add scheduled task')?.getAttribute('aria-disabled')).toBe('true');
  });

  it('does not activate disabled items', async () => {
    const onDisabled = vi.fn();
    const onClose = vi.fn();
    renderMenu(onClose, [{
      items: [
        {
          id: 'disabled',
          label: 'Unavailable action',
          disabled: true,
          disabledReason: 'Read-only node',
          onSelect: onDisabled,
        },
      ],
    }]);

    await act(async () => {
      menuButton('Unavailable action')?.click();
      await Promise.resolve();
    });

    expect(onDisabled).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(menuButton('Unavailable action')?.getAttribute('title')).toBe('Read-only node');
  });

  it('closes on Escape and outside pointer down', () => {
    const onClose = vi.fn();
    renderMenu(onClose);

    act(() => {
      menuButton('Unpin chat')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('restores focus to the invoking target when dismissed', async () => {
    const invoker = document.createElement('button');
    invoker.textContent = 'Open menu';
    document.body.appendChild(invoker);
    invoker.focus();

    const onClose = vi.fn(() => {
      root.render(<></>);
    });
    renderMenu(onClose, [{ items: [{ id: 'copy', label: 'Copy value' }] }], { x: 120, y: 96 }, invoker);

    expect(document.activeElement).toBe(menuButton('Copy value'));

    await act(async () => {
      menuButton('Copy value')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await nextAnimationFrame();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(invoker);
  });

  it('runs an enabled item and closes after successful activation', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderMenu(onClose, [{ items: [{ id: 'copy', label: 'Copy value', onSelect }] }]);

    await act(async () => {
      menuButton('Copy value')?.click();
      await Promise.resolve();
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves keyboard focus through all rows, including aria-disabled rows', () => {
    renderMenu();

    const first = menuButton('Unpin chat')!;
    const second = menuButton('Rename chat')!;
    const disabled = menuButton('Add scheduled task')!;

    expect(document.activeElement).toBe(first);

    act(() => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement).toBe(second);

    act(() => {
      second.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    const archive = menuButton('Archive chat')!;
    expect(document.activeElement).toBe(archive);

    act(() => {
      archive.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    const sideChat = menuButton('Open side chat')!;
    expect(document.activeElement).toBe(sideChat);

    act(() => {
      sideChat.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    const copy = menuButton('Copy')!;
    expect(document.activeElement).toBe(copy);

    act(() => {
      copy.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement).toBe(disabled);
  });

  it('opens a submenu on hover and uses the same menu role for the flyout card', () => {
    renderMenu();

    act(() => {
      menuButton('Copy')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    expect(menuButton('Copy working directory')).not.toBeNull();
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(2);
    expect(menuButton('Copy')?.classList.contains('is-active')).toBe(true);
    expect(menuButton('Copy')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders submenu flyouts as overlay siblings so parent card scrolling cannot clip them', () => {
    renderMenu();

    act(() => {
      menuButton('Copy')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    const cards = Array.from(document.querySelectorAll<HTMLElement>('.context-menu-card'));
    expect(cards).toHaveLength(2);
    expect(cards[0].contains(cards[1])).toBe(false);
    expect(cards[1].parentElement?.classList.contains('context-menu-root')).toBe(true);
  });

  it('opens submenus with ArrowRight and returns focus with ArrowLeft', () => {
    renderMenu();
    const copyButton = menuButton('Copy')!;

    act(() => {
      copyButton.focus();
      copyButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });

    const firstSubmenuItem = menuButton('Copy working directory')!;
    expect(document.activeElement).toBe(firstSubmenuItem);

    act(() => {
      firstSubmenuItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });

    expect(document.activeElement).toBe(copyButton);
    expect(menuButton('Copy working directory')).toBeNull();
  });

  it('clamps root and submenu positions to the visible viewport', () => {
    expect(getContextMenuPosition(
      { x: 980, y: 740 },
      { width: 300, height: 220 },
      { width: 1024, height: 768 },
    )).toEqual({ left: 716, top: 540 });

    expect(getContextSubmenuPosition(
      { left: 900, top: 700, right: 980, bottom: 746, width: 80, height: 46 },
      { width: 260, height: 180 },
      { width: 1024, height: 768 },
    )).toEqual({ left: 642, top: 580 });
  });

  it('applies clamped fixed positioning in the rendered menu', () => {
    setViewport(1000, 800);
    renderMenu(vi.fn(), [{ items: [{ id: 'inspect', label: 'Inspect row' }] }], { x: 960, y: 760 });

    const menu = document.querySelector<HTMLElement>('.context-menu-card')!;
    expect(menu.style.left).toBe('756px');
    expect(menu.style.top).toBe('500px');
  });

  it('builds reusable copy items and clipboard actions', async () => {
    const onCopy = vi.fn().mockResolvedValue(undefined);
    const item = copyContextMenuItem({
      id: 'copy-path',
      label: 'Copy path',
      text: 'C:\\lab\\file.json',
      icon: <span>C</span>,
      onCopy,
    });
    const section = copyContextMenuSection('copy', 'Copy', <span>C</span>, [item]);

    expect(section.items[0].submenu?.[0].items[0].label).toBe('Copy path');

    await item.onSelect?.(item);
    expect(onCopy).toHaveBeenCalledWith('C:\\lab\\file.json', 'Copy path');
  });

  it('normalizes context menu positions from pointer events', () => {
    expect(contextMenuPositionFromEvent({ clientX: 42, clientY: 84 })).toEqual({ x: 42, y: 84 });
  });

  it('detects keyboard context-menu requests and positions them from the invoking element', () => {
    const element = document.createElement('button');
    Object.defineProperty(element, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 20, top: 40, width: 80, height: 24, right: 100, bottom: 64 }),
    });

    expect(isKeyboardContextMenuEvent({ key: 'ContextMenu', shiftKey: false })).toBe(true);
    expect(isKeyboardContextMenuEvent({ key: 'F10', shiftKey: true })).toBe(true);
    expect(isKeyboardContextMenuEvent({ key: 'F10', shiftKey: false })).toBe(false);
    expect(contextMenuPositionFromElement(element)).toEqual({ x: 52, y: 56 });
  });

  it('uses navigator clipboard when no copy adapter is supplied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    await writeContextMenuClipboardText('structured value', 'Structured value');

    expect(writeText).toHaveBeenCalledWith('structured value');
  });

  it('reports copy success, unavailable clipboard, and copy failures through feedback', async () => {
    const onCopyFeedback = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    await writeContextMenuClipboardText('structured value', 'Structured value', undefined, onCopyFeedback);

    expect(onCopyFeedback).toHaveBeenLastCalledWith('Structured value copied.', 'success');

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {},
    });

    await writeContextMenuClipboardText('other value', 'Other value', undefined, onCopyFeedback);

    expect(onCopyFeedback).toHaveBeenLastCalledWith('Clipboard is not available in this window.', 'warning');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) },
    });

    await writeContextMenuClipboardText('failing value', 'Failing value', undefined, onCopyFeedback);

    expect(onCopyFeedback).toHaveBeenLastCalledWith('Could not copy failing value.', 'error');
    warn.mockRestore();
  });
});

function renderMenu(
  onClose = vi.fn(),
  sections: ContextMenuSection[] = screenshotLikeSections(),
  position = { x: 120, y: 96 },
  restoreFocusTo?: HTMLElement | null,
) {
  act(() => {
    root.render(
      <ContextMenuCard
        ariaLabel="Row actions"
        sections={sections}
        position={position}
        restoreFocusTo={restoreFocusTo}
        onClose={onClose}
      />,
    );
  });
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function screenshotLikeSections(): ContextMenuSection[] {
  return [
    {
      id: 'primary',
      items: [
        { id: 'unpin', label: 'Unpin chat', icon: <span>P</span>, shortcut: 'Ctrl+Alt+P' },
        { id: 'rename', label: 'Rename chat', icon: <span>P</span>, shortcut: 'Ctrl+Alt+R' },
        { id: 'archive', label: 'Archive chat', icon: <span>A</span>, shortcut: 'Ctrl+Shift+A' },
      ],
    },
    {
      id: 'secondary',
      items: [
        { id: 'side-chat', label: 'Open side chat', icon: <span>O</span>, shortcut: 'Ctrl+Alt+S' },
        {
          id: 'copy',
          label: 'Copy',
          icon: <span>C</span>,
          submenu: [
            {
              id: 'copy-options',
              items: [
                { id: 'copy-cwd', label: 'Copy working directory', icon: <span>C</span>, shortcut: 'Ctrl+Shift+C' },
                { id: 'copy-session', label: 'Copy session ID', icon: <span>C</span>, shortcut: 'Ctrl+Alt+C' },
                { id: 'copy-deeplink', label: 'Copy deeplink', icon: <span>C</span>, shortcut: 'Ctrl+Alt+L' },
                { id: 'copy-markdown', label: 'Copy as Markdown', icon: <span>C</span> },
              ],
            },
          ],
        },
        {
          id: 'scheduled-task',
          label: 'Add scheduled task',
          icon: <span>T</span>,
          disabled: true,
          disabledReason: 'No scheduling provider is available.',
        },
      ],
    },
    {
      id: 'window',
      items: [
        { id: 'new-window', label: 'Open in new window', icon: <span>W</span> },
      ],
    },
  ];
}

function menuButton(label: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.context-menu-item'))
    .find((button) => button.textContent?.includes(label)) ?? null;
}

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}
