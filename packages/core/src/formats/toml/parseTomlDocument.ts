import { parse as parseToml } from 'smol-toml';
import type { DocumentContent, FormatDiagnostic, FormatParseResult } from '../documentFormat.js';
import { createDocumentContent } from '../documentFormat.js';
import {
  analyzeStructuredValue,
  createStructuredJsonPreview,
  createStructuredPreservationSummary,
  diagnosticFromLineColumn,
  lineHasUnquotedHash,
  normalizeStructuredValueForJson,
  type ParsedStructuredDocument,
  type StructuredJsonPreview,
} from '../structured/structuredValue.js';
import { createLossyStructuredSourceMap } from '../structured/sourceMap.js';

export interface ParsedTomlDocument extends ParsedStructuredDocument {
  featureWarnings: FormatDiagnostic[];
  sections: TomlSectionSummary[];
}

export interface TomlSectionSummary {
  name: string;
  line: number;
  kind: 'table' | 'array-table';
}

export function parseTomlDocument(content: DocumentContent): FormatParseResult<ParsedTomlDocument> {
  const text = content.text;
  const featureWarnings = detectTomlFeatureWarnings(text);

  if (text.trim().length === 0) {
    return {
      format: 'toml',
      content,
      parsed: null,
      diagnostics: [{
        severity: 'error',
        code: 'toml-empty-document',
        message: 'TOML document is empty.',
        line: 1,
        column: 1,
        offset: 0,
        length: 1,
        source: 'toml',
        category: 'parser',
        blocking: true,
      }],
      sourceOnly: false,
    };
  }

  let value: unknown;
  try {
    value = normalizeStructuredValueForJson(parseToml(text));
  } catch (error) {
    return {
      format: 'toml',
      content,
      parsed: null,
      diagnostics: [tomlErrorToDiagnostic(error, text), ...featureWarnings],
      sourceOnly: false,
    };
  }

  const jsonPreview = createStructuredJsonPreview(value, featureWarnings, 'toml');
  return {
    format: 'toml',
    content,
    parsed: {
      value,
      stats: analyzeStructuredValue(value),
      sourceMap: createLossyStructuredSourceMap('toml', value),
      warnings: featureWarnings,
      preservation: createStructuredPreservationSummary({
        format: 'toml',
        warnings: featureWarnings,
        sourceMapFeasibility: 'requires-lossless-parser',
        candidateLibraries: ['taplo', 'toml_edit'],
        blockers: [
          'Current smol-toml integration returns normalized values only, without spans, comments, whitespace, dotted-key syntax, or array-of-table source identity.',
          'Round F5 toml_edit fixture tests preserve representative source text and expose spans in an immutable parse tree, but ScieMD has not adopted a production TOML adapter or edit planner.',
          'A writeable TOML tree needs a lossless parser/editor layer before source patches can be planned safely.',
        ],
      }),
      jsonPreview,
      featureWarnings,
      sections: collectTomlSections(text),
    },
    diagnostics: featureWarnings,
    sourceOnly: false,
  };
}

export function createTomlContent(text: string, path: string | null = null, metadata?: unknown): DocumentContent {
  return createDocumentContent('toml', text, path, metadata);
}

export function createTomlJsonPreview(parseResult: FormatParseResult<ParsedTomlDocument>): StructuredJsonPreview | null {
  if (!parseResult.parsed) return null;
  return parseResult.parsed.jsonPreview;
}

function detectTomlFeatureWarnings(text: string): FormatDiagnostic[] {
  const warnings: FormatDiagnostic[] = [];
  const sections = collectTomlSections(text);
  const duplicateSections = duplicateTomlSections(sections);
  const dottedKeyLine = findDottedKeyLine(text);
  const commentLine = splitLines(text).find((line) => lineHasUnquotedHash(line.text));

  const arrayTable = sections.find((section) => section.kind === 'array-table');
  if (arrayTable) {
    warnings.push(diagnosticFromLineColumn(
      'warning',
      'toml-array-table-readonly',
      'TOML arrays of tables are shown as read-only arrays. JSON preview will not preserve table syntax.',
      'toml',
      arrayTable.line,
      1,
      text,
    ));
  }
  if (dottedKeyLine) {
    warnings.push(diagnosticFromLineColumn(
      'warning',
      'toml-dotted-key-readonly',
      'TOML dotted keys are expanded into nested objects in the read-only tree and JSON preview.',
      'toml',
      dottedKeyLine.line,
      dottedKeyLine.column,
      text,
    ));
  }
  if (duplicateSections.length > 0) {
    warnings.push(diagnosticFromLineColumn(
      'warning',
      'toml-duplicate-section',
      `TOML section "${duplicateSections[0].name}" appears more than once. Parser rules decide whether this is allowed.`,
      'toml',
      duplicateSections[0].line,
      1,
      text,
    ));
  }
  const duplicateKey = findDuplicateKey(text);
  if (duplicateKey) {
    warnings.push(diagnosticFromLineColumn(
      'warning',
      'toml-duplicate-key',
      `TOML key "${duplicateKey.name}" appears more than once in the same table.`,
      'toml',
      duplicateKey.line,
      duplicateKey.column,
      text,
    ));
  }
  if (commentLine) {
    warnings.push(diagnosticFromLineColumn(
      'warning',
      'toml-comments-readonly',
      'TOML comments are source-only and are not represented in the read-only tree or JSON preview.',
      'toml',
      commentLine.line,
      1,
      text,
    ));
  }

  return warnings;
}

