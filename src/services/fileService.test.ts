import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  clearPendingDocumentOpen,
  clearPendingMarkdownOpen,
  createGeneratedSiblingArtifact,
  getInitialDocumentPath,
  getInitialMarkdownPath,
  grantExternalPath,
  listReadableFiles,
  peekPendingDocumentOpen,
  peekPendingMarkdownOpen,
  pickDocumentFile,
  pickMarkdownFile,
  pickSavePath,
  readTextFile,
  readTextFileForEdit,
  statFile,
  syncDocumentImageGrants,
  takePendingDocumentOpen,
  takePendingMarkdownOpen,
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

  it('keeps Markdown picker and generic document picker on separate native commands', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce('C:\\docs\\paper.md')
      .mockResolvedValueOnce('C:\\docs\\results.json');

    await expect(pickMarkdownFile()).resolves.toBe('C:\\docs\\paper.md');
    await expect(pickDocumentFile()).resolves.toBe('C:\\docs\\results.json');

    expect(invoke).toHaveBeenNthCalledWith(1, 'pick_markdown_file');
    expect(invoke).toHaveBeenNthCalledWith(2, 'pick_document_file');
  });

  it('passes the active document format to the native Save As dialog', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('C:\\docs\\config.yaml');

    await expect(pickSavePath('Untitled.yaml', 'yaml')).resolves.toBe('C:\\docs\\config.yaml');

    expect(invoke).toHaveBeenCalledWith('pick_save_path', {
      defaultPath: 'Untitled.yaml',
      format: 'yaml',
    });
  });

  it('keeps generic document launch aliases tied to the Markdown launch queue', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce('C:\\docs\\startup.md')
      .mockResolvedValueOnce('C:\\docs\\startup.md')
      .mockResolvedValueOnce('C:\\docs\\pending.md')
      .mockResolvedValueOnce('C:\\docs\\pending.md')
      .mockResolvedValueOnce('C:\\docs\\taken.md')
      .mockResolvedValueOnce('C:\\docs\\taken.md')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await expect(getInitialMarkdownPath()).resolves.toBe('C:\\docs\\startup.md');
    await expect(getInitialDocumentPath()).resolves.toBe('C:\\docs\\startup.md');
    await expect(peekPendingMarkdownOpen()).resolves.toBe('C:\\docs\\pending.md');
    await expect(peekPendingDocumentOpen()).resolves.toBe('C:\\docs\\pending.md');
    await expect(takePendingMarkdownOpen()).resolves.toBe('C:\\docs\\taken.md');
    await expect(takePendingDocumentOpen()).resolves.toBe('C:\\docs\\taken.md');
    await clearPendingMarkdownOpen('C:\\docs\\old.md');
    await clearPendingDocumentOpen('C:\\docs\\old.md');

    expect(invoke).toHaveBeenNthCalledWith(1, 'initial_markdown_path');
    expect(invoke).toHaveBeenNthCalledWith(2, 'initial_document_path');
    expect(invoke).toHaveBeenNthCalledWith(3, 'peek_pending_markdown_open');
    expect(invoke).toHaveBeenNthCalledWith(4, 'peek_pending_document_open');
    expect(invoke).toHaveBeenNthCalledWith(5, 'take_pending_markdown_open');
    expect(invoke).toHaveBeenNthCalledWith(6, 'take_pending_document_open');
    expect(invoke).toHaveBeenNthCalledWith(7, 'clear_pending_markdown_open', { path: 'C:\\docs\\old.md' });
    expect(invoke).toHaveBeenNthCalledWith(8, 'clear_pending_document_open', { path: 'C:\\docs\\old.md' });
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

  it('lists readable explorer entries through the document native boundary', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      {
        name: 'notes',
        path: 'C:\\docs\\notes',
        kind: 'directory',
        sizeBytes: 0,
        modifiedMs: 1,
      },
      {
        name: 'paper.md',
        path: 'C:\\docs\\paper.md',
        kind: 'markdown',
        sizeBytes: 7,
        modifiedMs: 2,
      },
      {
        name: 'results.json',
        path: 'C:\\docs\\results.json',
        kind: 'json',
        sizeBytes: 12,
        modifiedMs: 3,
      },
      {
        name: 'records.jsonl',
        path: 'C:\\docs\\records.jsonl',
        kind: 'jsonl',
        sizeBytes: 18,
        modifiedMs: 4,
      },
      {
        name: 'config.yaml',
        path: 'C:\\docs\\config.yaml',
        kind: 'yaml',
        sizeBytes: 20,
        modifiedMs: 5,
      },
      {
        name: 'settings.toml',
        path: 'C:\\docs\\settings.toml',
        kind: 'toml',
        sizeBytes: 24,
        modifiedMs: 6,
      },
      {
        name: 'metadata.xml',
        path: 'C:\\docs\\metadata.xml',
        kind: 'xml',
        sizeBytes: 28,
        modifiedMs: 7,
      },
      {
        name: 'samples.csv',
        path: 'C:\\docs\\samples.csv',
        kind: 'csv',
        sizeBytes: 32,
        modifiedMs: 8,
      },
      {
        name: 'samples.tsv',
        path: 'C:\\docs\\samples.tsv',
        kind: 'tsv',
        sizeBytes: 36,
        modifiedMs: 9,
      },
    ]);

    await expect(listReadableFiles('C:\\docs')).resolves.toEqual([
      {
        name: 'notes',
        path: 'C:\\docs\\notes',
        kind: 'directory',
        sizeBytes: 0,
        modifiedMs: 1,
      },
      {
        name: 'paper.md',
        path: 'C:\\docs\\paper.md',
        kind: 'markdown',
        sizeBytes: 7,
        modifiedMs: 2,
      },
      {
        name: 'results.json',
        path: 'C:\\docs\\results.json',
        kind: 'json',
        sizeBytes: 12,
        modifiedMs: 3,
      },
      {
        name: 'records.jsonl',
        path: 'C:\\docs\\records.jsonl',
        kind: 'jsonl',
        sizeBytes: 18,
        modifiedMs: 4,
      },
      {
        name: 'config.yaml',
        path: 'C:\\docs\\config.yaml',
        kind: 'yaml',
        sizeBytes: 20,
        modifiedMs: 5,
      },
      {
        name: 'settings.toml',
        path: 'C:\\docs\\settings.toml',
        kind: 'toml',
        sizeBytes: 24,
        modifiedMs: 6,
      },
      {
        name: 'metadata.xml',
        path: 'C:\\docs\\metadata.xml',
        kind: 'xml',
        sizeBytes: 28,
        modifiedMs: 7,
      },
      {
        name: 'samples.csv',
        path: 'C:\\docs\\samples.csv',
        kind: 'csv',
        sizeBytes: 32,
        modifiedMs: 8,
      },
      {
        name: 'samples.tsv',
        path: 'C:\\docs\\samples.tsv',
        kind: 'tsv',
        sizeBytes: 36,
        modifiedMs: 9,
      },
    ]);
    expect(invoke).toHaveBeenCalledWith('list_readable_files', {
      path: 'C:\\docs',
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
