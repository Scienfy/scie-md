import { lineStartOffsets } from './textOffsets';

export interface OffsetRange {
  start: number;
  end: number;
}

export function frontmatterRanges(text: string): OffsetRange[] {
  const firstLine = readLine(text, 0);
  if (!firstLine || firstLine.line !== '---' || firstLine.next >= text.length) return [];

  for (let offset = firstLine.next; offset < text.length;) {
    const current = readLine(text, offset);
    if (!current) break;
    const line = current.line;
    if (/^(?:---|\.\.\.)[ \t]*$/.test(line)) {
      return [{ start: 0, end: current.next }];
    }
    offset = current.next;
  }
  return [{ start: 0, end: text.length }];
}

export function fencedCodeRanges(text: string): OffsetRange[] {
  const ranges: OffsetRange[] = [];
  const starts = lineStartOffsets(text);
  let active: { startLine: number; char: string; length: number } | null = null;
  let indentedStartLine: number | null = null;

  for (let index = 0; index < starts.length; index += 1) {
    const lineStart = starts[index];
    const lineEnd = index + 1 < starts.length ? starts[index + 1] : text.length;

    if (!active && isIndentedCodeLine(text, lineStart, lineEnd)) {
      indentedStartLine ??= index;
      continue;
    }
    if (indentedStartLine !== null && !isBlankLine(text, lineStart, lineEnd)) {
      ranges.push({ start: starts[indentedStartLine], end: lineStart });
      indentedStartLine = null;
    }

    let scan = lineStart;
    let indent = 0;
    while (scan < lineEnd && text[scan] === ' ' && indent < 4) {
      scan++;
      indent++;
    }
    if (indent > 3) continue;
    const char = text[scan];
    if (char !== '`' && char !== '~') continue;

    let length = 0;
    while (scan + length < lineEnd && text[scan + length] === char) {
      length++;
    }
    if (length < 3) continue;

    if (!active) {
      active = { startLine: index, char, length };
      continue;
    }

    if (char === active.char && length >= active.length) {
      ranges.push({
        start: starts[active.startLine],
        end: lineEnd,
      });
      active = null;
    }
  }

  if (indentedStartLine !== null) {
    ranges.push({ start: starts[indentedStartLine], end: text.length });
  }
  if (active) {
    ranges.push({ start: starts[active.startLine], end: text.length });
  }
  return ranges;
}

export function inlineCodeRanges(text: string): OffsetRange[] {
  const ranges: OffsetRange[] = [];
  for (let index = 0; index < text.length;) {
    if (text[index] !== '`') {
      index += 1;
      continue;
    }
    const runLength = countRun(text, index, '`');
    const closeIndex = findClosingBacktickRun(text, index + runLength, runLength);
    if (closeIndex < 0) {
      index += runLength;
      continue;
    }
    ranges.push({ start: index, end: closeIndex + runLength });
    index = closeIndex + runLength;
  }
  return ranges;
}

export function scieMdCommentRanges(text: string): OffsetRange[] {
  const ranges: OffsetRange[] = [];
  const pattern = /<!--\s*scie_md:[\s\S]*?-->/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

export function mergeRanges(ranges: OffsetRange[]): OffsetRange[] {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: OffsetRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function isOffsetInsideRanges(offset: number, ranges: OffsetRange[]): boolean {
  return ranges.some((range) => offset >= range.start && offset < range.end);
}

function isBlankLine(text: string, start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    const char = text[index];
    if (char !== ' ' && char !== '\t' && char !== '\r' && char !== '\n') return false;
  }
  return true;
}

function isIndentedCodeLine(text: string, start: number, end: number): boolean {
  let spaces = 0;
  for (let index = start; index < end; index += 1) {
    const char = text[index];
    if (char === ' ') {
      spaces += 1;
      if (spaces >= 4) return !isBlankLine(text, index + 1, end);
      continue;
    }
    if (char === '\t') return !isBlankLine(text, index + 1, end);
    return false;
  }
  return false;
}

function countRun(text: string, start: number, char: string): number {
  let length = 0;
  while (text[start + length] === char) length += 1;
  return length;
}

function findClosingBacktickRun(text: string, start: number, runLength: number): number {
  for (let index = start; index < text.length;) {
    if (text[index] !== '`') {
      index += 1;
      continue;
    }
    const length = countRun(text, index, '`');
    if (length === runLength) return index;
    index += length;
  }
  return -1;
}

function readLine(text: string, start: number): { line: string; end: number; next: number } | null {
  if (start > text.length) return null;
  let end = start;
  while (end < text.length && text[end] !== '\n' && text[end] !== '\r') {
    end += 1;
  }
  let next = end;
  if (text[next] === '\r' && text[next + 1] === '\n') next += 2;
  else if (text[next] === '\r' || text[next] === '\n') next += 1;
  return { line: text.slice(start, end), end, next };
}
