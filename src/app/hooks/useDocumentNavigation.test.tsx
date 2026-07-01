import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorMode } from '../documentState';
import { useDocumentNavigation } from './useDocumentNavigation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

describe('useDocumentNavigation', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('reveals a structured source range by switching to source mode and selecting offsets', async () => {
    const sourceFindHandler = vi.fn();

    act(() => {
      root.render(<NavigationHarness sourceFindHandler={sourceFindHandler} />);
    });

    await act(async () => {
      button().click();
      await Promise.resolve();
    });

    expect(button().dataset.mode).toBe('source');
    expect(button().dataset.line).toBe('2');
    expect(sourceFindHandler).toHaveBeenCalledWith(5, 12);
  });

  it('navigates a normalized structured target through the source editor', async () => {
    const sourceFindHandler = vi.fn();

    act(() => {
      root.render(<NavigationHarness sourceFindHandler={sourceFindHandler} />);
    });

    await act(async () => {
      targetButton().click();
      await Promise.resolve();
    });

    expect(targetButton().dataset.mode).toBe('source');
    expect(targetButton().dataset.line).toBe('4');
    expect(sourceFindHandler).toHaveBeenCalledWith(20, 28);
  });
});

function NavigationHarness({
  sourceFindHandler,
}: {
  sourceFindHandler: (from: number, to: number) => void;
}) {
  const [mode, setMode] = useState<EditorMode>('visual');
  const navigation = useDocumentNavigation({
    mode,
    setMode,
    headings: [],
    sourceJumpHandler: undefined,
    sourceFindHandler,
    visualJumpHandler: undefined,
    visualFindHandler: undefined,
  });
  return (
    <>
      <button
        type="button"
        data-mode={mode}
        data-line={navigation.currentLine}
        onClick={() => navigation.revealSourceRange({ from: 5, to: 12, line: 2 })}
      >
        reveal
      </button>
      <button
        type="button"
        data-testid="target"
        data-mode={mode}
        data-line={navigation.currentLine}
        onClick={() => navigation.navigateStructuredTarget({
          kind: 'node',
          format: 'json',
          path: '$.study',
          sourceRange: {
            from: 20,
            to: 28,
            line: 4,
            displayPath: '$.study',
          },
        })}
      >
        target
      </button>
    </>
  );
}

function button(): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>('button');
  expect(element).not.toBeNull();
  return element!;
}

function targetButton(): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>('button[data-testid="target"]');
  expect(element).not.toBeNull();
  return element!;
}
