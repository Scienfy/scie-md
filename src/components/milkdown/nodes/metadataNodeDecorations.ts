import type { Node as ProseNode } from '@milkdown/prose/model';
import type { Transaction } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import { changeTouchesLockRange, collectLockRangesFromBoundaries } from '@sciemd/core';
import type { LockBoundary, LockRange } from '@sciemd/core';
import { findQuoteSelectorRangeInTextIndex } from '@sciemd/core';
import type { QuoteAnchorSelector } from '@sciemd/core';

export const lockOperationMeta = 'scie-md-lock-operation';
export const lockViolationEvent = 'scie-md-lock-violation';

const MAX_SCIE_METADATA_DECORATIONS = 1000;

export type MetadataNodeKind =
  | 'scie_lock_start'
  | 'scie_lock_end'
  | 'scie_lock_anchor'
  | 'scie_comment'
  | 'scie_comment_end'
  | 'scie_instruction'
  | 'scie_variant_group'
  | 'scie_directive_block'
  | 'scie_mermaid_block'
  | 'scie_svg_block';

const metadataNodeNames = new Set<MetadataNodeKind>([
  'scie_lock_start',
  'scie_lock_end',
  'scie_lock_anchor',
  'scie_comment',
  'scie_comment_end',
  'scie_instruction',
  'scie_variant_group',
  'scie_directive_block',
  'scie_mermaid_block',
  'scie_svg_block',
]);

export interface LockedRange extends LockRange {
  reason: string;
}

export function isScieMetadataNode(node: ProseNode): boolean {
  return metadataNodeNames.has(node.type.name as MetadataNodeKind);
}

export function findNextTopLevelNode(
  doc: ProseNode,
  fromPosition: number,
  typeName: string,
): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  doc.forEach((node, offset) => {
    if (found) return;
    const from = offset;
    if (from <= fromPosition) return;
    if (node.type.name === typeName) found = { from, to: from + node.nodeSize };
  });
  return found;
}

export function collectLockedRanges(doc: ProseNode): LockedRange[] {
  const boundaries: LockBoundary[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name === 'scie_lock_start') {
      boundaries.push({
        kind: 'start',
        from: offset,
        to: offset + node.nodeSize,
        contentFrom: offset + node.nodeSize,
        reason: String(node.attrs.reason ?? ''),
      });
      return;
    }
    if (node.type.name === 'scie_lock_end') {
      boundaries.push({
        kind: 'end',
        from: offset,
        to: offset + node.nodeSize,
      });
    }
  });
  const blockRanges = collectLockRangesFromBoundaries(boundaries).map((range) => ({
    ...range,
    reason: range.reason ?? '',
  }));
  const items = topLevelNodePositions(doc);
  const anchoredRanges: LockedRange[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.node.type.name !== 'scie_lock_anchor') continue;
    const quote = String(item.node.attrs.quote ?? '').trim();
    const target = String(item.node.attrs.target ?? 'quote');
    if (target !== 'quote' || !quote) continue;
    const range = findQuoteTargetRange(doc, items, index, quoteSelectorFromAttrs(item.node.attrs));
    if (!range) continue;
    anchoredRanges.push({
      from: range.from,
      to: range.to,
      contentFrom: range.from,
      contentTo: range.to,
      reason: String(item.node.attrs.reason ?? ''),
    });
  }
  return [...blockRanges, ...anchoredRanges].sort((left, right) => left.from - right.from || left.to - right.to);
}

export function nodeTouchesProtectedBlock(doc: ProseNode, position: number, nodeSize: number): boolean {
  const nodeEnd = position + nodeSize;
  return collectLockedRanges(doc)
    .some((range) => position < range.contentTo && range.contentFrom < nodeEnd);
}

export function transactionTouchedLockedRange(transaction: Transaction, lockedRanges: LockedRange[]): LockedRange | null {
  let touchedRange: LockedRange | null = null;
  transaction.mapping.maps.forEach((map) => {
    map.forEach((oldStart, oldEnd) => {
      if (touchedRange) return;
      touchedRange = lockedRanges.find((range) => changeTouchesLockedRange(oldStart, oldEnd, range)) ?? null;
    });
  });
  if (touchedRange) return touchedRange;
  return lockedRanges.find((range) => lockedRangeContentChanged(transaction, range)) ?? null;
}

