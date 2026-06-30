import { parseBibtexEntries } from './bibtex.js';
import type { BibtexEntry } from './bibtex.js';
import { fencedCodeRanges, frontmatterRanges, inlineCodeRanges, isOffsetInsideRanges, mergeRanges, scieMdCommentRanges } from '../../markdown/markdownRanges.js';
import { lineStartOffsets, offsetToLine } from '../../markdown/textOffsets.js';

export interface CitationUsage {
  key: string;
  line: number;
  raw: string;
  kind: CitationTokenKind;
}

export type CitationTokenKind = 'bracket' | 'narrative';

export interface CitationToken extends CitationUsage {
  from: number;
  to: number;
}

export interface CitationIndex {
  usages: CitationUsage[];
  bibliographyFiles: string[];
  bibtexKeys: string[];
  bibtexEntries: BibtexEntry[];
  missingKeys: string[];
}

export function buildCitationIndex(markdown: string, bibliographyFiles: string[] = [], bibtex = '', lineOffset = 0): CitationIndex {
  const usages = extractCitationUsages(markdown, { allowLoose: bibliographyFiles.length > 0 || bibtex.trim().length > 0, lineOffset });
  const bibtexEntries = parseBibtexEntries(bibtex);
  const bibtexKeys = bibtexEntries.length > 0 ? bibtexEntries.map((entry) => entry.key) : extractBibtexKeys(bibtex);
  const known = new Set(bibtexKeys);
  const shouldVerifyCitations = bibliographyFiles.length > 0 || bibtex.trim().length > 0;
  const missingKeys = shouldVerifyCitations
    ? Array.from(new Set(usages.map((usage) => usage.key).filter((key) => !known.has(key))))
    : [];

  return {
    usages,
    bibliographyFiles,
    bibtexKeys,
    bibtexEntries,
    missingKeys,
  };
}

export function extractCitationUsages(markdown: string, options: { allowLoose?: boolean; lineOffset?: number } = {}): CitationUsage[] {
  return extractCitationTokens(markdown, options).map(({ key, line, raw, kind }) => ({ key, line, raw, kind }));
}

export function extractCitationTokens(markdown: string, options: { allowLoose?: boolean; lineOffset?: number } = {}): CitationToken[] {
  const tokens: CitationToken[] = [];
  const bracketRanges: Array<{ start: number; end: number }> = [];
  const ignoredRanges = citationIgnoredRanges(markdown);
  const lineStarts = lineStartOffsets(markdown);
  const bracketPattern = /\[[^\]]*@([A-Za-z0-9_][A-Za-z0-9_:.#$%&+\-?<>~/]*)[^\]]*]/g;
  let bracketMatch: RegExpExecArray | null;

  while ((bracketMatch = bracketPattern.exec(markdown))) {
    const raw = bracketMatch[0];
    const rawOffset = bracketMatch.index;
    if (isOffsetInsideRanges(rawOffset, ignoredRanges)) continue;
    bracketRanges.push({ start: rawOffset, end: rawOffset + raw.length });
    for (const citationMatch of raw.matchAll(/@([A-Za-z0-9_][A-Za-z0-9_:.#$%&+\-?<>~/]*)/g)) {
      const key = citationMatch[1];
      const from = rawOffset + (citationMatch.index ?? 0);
      tokens.push({
        key,
        raw,
        kind: 'bracket',
        from,
        to: from + citationMatch[0].length,
        line: offsetToLine(lineStarts, from) + (options.lineOffset ?? 0),
      });
    }
  }

  if (!options.allowLoose) return orderTokens(dedupeTokens(tokens));

  const citationPattern = /(^|[^\w/])@([A-Za-z0-9_][A-Za-z0-9_:.#$%&+\-?<>~/]*)/g;
  let match: RegExpExecArray | null;
  while ((match = citationPattern.exec(markdown))) {
    const full = match[0].trim();
    const key = cleanLooseCitationKey(match[2]);
    if (!key) continue;
    const atOffset = match.index + match[1].length;
    if (isOffsetInsideRanges(atOffset, ignoredRanges)) continue;
    if (isOffsetInsideRanges(atOffset, bracketRanges)) continue;
    if (isLikelyEmailOrHandle(markdown, atOffset)) continue;
    if (isCrossReferenceKey(key)) continue;
    tokens.push({
      key,
      raw: full,
      kind: 'narrative',
      from: atOffset,
      to: atOffset + key.length + 1,
      line: offsetToLine(lineStarts, match.index + match[1].length) + (options.lineOffset ?? 0),
    });
  }

  return orderTokens(dedupeTokens(tokens));
}

export function extractBibtexKeys(bibtex: string): string[] {
  return parseBibtexEntries(bibtex).map((entry) => entry.key);
}

function citationIgnoredRanges(markdown: string): Array<{ start: number; end: number }> {
  return mergeRanges([
    ...frontmatterRanges(markdown),
    ...fencedCodeRanges(markdown),
    ...inlineCodeRanges(markdown),
    ...scieMdCommentRanges(markdown),
  ]);
}

function isLikelyEmailOrHandle(markdown: string, offset: number): boolean {
  const before = markdown.slice(Math.max(0, offset - 20), offset);
  return /[\w.+-]$/.test(before);
}

function isCrossReferenceKey(key: string): boolean {
  return /^(fig|tbl|eq|sec|lst|nte|tip|wrn|imp|cau)(?:-|:)/.test(key);
}

function cleanLooseCitationKey(key: string): string {
  return key.replace(/[.,;!?]+$/g, '');
}

function dedupeUsages(usages: CitationUsage[]): CitationUsage[] {
  const seen = new Set<string>();
  return usages.filter((usage) => {
    const signature = `${usage.key}:${usage.line}:${usage.raw}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function dedupeTokens(tokens: CitationToken[]): CitationToken[] {
  const seen = new Set<string>();
  return tokens.filter((token) => {
    const signature = `${token.key}:${token.from}:${token.to}:${token.raw}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function orderTokens(tokens: CitationToken[]): CitationToken[] {
  return tokens.slice().sort((left, right) => left.from - right.from || left.to - right.to);
}
