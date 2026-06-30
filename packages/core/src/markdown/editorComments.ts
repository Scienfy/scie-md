import { lineStartOffsets, offsetToLine } from './textOffsets';
import { fencedCodeRanges, isOffsetInsideRanges } from './markdownRanges';
import { findMarkdownBlockInsertionOffset, findSelectedMarkdownLineRange, insertStandaloneMarkdownBlock } from './selectionWrapping';
import { createQuoteAnchorSelector } from './quoteAnchors';

export type EditorCommentAudience = 'human' | 'llm' | 'both';
export type EditorNoteKind = 'human' | 'llm';
export type EditorNoteTarget = 'cursor' | 'quote' | 'next-block' | 'previous-block' | 'selection' | 'block-range';

export interface EditorComment {
  line: number;
  audience: EditorCommentAudience;
  body: string;
  start?: number;
  end?: number;
  id?: string;
  kind?: EditorNoteKind;
  target?: EditorNoteTarget | string;
  quote?: string;
  prefix?: string;
  suffix?: string;
  sourceNoteId?: string;
  legacy?: boolean;
}

export interface EditorNoteSnippetOptions {
  id?: string;
  kind?: EditorNoteKind;
  target?: EditorNoteTarget | string;
  quote?: string;
  prefix?: string;
  suffix?: string;
  sourceNoteId?: string;
}

export interface InsertEditorNoteOptions extends EditorNoteSnippetOptions {
  body: string;
  selectedText?: string;
  selectionLine?: number;
  selectionEndLine?: number;
  preferredLine?: number;
}

export interface InsertEditorNoteResult {
  markdown: string;
  id: string;
  line: number;
  target: EditorNoteTarget;
  quote?: string;
  prefix?: string;
  suffix?: string;
}

export interface EditorNoteLifecycleIssue {
  note: EditorComment;
  reason: 'missing-human-summary';
}

const notePattern = /<!--\s*scie_md:note\b([\s\S]*?)-->/gi;
const fullNotePattern = /^\s*<!--\s*scie_md:note\b([\s\S]*?)-->\s*$/i;
const commentPattern = /<!--\s*scie_md:comment(?!:)(?:\s+audience=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?\s*:\s*([\s\S]*?)\s*-->/gi;
const delimitedCommentPattern = /<!--\s*scie_md:comment(?!:)(?:\s+audience=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?\s*-->\s*([\s\S]*?)\s*<!--\s*scie_md:comment:end\s*-->/gi;
const fullCommentPattern = /^\s*<!--\s*scie_md:comment(?!:)(?:\s+audience=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?\s*:\s*([\s\S]*?)\s*-->\s*$/i;
const attributePattern = /([A-Za-z_:][A-Za-z0-9_:.-]*)=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
const escapedCommentClosePattern = /--&gt;/g;
const MAX_QUOTE_ATTRIBUTE_LENGTH = 2000;
const structuredNoteRangeEnd = '<!-- scie_md:comment:end -->';

export function parseEditorComments(markdown: string): EditorComment[] {
  const lineStarts = lineStartOffsets(markdown);
  const ignoredRanges = fencedCodeRanges(markdown);
  const comments: EditorComment[] = [];
  notePattern.lastIndex = 0;

  let noteMatch: RegExpExecArray | null;
  while ((noteMatch = notePattern.exec(markdown))) {
    if (isOffsetInsideRanges(noteMatch.index, ignoredRanges)) continue;
    const parsed = parseEditorNoteMatch(noteMatch, lineStarts);
    if (parsed) comments.push(parsed);
  }

  commentPattern.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = commentPattern.exec(markdown))) {
    if (isOffsetInsideRanges(match.index, ignoredRanges)) continue;
    const requestedAudience = (match[1] ?? match[2] ?? match[3] ?? 'both').toLowerCase();
    comments.push({
      line: offsetToLine(lineStarts, match.index),
      audience: normalizeAudience(requestedAudience),
      body: decodeCommentBody(match[4] ?? '').trim(),
      start: match.index,
      end: match.index + match[0].length,
      legacy: true,
    });
  }
  delimitedCommentPattern.lastIndex = 0;
  while ((match = delimitedCommentPattern.exec(markdown))) {
    if (isOffsetInsideRanges(match.index, ignoredRanges)) continue;
    const requestedAudience = (match[1] ?? match[2] ?? match[3] ?? 'both').toLowerCase();
    comments.push({
      line: offsetToLine(lineStarts, match.index),
      audience: normalizeAudience(requestedAudience),
      body: decodeCommentBody(match[4] ?? '').trim(),
      start: match.index,
      end: match.index + match[0].length,
      target: 'block-range',
      legacy: true,
    });
  }

  return comments.sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || a.line - b.line);
}

