import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppTooltip } from './AppTooltip';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

describe('AppTooltip', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  it('shows title tooltips immediately and suppresses the native title while active', () => {
    renderTooltipHost(<button type="button" title="Save document"><span>Save</span></button>);
    const button = container.querySelector('button')!;
    setRect(button, { left: 20, top: 20, width: 40, height: 28 });

    act(() => {
      button.querySelector('span')?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    });

    expect(document.body.querySelector('.app-tooltip')?.textContent).toBe('Save document');
    expect(button.hasAttribute('title')).toBe(false);
    expect(button.getAttribute('data-native-title')).toBe('Save document');

    act(() => {
      button.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
    });

    expect(document.body.querySelector('.app-tooltip')).toBeNull();
    expect(button.getAttribute('title')).toBe('Save document');
  });

  it('uses aria-label for title-less controls', () => {
    renderTooltipHost(<button type="button" aria-label="Open command palette"><span>K</span></button>);
    const button = container.querySelector('button')!;
    setRect(button, { left: 20, top: 20, width: 40, height: 28 });

    act(() => {
      button.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    });

    expect(document.body.querySelector('.app-tooltip')?.textContent).toBe('Open command palette');
  });

  it('renders structured typed marker tooltips', () => {
    renderTooltipHost(
      <button
        type="button"
        data-tooltip="Note to LLM: Revise this abstract. (line 56)"
        data-tooltip-title="Note to LLM"
        data-tooltip-detail="Revise this abstract."
        data-tooltip-meta="Line 56"
        data-tooltip-kind="llm-comment"
      >
        Marker
      </button>,
    );
    const button = container.querySelector('button')!;
    setRect(button, { left: 20, top: 20, width: 40, height: 28 });

    act(() => {
      button.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    });

    const tooltip = document.body.querySelector('.app-tooltip');
    expect(tooltip?.classList.contains('app-tooltip-structured')).toBe(true);
    expect(tooltip?.classList.contains('app-tooltip-kind-llm-comment')).toBe(true);
    expect(tooltip?.querySelector('.app-tooltip-title')?.textContent).toBe('Note to LLM');
    expect(tooltip?.querySelector('.app-tooltip-detail')?.textContent).toBe('Revise this abstract.');
    expect(tooltip?.querySelector('.app-tooltip-meta')?.textContent).toBe('Line 56');
  });

  it('can anchor structured rail tooltips directly to the left of the target', () => {
    renderTooltipHost(
      <button
        type="button"
        data-tooltip="Locked section: approved wording. (line 102)"
        data-tooltip-title="Locked section"
        data-tooltip-detail="approved wording"
        data-tooltip-meta="Line 102"
        data-tooltip-kind="lock"
        data-tooltip-placement="left"
      >
        Lock
      </button>,
    );
    const button = container.querySelector('button')!;
    setRect(button, { left: 420, top: 80, width: 32, height: 32 });

    act(() => {
      button.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    });

    const tooltip = document.body.querySelector<HTMLElement>('.app-tooltip');
    expect(tooltip?.classList.contains('app-tooltip-left')).toBe(true);
    expect(tooltip?.style.left).toBe('412px');
    expect(tooltip?.style.top).toBe('96px');
  });
});

function renderTooltipHost(control: ReactNode) {
  act(() => {
    root.render(
      <>
        {control}
        <AppTooltip />
      </>,
    );
  });
}

function setRect(element: HTMLElement, rect: { left: number; top: number; width: number; height: number }) {
  element.getBoundingClientRect = () => ({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  });
}
