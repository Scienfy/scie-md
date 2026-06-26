import { fencedCodeRanges, frontmatterRanges, isOffsetInsideRanges, mergeRanges, scieMdCommentRanges } from './markdownRanges';
import { lineStartOffsets } from './textOffsets';

export interface MarkdownHeading {
  id: string;
  level: number;
  text: string;
  line: number;
}

export function extractHeadings(markdown: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const seen = new Map<string, number>();
  const ignoredRanges = mergeRanges([
    ...frontmatterRanges(markdown),
    ...fencedCodeRanges(markdown),
    ...scieMdCommentRanges(markdown),
  ]);
  const lineStarts = lineStartOffsets(markdown);
  let inFence: '`' | '~' | null = null;
  let fenceLength = 0;

  markdown.split('\n').forEach((line, index) => {
    if (isOffsetInsideRanges(lineStarts[index] ?? 0, ignoredRanges)) return;
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1];
      const markerChar = marker[0] as '`' | '~';
      if (!inFence) {
        inFence = markerChar;
        fenceLength = marker.length;
      } else if (markerChar === inFence && marker.length >= fenceLength) {
        inFence = null;
        fenceLength = 0;
      }
      return;
    }
    if (inFence) return;

    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) return;

    const text = cleanHeadingText(match[2]);
    if (!text) return;
    headings.push({
      id: uniqueSlug(text, seen),
      level: match[1].length,
      text,
      line: index + 1,
    });
  });

  return headings;
}

export function headingPathForLine(headings: MarkdownHeading[], line: number): MarkdownHeading[] {
  const path: MarkdownHeading[] = [];
  for (const heading of headings) {
    if (heading.line > line) break;
    while (path.length > 0 && path[path.length - 1].level >= heading.level) {
      path.pop();
    }
    path.push(heading);
  }
  return path;
}

function cleanHeadingText(value: string): string {
  return value
    .replace(/!\[([^\]]*)]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueSlug(text: string, seen: Map<string, number>): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-') || 'section';
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}