export function createEditorCommentSnippet(body = 'LLM: revise this paragraph for clarity.', audience: EditorCommentAudience = 'llm'): string {
  const safeBody = encodeCommentBody(body);
  return safeBody.includes('\n')
    ? `<!-- scie_md:comment audience="${audience}":\n${safeBody}\n-->`
    : `<!-- scie_md:comment audience="${audience}": ${safeBody} -->`;
}

export function parseEditorCommentRaw(raw: string): Omit<EditorComment, 'line'> | null {
  const noteMatch = raw.match(fullNotePattern);
  if (noteMatch) {
    const parsed = parseEditorNoteRaw(noteMatch, 0);
    if (parsed) {
      const { line: _line, ...rest } = parsed;
      return rest;
    }
  }

  const match = raw.match(fullCommentPattern);
  if (!match) return null;
  const requestedAudience = (match[1] ?? match[2] ?? match[3] ?? 'both').toLowerCase();
  return {
    audience: normalizeAudience(requestedAudience),
    body: decodeCommentBody(match[4] ?? '').trim(),
    start: 0,
    end: raw.length,
    legacy: true,
  };
}

export function createEditorNoteSnippet(
  body = 'Revise this text for clarity while preserving the scientific meaning.',
  options: EditorNoteSnippetOptions = {},
): string {
  const kind = normalizeNoteKind(options.kind ?? 'llm');
  const id = options.id?.trim() || createEditorNoteId(kind);
  const target = normalizeTarget(options.target ?? (options.quote ? 'quote' : 'cursor'));
  const attrs = [
    `id="${escapeHtmlAttribute(id)}"`,
    `kind="${kind}"`,
    `target="${escapeHtmlAttribute(target)}"`,
  ];
  const quote = compactQuote(options.quote ?? '');
  if (quote) attrs.push(`quote="${escapeHtmlAttribute(quote)}"`);
  const prefix = compactContext(options.prefix ?? '');
  if (prefix) attrs.push(`prefix="${escapeHtmlAttribute(prefix)}"`);
  const suffix = compactContext(options.suffix ?? '');
  if (suffix) attrs.push(`suffix="${escapeHtmlAttribute(suffix)}"`);
  const sourceNoteId = options.sourceNoteId?.trim();
  if (sourceNoteId) attrs.push(`source="${escapeHtmlAttribute(sourceNoteId)}"`);
  const safeBody = encodeCommentBody(body.trim() || defaultNoteBody(kind));
  return safeBody.includes('\n')
    ? `<!-- scie_md:note ${attrs.join(' ')}:\n${safeBody}\n-->`
    : `<!-- scie_md:note ${attrs.join(' ')}: ${safeBody} -->`;
}

export function insertEditorNote(markdown: string, options: InsertEditorNoteOptions): InsertEditorNoteResult {
  const kind = normalizeNoteKind(options.kind ?? 'llm');
  const id = options.id?.trim() || createEditorNoteId(kind);
  const rawQuote = options.selectedText ?? options.quote ?? '';
  const selector = createQuoteAnchorSelector(markdown, rawQuote, {
    prefix: options.prefix,
    suffix: options.suffix,
    selectionLine: options.selectionLine,
    preferredLine: options.preferredLine,
  });
  const quote = compactQuote(selector.quote);
  const range = sourceLineRangeForSelectedText(markdown, rawQuote, options.selectionLine ?? options.preferredLine, options.selectionEndLine);
  const target = normalizeTarget(options.target ?? (range ? 'selection' : quote ? 'quote' : 'cursor'));
  const snippet = createEditorNoteSnippet(options.body, {
    ...options,
    id,
    kind,
    target,
    quote,
    prefix: target === 'quote' ? selector.prefix : undefined,
    suffix: target === 'quote' ? selector.suffix : undefined,
  });
  const { markdown: nextMarkdown, offset } = range
    ? insertDelimitedNoteRange(markdown, range, snippet)
    : (() => {
        const insertion = `${snippet}\n\n`;
        const insertionOffset = findNoteInsertionOffset(markdown, rawQuote, options.preferredLine, options.selectionLine);
        return {
          markdown: insertStandaloneBlock(markdown, insertionOffset, insertion),
          offset: insertionOffset,
        };
      })();
  const lineStarts = lineStartOffsets(nextMarkdown);
  return {
    markdown: nextMarkdown,
    id,
    line: offsetToLine(lineStarts, offset),
    target,
    quote: quote || undefined,
    prefix: target === 'quote' ? selector.prefix : undefined,
    suffix: target === 'quote' ? selector.suffix : undefined,
  };
}

