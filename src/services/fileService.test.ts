import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  createGeneratedSiblingArtifact,
  grantExternalPath,
  readTextFile,
  readTextFileForEdit,
  statFile,
  syncDocumentImageGrants,
} from './fileService';

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

  it('syncs current document image grants through the native boundary', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(2);

    await expect(syncDocumentImageGrants('C:\\docs\\paper.md', ['assets/a.png', 'assets/b.svg'])).resolves.toBe(2);
    expect(invoke).toHaveBeenCalledWith('sync_document_image_grants', {
      documentPath: 'C:\\docs\\paper.md',
      imageUrls: ['assets/a.png', 'assets/b.svg'],
    });
  });

  it('keeps generic text reads separate from edit-open text reads', async () => {
    await readTextFile('C:\\docs\\paper.md');
    await readTextFileForEdit('C:\\docs\\paper.md');

    expect(invoke).toHaveBeenNthCalledWith(1, 'read_text_file', {
      path: 'C:\\docs\\paper.md',
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'read_text_file_for_edit', {
      path: 'C:\\docs\\paper.md',
    });
  });

  it('creates allowlisted generated sibling artifacts through the native boundary', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      path: 'C:\\docs\\ScieMD_LLM_skill.md',
      metadata: {
        lineEnding: 'lf',
        encoding: 'utf8',
        hasBom: false,
        hasMixedLineEndings: false,
        lastKnownMtimeMs: 1,
        lastKnownSizeBytes: 2,
        contentHash: null,
        cloudState: 'local',
      },
    });

    await createGeneratedSiblingArtifact('C:\\docs\\paper.md', 'llm-skill', '# Skill\n');

    expect(invoke).toHaveBeenCalledWith('create_generated_sibling_artifact', {
      documentPath: 'C:\\docs\\paper.md',
      artifactKind: 'llm-skill',
      markdown: '# Skill\n',
      lineEnding: 'lf',
      encoding: 'utf8',
      hasBom: false,
    });
  });
});
