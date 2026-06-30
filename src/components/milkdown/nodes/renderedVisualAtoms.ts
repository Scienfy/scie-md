import { directiveBody, parseDirectiveBlocks } from '@sciemd/core';
import type { DirectiveBlock } from '@sciemd/core';
import { findMermaidFenceBlocks, mermaidFenceBody } from '../../../markdown/mermaidBlocks';
import { findSvgFenceBlocks, svgFenceBody } from '../../../markdown/svgBlocks';
import { lineStartOffsets } from '@sciemd/core';

export interface MetadataMdastNode {
  type: string;
  value?: string;
  children?: MetadataMdastNode[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
  [key: string]: unknown;
}

export interface DirectiveAttrs {
  raw: string;
  name: string;
  label: string;
  detail: string;
  body: string;
}

export interface MermaidAttrs {
  raw: string;
  body: string;
}

export interface SvgAttrs {
  raw: string;
  body: string;
}

interface SourceRangeNode {
  start: number;
  end: number;
  node: MetadataMdastNode;
}

const MAX_VISUAL_ATOM_RENDER_BYTES = 256 * 1024;
const MAX_VISUAL_ATOM_RAW_PREVIEW_CHARS = 12_000;

export function replaceRenderedVisualAtomNodes(children: MetadataMdastNode[], sourceMarkdown: string): void {
  if (!sourceMarkdown || children.length === 0) return;
  const ranges = collectRenderedVisualAtomNodes(sourceMarkdown);
  if (ranges.length === 0) return;

  for (const range of ranges) {
    const span = childSpanForSourceRange(children, range.start, range.end);
    if (!span) continue;
    children.splice(span.startIndex, span.removeCount, withPosition(range.node, children[span.startIndex], children[span.endIndex]));
  }
}

export function attrsForDirectiveRaw(raw: string): DirectiveAttrs {
  const normalized = normalizeRaw(raw);
  const directive = parseDirectiveBlocks(normalized).find((item) => item.known && item.endLine !== null && item.line === 1);
  if (directive) return attrsForDirectiveBlock(directive);
  return {
    raw: normalized || ':::note\nWrite the note here.\n:::',
    name: 'note',
    label: '',
    detail: 'Invalid directive syntax',
    body: normalized,
  };
}

export function attrsForMermaidRaw(raw: string): MermaidAttrs {
  const normalized = normalizeRaw(raw);
  if (isOversizedVisualAtomSource(normalized)) return oversizedMermaidAttrs(normalized);
  return {
    raw: normalized || '```mermaid\nflowchart LR\n  A --> B\n```',
    body: mermaidFenceBody(raw),
  };
}

export function attrsForSvgRaw(raw: string): SvgAttrs {
  const normalized = normalizeRaw(raw);
  if (isOversizedVisualAtomSource(normalized)) return oversizedSvgAttrs(normalized);
  return {
    raw: normalized || '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120"></svg>\n```',
    body: svgFenceBody(normalized),
  };
}

export function isOversizedVisualAtomSource(raw: string): boolean {
  return byteLength(raw) > MAX_VISUAL_ATOM_RENDER_BYTES;
}

export function createOversizedAtomFallback(label: string, raw: string): HTMLElement {
  const fallback = document.createElement('div');
  fallback.className = 'scie-md-visual-atom-raw-fallback';
  const title = document.createElement('strong');
  title.textContent = `${label} shown as raw Markdown`;
  const meta = document.createElement('span');
  meta.textContent = `${formatBytes(byteLength(raw))}. Rendering is skipped to keep visual mode responsive.`;
  const preview = document.createElement('pre');
  preview.textContent = raw.length > MAX_VISUAL_ATOM_RAW_PREVIEW_CHARS
    ? `${raw.slice(0, MAX_VISUAL_ATOM_RAW_PREVIEW_CHARS).trimEnd()}\n\n... raw block truncated in visual preview ...`
    : raw;
  fallback.append(title, meta, preview);
  return fallback;
}

export function oversizedDirectiveAttrs(raw: string): DirectiveAttrs {
  const normalized = normalizeRaw(raw);
  const opening = normalized.match(/^\s*:::\s*([A-Za-z][\w-]*)(?:\s+\{([^}]*)})?/);
  const detail = opening?.[2]?.trim() || 'Large directive shown as raw Markdown';
  return {
    raw: normalized || ':::note\nWrite the note here.\n:::',
    name: opening?.[1] ?? 'note',
    label: detail.match(/#([A-Za-z0-9_.:-]+)/)?.[1] ?? '',
    detail,
    body: '',
  };
}

export function oversizedMermaidAttrs(raw: string): MermaidAttrs {
  const normalized = normalizeRaw(raw);
  return {
    raw: normalized || '```mermaid\nflowchart LR\n  A --> B\n```',
    body: '',
  };
}

export function oversizedSvgAttrs(raw: string): SvgAttrs {
  const normalized = normalizeRaw(raw);
  return {
    raw: normalized || '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120"></svg>\n```',
    body: '',
  };
}

function collectRenderedVisualAtomNodes(sourceMarkdown: string): SourceRangeNode[] {
  const ranges = removeOverlappingSourceRanges([
    ...collectDirectiveNodes(sourceMarkdown),
    ...collectMermaidNodes(sourceMarkdown),
    ...collectSvgNodes(sourceMarkdown),
  ].sort((a, b) => a.start - b.start || b.end - a.end));
  return ranges.sort((a, b) => b.start - a.start);
}

function collectDirectiveNodes(sourceMarkdown: string): SourceRangeNode[] {
  const starts = lineStartOffsets(sourceMarkdown);
  return parseDirectiveBlocks(sourceMarkdown)
    .filter((directive) => directive.known && directive.endLine !== null)
    .map((directive) => {
      const start = starts[directive.line - 1] ?? 0;
      const end = lineEndOffset(starts, sourceMarkdown, directive.endLine ?? directive.line);
      return {
        start,
        end,
        node: directiveNodeFromBlock(directive),
      };
    });
}

function collectMermaidNodes(sourceMarkdown: string): SourceRangeNode[] {
  return findMermaidFenceBlocks(sourceMarkdown).map((block) => ({
    start: block.start,
    end: block.end,
    node: mermaidNodeFromRaw(block.raw),
  }));
}

function collectSvgNodes(sourceMarkdown: string): SourceRangeNode[] {
  return findSvgFenceBlocks(sourceMarkdown).map((block) => ({
    start: block.start,
    end: block.end,
    node: svgNodeFromRaw(block.raw),
  }));
}

function directiveNodeFromBlock(directive: DirectiveBlock): MetadataMdastNode {
  return {
    type: 'scie_directive_block',
    ...attrsForDirectiveBlock(directive),
  };
}

function attrsForDirectiveBlock(directive: DirectiveBlock): DirectiveAttrs {
  if (isOversizedVisualAtomSource(directive.raw)) return oversizedDirectiveAttrs(directive.raw);
  return {
    raw: directive.raw,
    name: directive.name,
    label: directive.label ?? '',
    detail: directiveDetail(directive),
    body: directiveBody(directive.raw),
  };
}

function mermaidNodeFromRaw(raw: string): MetadataMdastNode {
  return {
    type: 'scie_mermaid_block',
    ...attrsForMermaidRaw(raw),
  };
}

function svgNodeFromRaw(raw: string): MetadataMdastNode {
  return {
    type: 'scie_svg_block',
    ...attrsForSvgRaw(raw),
  };
}

function childSpanForSourceRange(
  children: MetadataMdastNode[],
  start: number,
  end: number,
): { startIndex: number; endIndex: number; removeCount: number } | null {
  let startIndex = -1;
  let endIndex = -1;

  for (let index = 0; index < children.length; index += 1) {
    const childStart = children[index].position?.start?.offset;
    const childEnd = children[index].position?.end?.offset;
    if (typeof childStart !== 'number' || typeof childEnd !== 'number') continue;
    if (childEnd <= start || childStart >= end) continue;
    if (startIndex === -1) startIndex = index;
    endIndex = index;
  }

  if (startIndex < 0 || endIndex < startIndex) return null;
  return { startIndex, endIndex, removeCount: endIndex - startIndex + 1 };
}

function lineEndOffset(starts: number[], sourceMarkdown: string, line: number): number {
  const nextLineStart = starts[line];
  if (typeof nextLineStart === 'number') {
    const maybeCarriageReturn = sourceMarkdown[nextLineStart - 2] === '\r' ? 2 : 1;
    return Math.max(starts[line - 1] ?? 0, nextLineStart - maybeCarriageReturn);
  }
  return sourceMarkdown.length;
}

function removeOverlappingSourceRanges(ranges: SourceRangeNode[]): SourceRangeNode[] {
  const accepted: SourceRangeNode[] = [];
  for (const range of ranges) {
    if (accepted.some((item) => range.start < item.end && item.start < range.end)) continue;
    accepted.push(range);
  }
  return accepted;
}

function directiveDetail(directive: DirectiveBlock): string {
  const parts = [
    directive.label ? `#${directive.label}` : '',
    directive.classes.length > 0 ? directive.classes.map((item) => `.${item}`).join(' ') : '',
  ].filter(Boolean);
  return parts.join(' - ') || directive.opening;
}

function withPosition(
  node: MetadataMdastNode,
  startFrom: MetadataMdastNode,
  endFrom = startFrom,
): MetadataMdastNode {
  return {
    ...node,
    position: {
      start: startFrom.position?.start,
      end: endFrom.position?.end,
    },
  };
}

function normalizeRaw(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  return unescape(encodeURIComponent(value)).length;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
