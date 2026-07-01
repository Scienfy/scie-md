import { getScienfyMetadata, replaceFrontmatterBody } from '../document/frontmatter';
import { parseFrontmatter } from '../document/frontmatter';
import type { FrontmatterParseResult } from '../document/frontmatter';
import { lineStartOffsets, offsetToLine } from '../../markdown/textOffsets';
import { fencedCodeRanges, inlineCodeRanges, isOffsetInsideRanges, mergeRanges, scieMdCommentRanges } from '../../markdown/markdownRanges';
import type { OffsetRange } from '../../markdown/markdownRanges';

export interface VariableDefinition {
  name: string;
  value: string;
  source: 'frontmatter' | 'scie_md' | 'external';
  file?: string;
}

export interface VariableUsage {
  name: string;
  raw: string;
  line: number;
  from: number;
  to: number;
}

export interface VariableIndex {
  definitions: VariableDefinition[];
  usages: VariableUsage[];
  missingVariables: string[];
}

export interface VariableSubstitutionOptions {
  escapeMarkdown?: boolean;
}

export function buildVariableIndex(
  markdown: string,
  frontmatter: FrontmatterParseResult,
  externalDefinitions: VariableDefinition[] = [],
): VariableIndex {
  const definitions = [
    ...externalDefinitions,
    ...extractVariableDefinitions(frontmatter),
  ];
  const usages = extractVariableUsages(
    frontmatter.hasFrontmatter ? frontmatter.body : markdown,
    frontmatter.hasFrontmatter ? frontmatter.endLine : 0,
    frontmatter.hasFrontmatter ? markdown.length - frontmatter.body.length : 0,
  );
  const known = new Set(definitions.map((definition) => definition.name));
  const missingVariables = Array.from(new Set(
    usages.map((usage) => usage.name).filter((name) => !known.has(name)),
  ));

  return { definitions, usages, missingVariables };
}

export function parseVariableDataFile(content: string, fileName = 'variables.json'): VariableDefinition[] {
  const extension = fileName.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase();
  if (extension === 'csv') return parseCsvVariables(content, fileName);
  if (extension === 'json' || extension === undefined) return parseJsonVariables(content, fileName);
  return [];
}

export function extractVariableUsages(markdown: string, lineOffset = 0, offsetOffset = 0): VariableUsage[] {
  const usages: VariableUsage[] = [];
  const lineStarts = lineStartOffsets(markdown);
  const ignoredRanges = ignoredVariableRanges(markdown);
  const pattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*}}/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(markdown))) {
    if (isOffsetInsideRanges(match.index, ignoredRanges)) continue;
    usages.push({
      name: match[1],
      raw: match[0],
      line: offsetToLine(lineStarts, match.index) + lineOffset,
      from: offsetOffset + match.index,
      to: offsetOffset + match.index + match[0].length,
    });
  }

  return usages;
}

export function canonicalizeVariableTokens(markdown: string): string {
  const ignoredRanges = ignoredVariableRanges(markdown);
  return markdown.replace(/\{\{[^\n]*?}}/g, (raw: string, offset: number) => {
    if (isOffsetInsideRanges(offset, ignoredRanges)) return raw;
    const inner = raw.slice(2, -2);
    const canonicalInner = inner.replace(/\\([_.-])/g, '$1');
    if (!/^\s*[A-Za-z_][A-Za-z0-9_.-]*\s*$/.test(canonicalInner)) return raw;
    return `{{${canonicalInner}}}`;
  });
}

export function substituteVariables(markdown: string): string {
  const frontmatter = parseFrontmatter(markdown);
  const definitions = extractVariableDefinitions(frontmatter);
  if (definitions.length === 0) return markdown;
  const substitutedBody = substituteVariablesInText(
    frontmatter.hasFrontmatter ? frontmatter.body : markdown,
    definitions,
  );

  if (!frontmatter.hasFrontmatter) return substitutedBody;
  return replaceFrontmatterBody(frontmatter, substitutedBody);
}

