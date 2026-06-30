export type MarkdownSelectionSurface = 'source' | 'visual' | 'unknown';

export interface MarkdownSelectionSnapshot {
  text: string;
  line?: number;
  endLine?: number;
  from?: number;
  to?: number;
  surface?: MarkdownSelectionSurface;
}

export function wrapMarkdownSelection(
  markdown: string,
  selectedText: string,
  wrap: (rawSelection: string) => string,
  preferredLine?: number,
): string | null {
  const normalizedSelection = selectedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalizedSelection) return null;

  const lineMatch = findSelectedMarkdownLineRange(markdown, normalizedSelection, preferredLine);
  if (lineMatch) {
    const rawSelection = markdown.slice(lineMatch.start, lineMatch.end);
    return `${markdown.slice(0, lineMatch.start)}${wrap(rawSelection)}${markdown.slice(lineMatch.end)}`;
  }

  const exactIndex = markdown.indexOf(selectedText);
  if (exactIndex < 0) return null;
  if (markdown.indexOf(selectedText, exactIndex + selectedText.length) >= 0) return null;
  const containingLine = findMarkdownLineRangeAtOffset(markdown, exactIndex);
  if (containingLine) {
    const rawLine = markdown.slice(containingLine.start, containingLine.end);
    if (shouldWrapEntireMarkdownLine(rawLine)) {
      return `${markdown.slice(0, containingLine.start)}${wrap(rawLine)}${markdown.slice(containingLine.end)}`;
    }
  }
  return `${markdown.slice(0, exactIndex)}${wrap(selectedText)}${markdown.slice(exactIndex + selectedText.length)}`;
}

export function wrapMarkdownBlockSelection(
  markdown: string,
  selection: MarkdownSelectionSnapshot,
  wrap: (rawSelection: string) => string,
  preferredLine?: number,
): string | null {
  const normalizedSelection = selection.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalizedSelection) return null;

  const sourceRange = sourceSelectionWholeLineRange(markdown, selection);
  if (sourceRange) {
    const rawSelection = markdown.slice(sourceRange.start, sourceRange.end);
    return `${markdown.slice(0, sourceRange.start)}${wrap(rawSelection)}${markdown.slice(sourceRange.end)}`;
  }

  const lineMatch = findWholeMarkdownBlockSelectionRange(markdown, normalizedSelection, selection.line ?? preferredLine);
  if (!lineMatch) return null;
  const rawSelection = markdown.slice(lineMatch.start, lineMatch.end);
  return `${markdown.slice(0, lineMatch.start)}${wrap(rawSelection)}${markdown.slice(lineMatch.end)}`;
}

export function insertStandaloneMarkdownBlockNearSelection(
  markdown: string,
  selection: MarkdownSelectionSnapshot,
  block: string,
  preferredLine?: number,
): string {
  const offset = findMarkdownBlockInsertionOffset(markdown, selection.text, preferredLine, selection.line);
  return insertStandaloneMarkdownBlock(markdown, offset, block);
}

export function findWholeMarkdownBlockSelectionRange(
  markdown: string,
  selectedText: string,
  preferredLine?: number,
): { start: number; end: number } | null {
  return findSelectedMarkdownLineRangeInternal(markdown, selectedText, preferredLine, false);
}

export function findMarkdownBlockInsertionOffset(
  markdown: string,
  selectedText: string,
  preferredLine?: number,
  selectionLine?: number,
): number {
  if (!markdown) return 0;
  const lines = markdown.split('\n');
  const starts = lineStartOffsets(markdown);
  const nearbyLine = selectionLine ?? preferredLine;
  const lineIndex = findSelectedTextStartLine(lines, selectedText, nearbyLine)
    ?? trustedLineIndex(lines, selectionLine)
    ?? findBestTargetLine(lines, selectedText, nearbyLine);
  const blockStartLine = findBlockStartLine(lines, lineIndex);
  return starts[blockStartLine] ?? markdown.length;
}

export function insertStandaloneMarkdownBlock(markdown: string, offset: number, block: string): string {
  const before = markdown.slice(0, offset);
  const after = markdown.slice(offset);
  const beforePad = before && !/\n\s*\n$/.test(before) ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
  const afterPad = after && !block.endsWith('\n\n') ? '\n' : '';
  return `${before}${beforePad}${block}${afterPad}${after}`;
}