function sourceLineRangeForSelectedText(
  markdown: string,
  selectedText: string,
  preferredLine?: number,
  selectionEndLine?: number,
): { start: number; end: number } | null {
  const normalized = selectedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return null;
  const explicitLineRange = sourceLineRangeFromSelectionLines(markdown, preferredLine, selectionEndLine, normalized);
  if (explicitLineRange) return explicitLineRange;
  const isRangeSelection = normalized.includes('\n') || normalizeSearchableQuote(normalized).length > MAX_QUOTE_ATTRIBUTE_LENGTH;
  if (!isRangeSelection) return null;
  return findSelectedMarkdownLineRange(markdown, normalized, preferredLine);
}

function sourceLineRangeFromSelectionLines(
  markdown: string,
  selectionLine?: number,
  selectionEndLine?: number,
  selectedText?: string,
): { start: number; end: number } | null {
  if (!Number.isFinite(selectionLine) || !Number.isFinite(selectionEndLine)) return null;
  const startLine = Math.max(1, Math.floor(selectionLine ?? 1));
  const endLine = Math.max(startLine, Math.floor(selectionEndLine ?? startLine));
  if (endLine <= startLine) return null;
  const starts = lineStartOffsets(markdown);
  const start = starts[startLine - 1];
  if (start === undefined) return null;
  const end = starts[endLine] ?? markdown.length;
  if (end <= start) return null;
  if (selectedText && !sourceRangeMatchesSelection(markdown.slice(start, end), selectedText)) return null;
  return { start, end };
}

function insertDelimitedNoteRange(
  markdown: string,
  range: { start: number; end: number },
  snippet: string,
): { markdown: string; offset: number } {
  const before = markdown.slice(0, range.start);
  const selected = markdown.slice(range.start, range.end);
  const after = markdown.slice(range.end);
  const beforePad = before && !/\n\s*\n$/.test(before) ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
  const selectedSuffix = selected.endsWith('\n') ? '' : '\n';
  const afterPad = after && !/^\s*\n/.test(after) ? '\n' : '';
  return {
    markdown: `${before}${beforePad}${snippet}\n\n${selected}${selectedSuffix}${structuredNoteRangeEnd}\n${afterPad}${after}`,
    offset: range.start + beforePad.length,
  };
}

export function detectEditorNoteLifecycleIssues(before: string, after: string): EditorNoteLifecycleIssue[] {
  const beforeNotes = parseEditorComments(before);
  const afterNotes = parseEditorComments(after);
  const afterIds = new Set(afterNotes.map((note) => note.id).filter((id): id is string => Boolean(id)));
  const humanSources = new Set(afterNotes
    .filter((note) => note.audience === 'human')
    .map((note) => note.sourceNoteId)
    .filter((id): id is string => Boolean(id)));

  return beforeNotes
    .filter((note) => note.audience === 'llm' && note.id && !note.legacy && !afterIds.has(note.id) && !humanSources.has(note.id))
    .map((note) => ({ note, reason: 'missing-human-summary' as const }));
}

export function createEditorNoteId(kind: EditorNoteKind = 'llm'): string {
  const timestamp = Date.now().toString(36);
  const suffix = Math.random().toString(36).slice(2, 8) || 'note';
  return `${kind}-${timestamp}-${suffix}`;
}

