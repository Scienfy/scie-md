import { lineStartOffsets } from './textOffsets';

export interface QuoteAnchorSelector {
  quote: string;
  prefix?: string;
  suffix?: string;
}

export interface NormalizedTextIndex {
  text: string;
  positions: number[];
}

export interface NormalizedQuoteMatch {
  startIndex: number;
  endIndex: number;
  from: number;
  to: number;
}

interface QuoteAnchorSelectorOptions {
  prefix?: string;
  suffix?: string;
  preferredLine?: number;
  selectionLine?: number;
  contextLength?: number;
}

const DEFAULT_QUOTE_CONTEXT_LENGTH = 20;

export function createQuoteAnchorSelector(
  markdown: string,
  quote: string,
  options: QuoteAnchorSelectorOptions = {},
): QuoteAnchorSelector {
  const normalizedQuote = normalizeQuoteText(quote);
  const selector: QuoteAnchorSelector = { quote: normalizedQuote };
  const explicitPrefix = normalizeQuoteText(options.prefix ?? '');
  const explicitSuffix = normalizeQuoteText(options.suffix ?? '');
  if (explicitPrefix) selector.prefix = explicitPrefix;
  if (explicitSuffix) selector.suffix = explicitSuffix;
  if (!normalizedQuote) return selector;

  const needsDerivedContext = !selector.prefix || !selector.suffix;
  if (!markdown || !needsDerivedContext) return selector;

  const preferredOffset = linePreferredOffset(markdown, options.selectionLine ?? options.preferredLine);
  const textIndex = buildNormalizedMarkdownTextIndex(markdown);
  const match = findQuoteSelectorRangeInTextIndex(textIndex, selector, preferredOffset);
  if (!match) return selector;

  const contextLength = Math.max(0, Math.floor(options.contextLength ?? DEFAULT_QUOTE_CONTEXT_LENGTH));
  if (contextLength === 0) return selector;

  if (!selector.prefix) {
    const prefix = normalizeQuoteText(textIndex.text.slice(Math.max(0, match.startIndex - contextLength), match.startIndex));
    if (prefix) selector.prefix = prefix;
  }
  if (!selector.suffix) {
    const suffix = normalizeQuoteText(textIndex.text.slice(match.endIndex + 1, match.endIndex + 1 + contextLength));
    if (suffix) selector.suffix = suffix;
  }
  return selector;
}

export function quoteAnchorPrefix(value: string, contextLength = DEFAULT_QUOTE_CONTEXT_LENGTH): string | undefined {
  const normalized = normalizeQuoteText(value);
  const prefix = normalizeQuoteText(normalized.slice(Math.max(0, normalized.length - contextLength)));
  return prefix || undefined;
}

export function quoteAnchorSuffix(value: string, contextLength = DEFAULT_QUOTE_CONTEXT_LENGTH): string | undefined {
  const suffix = normalizeQuoteText(normalizeQuoteText(value).slice(0, contextLength));
  return suffix || undefined;
}

export function findQuoteSelectorRangeInTextIndex(
  index: NormalizedTextIndex,
  selector: QuoteAnchorSelector,
  preferredPosition?: number,
): NormalizedQuoteMatch | null {
  const normalizedQuote = normalizeQuoteText(selector.quote).toLowerCase();
  if (!normalizedQuote) return null;

  const text = index.text;
  const lowerText = text.toLowerCase();
  const prefix = normalizeQuoteText(selector.prefix ?? '').toLowerCase();
  const suffix = normalizeQuoteText(selector.suffix ?? '').toLowerCase();
  const contextCount = (prefix ? 1 : 0) + (suffix ? 1 : 0);
  const matches: Array<NormalizedQuoteMatch & { contextMisses: number; sourceFrom: number }> = [];
  let searchFrom = 0;

  while (searchFrom < lowerText.length) {
    const startIndex = lowerText.indexOf(normalizedQuote, searchFrom);
    if (startIndex < 0) break;
    const endIndex = startIndex + normalizedQuote.length - 1;
    const from = index.positions[startIndex];
    const to = index.positions[endIndex] + 1;
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
      const prefixMatches = !prefix || lowerText.slice(0, startIndex).trimEnd().endsWith(prefix);
      const suffixMatches = !suffix || lowerText.slice(endIndex + 1).trimStart().startsWith(suffix);
      matches.push({
        startIndex,
        endIndex,
        from,
        to,
        sourceFrom: from,
        contextMisses: contextCount - (prefixMatches ? (prefix ? 1 : 0) : 0) - (suffixMatches ? (suffix ? 1 : 0) : 0),
      });
    }
    searchFrom = startIndex + Math.max(1, normalizedQuote.length);
  }

  if (matches.length === 0) return null;
  const preferred = Number.isFinite(preferredPosition) ? preferredPosition : undefined;
  const chosen = matches.sort((left, right) => {
    const leftAfter = preferred === undefined || left.sourceFrom >= preferred ? 0 : 1;
    const rightAfter = preferred === undefined || right.sourceFrom >= preferred ? 0 : 1;
    return left.contextMisses - right.contextMisses
      || leftAfter - rightAfter
      || (preferred === undefined ? 0 : Math.abs(left.sourceFrom - preferred) - Math.abs(right.sourceFrom - preferred))
      || left.sourceFrom - right.sourceFrom;
  })[0];

  return {
    startIndex: chosen.startIndex,
    endIndex: chosen.endIndex,
    from: chosen.from,
    to: chosen.to,
  };
}

export function buildNormalizedMarkdownTextIndex(markdown: string): NormalizedTextIndex {
  let text = '';
  const positions: number[] = [];
  let pendingSpacePosition: number | null = null;

  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown.startsWith('<!--', index)) {
      const end = markdown.indexOf('-->', index + 4);
      if (end < 0) break;
      index = end + 2;
      if (text && !text.endsWith(' ')) pendingSpacePosition = index;
      continue;
    }
    const char = markdown[index];
    if (isMarkdownSyntaxChar(char)) continue;
    if (char === '\\' && index + 1 < markdown.length) continue;
    if (/\s/.test(char)) {
      if (text && !text.endsWith(' ') && pendingSpacePosition === null) pendingSpacePosition = index;
      continue;
    }
    if (pendingSpacePosition !== null && text && !text.endsWith(' ')) {
      text += ' ';
      positions.push(pendingSpacePosition);
    }
    pendingSpacePosition = null;
    text += char;
    positions.push(index);
  }

  return { text, positions };
}

export function normalizeQuoteText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function linePreferredOffset(markdown: string, line?: number): number | undefined {
  if (!Number.isFinite(line) || !line) return undefined;
  const starts = lineStartOffsets(markdown);
  return starts[Math.max(0, Math.min(starts.length - 1, Math.floor(line) - 1))];
}

function isMarkdownSyntaxChar(char: string): boolean {
  return char === '*'
    || char === '_'
    || char === '`'
    || char === '~'
    || char === '['
    || char === ']'
    || char === '('
    || char === ')'
    || char === '!';
}
