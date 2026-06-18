import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { grantExternalPath, statFile } from './fileService';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('fileService', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue({
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

  it('uses metadata-only stat calls by default', async () => {
    await statFile('C:\\docs\\paper.md');

    expect(invoke).toHaveBeenCalledWith('stat_file', {
      path: 'C:\\docs\\paper.md',
      includeContentHash: false,
    });
  });

  it('allows callers to opt into content hashing for conflict-sensitive writes', async () => {
    await statFile('C:\\docs\\paper.md', { contentHash: true });

    expect(invoke).toHaveBeenCalledWith('stat_file', {
      path: 'C:\\docs\\paper.md',
      includeContentHash: true,
    });
  });

  it('can grant validated external image paths before non-dialog reads', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('C:\\docs\\figure.png');

    await expect(grantExternalPath('C:\\docs\\figure.png', 'image')).resolves.toBe('C:\\docs\\figure.png');
    expect(invoke).toHaveBeenCalledWith('grant_external_path', {
      path: 'C:\\docs\\figure.png',
      kind: 'image',
    });
  });
});
