import { parseFrontmatter, serializeFrontmatter } from '../document/frontmatter';
import { fencedCodeRanges, inlineCodeRanges, isOffsetInsideRanges, mergeRanges, scieMdCommentRanges } from '../../markdown/markdownRanges';
import type { VariableDefinition } from './variableIndex';

export const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export function createVariableToken(name: string): string {
  return `{{ ${name} }}`;
}

export function nextVariableName(definitions: VariableDefinition[], base = 'variable'): string {
  const used = new Set(definitions.map((definition) => definition.name));
  let index = 1;
  while (used.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

export function upsertFrontmatterVariable(markdown: string, name: string, value: string): string {
  assertVariableName(name);
  const frontmatter = parseFrontmatter(markdown);
  if (frontmatter.error) {
    throw new Error('Front matter must be valid before variables can be edited.');
  }
  const data = { ...frontmatter.data };
  const variables = variableRecord(data.variables);
  variables[name] = value;
  data.variables = variables;
  return serializeFrontmatter(data, frontmatter.hasFrontmatter ? frontmatter.body : markdown);
}

export function upsertScienfyVariablesFile(markdown: string, filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) {
    throw new Error('Variable data file path cannot be empty.');
  }
  const frontmatter = parseFrontmatter(markdown);
  if (frontmatter.error) {
    throw new Error('Front matter must be valid before data files can be linked.');
  }
  const data = { ...frontmatter.data };
  const scienfy = data.scienfy && typeof data.scienfy === 'object' && !Array.isArray(data.scienfy)
    ? { ...(data.scienfy as Record<string, unknown>) }
    : {};
  scienfy.variablesFile = Array.from(new Set([...stringList(scienfy.variablesFile), trimmed]));
  data.scienfy = scienfy;
  return serializeFrontmatter(data, frontmatter.hasFrontmatter ? frontmatter.body : markdown);
}

export function renameVariableAndUpdateUsages(
  markdown: string,
  originalName: string,
  nextName: string,
  value: string,
): string {
  assertVariableName(originalName);
  assertVariableName(nextName);
  const frontmatter = parseFrontmatter(markdown);
  if (frontmatter.error) {
    throw new Error('Front matter must be valid before variables can be edited.');
  }
  const data = { ...frontmatter.data };
  const variables = variableRecord(data.variables);
  if (originalName !== nextName) {
    delete variables[originalName];
  }
  variables[nextName] = value;
  data.variables = variables;
  const body = replaceVariableUsages(frontmatter.hasFrontmatter ? frontmatter.body : markdown, originalName, nextName);
  return serializeFrontmatter(data, body);
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

function variableRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([name]) => VARIABLE_NAME_PATTERN.test(name))
      .map(([name, item]) => [name, String(item)]),
  );
}

function replaceVariableUsages(markdown: string, originalName: string, nextName: string): string {
  if (originalName === nextName) return markdown;
  const ignoredRanges = mergeRanges([
    ...fencedCodeRanges(markdown),
    ...inlineCodeRanges(markdown),
    ...scieMdCommentRanges(markdown),
  ]);
  const replacements: Array<{ from: number; to: number; value: string }> = [];
  const pattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*}}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown))) {
    if (match[1] !== originalName || isOffsetInsideRanges(match.index, ignoredRanges)) continue;
    replacements.push({ from: match.index, to: match.index + match[0].length, value: createVariableToken(nextName) });
  }
  return replacements
    .reverse()
    .reduce((text, replacement) => (
      `${text.slice(0, replacement.from)}${replacement.value}${text.slice(replacement.to)}`
    ), markdown);
}

function assertVariableName(name: string): void {
  if (!VARIABLE_NAME_PATTERN.test(name)) {
    throw new Error('Variable names must start with a letter or underscore and use only letters, numbers, dots, dashes, and underscores.');
  }
}
