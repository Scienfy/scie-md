import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarkdownHeading } from '@sciemd/core';
import { QuickOutlineHover } from './QuickOutlineHover';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let writeClipboardText: ReturnType<typeof vi.fn>;

describe('QuickOutlineHover', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    writeClipboardText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: writeClipboardText,
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('does not render an empty floating outline control', () => {
    renderOutline([]);

    expect(container.querySelector('.quick-outline')).toBeNull();
    expect(container.textContent).not.toContain('No headings');
  });

  it('renders headings and emits jump requests when outline content exists', () => {
    const onJump = vi.fn();
    const headings: MarkdownHeading[] = [
      { id: 'intro', text: 'Intro', level: 1, line: 1 },
      { id: 'methods', text: 'Methods', level: 2, line: 12 },
    ];

    renderOutline(headings, { activeHeadingId: 'methods', onJump });

    expect(container.querySelector('.quick-outline')).not.toBeNull();
    expect(container.textContent).toContain('Intro');
    clickOutlineItem('Methods');

    expect(onJump).toHaveBeenCalledWith(headings[1]);
  });

  it('opens heading context actions with copy feedback', async () => {
    const onCopyFeedback = vi.fn();
    const headings: MarkdownHeading[] = [
      { id: 'intro', text: 'Intro', level: 1, line: 1 },
      { id: 'methods', text: 'Methods', level: 2, line: 12 },
    ];

    renderOutline(headings, { onCopyFeedback });

    const methods = outlineItem('Methods');
    openContextMenu(methods);
    await clickContextMenuItem('Copy');
    await clickContextMenuItem('Copy heading text');

    expect(writeClipboardText).toHaveBeenLastCalledWith('Methods');
    expect(onCopyFeedback).toHaveBeenLastCalledWith('Copy heading text copied.', 'success');
  });
});

function renderOutline(
  headings: MarkdownHeading[],
  options: {
    activeHeadingId?: string;
    onJump?: (heading: MarkdownHeading) => void;
    onCopyFeedback?: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  } = {},
): void {
  act(() => {
    root.render(
      <QuickOutlineHover
        headings={headings}
        activeHeadingId={options.activeHeadingId ?? null}
        onJump={options.onJump ?? vi.fn()}
        onCopyFeedback={options.onCopyFeedback}
      />,
    );
  });
}

function clickOutlineItem(text: string): void {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent === text);
  expect(button, `outline item "${text}"`).not.toBeUndefined();
  act(() => {
    button?.click();
  });
}

function outlineItem(text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('.quick-outline-item'))
    .find((candidate) => candidate.textContent === text);
  expect(button, `outline item "${text}"`).not.toBeUndefined();
  return button as HTMLButtonElement;
}

function openContextMenu(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 160,
      clientY: 96,
      button: 2,
    }));
  });
}

function contextMenuItem(label: string): HTMLButtonElement {
  const item = Array.from(document.querySelectorAll<HTMLButtonElement>('.context-menu-item'))
    .find((candidate) => candidate.querySelector('.context-menu-label')?.textContent === label);
  expect(item).toBeTruthy();
  return item as HTMLButtonElement;
}

function clickContextMenuItem(label: string) {
  const item = contextMenuItem(label);
  return act(async () => {
    item.click();
    await Promise.resolve();
  });
}