export function changeTouchesLockedRange(changeFrom: number, changeTo: number, range: LockedRange): boolean {
  return changeTouchesLockRange(changeFrom, changeTo, range);
}

function lockedRangeContentChanged(transaction: Transaction, range: LockedRange): boolean {
  const nextFrom = transaction.mapping.map(range.contentFrom, 1);
  const nextTo = transaction.mapping.map(range.contentTo, -1);
  if (nextFrom < 0 || nextTo < nextFrom || nextTo > transaction.doc.content.size) return true;
  return serializeDocSlice(transaction.before, range.contentFrom, range.contentTo)
    !== serializeDocSlice(transaction.doc, nextFrom, nextTo);
}

function serializeDocSlice(doc: ProseNode, from: number, to: number): string {
  return JSON.stringify(doc.slice(from, to).content.toJSON());
}

export function emitLockViolation(range: LockedRange): void {
  if (typeof window === 'undefined') return;
  const detail = {
    reason: range.reason,
    message: range.reason
      ? `This section is locked (${range.reason}). Use the lock icon to unlock it before editing.`
      : 'This section is locked. Use the lock icon to unlock it before editing.',
  };
  queueMicrotask(() => {
    window.dispatchEvent(new CustomEvent(lockViolationEvent, { detail }));
  });
}

export function findMatchingLockEnd(doc: ProseNode, startPosition: number): { from: number; to: number } | null {
  let foundStart = false;
  let depth = 0;
  let match: { from: number; to: number } | null = null;
  doc.forEach((node, offset) => {
    if (match) return;
    if (offset === startPosition && node.type.name === 'scie_lock_start') {
      foundStart = true;
      depth = 1;
      return;
    }
    if (!foundStart || offset <= startPosition) return;
    if (node.type.name === 'scie_lock_start') {
      depth += 1;
      return;
    }
    if (node.type.name === 'scie_lock_end') {
      depth -= 1;
      if (depth === 0) match = { from: offset, to: offset + node.nodeSize };
    }
  });
  return match;
}

export function createScieMetadataDecorations(doc: ProseNode): DecorationSet {
  const decorations: Decoration[] = [];
  addLockRangeDecorations(doc, decorations);
  addNoteTargetDecorations(doc, decorations);
  return decorations.length > 0 ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
}

function addLockRangeDecorations(doc: ProseNode, decorations: Decoration[]): void {
  const ranges = collectLockedRanges(doc);
  if (ranges.length === 0) return;
  doc.forEach((node, offset) => {
    if (decorations.length >= MAX_SCIE_METADATA_DECORATIONS) return;
    for (const range of ranges) {
      if (offset < range.contentFrom || offset >= range.contentTo) continue;
      if (isScieMetadataNode(node)) continue;
      const className = offset === range.contentFrom ? 'locked-range-block locked-range-first' : 'locked-range-block';
      decorations.push(Decoration.node(offset, offset + node.nodeSize, { class: className }));
      break;
    }
  });
}

