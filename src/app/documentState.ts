import type { DocumentFormat } from '@sciemd/core';

export type EditorMode = 'visual' | 'source';

export type AutosaveStatus = 'idle' | 'pending' | 'paused' | 'saving' | 'saved' | 'error' | 'conflict';

export type LineEnding = 'lf' | 'crlf';
export type TextEncoding = 'utf8' | 'utf16le' | 'utf16be' | 'windows1252';
export type CloudFileState = 'local' | 'cloud-placeholder' | 'cloud-recall-on-open' | 'cloud-pinned' | 'unknown';

export interface FileMetadata {
  lineEnding: LineEnding;
  encoding: TextEncoding;
  hasBom: boolean;
  hasMixedLineEndings: boolean;
  lastKnownMtimeMs: number;
  lastKnownSizeBytes: number;
  contentHash: string | null;
  cloudState: CloudFileState;
}

export interface ReadTextFileResponse {
  content: string;
  metadata: FileMetadata;
}

export interface CopyImageResponse {
  markdownPath: string;
  fileName: string;
  altText: string;
}

export const DEFAULT_METADATA: FileMetadata = {
  lineEnding: 'lf',
  encoding: 'utf8',
  hasBom: false,
  hasMixedLineEndings: false,
  lastKnownMtimeMs: 0,
  lastKnownSizeBytes: 0,
  contentHash: null,
  cloudState: 'local',
};

export const UNTITLED_NAME = 'Untitled.md';

const UNTITLED_EXTENSION_BY_FORMAT: Record<DocumentFormat, string> = {
  markdown: 'md',
  json: 'json',
  jsonl: 'jsonl',
  yaml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  csv: 'csv',
  tsv: 'tsv',
  plainText: 'txt',
};

export function isDirty(sourceText: string, lastSavedSourceText: string): boolean {
  return sourceText !== lastSavedSourceText;
}

export const isSourceDirty = isDirty;

export function untitledNameForFormat(format: DocumentFormat | null | undefined = 'markdown'): string {
  return `Untitled.${UNTITLED_EXTENSION_BY_FORMAT[format ?? 'markdown']}`;
}

export function displayNameForPath(
  filePath: string | null,
  format: DocumentFormat | null | undefined = 'markdown',
): string {
  if (!filePath) return untitledNameForFormat(format);
  return filePath.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? untitledNameForFormat(format);
}

export function basename(filePath: string | null): string {
  return displayNameForPath(filePath, 'markdown');
}

export function createWindowTitle(
  filePath: string | null,
  dirty: boolean,
  format: DocumentFormat | null | undefined = 'markdown',
): string {
  return `${dirty ? '* ' : ''}${displayNameForPath(filePath, format)} - ScieMD`;
}

export function metadataChanged(
  known: FileMetadata | null,
  current: FileMetadata | null,
  toleranceMs = 0,
): boolean {
  if (!known || !current || known.lastKnownMtimeMs === 0) return false;
  if (known.contentHash && current.contentHash && known.contentHash !== current.contentHash) return true;
  const mtimeChanged = Math.abs(current.lastKnownMtimeMs - known.lastKnownMtimeMs) > toleranceMs;
  const sizeChanged = current.lastKnownSizeBytes !== known.lastKnownSizeBytes;
  return mtimeChanged || sizeChanged;
}

export function normalizeMarkdownInput(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
