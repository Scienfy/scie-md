import { lineStartOffsets, offsetToLine } from './textOffsets';
import { fencedCodeRanges, isOffsetInsideRanges } from './markdownRanges';
import { changeTouchesLockRange, collectLockRangesFromBoundaries } from './lockRanges';
import type { LockBoundary, LockRange } from './lockRanges';
import {
  buildNormalizedMarkdownTextIndex,
  createQuoteAnchorSelector,
  findQuoteSelectorRangeInTextIndex,
} from './quoteAnchors';
import type { QuoteAnchorSelector } from './quoteAnchors';

export interface ProtectedBlock {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  reason: string | null;
  raw: string;
  body: string;
}

export interface ProtectedAnchor {
  start: number;
  end: number;
  line: number;
  id: string;
  reason: string | null;
  target: 'quote';
  quote: string;
  prefix?: string;
  suffix?: string;
  raw: string;
}

export interface ProtectedChange {
  block: ProtectedBlock | ProtectedAnchor;
  hunkId: string;
}

export interface ProtectedBodyRange {
  start: number;
  end: number;
}

interface HunkLike {
  id: string;
  beforeStart: number;
  beforeEnd: number;
}

const lockMarkerPattern = /<!--\s*scie_md:lock:(start|end)(?:\s+reason=(?:"([^"]*)"|'([^']*)'|([^\s-][^>]*?)))?\s*-->/gi;
const lockAnchorPattern = /<!--\s*scie_md:lock(?!:)\b([^>]*)-->/gi;
const attributePattern = /([A-Za-z_:][A-Za-z0-9_:.-]*)=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
const MAX_LOCK_QUOTE_ATTRIBUTE_LENGTH = 2000;

interface ProtectedAnchorSnippetOptions {
  markdown?: string;
  preferredLine?: number;
  selectionLine?: number;
  prefix?: string;
  suffix?: string;
}

export function parseProtectedBlocks(markdown: string): ProtectedBlock[] {
  const blocks: ProtectedBlock[] = [];
  const lineStarts = lineStartOffsets(markdown);
  const ignoredRanges = fencedCodeRanges(markdown);
  const boundaries: LockBoundary[] = [];
  lockMarkerPattern.lastIndex = 0;

  let markerMatch: RegExpExecArray | null;
  while ((markerMatch = lockMarkerPattern.exec(markdown))) {
    if (isOffsetInsideRanges(markerMatch.index, ignoredRanges)) continue;
    const markerEnd = markerMatch.index + markerMatch[0].length;
    if (markerMatch[1].toLowerCase() === 'start') {
      boundaries.push({
        kind: 'start',
        from: markerMatch.index,
        to: markerEnd,
        contentFrom: markerEnd,
        reason: decodeHtmlAttribute((markerMatch[2] ?? markerMatch[3] ?? markerMatch[4] ?? '').trim()) || null,
      });
      continue;
    }
    boundaries.push({
      kind: 'end',
      from: markerMatch.index,
      to: markerEnd,
    });
  }

  for (const range of collectLockRangesFromBoundaries(boundaries)) {
    blocks.push({
      start: range.from,
      end: range.to,
      startLine: offsetToLine(lineStarts, range.from),
      endLine: offsetToLine(lineStarts, range.to),
      reason: range.reason,
      raw: markdown.slice(range.from, range.to),
      body: markdown.slice(range.contentFrom, range.contentTo).replace(/^\r?\n/, '').replace(/\r?\n$/, ''),
    });
  }

  return blocks.sort((left, right) => left.start - right.start || left.end - right.end);
}