export function findSelectedMarkdownLineRange(
  markdown: string,
  selectedText: string,
  preferredLine?: number,
): { start: number; end: number } | null {
  return findSelectedMarkdownLineRangeInternal(markdown, selectedText, preferredLine, true);
}

function findSelectedMarkdownLineRangeInternal(
  markdown: string,
  selectedText: string,
  preferredLine: number | undefined,
  allowPartialLineContains: boolean,
): { start: number; end: number } | null {
  const selectedLines = selectedText
    .split('\n')
    .map(normalizeComparableMarkdownLine)
    .filter(Boolean);
  if (selectedLines.length === 0) return null;

  const lines = markdown.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }

  const lineOrder = lines
    .map((_, index) => index)
    .sort((left, right) => {
      if (!preferredLine) return left - right;
      return Math.abs(left + 1 - preferredLine) - Math.abs(right + 1 - preferredLine);
    });

  const findRange = (allowContains: boolean): { start: number; end: number } | null => {
    for (const startLine of lineOrder) {
      const firstComparable = normalizeComparableMarkdownLine(lines[startLine]);
      if (allowContains && selectedLines.length === 1 && !shouldWrapEntireMarkdownLine(lines[startLine])) continue;
      if (!comparableLineMatchesSelection(firstComparable, selectedLines[0], allowContains)) continue;

      let selectedIndex = 0;
      let endLine = startLine;
      for (; endLine < lines.length && selectedIndex < selectedLines.length; endLine += 1) {
        const comparable = normalizeComparableMarkdownLine(lines[endLine]);
        if (!comparable) continue;
        if (!comparableLineMatchesSelection(comparable, selectedLines[selectedIndex], allowContains)) break;
        selectedIndex += 1;
      }
      if (selectedIndex !== selectedLines.length) continue;

      const lastLine = Math.max(startLine, endLine - 1);
      const start = starts[startLine];
      const end = lastLine + 1 < starts.length
        ? starts[lastLine + 1]
        : markdown.length;
      return { start, end };
    }
    return null;
  };

  return findRange(false) ?? (allowPartialLineContains ? findRange(true) : null);
}

function sourceSelectionWholeLineRange(markdown: string, selection: MarkdownSelectionSnapshot): { start: number; end: number } | null {
  if (selection.surface !== 'source') return null;
  if (!Number.isFinite(selection.from) || !Number.isFinite(selection.to)) return null;
  const start = Math.max(0, Math.min(Math.floor(selection.from ?? 0), markdown.length));
  const end = Math.max(start, Math.min(Math.floor(selection.to ?? start), markdown.length));
  if (start === end) return null;
  const startsAtLineBoundary = start === 0 || markdown[start - 1] === '\n';
  const endsAtLineBoundary = end === markdown.length || markdown[end] === '\n' || markdown[end - 1] === '\n';
  if (!startsAtLineBoundary || !endsAtLineBoundary) return null;
  return { start, end };
}

function comparableLineMatchesSelection(line: string, selected: string, allowContains: boolean): boolean {
  if (line === selected) return true;
  return allowContains && selected.length >= 3 && line.includes(selected);
}

function findMarkdownLineRangeAtOffset(markdown: string, offset: number): { start: number; end: number } | null {
  if (offset < 0 || offset > markdown.length) return null;
  const start = markdown.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const nextNewline = markdown.indexOf('\n', offset);
  const end = nextNewline >= 0 ? nextNewline + 1 : markdown.length;
  return { start, end };
}

function shouldWrapEntireMarkdownLine(line: string): boolean {
  return /^\s{0,3}(?:>\s*)?(?:[-+*]|\d+[.)])\s+/.test(line)
    || /^\s{0,3}(?:>\s*)?-\s+\[[ xX]\]\s+/.test(line)
    || /^\s{0,3}#{1,6}\s+/.test(line);
}

