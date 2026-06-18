import { lineStartOffsets, offsetToLine } from './textOffsets';

const MAX_INTERACTIVE_DIFF_CELLS = 1_000_000;

export type DiffLineKind = 'same' | 'added' | 'removed';

export interface DiffSegment {
  kind: DiffLineKind;
  text: string;
}

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  segments?: DiffSegment[];
}

export interface DiffHunk {
  id: string;
  beforeStart: number;
  beforeEnd: number;
  afterStart: number;
  afterEnd: number;
  beforeLines: string[];
  afterLines: string[];
  diffLines: DiffLine[];
}

export function createDiffHunks(before: string, after: string): DiffHunk[] {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const protectedLineState = createProtectedLineState(before);
  if (beforeLines.length * afterLines.length > MAX_INTERACTIVE_DIFF_CELLS) {
    return [createWholeDocumentDiffHunk(beforeLines, afterLines)];
  }
  const ops = createDiffOps(beforeLines, afterLines);
  const hunks: DiffHunk[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  let current: DiffHunk | null = null;
  let currentProtectedState: string | null = null;

  const flush = () => {
    if (current) {
      attachWordDiffs(current.diffLines);
      hunks.push(current);
      current = null;
      currentProtectedState = null;
    }
  };

  for (const op of ops) {
    if (op.kind === 'same') {
      flush();
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    const opProtectedState: string | null = op.kind === 'added' && current
      ? currentProtectedState
      : protectedLineState(op.kind === 'removed' ? beforeIndex + 1 : Math.max(1, beforeIndex));
    if (current && currentProtectedState !== null && opProtectedState !== currentProtectedState) {
      flush();
    }

    if (!current) {
      current = {
        id: `hunk-${hunks.length + 1}`,
        beforeStart: beforeIndex,
        beforeEnd: beforeIndex,
        afterStart: afterIndex,
        afterEnd: afterIndex,
        beforeLines: [],
        afterLines: [],
        diffLines: [],
      };
      currentProtectedState = opProtectedState;
    }

    if (op.kind === 'removed') {
      current.beforeLines.push(op.text);
      current.diffLines.push({ kind: 'removed', text: op.text });
      beforeIndex += 1;
      current.beforeEnd = beforeIndex;
    } else {
      current.afterLines.push(op.text);
      current.diffLines.push({ kind: 'added', text: op.text });
      afterIndex += 1;
      current.afterEnd = afterIndex;
    }
  }

  flush();
  return hunks;
}

function createWholeDocumentDiffHunk(beforeLines: string[], afterLines: string[]): DiffHunk {
  return {
    id: 'hunk-1',
    beforeStart: 0,
    beforeEnd: beforeLines.length,
    afterStart: 0,
    afterEnd: afterLines.length,
    beforeLines,
    afterLines,
    diffLines: [
      ...beforeLines.map((text) => ({ kind: 'removed' as const, text })),
      ...afterLines.map((text) => ({ kind: 'added' as const, text })),
    ],
  };
}

function attachWordDiffs(lines: DiffLine[]): void {
  for (let index = 0; index < lines.length - 1; index += 1) {
    const removed = lines[index];
    const added = lines[index + 1];
    if (removed.kind !== 'removed' || added.kind !== 'added') continue;
    const pair = createWordDiffPair(removed.text, added.text);
    removed.segments = pair.removed;
    added.segments = pair.added;
    index += 1;
  }
}

function createWordDiffPair(before: string, after: string): { removed: DiffSegment[]; added: DiffSegment[] } {
  const beforeTokens = tokenizeWords(before);
  const afterTokens = tokenizeWords(after);
  const ops = createDiffOps(beforeTokens, afterTokens);
  return {
    removed: mergeSegments(ops.filter((op) => op.kind !== 'added')),
    added: mergeSegments(ops.filter((op) => op.kind !== 'removed')),
  };
}

function tokenizeWords(value: string): string[] {
  return value.match(/\S+/g) ?? [];
}

function mergeSegments(segments: DiffSegment[]): DiffSegment[] {
  const merged: DiffSegment[] = [];
  for (const segment of segments) {
    const text = merged.length === 0 ? segment.text : ` ${segment.text}`;
    const previous = merged.at(-1);
    if (previous?.kind === segment.kind) {
      previous.text += text;
    } else {
      merged.push({ ...segment, text });
    }
  }
  return merged;
}

export function applyDiffDecisions(before: string, after: string, hunks: DiffHunk[], rejectedHunkIds: Set<string>): string {
  if (rejectedHunkIds.size === 0) return after;
  if (rejectedHunkIds.size === hunks.length) return before;

  const beforeLines = splitLines(before);
  const output: string[] = [];
  let beforeIndex = 0;

  for (const hunk of hunks) {
    output.push(...beforeLines.slice(beforeIndex, hunk.beforeStart));
    output.push(...(rejectedHunkIds.has(hunk.id) ? hunk.beforeLines : hunk.afterLines));
    beforeIndex = hunk.beforeEnd;
  }

  output.push(...beforeLines.slice(beforeIndex));
  return joinLines(output, before.endsWith('\n'));
}

export function applyThreeWayDiffDecisions(
  base: string,
  mine: string,
  theirs: string,
  theirHunks: DiffHunk[],
  rejectedTheirHunkIds: Set<string>,
): string {
  const mineHunks = createDiffHunks(base, mine);
  const acceptedTheirHunks = theirHunks.filter((hunk) => !rejectedTheirHunkIds.has(hunk.id));
  const conflictGroups = createConflictGroups(mineHunks, acceptedTheirHunks);
  const replacements: Array<{ beforeStart: number; beforeEnd: number; lines: string[]; priority: number }> = [];

  for (const hunk of acceptedTheirHunks) {
    if (conflictGroups.some((group) => group.theirHunks.includes(hunk))) continue;
    replacements.push({
      beforeStart: hunk.beforeStart,
      beforeEnd: hunk.beforeEnd,
      lines: hunk.afterLines,
      priority: 1,
    });
  }

  for (const hunk of mineHunks) {
    if (conflictGroups.some((group) => group.mineHunks.includes(hunk))) continue;
    replacements.push({
      beforeStart: hunk.beforeStart,
      beforeEnd: hunk.beforeEnd,
      lines: hunk.afterLines,
      priority: 0,
    });
  }

  const baseLines = splitLines(base);
  for (const group of conflictGroups) {
    replacements.push({
      beforeStart: group.beforeStart,
      beforeEnd: group.beforeEnd,
      lines: createConflictMarkerLines(
        applyHunksToBaseRange(baseLines, group.beforeStart, group.beforeEnd, group.mineHunks),
        applyHunksToBaseRange(baseLines, group.beforeStart, group.beforeEnd, group.theirHunks),
      ),
      priority: 2,
    });
  }

  replacements.sort((left, right) => {
    if (left.beforeStart !== right.beforeStart) return left.beforeStart - right.beforeStart;
    if (left.beforeEnd !== right.beforeEnd) return left.beforeEnd - right.beforeEnd;
    return left.priority - right.priority;
  });

  const output: string[] = [];
  let beforeIndex = 0;
  for (const replacement of replacements) {
    if (replacement.beforeStart < beforeIndex) continue;
    output.push(...baseLines.slice(beforeIndex, replacement.beforeStart));
    output.push(...replacement.lines);
    beforeIndex = replacement.beforeEnd;
  }
  output.push(...baseLines.slice(beforeIndex));

  return joinLines(output, mine.endsWith('\n') || (!mine && theirs.endsWith('\n')));
}

interface ConflictGroup {
  beforeStart: number;
  beforeEnd: number;
  mineHunks: DiffHunk[];
  theirHunks: DiffHunk[];
}

function createConflictGroups(mineHunks: DiffHunk[], theirHunks: DiffHunk[]): ConflictGroup[] {
  const groups: ConflictGroup[] = [];
  for (const mineHunk of mineHunks) {
    const overlappingTheirHunks = theirHunks.filter((theirHunk) => hunksOverlap(mineHunk, theirHunk));
    if (overlappingTheirHunks.length === 0) continue;
    let group: ConflictGroup = {
      beforeStart: mineHunk.beforeStart,
      beforeEnd: mineHunk.beforeEnd,
      mineHunks: [mineHunk],
      theirHunks: overlappingTheirHunks,
    };
    for (const theirHunk of overlappingTheirHunks) {
      group.beforeStart = Math.min(group.beforeStart, theirHunk.beforeStart);
      group.beforeEnd = Math.max(group.beforeEnd, theirHunk.beforeEnd);
    }
    const existing = groups.find((candidate) => rangesOverlap(candidate.beforeStart, candidate.beforeEnd, group.beforeStart, group.beforeEnd));
    if (existing) {
      existing.beforeStart = Math.min(existing.beforeStart, group.beforeStart);
      existing.beforeEnd = Math.max(existing.beforeEnd, group.beforeEnd);
      existing.mineHunks = Array.from(new Set([...existing.mineHunks, ...group.mineHunks]));
      existing.theirHunks = Array.from(new Set([...existing.theirHunks, ...group.theirHunks]));
    } else {
      groups.push(group);
    }
  }
  return groups.map((group) => ({
    ...group,
    mineHunks: group.mineHunks.sort((left, right) => left.beforeStart - right.beforeStart),
    theirHunks: group.theirHunks.sort((left, right) => left.beforeStart - right.beforeStart),
  }));
}

function applyHunksToBaseRange(baseLines: string[], start: number, end: number, hunks: DiffHunk[]): string[] {
  const output: string[] = [];
  let beforeIndex = start;
  for (const hunk of hunks) {
    if (hunk.beforeStart < beforeIndex) continue;
    output.push(...baseLines.slice(beforeIndex, hunk.beforeStart));
    output.push(...hunk.afterLines);
    beforeIndex = hunk.beforeEnd;
  }
  output.push(...baseLines.slice(beforeIndex, end));
  return output;
}

function createConflictMarkerLines(localLines: string[], diskLines: string[]): string[] {
  return [
    '<<<<<<< ScieMD local edits',
    ...localLines,
    '=======',
    ...diskLines,
    '>>>>>>> Disk changes',
  ];
}

function rangesOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
  if (leftStart === leftEnd && rightStart === rightEnd) return leftStart === rightStart;
  if (leftStart === leftEnd) return leftStart >= rightStart && leftStart <= rightEnd;
  if (rightStart === rightEnd) return rightStart >= leftStart && rightStart <= leftEnd;
  return leftStart < rightEnd && rightStart < leftEnd;
}

function hunksOverlap(left: DiffHunk, right: DiffHunk): boolean {
  const leftStart = left.beforeStart;
  const leftEnd = left.beforeEnd;
  const rightStart = right.beforeStart;
  const rightEnd = right.beforeEnd;
  if (leftStart === leftEnd && rightStart === rightEnd) return leftStart === rightStart;
  if (leftStart === leftEnd) return leftStart > rightStart && leftStart < rightEnd;
  if (rightStart === rightEnd) return rightStart > leftStart && rightStart < leftEnd;
  return leftStart < rightEnd && rightStart < leftEnd;
}

function createDiffOps(beforeLines: string[], afterLines: string[]): DiffLine[] {
  const table = createLcsTable(beforeLines, afterLines);
  const ops: DiffLine[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
    if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
      ops.push({ kind: 'same', text: beforeLines[beforeIndex] });
      beforeIndex += 1;
      afterIndex += 1;
    } else if (table[beforeIndex + 1][afterIndex] >= table[beforeIndex][afterIndex + 1]) {
      ops.push({ kind: 'removed', text: beforeLines[beforeIndex] });
      beforeIndex += 1;
    } else {
      ops.push({ kind: 'added', text: afterLines[afterIndex] });
      afterIndex += 1;
    }
  }

  while (beforeIndex < beforeLines.length) {
    ops.push({ kind: 'removed', text: beforeLines[beforeIndex] });
    beforeIndex += 1;
  }

  while (afterIndex < afterLines.length) {
    ops.push({ kind: 'added', text: afterLines[afterIndex] });
    afterIndex += 1;
  }

  return ops;
}