function addNoteTargetDecorations(doc: ProseNode, decorations: Decoration[]): void {
  const nodePositions = topLevelNodePositions(doc);
  for (let index = 0; index < nodePositions.length; index += 1) {
    if (decorations.length >= MAX_SCIE_METADATA_DECORATIONS) return;
    const item = nodePositions[index];
    if (item.node.type.name === 'scie_comment') {
      const noteKind = normalizeNoteKind(String(item.node.attrs.kind ?? item.node.attrs.audience ?? 'llm'));
      const quoteClass = noteKind === 'human' ? 'human-note-target-quote' : 'llm-note-target-quote';
      const blockClass = noteKind === 'human' ? 'human-note-target-block' : 'llm-note-target-block';
      const target = String(item.node.attrs.target ?? '');
      const quote = String(item.node.attrs.quote ?? '').trim();
      if (target === 'quote' && quote) {
        decorateQuoteTarget(doc, nodePositions, decorations, index, quoteSelectorFromAttrs(item.node.attrs), quoteClass);
        continue;
      }
      const endIndex = findNextNodeIndex(nodePositions, index + 1, 'scie_comment_end');
      if (endIndex !== null) {
        decorateRange(nodePositions, decorations, index + 1, endIndex, blockClass);
      } else {
        const next = findNextEditableNodeIndex(nodePositions, index + 1);
        if (next !== null) decorateRange(nodePositions, decorations, next, next + 1, blockClass);
      }
    }
    if (item.node.type.name === 'scie_instruction') {
      const target = String(item.node.attrs.target ?? 'next-block');
      if (target === 'previous-block') {
        const previous = findPreviousEditableNodeIndex(nodePositions, index - 1);
        if (previous !== null) decorateRange(nodePositions, decorations, previous, previous + 1, 'llm-note-target-block');
      } else if (target === 'next-block') {
        const next = findNextEditableNodeIndex(nodePositions, index + 1);
        if (next !== null) decorateRange(nodePositions, decorations, next, next + 1, 'llm-note-target-block');
      } else if (target === 'section') {
        decorateInstructionSection(nodePositions, decorations, index);
      }
    }
    if (item.node.type.name === 'scie_lock_anchor') {
      const quote = String(item.node.attrs.quote ?? '').trim();
      if (quote) decorateQuoteTarget(doc, nodePositions, decorations, index, quoteSelectorFromAttrs(item.node.attrs), 'locked-range-quote');
    }
    if (item.node.type.name === 'scie_variant_group') {
      const target = String(item.node.attrs.target ?? '');
      const quote = String(item.node.attrs.quote ?? '').trim();
      if (target === 'quote' && quote) decorateQuoteTarget(doc, nodePositions, decorations, index, quoteSelectorFromAttrs(item.node.attrs), 'variant-target-quote');
    }
  }
}

function decorateQuoteTarget(
  doc: ProseNode,
  items: Array<{ node: ProseNode; offset: number }>,
  decorations: Decoration[],
  noteIndex: number,
  selector: QuoteAnchorSelector,
  className: string,
): boolean {
  const range = findQuoteTargetRange(doc, items, noteIndex, selector);
  if (!range) return false;
  if (decorations.length >= MAX_SCIE_METADATA_DECORATIONS) return false;
  decorations.push(Decoration.inline(range.from, range.to, { class: className }));
  return true;
}

function findQuoteTargetRange(
  doc: ProseNode,
  items: Array<{ node: ProseNode; offset: number }>,
  anchorIndex: number,
  selector: QuoteAnchorSelector,
): { from: number; to: number } | null {
  const next = findNextEditableNodeIndex(items, anchorIndex + 1);
  if (next !== null) {
    const range = findQuoteRangeInNode(doc, items[next], selector);
    if (range) return range;
  }

  const previous = findPreviousEditableNodeIndex(items, anchorIndex - 1);
  if (previous !== null) {
    const range = findQuoteRangeInNode(doc, items[previous], selector);
    if (range) return range;
  }

  for (let index = anchorIndex + 1; index < items.length; index += 1) {
    if (isScieMetadataNode(items[index].node)) continue;
    const range = findQuoteRangeInNode(doc, items[index], selector);
    if (range) return range;
  }
  for (let index = anchorIndex - 1; index >= 0; index -= 1) {
    if (isScieMetadataNode(items[index].node)) continue;
    const range = findQuoteRangeInNode(doc, items[index], selector);
    if (range) return range;
  }
  return null;
}

function findQuoteRangeInNode(
  doc: ProseNode,
  item: { node: ProseNode; offset: number },
  selector: QuoteAnchorSelector,
): { from: number; to: number } | null {
  const index = buildNormalizedTextIndex(doc, item.offset, item.offset + item.node.nodeSize);
  const match = findQuoteSelectorRangeInTextIndex(index, selector);
  return match ? { from: match.from, to: match.to } : null;
}

function quoteSelectorFromAttrs(attrs: ProseNode['attrs']): QuoteAnchorSelector {
  return {
    quote: String(attrs.quote ?? '').trim(),
    prefix: String(attrs.prefix ?? '').trim() || undefined,
    suffix: String(attrs.suffix ?? '').trim() || undefined,
  };
}