function lineStartOffsets(markdown: string): number[] {
  const starts = [0];
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function trustedLineIndex(lines: string[], line?: number): number | null {
  if (!Number.isFinite(line) || !line) return null;
  return Math.max(0, Math.min(lines.length - 1, Math.floor(line) - 1));
}

function findSelectedTextStartLine(lines: string[], selectedText: string, preferredLine?: number): number | null {
  const preferredIndex = Math.max(0, Math.min(lines.length - 1, (preferredLine ?? 1) - 1));
  const lineEntries = lines.map((line, index) => ({
    index,
    comparable: normalizeComparableMarkdownLine(line).toLowerCase(),
  }));

  for (const fragment of selectionSearchFragments(selectedText)) {
    const candidates = lineEntries.filter((item) => item.comparable.includes(fragment));
    if (candidates.length === 0) continue;
    return candidates.sort((left, right) => (
      Math.abs(left.index - preferredIndex) - Math.abs(right.index - preferredIndex)
      || left.index - right.index
    ))[0].index;
  }
  return null;
}

function findBestTargetLine(lines: string[], quote: string, preferredLine?: number): number {
  const preferredIndex = Math.max(0, Math.min(lines.length - 1, (preferredLine ?? 1) - 1));
  const normalizedQuote = normalizeComparableMarkdownLine(quote).toLowerCase();
  if (!normalizedQuote) return preferredIndex;

  const candidates = lines
    .map((line, index) => ({ index, comparable: normalizeComparableMarkdownLine(line).toLowerCase() }))
    .filter((item) => item.comparable.includes(normalizedQuote));
  if (candidates.length === 0) return preferredIndex;
  return candidates.sort((left, right) => Math.abs(left.index - preferredIndex) - Math.abs(right.index - preferredIndex))[0].index;
}

function selectionSearchFragments(selectedText: string): string[] {
  const seen = new Set<string>();
  const fragments: string[] = [];
  for (const rawFragment of selectedText.split(/\r?\n+/)) {
    const fragment = normalizeComparableMarkdownLine(rawFragment).toLowerCase();
    for (const candidate of fragmentCandidates(fragment)) {
      if (candidate.length < 4 || seen.has(candidate)) continue;
      seen.add(candidate);
      fragments.push(candidate);
    }
  }
  return fragments;
}

function fragmentCandidates(fragment: string): string[] {
  if (!fragment) return [];
  if (fragment.length <= 120) return [fragment];
  const sentenceEnd = fragment.search(/[.!?]\s/);
  const sentence = sentenceEnd > 20 ? fragment.slice(0, sentenceEnd + 1).trim() : '';
  const prefix = fragment.slice(0, 120).replace(/\s+\S*$/, '').trim();
  return [fragment, sentence, prefix].filter(Boolean);
}

function findBlockStartLine(lines: string[], lineIndex: number): number {
  let index = Math.max(0, Math.min(lines.length - 1, lineIndex));
  while (index > 0 && !lines[index].trim()) index -= 1;
  while (index > 0 && lines[index - 1].trim() && !isStandaloneBlockStart(lines[index])) {
    if (isStandaloneBlockStart(lines[index - 1])) break;
    index -= 1;
  }
  return index;
}

function isStandaloneBlockStart(line: string): boolean {
  return /^\s{0,3}(?:[-+*]|\d+[.)])\s+/.test(line)
    || /^\s{0,3}#{1,6}\s+/.test(line)
    || /^\s{0,3}>\s+/.test(line)
    || /^\s*(`{3,}|~{3,})/.test(line)
    || /^:::[A-Za-z]/.test(line)
    || /^\s*<!--\s*scie_md:/.test(line);
}

function normalizeComparableMarkdownLine(line: string): string {
  const structuralText = line
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/^\s{0,3}-\s+\[[ xX]\]\s+/, '')
    .replace(/^\s{0,3}(?:[-+*]|\d+[.)])\s+/, '')
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/\s+#{1,6}\s*$/, '');

  return stripInlineMarkdownForComparison(structuralText)
    .replace(/\s+/g, ' ')
    .trim();
}

function stripInlineMarkdownForComparison(text: string): string {
  return text
    .replace(/!\[([^\]]*)]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/\\([\\`*_[\]{}()#+\-.!|>])/g, '$1');
}
