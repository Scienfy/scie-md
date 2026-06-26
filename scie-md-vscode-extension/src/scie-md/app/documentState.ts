export type EditorMode = 'visual' | 'source';

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict';

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

export function isDirty(markdown: string, lastSavedMarkdown: string): boolean {
  return markdown !== lastSavedMarkdown;
}

export function basename(filePath: string | null): string {
  if (!filePath) return UNTITLED_NAME;
  return filePath.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? UNTITLED_NAME;
}

export function createWindowTitle(filePath: string | null, dirty: boolean): string {
  return `${dirty ? '* ' : ''}${basename(filePath)} - ScieMD`;
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