function buildNormalizedTextIndex(doc: ProseNode, from: number, to: number): { text: string; positions: number[] } {
  let text = '';
  const positions: number[] = [];
  let pendingSpacePosition: number | null = null;
  let previousTextPosition: number | null = null;

  doc.nodesBetween(from, to, (node, position) => {
    if (!node.isText || !node.text) return true;
    for (let index = 0; index < node.text.length; index += 1) {
      const char = node.text[index];
      const charPosition = position + index;
      if (
        previousTextPosition !== null
        && charPosition > previousTextPosition + 1
        && text
        && !text.endsWith(' ')
        && pendingSpacePosition === null
      ) {
        pendingSpacePosition = previousTextPosition + 1;
      }
      if (/\s/.test(char)) {
        if (text && !text.endsWith(' ') && pendingSpacePosition === null) pendingSpacePosition = charPosition;
        previousTextPosition = charPosition;
        continue;
      }
      if (pendingSpacePosition !== null && text && !text.endsWith(' ')) {
        text += ' ';
        positions.push(pendingSpacePosition);
      }
      pendingSpacePosition = null;
      text += char;
      positions.push(charPosition);
      previousTextPosition = charPosition;
    }
    return true;
  });

  return { text, positions };
}

function topLevelNodePositions(doc: ProseNode): Array<{ node: ProseNode; offset: number }> {
  const positions: Array<{ node: ProseNode; offset: number }> = [];
  doc.forEach((node, offset) => positions.push({ node, offset }));
  return positions;
}

function findNextNodeIndex(items: Array<{ node: ProseNode }>, start: number, nodeName: string): number | null {
  for (let index = start; index < items.length; index += 1) {
    if (items[index].node.type.name === nodeName) return index;
  }
  return null;
}

function findNextEditableNodeIndex(items: Array<{ node: ProseNode }>, start: number): number | null {
  for (let index = start; index < items.length; index += 1) {
    if (!isScieMetadataNode(items[index].node)) return index;
  }
  return null;
}

function findPreviousEditableNodeIndex(items: Array<{ node: ProseNode }>, start: number): number | null {
  for (let index = start; index >= 0; index -= 1) {
    if (!isScieMetadataNode(items[index].node)) return index;
  }
  return null;
}

function decorateInstructionSection(
  items: Array<{ node: ProseNode; offset: number }>,
  decorations: Decoration[],
  instructionIndex: number,
): void {
  const first = findNextEditableNodeIndex(items, instructionIndex + 1);
  if (first === null) return;
  const headingLevel = headingLevelForNode(items[first].node);
  if (!headingLevel) {
    decorateRange(items, decorations, first, first + 1, 'llm-note-target-block');
    return;
  }
  let end = first + 1;
  while (end < items.length) {
    const level = headingLevelForNode(items[end].node);
    if (level && level <= headingLevel) break;
    end += 1;
  }
  decorateRange(items, decorations, first, end, 'llm-note-target-block');
}

function headingLevelForNode(node: ProseNode): number | null {
  if (node.type.name !== 'heading') return null;
  const level = Number(node.attrs.level);
  return Number.isFinite(level) ? level : null;
}

function decorateRange(
  items: Array<{ node: ProseNode; offset: number }>,
  decorations: Decoration[],
  startIndex: number,
  endIndexExclusive: number,
  baseClass: string,
): void {
  let first = true;
  for (let index = startIndex; index < endIndexExclusive; index += 1) {
    if (decorations.length >= MAX_SCIE_METADATA_DECORATIONS) break;
    const item = items[index];
    if (!item || isScieMetadataNode(item.node)) continue;
    decorations.push(Decoration.node(item.offset, item.offset + item.node.nodeSize, {
      class: first ? `${baseClass} ${baseClass}-first` : baseClass,
    }));
    first = false;
  }
}

export function decorateMissingImages(container: HTMLElement): void {
  for (const image of Array.from(container.querySelectorAll('img'))) {
    attachMissingImageHandler(image);
  }
}

