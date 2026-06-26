import { invoke } from '@tauri-apps/api/core';
import type { FileMetadata, ReadTextFileResponse } from '../app/documentState';
import { DEFAULT_METADATA } from '../app/documentState';
import type { PandocExportFormat } from '../export/exportTypes';

export type FileExplorerEntryKind = 'directory' | 'markdown';

export interface FileExplorerEntry {
  name: string;
  path: string;
  kind: FileExplorerEntryKind;
  sizeBytes: number;
  modifiedMs: number;
}

export async function pickMarkdownFile(): Promise<string | null> {
  return invoke<string | null>('pick_markdown_file');
}

export async function pickFolder(): Promise<string | null> {
  return invoke<string | null>('pick_folder');
}

export async function pickSavePath(defaultPath?: string | null): Promise<string | null> {
  return invoke<string | null>('pick_save_path', { defaultPath: defaultPath ?? null });
}

export async function pickHtmlSavePath(defaultPath?: string | null): Promise<string | null> {
  return invoke<string | null>('pick_html_save_path', { defaultPath: defaultPath ?? null });
}

export async function pickCitationStyleFile(): Promise<string | null> {
  return invoke<string | null>('pick_citation_style_file');
}

export async function pickExportSavePath(
  format: PandocExportFormat,
  defaultPath?: string | null,
): Promise<string | null> {
  return invoke<string | null>('pick_pandoc_export_save_path', {
    defaultPath: defaultPath ?? null,
    format,
  });
}

export async function grantExternalPath(path: string, kind: 'image'): Promise<string> {
  return invoke<string>('grant_external_path', { path, kind });
}

export async function getInitialMarkdownPath(): Promise<string | null> {
  return invoke<string | null>('initial_markdown_path');
}

export async function peekPendingMarkdownOpen(): Promise<string | null> {
  return invoke<string | null>('peek_pending_markdown_open');
}

export async function takePendingMarkdownOpen(): Promise<string | null> {
  return invoke<string | null>('take_pending_markdown_open');
}

export async function clearPendingMarkdownOpen(path: string): Promise<void> {
  await invoke('clear_pending_markdown_open', { path });
}

export async function readTextFile(path: string): Promise<ReadTextFileResponse> {
  return invoke<ReadTextFileResponse>('read_text_file', { path });
}

export async function readTextFilePreview(path: string, maxBytes = 8192): Promise<{ content: string; modifiedMs: number }> {
  return invoke<{ content: string; modifiedMs: number }>('read_text_file_preview', { path, maxBytes });
}

export async function readBinaryFileBase64(path: string): Promise<string> {
  return invoke<string>('read_binary_file_base64', { path });
}

export async function listReadableFiles(path: string): Promise<FileExplorerEntry[]> {
  return invoke<FileExplorerEntry[]>('list_readable_files', { path });
}

export async function statFile(path: string, options: { contentHash?: boolean } = {}): Promise<FileMetadata> {
  return invoke<FileMetadata>('stat_file', {
    path,
    includeContentHash: options.contentHash ?? false,
  });
}

export async function writeTextFileAtomic(
  path: string,
  markdown: string,
  metadata: FileMetadata | null,
  expectedMetadata: FileMetadata | null = null,
): Promise<FileMetadata> {
  const writeMetadata = metadata ?? DEFAULT_METADATA;
  return invoke<FileMetadata>('write_text_file_atomic', {
    path,
    markdown,
    lineEnding: writeMetadata.lineEnding,
    encoding: writeMetadata.encoding,
    hasBom: writeMetadata.hasBom,
    expectedMtimeMs: expectedMetadata?.lastKnownMtimeMs ?? null,
    expectedSizeBytes: expectedMetadata?.lastKnownSizeBytes ?? null,
    expectedContentHash: expectedMetadata?.contentHash ?? null,
  });
}

export async function writeTextFileCreateNew(
  path: string,
  markdown: string,
  metadata: FileMetadata | null = null,
): Promise<FileMetadata> {
  const writeMetadata = metadata ?? DEFAULT_METADATA;
  return invoke<FileMetadata>('write_text_file_create_new', {
    path,
    markdown,
    lineEnding: writeMetadata.lineEnding,
    encoding: writeMetadata.encoding,
    hasBom: writeMetadata.hasBom,
  });
}

export async function createBackupSnapshot(path: string, label: string): Promise<string | null> {
  const result = await invoke<string | null>('create_backup_snapshot', { path, label });
  return result ?? null;
}

export async function listBackups(path: string): Promise<string[]> {
  return invoke<string[]>('list_backups', { path });
}

export async function cleanupStaleTempFilesForPaths(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await invoke('cleanup_stale_temp_files_for_paths', { paths });
}