function parseEditorNoteMatch(match: RegExpExecArray, lineStarts: number[]): EditorComment | null {
  return parseEditorNoteRaw(match, offsetToLine(lineStarts, match.index));
}

function parseEditorNoteRaw(match: RegExpMatchArray | RegExpExecArray, line: number): EditorComment | null {
  const raw = splitEditorNoteRaw(match[1] ?? '');
  if (!raw) return null;
  const attrs = parseAttributes(raw.attrs);
  const body = decodeCommentBody(raw.body).trim();
  if (!body) return null;
  const kind = normalizeNoteKind(attrs.kind ?? attrs.audience ?? 'llm');
  return {
    line,
    audience: kind,
    body,
    start: 'index' in match && typeof match.index === 'number' ? match.index : 0,
    end: 'index' in match && typeof match.index === 'number' ? match.index + match[0].length : match[0].length,
    id: decodeHtmlAttribute(attrs.id ?? '').trim() || undefined,
    kind,
    target: normalizeTarget(attrs.target ?? (attrs.quote ? 'quote' : 'cursor')),
    quote: decodeHtmlAttribute(attrs.quote ?? '').trim() || undefined,
    prefix: decodeHtmlAttribute(attrs.prefix ?? '').trim() || undefined,
    suffix: decodeHtmlAttribute(attrs.suffix ?? '').trim() || undefined,
    sourceNoteId: decodeHtmlAttribute(attrs.source ?? attrs.sourceNoteId ?? '').trim() || undefined,
  };
}

function splitEditorNoteRaw(value: string): { attrs: string; body: string } | null {
  let quotedBy: '"' | "'" | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quotedBy) {
      if (char === quotedBy) quotedBy = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quotedBy = char;
      continue;
    }
    if (char === ':') {
      return {
        attrs: value.slice(0, index).trim(),
        body: value.slice(index + 1),
      };
    }
  }
  return null;
}

function normalizeAudience(value: string): EditorCommentAudience {
  if (value === 'human' || value === 'llm' || value === 'both') return value;
  return 'both';
}

function normalizeNoteKind(value: string): EditorNoteKind {
  return value === 'human' ? 'human' : 'llm';
}

function normalizeTarget(value: string): EditorNoteTarget {
  if (value === 'quote' || value === 'next-block' || value === 'previous-block' || value === 'selection' || value === 'block-range') return value;
  return 'cursor';
}

function defaultNoteBody(kind: EditorNoteKind): string {
  return kind === 'human'
    ? 'Summary for human review.'
    : 'Revise this text for clarity while preserving the scientific meaning.';
}

function encodeCommentBody(value: string): string {
  return value.replace(/-->/g, '--&gt;');
}

function decodeCommentBody(value: string): string {
  return value.replace(escapedCommentClosePattern, '-->');
}

function parseAttributes(value: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  attributePattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = attributePattern.exec(value))) {
    attrs[match[1]] = decodeHtmlAttribute(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function compactQuote(value: string): string {
  const quote = normalizeSearchableQuote(value);
  if (quote.length <= MAX_QUOTE_ATTRIBUTE_LENGTH) return quote;
  return quote.slice(0, MAX_QUOTE_ATTRIBUTE_LENGTH).trimEnd();
}

function compactContext(value: string): string {
  return normalizeSearchableQuote(value).slice(0, 80).trimEnd();
}

function normalizeSearchableQuote(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function findNoteInsertionOffset(markdown: string, quote: string, preferredLine?: number, selectionLine?: number): number {
  return findMarkdownBlockInsertionOffset(markdown, quote, preferredLine, selectionLine);
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

function insertStandaloneBlock(markdown: string, offset: number, block: string): string {
  return insertStandaloneMarkdownBlock(markdown, offset, block);
}

function sourceRangeMatchesSelection(source: string, selectedText: string): boolean {
  const sourceComparable = normalizeComparableMarkdownText(source).toLowerCase();
  if (!sourceComparable) return false;
  const fragments = selectionSearchFragments(selectedText);
  if (fragments.length === 0) return false;
  return fragments.every((fragment) => sourceComparable.includes(fragment));
}

function normalizeComparableMarkdownText(value: string): string {
  return value
    .split(/\r?\n+/)
    .map(normalizeComparableMarkdownLine)
    .filter(Boolean)
    .join(' ');
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
