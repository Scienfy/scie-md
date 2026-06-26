import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MutableRefObject } from 'react';
import { DEFAULT_METADATA } from '../documentState';
import { useExternalConflictReviewWorkflow } from './useExternalConflictReviewWorkflow';

const fileServiceMock = vi.hoisted(() => ({
  readTextFile: vi.fn(),
}));

vi.mock('../../services/fileService', () => ({
  readTextFile: fileServiceMock.readTextFile,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useExternalConflictReviewWorkflow', () => {
  let container: HTMLDivElement;
  let root: Root;
  let controls: ReturnType<typeof useExternalConflictReviewWorkflow> | null;
  let documentEpochRef: MutableRefObject<number>;
  let adoptReviewedDiskMerge: ReturnType<typeof vi.fn>;
  let pushToast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    controls = null;
    documentEpochRef = { current: 1 };
    adoptReviewedDiskMerge = vi.fn((_content: string, _diskContent: string, _metadata: typeof DEFAULT_METADATA) => undefined);
    pushToast = vi.fn((_text: string, _tone?: 'error' | 'warning' | 'info' | 'success') => undefined);
    fileServiceMock.readTextFile.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('does not apply a disk review after the document epoch changes', async () => {
    fileServiceMock.readTextFile.mockResolvedValueOnce({
      content: 'Disk edit.\n',
      metadata: DEFAULT_METADATA,
    });
    renderWorkflow('C:\\docs\\a.md');

    await act(async () => {
      await controls?.openExternalConflictReview();
    });
    documentEpochRef.current += 1;

    act(() => {
      controls?.applyExternalConflictReview(new Set());
    });

    expect(adoptReviewedDiskMerge).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      'Disk review was closed because the document changed before it was applied.',
      'warning',
    );
  });

  function renderWorkflow(filePath: string | null) {
    act(() => {
      root.render(
        <Harness
          filePath={filePath}
          documentEpochRef={documentEpochRef}
          adoptReviewedDiskMerge={adoptReviewedDiskMerge as never}
          pushToast={pushToast as never}
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
  documentEpochRef,
  adoptReviewedDiskMerge,
  pushToast,
  onControls,
}: {
  filePath: string | null;
  documentEpochRef: MutableRefObject<number>;
  adoptReviewedDiskMerge: (content: string, diskContent: string, diskMetadata: typeof DEFAULT_METADATA) => void;
  pushToast: (text: string, tone?: 'error' | 'warning' | 'info' | 'success') => void;
  onControls: (controls: ReturnType<typeof useExternalConflictReviewWorkflow>) => void;
}) {
  const controls = useExternalConflictReviewWorkflow({
    filePath,
    documentEpochRef,
    markdown: 'Local edit.\n',
    lastSavedMarkdown: 'Base.\n',
    adoptReviewedDiskMerge,
    setAuthorshipMarks: (() => undefined) as never,
    pushToast,
  });
  onControls(controls);
  return null;
}