export function parseProtectedAnchors(markdown: string): ProtectedAnchor[] {
  const anchors: ProtectedAnchor[] = [];
  const lineStarts = lineStartOffsets(markdown);
  const ignoredRanges = fencedCodeRanges(markdown);
  lockAnchorPattern.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = lockAnchorPattern.exec(markdown))) {
    if (isOffsetInsideRanges(match.index, ignoredRanges)) continue;
    const attrs = parseAttributes(match[1] ?? '');
    const quote = decodeHtmlAttribute(attrs.quote ?? '').trim();
    const target = (attrs.target ?? 'quote').toLowerCase();
    if (target !== 'quote' || !quote) continue;
    anchors.push({
      start: match.index,
      end: match.index + match[0].length,
      line: offsetToLine(lineStarts, match.index),
      id: decodeHtmlAttribute(attrs.id ?? '').trim() || '',
      reason: decodeHtmlAttribute(attrs.reason ?? '').trim() || null,
      target: 'quote',
      quote,
      prefix: decodeHtmlAttribute(attrs.prefix ?? '').trim() || undefined,
      suffix: decodeHtmlAttribute(attrs.suffix ?? '').trim() || undefined,
      raw: match[0],
    });
  }

  return anchors.sort((left, right) => left.start - right.start || left.end - right.end);
}

export function createProtectedBlockSnippet(body = 'Protected content.', reason = 'human-approved'): string {
  return [
    `<!-- scie_md:lock:start reason="${escapeHtmlAttribute(reason)}" -->`,
    body,
    '<!-- scie_md:lock:end -->',
    '',
  ].join('\n');
}

export function createProtectedAnchorSnippet(
  quote: string,
  reason = 'human-approved',
  id = createProtectedAnchorId(),
  options: ProtectedAnchorSnippetOptions = {},
): string {
  const selector = createQuoteAnchorSelector(options.markdown ?? '', quote, {
    prefix: options.prefix,
    suffix: options.suffix,
    preferredLine: options.preferredLine,
    selectionLine: options.selectionLine,
  });
  const attrs = [
    `id="${escapeHtmlAttribute(id)}"`,
    'target="quote"',
    `quote="${escapeHtmlAttribute(compactQuote(selector.quote))}"`,
  ];
  const prefix = compactContext(selector.prefix ?? '');
  if (prefix) attrs.push(`prefix="${escapeHtmlAttribute(prefix)}"`);
  const suffix = compactContext(selector.suffix ?? '');
  if (suffix) attrs.push(`suffix="${escapeHtmlAttribute(suffix)}"`);
  attrs.push(`reason="${escapeHtmlAttribute(reason)}"`);
  return `<!-- scie_md:lock ${attrs.join(' ')} -->`;
}

export function describeProtectedBlocks(blocks: ProtectedBlock[]): string[] {
  return blocks.map((block, index) => {
    const reason = block.reason ? ` (${block.reason})` : '';
    return `Locked section ${index + 1}: lines ${block.startLine}-${block.endLine}${reason}`;
  });
}

export function describeProtectedAnchors(anchors: ProtectedAnchor[]): string[] {
  return anchors.map((anchor, index) => {
    const reason = anchor.reason ? ` (${anchor.reason})` : '';
    return `Locked quote ${index + 1}: line ${anchor.line}${reason} -> "${shortQuote(anchor.quote)}"`;
  });
}

export function detectProtectedChanges(markdown: string, hunks: HunkLike[]): ProtectedChange[] {
  const blocks = parseProtectedBlocks(markdown);
  const anchors = parseProtectedAnchors(markdown);
  if ((blocks.length === 0 && anchors.length === 0) || hunks.length === 0) return [];

  const changes: ProtectedChange[] = [];
  for (const hunk of hunks) {
    const hunkStartLine = hunk.beforeStart + 1;
    const hunkEndLine = Math.max(hunkStartLine, hunk.beforeEnd);
    for (const block of blocks) {
      if (rangesOverlap(hunkStartLine, hunkEndLine, block.startLine, block.endLine)) {
        changes.push({ block, hunkId: hunk.id });
      }
    }
    for (const anchor of anchors) {
      const quoteLine = findAnchorQuoteLine(markdown, anchor);
      if (
        rangesOverlap(hunkStartLine, hunkEndLine, anchor.line, anchor.line)
        || (quoteLine !== null && rangesOverlap(hunkStartLine, hunkEndLine, quoteLine, quoteLine))
      ) {
        changes.push({ block: anchor, hunkId: hunk.id });
      }
    }
  }
  return changes;
}

