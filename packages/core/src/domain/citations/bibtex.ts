import { extractCitationTokens } from './citationIndex.js';

export interface BibtexEntry {
  type: string;
  key: string;
  fields: Record<string, string>;
}

export interface BibtexEntryDraft {
  type: string;
  key: string;
  title?: string;
  author?: string;
  year?: string;
  journal?: string;
  publisher?: string;
  doi?: string;
  url?: string;
  note?: string;
  extraFields?: Record<string, string>;
}

interface BibtexItem {
  type: string;
  body: string;
  start: number;
  end: number;
}

const BIBTEX_BUILTIN_STRINGS: Record<string, string> = {
  jan: 'January',
  feb: 'February',
  mar: 'March',
  apr: 'April',
  may: 'May',
  jun: 'June',
  jul: 'July',
  aug: 'August',
  sep: 'September',
  oct: 'October',
  nov: 'November',
  dec: 'December',
};

export function parseBibtexEntries(bibtex: string): BibtexEntry[] {
  const entries: BibtexEntry[] = [];
  const strings = new Map(Object.entries(BIBTEX_BUILTIN_STRINGS));
  let index = 0;

  while (index < bibtex.length) {
    const item = readBibtexItem(bibtex, index);
    if (!item) break;
    index = item.end;

    if (item.type === 'string') {
      for (const [name, value] of Object.entries(parseBibtexFields(item.body, strings))) {
        strings.set(name.toLowerCase(), value);
      }
      continue;
    }
    if (item.type === 'comment' || item.type === 'preamble') continue;

    const comma = findTopLevelComma(item.body);
    if (comma <= 0) continue;
    const key = item.body.slice(0, comma).trim();
    if (!key) continue;
    entries.push({
      type: item.type,
      key,
      fields: parseBibtexFields(item.body.slice(comma + 1), strings),
    });
  }

  return applyCrossrefInheritance(entries);
}