function tomlErrorToDiagnostic(error: unknown, text: string): FormatDiagnostic {
  const candidate = error as { line?: number; column?: number; message?: string };
  const line = typeof candidate.line === 'number' ? candidate.line : undefined;
  const column = typeof candidate.column === 'number' ? candidate.column : undefined;
  return diagnosticFromLineColumn(
    'error',
    'toml-syntax',
    cleanTomlErrorMessage(candidate.message ?? String(error || 'TOML parser reported a problem.')),
    'toml',
    line,
    column,
    text,
  );
}

function collectTomlSections(text: string): TomlSectionSummary[] {
  const sections: TomlSectionSummary[] = [];
  for (const line of splitLines(text)) {
    const trimmed = line.text.trim();
    const arrayMatch = trimmed.match(/^\[\[([^\]]+)]](?:\s*(?:#.*)?)$/);
    if (arrayMatch) {
      sections.push({ name: arrayMatch[1].trim(), line: line.line, kind: 'array-table' });
      continue;
    }
    const tableMatch = trimmed.match(/^\[([^\]]+)](?:\s*(?:#.*)?)$/);
    if (tableMatch) sections.push({ name: tableMatch[1].trim(), line: line.line, kind: 'table' });
  }
  return sections;
}

function duplicateTomlSections(sections: readonly TomlSectionSummary[]): TomlSectionSummary[] {
  const seen = new Set<string>();
  const duplicates: TomlSectionSummary[] = [];
  for (const section of sections) {
    const key = `${section.kind}:${section.name}`;
    if (seen.has(key)) duplicates.push(section);
    seen.add(key);
  }
  return duplicates;
}

function findDottedKeyLine(text: string): { line: number; column: number } | null {
  for (const line of splitLines(text)) {
    const withoutComment = stripTomlComment(line.text);
    if (/^\s*\[/.test(withoutComment)) continue;
    const match = withoutComment.match(/(^|[^"'A-Za-z0-9_-])([A-Za-z0-9_-]+(?:\s*\.\s*[A-Za-z0-9_-]+)+)\s*=/);
    if (match?.index !== undefined) return { line: line.line, column: match.index + match[1].length + 1 };
  }
  return null;
}

function findDuplicateKey(text: string): { name: string; line: number; column: number } | null {
  const keysBySection = new Map<string, Set<string>>();
  let section = '$';
  for (const line of splitLines(text)) {
    const withoutComment = stripTomlComment(line.text).trim();
    if (!withoutComment) continue;
    const sectionMatch = withoutComment.match(/^\[{1,2}([^\]]+)]{1,2}$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }
    const keyMatch = withoutComment.match(/^("[^"]+"|'[^']+'|[A-Za-z0-9_-]+(?:\s*\.\s*[A-Za-z0-9_-]+)*)\s*=/);
    if (!keyMatch) continue;
    const key = keyMatch[1].replace(/\s+/g, '');
    const keys = keysBySection.get(section) ?? new Set<string>();
    if (keys.has(key)) return { name: key, line: line.line, column: line.text.indexOf(keyMatch[1]) + 1 };
    keys.add(key);
    keysBySection.set(section, keys);
  }
  return null;
}

function stripTomlComment(line: string): string {
  let quoted: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const previous = line[index - 1];
    if (quoted === '"' && char === '"' && previous !== '\\') {
      quoted = null;
      continue;
    }
    if (quoted === "'" && char === "'") {
      quoted = null;
      continue;
    }
    if (!quoted && (char === '"' || char === "'")) {
      quoted = char;
      continue;
    }
    if (!quoted && char === '#') return line.slice(0, index);
  }
  return line;
}

function splitLines(text: string): Array<{ text: string; line: number }> {
  return text.split(/\r?\n/).map((line, index) => ({ text: line, line: index + 1 }));
}

function cleanTomlErrorMessage(message: string): string {
  return message.replace(/^Invalid TOML document:\s*/i, '').split(/\n\s*\n/)[0]?.trim() || message.trim();
}
