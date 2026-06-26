import { lineStartOffsets, offsetToLine } from './textOffsets';
import { fencedCodeRanges, inlineCodeRanges, isOffsetInsideRanges, mergeRanges } from './markdownRanges';

export interface MarkdownImageMatch {
  raw: string;
  alt: string;
  url: string;
  title: string;
  from: number;
  to: number;
  line: number;
}

const imageStartPattern = /!\[((?:\\.|[^\]\\])*)]\(/g;

export function findMarkdownImages(markdown: string): MarkdownImageMatch[] {
  const starts = lineStartOffsets(markdown);
  const ignoredRanges = mergeRanges([
    ...fencedCodeRanges(markdown),
    ...inlineCodeRanges(markdown),
  ]);
  const matches: MarkdownImageMatch[] = [];
  let match: RegExpExecArray | null;
  imageStartPattern.lastIndex = 0;

  while ((match = imageStartPattern.exec(markdown)) !== null) {
    if (isOffsetInsideRanges(match.index, ignoredRanges)) continue;
    const destination = readImageDestination(markdown, imageStartPattern.lastIndex);
    if (!destination) continue;
    const parsed = parseImageDestination(destination.raw);
    if (!parsed) continue;
    matches.push({
      raw: markdown.slice(match.index, destination.end),
      alt: match[1],
      url: parsed.url,
      title: parsed.title,
      from: match.index,
      to: destination.end,
      line: offsetToLine(starts, match.index),
    });
    imageStartPattern.lastIndex = destination.end;
  }

  return matches;
}

function readImageDestination(markdown: string, start: number): { raw: string; end: number } | null {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaping = false;
  for (let index = start; index < markdown.length; index += 1) {
    const char = markdown[index];
    if (char === '\n') return null;
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === '\\') {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char !== ')') continue;
    if (depth > 0) {
      depth -= 1;
      continue;
    }
    return { raw: markdown.slice(start, index), end: index + 1 };
  }
  return null;
}

export function replaceMarkdownImages(
  markdown: string,
  replace: (match: MarkdownImageMatch) => string,
): string {
  const matches = findMarkdownImages(markdown);
  if (matches.length === 0) return markdown;

  let output = '';
  let offset = 0;
  for (const match of matches) {
    output += markdown.slice(offset, match.from);
    output += replace(match);
    offset = match.to;
  }
  return output + markdown.slice(offset);
}

export async function replaceMarkdownImagesAsync(
  markdown: string,
  replace: (match: MarkdownImageMatch) => Promise<string>,
): Promise<string> {
  const matches = findMarkdownImages(markdown);
  if (matches.length === 0) return markdown;

  let output = '';
  let offset = 0;
  for (const match of matches) {
    output += markdown.slice(offset, match.from);
    output += await replace(match);
    offset = match.to;
  }
  return output + markdown.slice(offset);
}

export function formatMarkdownImageDestination(url: string): string {
  if (!needsBracketedImageDestination(url)) return url;
  return `<${url
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')}>`;
}

function parseImageDestination(raw: string): { url: string; title: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('<')) {
    const end = trimmed.indexOf('>');
    if (end > 1) {
      return {
        url: trimmed.slice(1, end).trim(),
        title: trimmed.slice(end + 1),
      };
    }
  }

  const titleMatch = trimmed.match(/^(.+?)(\s+(?:"[^"]*"|'[^']*'))$/);
  if (titleMatch && looksLikeImagePath(titleMatch[1])) {
    return {
      url: titleMatch[1].trim(),
      title: titleMatch[2],
    };
  }

  return { url: trimmed, title: '' };
}

function looksLikeImagePath(value: string): boolean {
  return /\.(?:png|jpe?g|gif|webp|bmp|tiff?|svg)(?:[?#].*)?$/i.test(value.trim());
}

function needsBracketedImageDestination(url: string): boolean {
  return /[\s()<>]/.test(url);
}
