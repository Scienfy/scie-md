import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusBar } from './StatusBar';
import { formatCapabilitiesFor } from '../app/formatCapabilities';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => undefined;

let container: HTMLDivElement;
let root: Root;
let writeClipboardText: ReturnType<typeof vi.fn>;

describe('StatusBar', () => {
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
    document.body.innerHTML = '';
  });

  it('labels the readiness score so the number is understandable', () => {
    act(() => {
      root.render(
        <StatusBar
          autosaveStatus="saved"
          statusText="Saved"
          headingPath={[]}
          wordCount={1200}
          manuscriptScore={73}
          manuscriptStatus="needs-review"
          errors={[]}
          warnings={[]}
          externalConflict={false}
          filePath={null}
          onReviewConflict={noop}
          onSaveAnyway={noop}
          onReveal={noop}
          onReload={noop}
          onJumpToHeading={noop}
          onOpenReadiness={noop}
          onOpenValidation={noop}
          onSaveNow={noop}
        />,
      );
    });

    expect(container.querySelector('.status-readiness')?.textContent).toContain('Readiness');
    expect(container.querySelector('.status-readiness')?.textContent).toContain('73');
  });

  it('opens review surfaces from readiness and validation indicators', () => {
    let readinessOpened = 0;
    let validationOpened = 0;

    act(() => {
      root.render(
        <StatusBar
          autosaveStatus="saved"
          statusText="Saved"
          headingPath={[]}
          wordCount={1200}
          manuscriptScore={73}
          manuscriptStatus="needs-review"
          errors={['Broken syntax']}
          warnings={['Missing citation']}
          externalConflict={false}
          filePath={null}
          onReviewConflict={noop}
          onSaveAnyway={noop}
          onReveal={noop}
          onReload={noop}
          onJumpToHeading={noop}
          onOpenReadiness={() => { readinessOpened += 1; }}
          onOpenValidation={() => { validationOpened += 1; }}
          onSaveNow={noop}
        />,
      );
    });

    act(() => {
      container.querySelector<HTMLButtonElement>('.status-readiness')?.click();
      container.querySelector<HTMLButtonElement>('.status-badge.error')?.click();
      container.querySelector<HTMLButtonElement>('.status-badge.warning')?.click();
    });

    expect(readinessOpened).toBe(1);
    expect(validationOpened).toBe(2);
  });

  it('offers save now from the status bar for unsaved documents', () => {
    let saveRequested = 0;

    act(() => {
      root.render(
        <StatusBar
          autosaveStatus="idle"
          statusText="Autosave off until saved"
          headingPath={[]}
          wordCount={1200}
          manuscriptScore={73}
          manuscriptStatus="needs-review"
          errors={[]}
          warnings={[]}
          externalConflict={false}
          filePath={null}
          onReviewConflict={noop}
          onSaveAnyway={noop}
          onReveal={noop}
          onReload={noop}
          onJumpToHeading={noop}
          onOpenReadiness={noop}
          onOpenValidation={noop}
          onSaveNow={() => { saveRequested += 1; }}
        />,
      );
    });

    act(() => {
      container.querySelector<HTMLButtonElement>('.status-inline-action.warning')?.click();
    });

    expect(saveRequested).toBe(1);
  });

  it('hides manuscript readiness and word-count indicators for source-only formats', () => {
    act(() => {
      root.render(
        <StatusBar
          formatCapabilities={formatCapabilitiesFor('json')}
          autosaveStatus="saved"
          statusText="Saved"
          headingPath={[{ id: 'root', level: 1, text: 'JSON Root', line: 1 }]}
          wordCount={1200}
          manuscriptScore={73}
          manuscriptStatus="needs-review"
          errors={[]}
          warnings={[]}
          externalConflict={false}
          filePath="C:\\data.json"
          onReviewConflict={noop}
          onSaveAnyway={noop}
          onReveal={noop}
          onReload={noop}
          onJumpToHeading={noop}
          onOpenReadiness={noop}
          onOpenValidation={noop}
          onSaveNow={noop}
        />,
      );
    });

    expect(container.querySelector('.status-readiness')).toBeNull();
    expect(container.querySelector('.status-word-count')).toBeNull();
    expect(container.querySelector('.status-breadcrumb')).toBeNull();
    expect(container.querySelector('.status-save-text')?.textContent).toBe('Saved');
  });

  it('shows only the current heading in the compact status breadcrumb', () => {
    let jumpedTo = '';
    const headingPath = [
      { id: 'root', level: 1, text: 'Very Long Root Document Title That Should Not Fill The Status Bar', line: 1 },
      { id: 'phase', level: 2, text: 'Phase 2 Optional Depth Time Editor', line: 12 },
      { id: 'active', level: 3, text: 'Constraint Editing', line: 45 },
    ];

    act(() => {
      root.render(
        <StatusBar
          autosaveStatus="saved"
          statusText="Saved"
          headingPath={headingPath}
          wordCount={1200}
          manuscriptScore={73}
          manuscriptStatus="needs-review"
          errors={[]}
          warnings={[]}
          externalConflict={false}
          filePath="C:\\paper.md"
          onReviewConflict={noop}
          onSaveAnyway={noop}
          onReveal={noop}
          onReload={noop}
          onJumpToHeading={(heading) => { jumpedTo = heading.id; }}
          onOpenReadiness={noop}
          onOpenValidation={noop}
          onSaveNow={noop}
        />,
      );
    });

    const breadcrumb = container.querySelector('.status-breadcrumb');
    const button = breadcrumb?.querySelector<HTMLButtonElement>('button');
    expect(button?.textContent).toBe('Constraint Editing');
    expect(breadcrumb?.textContent).not.toContain('Very Long Root');
    expect(button?.title).toContain('Very Long Root Document Title');

    act(() => {
      button?.click();
    });

    expect(jumpedTo).toBe('active');
  });

  it('opens current-heading context actions with copy feedback', async () => {
    const onJumpToHeading = vi.fn();
    const onCopyFeedback = vi.fn();
    const headingPath = [
      { id: 'root', level: 1, text: 'Study', line: 1 },
      { id: 'methods', level: 2, text: 'Methods', line: 18 },
    ];

    act(() => {
      root.render(
        <StatusBar
          autosaveStatus="saved"
          statusText="Saved"
          headingPath={headingPath}
          wordCount={1200}
          manuscriptScore={73}
          manuscriptStatus="needs-review"
          errors={[]}
          warnings={[]}
          externalConflict={false}
          filePath="C:\\paper.md"
          onReviewConflict={noop}
          onSaveAnyway={noop}
          onReveal={noop}
          onReload={noop}
          onJumpToHeading={onJumpToHeading}
          onOpenReadiness={noop}
          onOpenValidation={noop}
          onSaveNow={noop}
          onCopyFeedback={onCopyFeedback}
        />,
      );
    });

    const breadcrumbButton = container.querySelector<HTMLButtonElement>('.status-breadcrumb button');
    expect(breadcrumbButton).not.toBeNull();
    openContextMenu(breadcrumbButton!);
    await clickContextMenuItem('Jump to heading');
    expect(onJumpToHeading).toHaveBeenCalledWith(headingPath[1]);

    openContextMenu(breadcrumbButton!);
    await clickContextMenuItem('Copy');
    await clickContextMenuItem('Copy section path');

    expect(writeClipboardText).toHaveBeenLastCalledWith('Study / Methods');
    expect(onCopyFeedback).toHaveBeenLastCalledWith('Copy section path copied.', 'success');
  });
});

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