function attachMissingImageHandler(image: HTMLImageElement): void {
  image.addEventListener('error', () => {
    const alt = image.getAttribute('alt')?.trim() || 'image';
    const source = image.getAttribute('src') ?? '';
    const placeholder = document.createElement('div');
    placeholder.className = 'directive-missing-image';

    const copy = document.createElement('span');
    copy.className = 'directive-missing-image-copy';
    copy.textContent = source
      ? `Missing image: ${alt} (${shortImageSource(source)})`
      : `Missing image: ${alt}`;

    const actions = document.createElement('span');
    actions.className = 'directive-missing-image-actions';

    const locate = document.createElement('button');
    locate.type = 'button';
    locate.textContent = 'Locate file...';
    locate.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(new CustomEvent('scie-md-locate-missing-image', {
        detail: { alt, source },
      }));
    });

    const reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = 'Reload';
    reload.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const retry = image.cloneNode(false) as HTMLImageElement;
      attachMissingImageHandler(retry);
      placeholder.replaceWith(retry);
      retry.src = cacheBustedImageSource(source);
    });

    actions.append(locate, reload);
    placeholder.append(copy, actions);
    image.replaceWith(placeholder);
  }, { once: true });
}

function cacheBustedImageSource(source: string): string {
  if (!source || /^(?:data|blob):/i.test(source)) return source;
  const separator = source.includes('?') ? '&' : '?';
  return `${source}${separator}scieReload=${Date.now()}`;
}

function shortImageSource(source: string): string {
  const decoded = safeDecodeURIComponent(source);
  const normalized = decoded.replace(/\\/g, '/');
  const fileName = normalized.split('/').filter(Boolean).at(-1) ?? normalized;
  return fileName.length > 48 ? `${fileName.slice(0, 45)}...` : fileName;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeSearchText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function shortDisplayText(value: string, limit: number): string {
  const normalized = normalizeSearchText(value);
  return normalized.length > limit ? `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...` : normalized;
}

const noteCardLayoutFrames = new WeakMap<HTMLElement, number>();

export function scheduleNoteCardLayout(root: HTMLElement): void {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
  const pending = noteCardLayoutFrames.get(root);
  if (pending !== undefined) window.cancelAnimationFrame(pending);
  const frame = window.requestAnimationFrame(() => {
    noteCardLayoutFrames.delete(root);
    layoutNoteCards(root);
  });
  noteCardLayoutFrames.set(root, frame);
}

function layoutNoteCards(root: HTMLElement): void {
  const cards = Array.from(root.querySelectorAll<HTMLElement>('.scie-md-note-card'));
  for (const card of cards) {
    card.style.setProperty('--note-stack-offset', '0px');
  }

  const measured = cards
    .map((card) => ({ card, rect: card.getBoundingClientRect() }))
    .filter((item) => item.rect.width > 0 && item.rect.height > 0)
    .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left);
  if (measured.length <= 1) return;

  const lanes: Array<{ left: number; right: number; bottom: number }> = [];
  for (const item of measured) {
    const lane = lanes.find((candidate) => item.rect.left < candidate.right && item.rect.right > candidate.left);
    if (!lane) {
      lanes.push({ left: item.rect.left, right: item.rect.right, bottom: item.rect.bottom });
      continue;
    }
    const offset = Math.max(0, lane.bottom + 10 - item.rect.top);
    item.card.style.setProperty('--note-stack-offset', `${Math.round(offset)}px`);
    lane.left = Math.min(lane.left, item.rect.left);
    lane.right = Math.max(lane.right, item.rect.right);
    lane.bottom = Math.max(lane.bottom, item.rect.bottom + offset);
  }
}

export function normalizeAudience(value: string): 'human' | 'llm' | 'both' {
  return value === 'human' || value === 'both' ? value : 'llm';
}

export function normalizeNoteKind(value: string): 'human' | 'llm' {
  return value === 'human' ? 'human' : 'llm';
}

export function normalizeTarget(value: string): 'next-block' | 'previous-block' | 'selection' | 'section' {
  if (value === 'previous-block' || value === 'selection' || value === 'section') return value;
  return 'next-block';
}

export function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
