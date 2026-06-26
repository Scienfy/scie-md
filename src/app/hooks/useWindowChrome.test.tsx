import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWindowChrome } from './useWindowChrome';

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    startDragging: vi.fn(),
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useWindowChrome', () => {
  let container: HTMLDivElement;
  let root: Root;
  let controls: ReturnType<typeof useWindowChrome> | null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    controls = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('pauses pending autosave before opening the dirty close dialog', () => {
    const onDirtyCloseRequested = vi.fn(() => undefined);
    const setCloseDialogOpen = vi.fn((_open: boolean) => undefined);
    const closeWindow = vi.fn(async () => undefined);

    renderChrome({ dirty: true, onDirtyCloseRequested, setCloseDialogOpen, closeWindow });

    act(() => {
      controls?.handleWindowClose();
    });

    expect(onDirtyCloseRequested).toHaveBeenCalledTimes(1);
    expect(setCloseDialogOpen).toHaveBeenCalledWith(true);
    expect(closeWindow).not.toHaveBeenCalled();
  });

  function renderChrome(props: {
    dirty: boolean;
    onDirtyCloseRequested?: () => void;
    setCloseDialogOpen: (open: boolean) => void;
    closeWindow: () => Promise<void>;
  }) {
    act(() => {
      root.render(
        <Harness
          {...props}
          onControls={(nextControls) => {
            controls = nextControls;
          }}
        />,
      );
    });
  }
});

function Harness({
  dirty,
  onDirtyCloseRequested,
  setCloseDialogOpen,
  closeWindow,
  onControls,
}: {
  dirty: boolean;
  onDirtyCloseRequested?: () => void;
  setCloseDialogOpen: (open: boolean) => void;
  closeWindow: () => Promise<void>;
  onControls: (controls: ReturnType<typeof useWindowChrome>) => void;
}) {
  const controls = useWindowChrome({ dirty, onDirtyCloseRequested, setCloseDialogOpen, closeWindow });
  onControls(controls);
  return null;
}
