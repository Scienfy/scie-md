import { findMarkdownImages } from './markdownImages';

export interface MarkdownImageReference {
  alt: string;
  url: string;
  line: number;
}

export interface DocumentInsights {
  firstHeading: string | null;
  excerpt: string;
  codeBlockCount: number;
  imageReferences: MarkdownImageReference[];
  longestLineLength: number;
  tableCount: number;
  taskCount: number;
}

export interface RecentFilePreview {
  path: string;
  name: string;
  heading: string;
  excerpt: string;
  modifiedAtMs?: number;
}

export function analyzeMarkdownDocument(markdown: string): DocumentInsights {
  const lines = markdown.split(/\r?\n/);
  const withoutCode = stripFencedCode(markdown);
  const imageReferences = extractImageReferences(withoutCode);
  const codeBlockCount = Math.floor((markdown.match(/^\s*(```|~~~)/gm) ?? []).length / 2);
  const tableCount = countTables(withoutCode);
  const taskCount = (withoutCode.match(/^\s*[-*+]\s+\[[ xX]]\s+/gm) ?? []).length;
  const longestLineLength = lines.reduce((longest, line) => Math.max(longest, line.length), 0);
  const firstHeading = extractFirstHeading(markdown);
  const excerpt = extractExcerpt(markdown);
  return {
    firstHeading,
    excerpt,
    codeBlockCount,
    imageReferences,
    longestLineLength,
    tableCount,
    taskCount,
  };
}

export function createRecentFilePreview(path: string, markdown: string, modifiedAtMs?: number): RecentFilePreview {
  return {
    path,
    name: basename(path),
    heading: extractFirstHeading(markdown) ?? basename(path),
    excerpt: extractExcerpt(markdown),
    modifiedAtMs,
  };
}

export function resolveRelativeMarkdownAsset(documentPath: string | null, url: string): string | null {
  if (!documentPath || !url || /^(?:[a-z][a-z0-9+.-]*:|#|\/|\\)/i.test(url)) return null;
  const cleanUrl = decodeURIComponent(url.split(/[?#]/, 1)[0]).replace(/\\/g, '/');
  const segments = cleanUrl.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '..')) return null;
  const documentDir = documentPath.replace(/[/\\][^/\\]*$/, '');
  const separator = documentPath.includes('\\') ? '\\' : '/';
  return `${documentDir}${separator}${segments.join(separator)}`;
}

function stripFencedCode(markdown: string): string {
  return markdown.replace(/(^|\n)(```|~~~)[\s\S]*?(\n\2)(?=\n|$)/g, '\n');
}

function extractImageReferences(markdown: string): MarkdownImageReference[] {
  return findMarkdownImages(markdown).map((image) => ({
    alt: image.alt,
    url: image.url,
    line: image.line,
  }));
}

function extractFirstHeading(markdown: string): string | null {
  const match = markdown.match(/^#{1,6}\s+(.+?)\s*#*\s*$/m);
  return match ? match[1].trim() : null;
}

function extractExcerpt(markdown: string): string {
  const lines = stripFencedCode(markdown)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('|') && !/^[-*+]\s*$/.test(line));
  const plain = (lines[0] ?? '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[*_`>#|]/g, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .trim();
  return plain.length > 140 ? `${plain.slice(0, 137)}...` : plain;
}

function countTables(markdown: string): number {
  const lines = markdown.split(/\r?\n/);
  let count = 0;
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (lines[index].trim().startsWith('|') && isTableSeparator(lines[index + 1])) {
      count += 1;
    }
  }
  return count;
}

function isTableSeparator(line: string): boolean {
  const cells = line
    .trim()
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
