import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface FrontmatterParseResult {
  hasFrontmatter: boolean;
  raw: string;
  body: string;
  data: Record<string, unknown>;
  error: string | null;
  startLine: number;
  endLine: number;
  openingFence: string;
  closingFence: string;
  lineEnding: string;
  sourcePrefix: string;
  bodyStartOffset: number;
}

export function parseFrontmatter(markdown: string): FrontmatterParseResult {
  const lines = splitLinesWithBreaks(markdown);
  const openingLine = lines[0];
  if (!openingLine || openingLine.text !== '---' || !openingLine.lineBreak) {
    return {
      hasFrontmatter: false,
      raw: '',
      body: markdown,
      data: {},
      error: null,
      startLine: 0,
      endLine: 0,
      openingFence: '',
      closingFence: '',
      lineEnding: detectLineEnding(markdown),
      sourcePrefix: '',
      bodyStartOffset: 0,
    };
  }

  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[index].text)) {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex < 0) {
    return {
      hasFrontmatter: true,
      raw: markdown.slice(openingLine.endOffset),
      body: '',
      data: {},
      error: 'Front matter is missing a closing --- fence.',
      startLine: 1,
      endLine: lines.length,
      openingFence: '---',
      closingFence: '',
      lineEnding: openingLine.lineBreak,
      sourcePrefix: markdown,
      bodyStartOffset: markdown.length,
    };
  }

  const closingLine = lines[closingIndex];
  const raw = stripTrailingLineBreak(markdown.slice(openingLine.endOffset, closingLine.offset));
  let data: Record<string, unknown> = {};
  let error: string | null = null;
  try {
    const parsed = parseYaml(raw, { maxAliasCount: 100 });
    data = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch (parseError) {
    error = parseError instanceof Error ? parseError.message : 'Front matter is not valid YAML.';
  }

  return {
    hasFrontmatter: true,
    raw,
    body: markdown.slice(closingLine.endOffset),
    data,
    error,
    startLine: 1,
    endLine: closingIndex + 1,
    openingFence: '---',
    closingFence: closingLine.text.trim(),
    lineEnding: openingLine.lineBreak,
    sourcePrefix: markdown.slice(0, closingLine.endOffset),
    bodyStartOffset: closingLine.endOffset,
  };
}

export interface SerializeFrontmatterOptions {
  lineEnding?: string;
  openingFence?: string;
  closingFence?: string;
}

export function serializeFrontmatter(
  data: Record<string, unknown>,
  body: string,
  options: SerializeFrontmatterOptions = {},
): string {
  const lineEnding = options.lineEnding || detectLineEnding(body);
  const openingFence = options.openingFence || '---';
  const closingFence = options.closingFence || '---';
  const yaml = normalizeLineEndings(stringifyYaml(data).trimEnd(), lineEnding);
  const separator = startsWithLineBreak(body) ? '' : lineEnding;
  return `${openingFence}${lineEnding}${yaml}${lineEnding}${closingFence}${separator}${body}`;
}

export function replaceFrontmatterBody(frontmatter: FrontmatterParseResult, body: string): string {
  if (!frontmatter.hasFrontmatter) return body;
  if (frontmatter.sourcePrefix) return `${frontmatter.sourcePrefix}${body}`;
  const lineEnding = frontmatter.lineEnding || detectLineEnding(body);
  const raw = normalizeLineEndings(frontmatter.raw, lineEnding);
  const openingFence = frontmatter.openingFence || '---';
  const closingFence = frontmatter.closingFence || '---';
  const rawSeparator = raw ? `${raw}${lineEnding}` : '';
  return `${openingFence}${lineEnding}${rawSeparator}${closingFence}${lineEnding}${body}`;
}

export function getScienfyMetadata(frontmatter: Record<string, unknown>): Record<string, unknown> {
  const value = frontmatter.scienfy;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function getStringField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function getStringArrayField(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

interface SourceLine {
  text: string;
  offset: number;
  endOffset: number;
  lineBreak: string;
}

function splitLinesWithBreaks(text: string): SourceLine[] {
  if (text.length === 0) return [];
  const lines: SourceLine[] = [];
  let lineStart = 0;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '\r' || char === '\n') {
      const lineBreak = char === '\r' && text[index + 1] === '\n' ? '\r\n' : char;
      const endOffset = index + lineBreak.length;
      lines.push({
        text: text.slice(lineStart, index),
        offset: lineStart,
        endOffset,
        lineBreak,
      });
      index = endOffset;
      lineStart = index;
      continue;
    }
    index += 1;
  }
  lines.push({
    text: text.slice(lineStart),
    offset: lineStart,
    endOffset: text.length,
    lineBreak: '',
  });
  return lines;
}

function detectLineEnding(text: string): string {
  const match = text.match(/\r\n|\n|\r/);
  return match?.[0] ?? '\n';
}

function normalizeLineEndings(text: string, lineEnding: string): string {
  return text.replace(/\r\n|\n|\r/g, lineEnding);
}

function startsWithLineBreak(text: string): boolean {
  return text.startsWith('\n') || text.startsWith('\r');
}

function stripTrailingLineBreak(text: string): string {
  return text.replace(/\r\n$|\n$|\r$/, '');
}
