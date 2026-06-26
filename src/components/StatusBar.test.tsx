import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StatusBar } from './StatusBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => undefined;

let container: HTMLDivElement;
let root: Root;

describe('StatusBar', () => {
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
});