export function protectedBlockBodyRange(block: ProtectedBlock): ProtectedBodyRange {
  const startMarkerEnd = block.raw.indexOf('-->');
  const endMarkerStart = block.raw.lastIndexOf('<!--');
  if (startMarkerEnd < 0 || endMarkerStart < 0 || endMarkerStart <= startMarkerEnd) {
    return { start: block.start, end: block.end };
  }
  return {
    start: block.start + startMarkerEnd + 3,
    end: block.start + endMarkerStart,
  };
}

export function protectedBlockLockRange(block: ProtectedBlock): LockRange {
  const body = protectedBlockBodyRange(block);
  return {
    from: block.start,
    to: block.end,
    contentFrom: body.start,
    contentTo: body.end,
  };
}

export function changeTouchesProtectedBlockBody(block: ProtectedBlock, changeFrom: number, changeTo: number): boolean {
  return changeTouchesLockRange(changeFrom, changeTo, protectedBlockLockRange(block));
}

export function protectedAnchorQuoteRange(markdown: string, anchor: ProtectedAnchor): ProtectedBodyRange | null {
  const preferredOffset = anchor.end;
  return findNormalizedQuoteRange(markdown, anchor, preferredOffset);
}

export function changeTouchesProtectedAnchor(anchor: ProtectedAnchor, markdown: string, changeFrom: number, changeTo: number): boolean {
  if (changeTouchesLockRange(changeFrom, changeTo, {
    from: anchor.start,
    to: anchor.end,
    contentFrom: anchor.start,
    contentTo: anchor.end,
  })) return true;
  const range = protectedAnchorQuoteRange(markdown, anchor);
  return range ? changeTouchesLockRange(changeFrom, changeTo, {
    from: range.start,
    to: range.end,
    contentFrom: range.start,
    contentTo: range.end,
  }) : false;
}

function rangesOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function parseAttributes(value: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  attributePattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = attributePattern.exec(value))) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function compactQuote(value: string): string {
  const quote = value.replace(/\s+/g, ' ').trim();
  if (quote.length <= MAX_LOCK_QUOTE_ATTRIBUTE_LENGTH) return quote;
  return quote.slice(0, MAX_LOCK_QUOTE_ATTRIBUTE_LENGTH).trimEnd();
}

function createProtectedAnchorId(): string {
  const timestamp = Date.now().toString(36);
  const suffix = Math.random().toString(36).slice(2, 8) || 'lock';
  return `lock-${timestamp}-${suffix}`;
}

function shortQuote(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 80 ? `${normalized.slice(0, 77).trimEnd()}...` : normalized;
}

function findAnchorQuoteLine(markdown: string, anchor: ProtectedAnchor): number | null {
  const range = protectedAnchorQuoteRange(markdown, anchor);
  if (range) return offsetToLine(lineStartOffsets(markdown), range.start);
  const after = markdown.slice(anchor.end);
  const exactAfter = after.indexOf(anchor.quote);
  const lineStarts = lineStartOffsets(markdown);
  if (exactAfter >= 0) return offsetToLine(lineStarts, anchor.end + exactAfter);
  const before = markdown.slice(0, anchor.start);
  const exactBefore = before.lastIndexOf(anchor.quote);
  if (exactBefore >= 0) return offsetToLine(lineStarts, exactBefore);
  return null;
}

function findNormalizedQuoteRange(markdown: string, selector: QuoteAnchorSelector, preferredOffset: number): ProtectedBodyRange | null {
  const index = buildNormalizedMarkdownTextIndex(markdown);
  const match = findQuoteSelectorRangeInTextIndex(index, selector, preferredOffset);
  return match ? { start: match.from, end: match.to } : null;
}

function compactContext(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 80).trimEnd();
}
