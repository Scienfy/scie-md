import { lineStartOffsets } from '@sciemd/core';

export interface AuthorshipMark {
  id: string;
  start: number;
  end: number;
  createdAt: number;
  label: string;
}

export function createInsertionAuthorshipMark(before: string, after: string, createdAt: number, label = 'AI paste'): AuthorshipMark | null {
  if (before === after || after.length <= before.length) return null;

  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const start = prefix;
  const end = after.length - suffix;
  if (end <= start) return null;

  return {
    id: `auth-${createdAt}-${start}-${end}`,
    start,
    end,
    createdAt,
    label,
  };
}

export function createAcceptedHunkAuthorshipMarks(
  document: string,
  hunks: Array<{ id: string; afterLines: string[]; afterStart?: number }>,
  rejectedHunkIds: Set<string>,
  createdAt: number,
  label = 'Accepted external edit',
): AuthorshipMark[] {
  const marks: AuthorshipMark[] = [];
  const lineStarts = lineStartOffsets(document);
  let searchFrom = 0;
  for (const hunk of hunks) {
    if (rejectedHunkIds.has(hunk.id) || hunk.afterLines.length === 0) continue;
    const text = hunk.afterLines.join('\n');
    if (!text.trim()) continue;
    const start = locateAcceptedHunk(document, text, hunk.afterStart, lineStarts, searchFrom);
    if (start < 0) continue;
    const end = start + text.length;
    marks.push({
      id: `auth-${createdAt}-${marks.length}-${start}-${end}`,
      start,
      end,
      createdAt,
      label,
    });
    searchFrom = end;
  }
  return marks;
}

function locateAcceptedHunk(
  document: string,
  text: string,
  afterStart: number | undefined,
  lineStarts: number[],
  searchFrom: number,
): number {
  if (typeof afterStart === 'number' && afterStart >= 0) {
    const lineOffset = lineStarts[afterStart];
    if (typeof lineOffset === 'number') {
      if (document.slice(lineOffset, lineOffset + text.length) === text) return lineOffset;
      const nearbyStart = Math.max(0, lineOffset - 2000);
      const nearbyEnd = Math.min(document.length, lineOffset + text.length + 2000);
      const nearby = findUniqueInRange(document, text, nearbyStart, nearbyEnd);
      if (nearby >= 0) return nearby;
    }
  }
  return findUniqueInRange(document, text, searchFrom, document.length);
}

function findUniqueInRange(document: string, text: string, from: number, to: number): number {
  const first = document.indexOf(text, from);
  if (first < 0 || first > to) return -1;
  const second = document.indexOf(text, first + text.length);
  if (second >= 0 && second <= to) return -1;
  return first;
}

export function keepRecentAuthorshipMarks(marks: AuthorshipMark[], now: number, ttlMs = 30 * 60 * 1000): AuthorshipMark[] {
  return marks.filter((mark) => now - mark.createdAt <= ttlMs && mark.end > mark.start);
}
