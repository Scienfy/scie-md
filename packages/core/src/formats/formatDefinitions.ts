import type { DocumentFormat } from './documentFormat';

export interface DocumentFormatDefinition {
  format: DocumentFormat;
  label: string;
  extensions: readonly string[];
  mediaTypes: readonly string[];
  structured: boolean;
}

export const documentFormatDefinitions = [
  {
    format: 'markdown',
    label: 'Markdown',
    extensions: ['md', 'markdown'],
    mediaTypes: ['text/markdown', 'text/x-markdown'],
    structured: false,
  },
  {
    format: 'json',
    label: 'JSON',
    extensions: ['json'],
    mediaTypes: ['application/json'],
    structured: true,
  },
  {
    format: 'jsonl',
    label: 'JSON Lines',
    extensions: ['jsonl', 'ndjson'],
    mediaTypes: ['application/jsonl', 'application/x-ndjson'],
    structured: true,
  },
  {
    format: 'yaml',
    label: 'YAML',
    extensions: ['yaml', 'yml'],
    mediaTypes: ['application/yaml', 'application/x-yaml', 'text/yaml', 'text/x-yaml'],
    structured: true,
  },
  {
    format: 'toml',
    label: 'TOML',
    extensions: ['toml'],
    mediaTypes: ['application/toml', 'application/x-toml'],
    structured: true,
  },
  {
    format: 'xml',
    label: 'XML',
    extensions: ['xml'],
    mediaTypes: ['application/xml', 'text/xml', 'application/rss+xml', 'application/atom+xml'],
    structured: true,
  },
  {
    format: 'csv',
    label: 'CSV',
    extensions: ['csv'],
    mediaTypes: ['text/csv', 'application/csv'],
    structured: true,
  },
  {
    format: 'tsv',
    label: 'TSV',
    extensions: ['tsv'],
    mediaTypes: ['text/tab-separated-values'],
    structured: true,
  },
  {
    format: 'plainText',
    label: 'Plain Text',
    extensions: ['txt', 'text'],
    mediaTypes: ['text/plain'],
    structured: false,
  },
] as const satisfies readonly DocumentFormatDefinition[];

export const knownDocumentExtensions = Object.freeze(
  Array.from(new Set(documentFormatDefinitions.flatMap((definition) => definition.extensions))).sort(),
);

const formatByExtension = new Map<string, DocumentFormat>();
const formatByMediaType = new Map<string, DocumentFormat>();

for (const definition of documentFormatDefinitions) {
  for (const extension of definition.extensions) {
    formatByExtension.set(extension, definition.format);
  }
  for (const mediaType of definition.mediaTypes) {
    formatByMediaType.set(mediaType, definition.format);
  }
}

export function formatDefinitionFor(format: DocumentFormat | null | undefined): DocumentFormatDefinition | null {
  if (!format) return null;
  return documentFormatDefinitions.find((definition) => definition.format === format) ?? null;
}

export function formatFromPath(path: string | null | undefined): DocumentFormat | null {
  const extension = extensionFromPath(path);
  if (!extension) return null;
  return formatByExtension.get(extension) ?? null;
}

export function formatFromMediaType(mediaType: string | null | undefined): DocumentFormat | null {
  const normalized = normalizeMediaType(mediaType);
  if (!normalized) return null;
  if (normalized.endsWith('+json')) return 'json';
  if (normalized.endsWith('+xml')) return 'xml';
  return formatByMediaType.get(normalized) ?? null;
}

export function isMarkdownFormat(format: DocumentFormat | null | undefined): boolean {
  return format === 'markdown';
}

export function isStructuredFormat(format: DocumentFormat | null | undefined): boolean {
  return formatDefinitionFor(format)?.structured === true;
}

export function extensionFromPath(path: string | null | undefined): string | null {
  const trimmed = path?.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\\/g, '/').replace(/[?#].*$/, '').replace(/\/+$/, '');
  const fileName = normalized.split('/').at(-1) ?? '';
  if (!fileName || (fileName.startsWith('.') && !fileName.slice(1).includes('.'))) return null;
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return null;
  return fileName.slice(dotIndex + 1).toLowerCase();
}

function normalizeMediaType(mediaType: string | null | undefined): string | null {
  const normalized = mediaType?.split(';', 1)[0]?.trim().toLowerCase();
  return normalized || null;
}