export function formatBibliographyEntry(entry: BibtexEntry): string {
  const authors = formatAuthors(entry.fields.author || entry.fields.editor || '');
  const year = entry.fields.year ? ` (${entry.fields.year}).` : '';
  const title = sentenceWithPeriod(stripBraces(entry.fields.title || entry.key));
  const venue = stripBraces(entry.fields.journal || entry.fields.booktitle || entry.fields.publisher || '');
  const doi = entry.fields.doi ? ` https://doi.org/${entry.fields.doi.replace(/^https?:\/\/doi\.org\//i, '')}` : '';
  const url = !doi && entry.fields.url ? ` ${entry.fields.url}` : '';

  return [authors, year, title, venue ? `${venue}.` : '', doi || url]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createBibtexEntrySource(draft: BibtexEntryDraft): string {
  const type = normalizeEntryType(draft.type);
  const key = normalizeBibtexKey(draft.key);
  if (!key) throw new Error('Citation key is required.');
  const knownFieldNames = new Set(['title', 'author', 'year', 'journal', 'publisher', 'doi', 'url', 'note']);
  const fields: Array<[string, string | undefined]> = [
    ['title', draft.title],
    ['author', draft.author],
    ['year', draft.year],
    ['journal', draft.journal],
    ['publisher', draft.publisher],
    ['doi', normalizeDoi(draft.doi)],
    ['url', draft.url],
    ['note', draft.note],
  ];
  for (const [name, value] of Object.entries(draft.extraFields ?? {})) {
    const normalizedName = normalizeFieldName(name);
    if (!normalizedName || knownFieldNames.has(normalizedName)) continue;
    fields.push([normalizedName, value]);
  }
  const lines = fields
    .map(([name, value]) => [name, value?.trim()] as const)
    .filter(([, value]) => Boolean(value))
    .map(([name, value]) => `  ${name} = {${escapeBibtexValue(value ?? '')}},`);
  if (lines.length === 0) {
    throw new Error('Add at least one citation field.');
  }
  return [`@${type}{${key},`, ...lines, '}'].join('\n');
}

export function upsertBibtexEntrySource(bibtex: string, originalKey: string | null, nextSource: string): string {
  const normalizedSource = nextSource.trim();
  if (!normalizedSource) return bibtex;
  const key = originalKey ? normalizeBibtexKey(originalKey) : extractKeyFromEntrySource(normalizedSource);
  if (!key) return `${bibtex.trimEnd()}\n\n${normalizedSource}\n`;
  const range = findBibtexEntryRange(bibtex, key);
  if (!range) return `${bibtex.trimEnd()}\n\n${normalizedSource}\n`;
  return `${bibtex.slice(0, range.start).trimEnd()}\n\n${normalizedSource}\n\n${bibtex.slice(range.end).trimStart()}`.replace(/\n{4,}/g, '\n\n\n');
}

export function deleteBibtexEntrySource(bibtex: string, key: string): string {
  const normalizedKey = normalizeBibtexKey(key);
  if (!normalizedKey) return bibtex;
  const range = findBibtexEntryRange(bibtex, normalizedKey);
  if (!range) return bibtex;
  return `${bibtex.slice(0, range.start).trimEnd()}\n\n${bibtex.slice(range.end).trimStart()}`.replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n';
}

export function extractCitationUsageKeys(markdown: string): string[] {
  return extractUsedCitationKeys(markdown);
}

export function countCitationKeyUsages(markdown: string, key: string): number {
  return extractUsedCitationKeys(markdown).filter((usedKey) => usedKey === key).length;
}

export function renameCitationKeyUsages(markdown: string, originalKey: string, nextKey: string): string {
  const normalizedOriginal = normalizeBibtexKey(originalKey);
  const normalizedNext = normalizeBibtexKey(nextKey);
  if (!normalizedOriginal || !normalizedNext || normalizedOriginal === normalizedNext) return markdown;
  const replacements = extractCitationTokens(markdown, { allowLoose: true })
    .filter((token) => token.key === normalizedOriginal)
    .map((token) => ({
      from: token.from,
      to: token.to,
      value: `@${normalizedNext}`,
    }));
  return replacements
    .reverse()
    .reduce((text, replacement) => (
      `${text.slice(0, replacement.from)}${replacement.value}${text.slice(replacement.to)}`
    ), markdown);
}

export function syncGeneratedBibliography(markdown: string, entries: BibtexEntry[]): string {
  const usedKeys = Array.from(new Set(extractUsedCitationKeys(markdown)));
  const entryByKey = new Map(entries.map((entry) => [entry.key, entry]));
  const lines = usedKeys.length === 0
    ? ['No citation keys were found in this document yet.']
    : usedKeys.map((key) => {
      const entry = entryByKey.get(key);
      return entry ? `- ${formatBibliographyEntry(entry)}` : `- @${key} (missing from loaded bibliography)`;
    });
  const section = [
    '## References',
    '',
    '<!-- scie_md:bibliography:start -->',
    ...lines,
    '<!-- scie_md:bibliography:end -->',
  ].join('\n');

  const managedPattern = /(?:^|\n)## References\s*\n\s*<!--\s*scie_md:bibliography:start\s*-->[\s\S]*?<!--\s*scie_md:bibliography:end\s*-->/;
  if (managedPattern.test(markdown)) {
    return markdown.replace(managedPattern, (match) => `${match.startsWith('\n') ? '\n' : ''}${section}`);
  }
  return `${markdown.replace(/\s*$/g, '')}\n\n${section}\n`;
}

function parseBibtexFields(input: string, strings: Map<string, string> = new Map()): Record<string, string> {
  const fields: Record<string, string> = {};
  let index = 0;

  while (index < input.length) {
    const keyMatch = input.slice(index).match(/^\s*,?\s*([A-Za-z][\w-]*)\s*=\s*/);
    if (!keyMatch) break;
    const key = keyMatch[1].toLowerCase();
    index += keyMatch[0].length;
    const parsed = parseBibtexValueExpression(input, index, strings);
    fields[key] = parsed.value.trim();
    index = parsed.end;
  }

  return fields;
}

function findBibtexEntryRange(bibtex: string, key: string): { start: number; end: number } | null {
  let index = 0;
  while (index < bibtex.length) {
    const item = readBibtexItem(bibtex, index);
    if (!item) return null;
    index = item.end;
    if (item.type === 'comment' || item.type === 'preamble' || item.type === 'string') continue;
    const comma = findTopLevelComma(item.body);
    if (comma > 0 && item.body.slice(0, comma).trim() === key) {
      return { start: item.start, end: item.end };
    }
  }
  return null;
}

function extractKeyFromEntrySource(source: string): string {
  return normalizeBibtexKey(source.match(/^@\w+\s*\{\s*([^,\s]+)\s*,/)?.[1] ?? '');
}

function normalizeBibtexKey(value: string): string {
  return value.trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9_:.#$%&+\-?<>~/]/g, '');
}

function normalizeEntryType(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return normalized || 'misc';
}

function normalizeDoi(value: string | undefined): string {
  return value?.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '') ?? '';
}

function normalizeFieldName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function escapeBibtexValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parseBibtexValueExpression(input: string, start: number, strings: Map<string, string>): { value: string; end: number } {
  const parts: string[] = [];
  let index = start;
  while (index < input.length) {
    index = skipBibtexWhitespace(input, index);
    if (input[index] === ',' || input[index] === '}') break;
    const parsed = parseBibtexValue(input, index, strings);
    parts.push(parsed.value);
    index = skipBibtexWhitespace(input, parsed.end);
    if (input[index] !== '#') break;
    index += 1;
  }
  return { value: parts.join(''), end: consumeTrailingFieldSeparator(input, index) };
}

function parseBibtexValue(input: string, start: number, strings: Map<string, string>): { value: string; end: number } {
  const first = input[start];
  if (first === '{') {
    const end = findMatchingBrace(input, start);
    return { value: end < 0 ? input.slice(start + 1) : input.slice(start + 1, end), end: end < 0 ? input.length : end + 1 };
  }
  if (first === '"') {
    let escaping = false;
    for (let index = start + 1; index < input.length; index += 1) {
      const char = input[index];
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === '\\') {
        escaping = true;
        continue;
      }
      if (char === '"') return { value: input.slice(start + 1, index), end: index + 1 };
    }
    return { value: input.slice(start + 1), end: input.length };
  }
  const token = input.slice(start).match(/^[^\s,#}]+/);
  if (token) {
    const raw = token[0].trim();
    return { value: strings.get(raw.toLowerCase()) ?? raw, end: start + token[0].length };
  }
  const end = input.slice(start).search(/[,}#\n]/);
  return {
    value: end < 0 ? input.slice(start) : input.slice(start, start + end),
    end: end < 0 ? input.length : start + end + 1,
  };
}

function readBibtexItem(input: string, fromIndex: number): BibtexItem | null {
  let index = fromIndex;
  while (index < input.length) {
    const at = input.indexOf('@', index);
    if (at < 0) return null;
    const header = input.slice(at).match(/^@([A-Za-z]+)\s*([({])/);
    if (!header) {
      index = at + 1;
      continue;
    }
    const openIndex = at + header[0].length - 1;
    const closeIndex = findMatchingDelimiter(input, openIndex, header[2] as '{' | '(');
    if (closeIndex < 0) {
      index = openIndex + 1;
      continue;
    }
    return {
      type: header[1].toLowerCase(),
      body: input.slice(openIndex + 1, closeIndex),
      start: at,
      end: closeIndex + 1,
    };
  }
  return null;
}

function findTopLevelComma(input: string): number {
  let braceDepth = 0;
  let quote = false;
  let escaping = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === '\\') {
      escaping = true;
      continue;
    }
    if (char === '"' && braceDepth === 0) {
      quote = !quote;
      continue;
    }
    if (quote) continue;
    if (char === '{') braceDepth += 1;
    else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
    else if (char === ',' && braceDepth === 0) return index;
  }
  return -1;
}

function findMatchingDelimiter(input: string, openIndex: number, opener: '{' | '('): number {
  const closer = opener === '{' ? '}' : ')';
  let delimiterDepth = 0;
  let braceDepth = 0;
  let quote = false;
  let escaping = false;
  for (let index = openIndex; index < input.length; index += 1) {
    const char = input[index];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === '\\') {
      escaping = true;
      continue;
    }
    const quoteCanToggle = opener === '{'
      ? delimiterDepth === 1
      : delimiterDepth === 1 && braceDepth === 0;
    if (char === '"' && quoteCanToggle) {
      quote = !quote;
      continue;
    }
    if (quote) continue;
    if (char === opener) delimiterDepth += 1;
    else if (char === closer) {
      delimiterDepth -= 1;
      if (delimiterDepth === 0 && braceDepth === 0) return index;
    } else if (opener !== '{' && char === '{') {
      braceDepth += 1;
    } else if (opener !== '{' && char === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
    }
  }
  return -1;
}

function findMatchingBrace(input: string, openIndex: number): number {
  let depth = 0;
  let escaping = false;
  for (let index = openIndex; index < input.length; index += 1) {
    const char = input[index];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === '\\') {
      escaping = true;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function applyCrossrefInheritance(entries: BibtexEntry[]): BibtexEntry[] {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  return entries.map((entry) => {
    const parent = entry.fields.crossref ? byKey.get(entry.fields.crossref) : null;
    if (!parent) return entry;
    return {
      ...entry,
      fields: {
        ...Object.fromEntries(Object.entries(parent.fields).filter(([field]) => field !== 'crossref')),
        ...entry.fields,
      },
    };
  });
}

function extractUsedCitationKeys(markdown: string): string[] {
  return extractCitationTokens(markdown, { allowLoose: true }).map((token) => token.key);
}

function skipBibtexWhitespace(input: string, index: number): number {
  while (index < input.length && /\s/.test(input[index])) index += 1;
  return index;
}

function consumeTrailingFieldSeparator(input: string, index: number): number {
  index = skipBibtexWhitespace(input, index);
  return input[index] === ',' ? index + 1 : index;
}

function formatAuthors(value: string): string {
  const authors = stripBraces(value).split(/\s+and\s+/i).map((author) => author.trim()).filter(Boolean);
  if (authors.length === 0) return '';
  if (authors.length === 1) return authors[0];
  if (authors.length === 2) return `${authors[0]} and ${authors[1]}`;
  return `${authors[0]} et al.`;
}

function sentenceWithPeriod(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function stripBraces(value: string): string {
  return value.replace(/[{}]/g, '').replace(/\\&/g, '&').trim();
}
