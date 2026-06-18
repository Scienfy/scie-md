import { act } from 'react';
import type { ComponentProps } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownToolbar } from './MarkdownToolbar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => undefined;

let container: HTMLDivElement;
let root: Root;

describe('MarkdownToolbar', () => {
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

  it('keeps citation visible and moves variable, LLM note, versions, and secondary inserts into More', () => {
    renderToolbar();

    expect(container.querySelector('[aria-label="Variable"]')).toBeNull();
    expect(container.querySelector('[aria-label="Note to LLM"]')).toBeNull();
    expect(container.querySelector('[aria-label="Text versions"]')).toBeNull();
    expect(container.querySelector('[aria-label="Citation"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="More insert tools"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Horizontal rule"]')).toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="More insert tools"]')?.click();
    });

    const menu = container.querySelector('.toolbar-more-menu');
    expect(menu?.querySelector('[aria-label="Variable"]')).not.toBeNull();
    expect(menu?.querySelector('[aria-label="Note to LLM"]')).not.toBeNull();
    expect(menu?.querySelector('[aria-label="Text versions"]')).not.toBeNull();
    expect(menu?.textContent).toContain('Task');
    expect(menu?.textContent).toContain('Code block');
    expect(menu?.textContent).toContain('Inline math');
    expect(menu?.textContent).toContain('Math block');
    expect(menu?.textContent).toContain('Figure block');
    expect(menu?.textContent).toContain('Note to Human');
    expect(menu?.textContent).toContain('Horizontal rule');
  });

  it('uses the same table picker entry point as slash table insertion', () => {
    const onOpenTablePicker = vi.fn();
    renderToolbar({ onOpenTablePicker });

    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Table"]')?.click();
    });

    expect(onOpenTablePicker).toHaveBeenCalledTimes(1);
  });
});

function renderToolbar(overrides: Partial<ComponentProps<typeof MarkdownToolbar>> = {}) {
  act(() => {
    root.render(
      <MarkdownToolbar
        mode="source"
        visualEditor={undefined}
        onInsertMarkdown={noop}
        onInsertImage={noop}
        onInsertCitation={noop}
        onInsertVariable={noop}
        onInsertLlmNote={noop}
        onInsertHumanNote={noop}
        onInsertVariantGroup={noop}
        onOpenTablePicker={noop}
        onUndo={noop}
        onRedo={noop}
        onInsertLink={noop}
        nextFigureLabel="fig-1"
        {...overrides}
      />,
    );
  });
}