export function substituteVariablesWithDefinitions(
  markdown: string,
  definitions: VariableDefinition[],
  options: VariableSubstitutionOptions = {},
): string {
  const frontmatter = parseFrontmatter(markdown);
  const body = frontmatter.hasFrontmatter ? frontmatter.body : markdown;
  const substitutedBody = substituteVariablesInText(body, definitions, options);
  if (!frontmatter.hasFrontmatter) return substitutedBody;
  return replaceFrontmatterBody(frontmatter, substitutedBody);
}

export function substituteVariablesInText(
  text: string,
  definitions: VariableDefinition[],
  options: VariableSubstitutionOptions = {},
): string {
  if (definitions.length === 0) return text;
  const values = new Map(definitions.map((definition) => [definition.name, definition.value]));
  const ignoredRanges = ignoredVariableRanges(text);
  return text.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*}}/g, (raw, name: string, offset: number) => {
    if (isOffsetInsideRanges(offset, ignoredRanges)) return raw;
    const value = values.get(name);
    if (value === undefined) return raw;
    return options.escapeMarkdown ? escapeVariableValueForMarkdown(value) : value;
  });
}

function escapeVariableValueForMarkdown(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([`*_{}\[\]()#+\-!|])/g, '\\$1');
}

function ignoredVariableRanges(text: string): OffsetRange[] {
  return mergeRanges([
    ...fencedCodeRanges(text),
    ...inlineCodeRanges(text),
    ...scieMdCommentRanges(text),
  ]);
}

function extractVariableDefinitions(frontmatter: FrontmatterParseResult): VariableDefinition[] {
  if (!frontmatter.hasFrontmatter || frontmatter.error) return [];
  return [
    ...definitionsFromRecord(frontmatter.data.variables, 'frontmatter'),
    ...definitionsFromRecord(getScienfyMetadata(frontmatter.data).variables, 'scie_md'),
  ];
}

function definitionsFromRecord(value: unknown, source: VariableDefinition['source']): VariableDefinition[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([name, item]) => isVariableName(name) && isVariableValue(item))
    .map(([name, item]) => ({
      name,
      value: String(item),
      source,
    }));
}

function parseJsonVariables(content: string, fileName: string): VariableDefinition[] {
  try {
    const parsed = JSON.parse(content) as unknown;
    const definitions: VariableDefinition[] = [];
    collectJsonVariables(parsed, '', definitions, fileName);
    return definitions;
  } catch {
    return [];
  }
}

function collectJsonVariables(
  value: unknown,
  path: string,
  definitions: VariableDefinition[],
  fileName: string,
): void {
  if (isVariableValue(value) && path && isVariableName(path)) {
    definitions.push({ name: path, value: String(value), source: 'external', file: fileName });
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = path ? `${path}.${key}` : key;
    collectJsonVariables(child, nextPath, definitions, fileName);
  }
}

function parseCsvVariables(content: string, fileName: string): VariableDefinition[] {
  const rows = parseCsvRows(content).filter((row) => row.some((cell) => cell.trim()));
  if (rows.length < 2) return [];

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const keyIndex = header.findIndex((cell) => cell === 'name' || cell === 'key' || cell === 'variable');
  const valueIndex = header.findIndex((cell) => cell === 'value' || cell === 'val');
  if (keyIndex >= 0 && valueIndex >= 0) {
    return rows.slice(1)
      .map((row) => ({
        name: row[keyIndex]?.trim() ?? '',
        value: row[valueIndex]?.trim() ?? '',
      }))
      .filter((row) => isVariableName(row.name) && row.value.length > 0)
      .map((row) => ({ ...row, source: 'external' as const, file: fileName }));
  }

  // Wide CSV shape: first row contains variable names, second row contains values.
  return rows[0]
    .map((name, index) => ({ name: name.trim(), value: rows[1][index]?.trim() ?? '' }))
    .filter((row) => isVariableName(row.name) && row.value.length > 0)
    .map((row) => ({ ...row, source: 'external' as const, file: fileName }));
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell.replace(/\r$/, ''));
  rows.push(row);
  return rows;
}

function isVariableName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value);
}

function isVariableValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}
