import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentInsights } from '../../markdown/documentIntelligence';
import { statFile, syncDocumentImageGrants } from '../../services/fileService';
import { useMissingImageDetection } from './useMissingImageDetection';

vi.mock('../../services/fileService', () => ({
  statFile: vi.fn(),
  syncDocumentImageGrants: vi.fn(),
}));

vi.mock('../runtime', () => ({
  isTauriRuntime: vi.fn(() => true),
}));

describe('useMissingImageDetection', () => {
  let container: HTMLDivElement;
  let root: Root;
  let counts: number[];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    counts = [];
    vi.mocked(syncDocumentImageGrants).mockResolvedValue(0);
    vi.mocked(statFile).mockResolvedValue({
      lineEnding: 'lf',
      encoding: 'utf8',
      hasBom: false,
      hasMixedLineEndings: false,
      lastKnownMtimeMs: 1,
      lastKnownSizeBytes: 2,
      contentHash: null,
      cloudState: 'local',
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('syncs exact document image grants before statting relative image references', async () => {
    vi.mocked(syncDocumentImageGrants).mockResolvedValueOnce(2);
    vi.mocked(statFile)
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error('missing'));

    await renderAndFlush(
      'C:\\docs\\paper.md',
      [
        { alt: 'A', url: 'assets/a.png', line: 1 },
        { alt: 'B', url: 'assets/b.png', line: 2 },
      ],
    );

    expect(syncDocumentImageGrants).toHaveBeenCalledWith('C:\\docs\\paper.md', ['assets/a.png', 'assets/b.png']);
    expect(statFile).toHaveBeenCalledWith('C:\\docs\\assets\\a.png', { contentHash: false });
    expect(statFile).toHaveBeenCalledWith('C:\\docs\\assets\\b.png', { contentHash: false });
    expect(vi.mocked(syncDocumentImageGrants).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(statFile).mock.invocationCallOrder[0],
    );
    expect(counts.at(-1)).toBe(1);
  });

  it('clears document image grants when the active document changes away', async () => {
    await renderAndFlush('C:\\docs\\paper.md', [{ alt: 'A', url: 'assets/a.png', line: 1 }]);

    await act(async () => {
      root.render(<Harness filePath={null} imageReferences={[]} onCount={(count) => counts.push(count)} />);
      await flushPromises();
    });

    expect(syncDocumentImageGrants).toHaveBeenCalledWith('C:\\docs\\paper.md', []);
  });

  async function renderAndFlush(
    filePath: string | null,
    imageReferences: DocumentInsights['imageReferences'],
  ) {
    await act(async () => {
      root.render(<Harness filePath={filePath} imageReferences={imageReferences} onCount={(count) => counts.push(count)} />);
      await flushPromises();
    });
  }
});

function Harness({
  filePath,
  imageReferences,
  onCount,
}: {
  filePath: string | null;
  imageReferences: DocumentInsights['imageReferences'];
  onCount: (count: number) => void;
}) {
  const count = useMissingImageDetection(filePath, imageReferences);
  useEffect(() => {
    onCount(count);
  }, [count, onCount]);
  return null;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