function createLcsTable(beforeLines: string[], afterLines: string[]): number[][] {
  const table = Array.from({ length: beforeLines.length + 1 }, () => Array(afterLines.length + 1).fill(0) as number[]);

  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      table[beforeIndex][afterIndex] = beforeLines[beforeIndex] === afterLines[afterIndex]
        ? table[beforeIndex + 1][afterIndex + 1] + 1
        : Math.max(table[beforeIndex + 1][afterIndex], table[beforeIndex][afterIndex + 1]);
    }
  }

  return table;
}

function createProtectedLineState(markdown: string): (lineNumber: number) => string {
  const protectedRanges: Array<{ start: number; end: number; state: string }> = [];
  const startPattern = /<!--\s*scie_md:lock:start(?:\s+[^>]*)?\s*-->/gi;
  const endPattern = /<!--\s*scie_md:lock:end\s*-->/gi;
  const lineStarts = lineStartOffsets(markdown);
  let lockIndex = 0;
  let startMatch: RegExpExecArray | null;
  while ((startMatch = startPattern.exec(markdown))) {
    endPattern.lastIndex = startPattern.lastIndex;
    const endMatch = endPattern.exec(markdown);
    if (!endMatch) break;
    protectedRanges.push({
      start: offsetToLine(lineStarts, startMatch.index),
      end: offsetToLine(lineStarts, endMatch.index + endMatch[0].length),
      state: `lock-${lockIndex}`,
    });
    lockIndex += 1;
    startPattern.lastIndex = endMatch.index + endMatch[0].length;
  }

  const variantBoundaryLines = new Map<number, string>();
  markdown.split(/\r?\n/).forEach((line, index) => {
    if (/<!--\s*scie_md:variant:(?:group|item|end)\b/i.test(line)) {
      variantBoundaryLines.set(index + 1, `variant-boundary-${index + 1}`);
    }
  });

  return (lineNumber: number) => {
    const variantBoundary = variantBoundaryLines.get(lineNumber);
    if (variantBoundary) return variantBoundary;
    const protectedRange = protectedRanges.find((range) => lineNumber >= range.start && lineNumber <= range.end);
    if (protectedRange) return protectedRange.state;
    return 'normal';
  };
}

function splitLines(value: string): string[] {
  if (!value) return [];
  const lines = value.split('\n');
  if (value.endsWith('\n')) lines.pop();
  return lines;
}

function joinLines(lines: string[], trailingNewline: boolean): string {
  return `${lines.join('\n')}${trailingNewline ? '\n' : ''}`;
}
