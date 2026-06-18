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

const imagePattern = /!\[((?:\\.|[^\]\\])*)]\(([^)\n]+)\)/g;

export function findMarkdownImages(markdown: string): MarkdownImageMatch[] {
  const starts = lineStartOffsets(markdown);
  const ignoredRanges = mergeRanges([
    ...fencedCodeRanges(markdown),
    ...inlineCodeRanges(markdown),
  ]);
  const matches: MarkdownImageMatch[] = [];
  let match: RegExpExecArray | null;
  imagePattern.lastIndex = 0;

  while ((match = imagePattern.exec(markdown)) !== null) {
    if (isOffsetInsideRanges(match.index, ignoredRanges)) continue;
    const parsed = parseImageDestination(match[2]);
    if (!parsed) continue;
    matches.push({
      raw: match[0],
      alt: match[1],
      url: parsed.url,
      title: parsed.title,
      from: match.index,
      to: match.index + match[0].length,
      line: offsetToLine(starts, match.index),
    });
  }

  return matches;
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
