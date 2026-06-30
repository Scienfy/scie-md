import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_DELAY_MS, AUTOSAVE_MAX_WAIT_MS } from '../../services/autosaveService';
import { useAutosaveTimer } from './useAutosaveTimer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SaveCurrent = (options?: { autosave?: boolean; forceSaveAs?: boolean }) => Promise<string | false>;
type SetAutosaveStatus = (status: 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict') => void;
type MockedCallback<T extends (...args: any[]) => unknown> = T & ReturnType<typeof vi.fn>;

describe('useAutosaveTimer', () => {
  let container: HTMLDivElement;
  let root: Root;
  let saveCurrent: MockedCallback<SaveCurrent>;
  let setAutosaveStatus: MockedCallback<SetAutosaveStatus>;
  let controls: ReturnType<typeof useAutosaveTimer> | null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    saveCurrent = vi.fn().mockResolvedValue('C:\\docs\\paper.md') as MockedCallback<SaveCurrent>;
    setAutosaveStatus = vi.fn() as MockedCallback<SetAutosaveStatus>;
    controls = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('debounces autosave again when markdown changes while dirty remains true', () => {
    renderAutosave({ markdown: 'draft one', dirty: true });

    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);
    });
    renderAutosave({ markdown: 'draft two', dirty: true });
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(saveCurrent).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    });

    expect(saveCurrent).toHaveBeenCalledTimes(1);
    expect(saveCurrent).toHaveBeenCalledWith({ autosave: true });
  });

  it('flushes immediately and cancels the pending timer', async () => {
    renderAutosave({ markdown: 'draft one', dirty: true });

    await act(async () => {
      await controls?.flushAutosave();
    });
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    });

    expect(saveCurrent).toHaveBeenCalledTimes(1);
    expect(saveCurrent).toHaveBeenCalledWith({ autosave: true });
  });

  it('returns false when flushing a dirty document while autosave is blocked', async () => {
    renderAutosave({ markdown: 'draft one', dirty: true, autosaveBlocked: true });

    let result: unknown = true;
    await act(async () => {
      result = await controls?.flushAutosave();
    });

    expect(result).toBe(false);
    expect(saveCurrent).not.toHaveBeenCalled();
  });

  it('marks autosave as error when the scheduled save rejects', async () => {
    saveCurrent.mockRejectedValueOnce(new Error('disk full'));
    renderAutosave({ markdown: 'draft one', dirty: true });

    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await Promise.resolve();
    });

    expect(saveCurrent).toHaveBeenCalledWith({ autosave: true });
    expect(setAutosaveStatus).toHaveBeenLastCalledWith('error');
  });

  it('serializes overlapping autosave requests and reruns after the in-flight save settles', async () => {
    let resolveFirstSave: ((value: string) => void) | null = null;
    saveCurrent
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirstSave = resolve;
      }) as ReturnType<SaveCurrent>)
      .mockResolvedValueOnce('C:\\docs\\paper.md');
    renderAutosave({ markdown: 'draft one', dirty: true });

    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await Promise.resolve();
    });
    expect(saveCurrent).toHaveBeenCalledTimes(1);

    renderAutosave({ markdown: 'draft two', dirty: true });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await Promise.resolve();
    });
    expect(saveCurrent).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirstSave?.('C:\\docs\\paper.md');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveCurrent).toHaveBeenCalledTimes(2);
    expect(saveCurrent).toHaveBeenNthCalledWith(2, { autosave: true });
  });

  it('resumes autosave after the dirty close dialog is canceled', async () => {
    renderAutosave({ markdown: 'draft one', dirty: true });

    act(() => {
      controls?.cancelAutosave();
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    });
    expect(saveCurrent).not.toHaveBeenCalled();

    act(() => {
      controls?.resumeAutosave();
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(saveCurrent).toHaveBeenCalledTimes(1);
    expect(saveCurrent).toHaveBeenCalledWith({ autosave: true });
  });

  it('runs autosave at max-wait even when continuous typing keeps resetting the debounce timer', async () => {
    renderAutosave({ markdown: 'draft 0', dirty: true });

    for (let index = 1; index <= 6; index += 1) {
      act(() => {
        vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);
      });
      renderAutosave({ markdown: `draft ${index}`, dirty: true });
      expect(saveCurrent).not.toHaveBeenCalled();
    }

    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_MAX_WAIT_MS - (AUTOSAVE_DELAY_MS - 1) * 6);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(saveCurrent).toHaveBeenCalledTimes(1);
    expect(saveCurrent).toHaveBeenCalledWith({ autosave: true });
  });

  function renderAutosave(props: {
    markdown: string;
    dirty: boolean;
    autosaveBlocked?: boolean;
  }) {
    act(() => {
      root.render(
        <Harness
          filePath="C:\\docs\\paper.md"
          markdown={props.markdown}
          dirty={props.dirty}
          autosaveBlocked={props.autosaveBlocked}
          saveCurrent={saveCurrent}
          setAutosaveStatus={setAutosaveStatus}
          onControls={(nextControls) => {
            controls = nextControls;
          }}
        />,
      );
    });
  }
});

function Harness({
  filePath,
  markdown,
  dirty,
  autosaveBlocked,
  saveCurrent,
  setAutosaveStatus,
  onControls,
}: {
  filePath: string | null;
  markdown: string;
  dirty: boolean;
  autosaveBlocked?: boolean;
  saveCurrent: SaveCurrent;
  setAutosaveStatus: SetAutosaveStatus;
  onControls: (controls: ReturnType<typeof useAutosaveTimer>) => void;
}) {
  const controls = useAutosaveTimer({
    filePath,
    markdown,
    dirty,
    externalConflict: false,
    autosaveBlocked,
    saveCurrent,
    setAutosaveStatus,
  });
  onControls(controls);
  return null;
}
