import { safeParseScienfyDocument } from '@sciemd/core';
import type { ParsedScienfyDocument } from '@sciemd/core';
import type { VariableDefinition } from '@sciemd/core';
import type { ExportFormat, ExportRequestOptions } from './exportTypes';
import { extractCitationTokens } from '@sciemd/core';
import type { BibtexEntry } from '@sciemd/core';

export type ExportPreflightSeverity = 'blocker' | 'warning';

export interface ExportPreflightIssue {
  severity: ExportPreflightSeverity;
  code: string;
  message: string;
  line?: number;
}

export interface ExportPreflightResult {
  ok: boolean;
  issues: ExportPreflightIssue[];
  blockers: ExportPreflightIssue[];
  warnings: ExportPreflightIssue[];
  document: ParsedScienfyDocument;
}

export interface ExportPreflightInput {
  markdown: string;
  format: ExportFormat;
  variableDefinitions?: VariableDefinition[];
  citationEntries?: BibtexEntry[];
  exportOptions?: ExportRequestOptions;
}

const BLOCKING_DIAGNOSTIC_CODES = new Set([
  'frontmatter-yaml',
  'frontmatter-scienfy-invalid',
  'directive-unclosed',
  'reference-duplicate-label',
  'variant-duplicate-group',
  'variant-duplicate-item',
  'variant-unclosed',
  'variant-item-outside-group',
  'variant-group-nested',
  'variable-missing',
]);

const CITATION_FORMATS = new Set<ExportFormat>(['docx', 'epub', 'latex', 'pdf', 'odt']);

export function runExportPreflight({
  markdown,
  format,
  variableDefinitions = [],
  citationEntries = [],
  exportOptions,
}: ExportPreflightInput): ExportPreflightResult {
  const document = safeParseScienfyDocument(markdown, {
    variableDefinitions,
    bibtex: bibliographyEntriesToBibtex(citationEntries),
  });
  const issues: ExportPreflightIssue[] = [];

  for (const diagnostic of document.diagnostics) {
    if (BLOCKING_DIAGNOSTIC_CODES.has(diagnostic.code)) {
      issues.push({
        severity: 'blocker',
        code: diagnostic.code,
        message: diagnostic.message,
        line: diagnostic.line,
      });
    }
  }

  const citationTokens = extractCitationTokens(markdown, { allowLoose: true });
  if (citationTokens.length > 0 && document.bibliographyFiles.length === 0) {
    issues.push({
      severity: 'warning',
      code: 'export-citation-no-bibliography',
      message: 'Citation keys were found, but front matter does not declare a bibliography file.',
      line: citationTokens[0]?.line,
    });
  }

  if (citationTokens.length > 0 && document.bibliographyFiles.length > 0 && citationEntries.length === 0) {
    issues.push({
      severity: 'warning',
      code: 'export-bibliography-empty',
      message: 'A bibliography file is declared, but no bibliography entries are currently loaded for export checks.',
      line: citationTokens[0]?.line,
    });
  }

  const knownCitationKeys = new Set(citationEntries.map((entry) => entry.key));
  const missingKeys = Array.from(new Set(citationTokens
    .map((token) => token.key)
    .filter((key) => citationEntries.length > 0 && !knownCitationKeys.has(key))));
  for (const key of missingKeys) {
    issues.push({
      severity: 'warning',
      code: 'export-citation-missing',
      message: `Citation @${key} is not present in the loaded bibliography entries.`,
      line: citationTokens.find((token) => token.key === key)?.line,
    });
  }

  if (citationTokens.length > 0 && CITATION_FORMATS.has(format) && !exportOptions?.citationStylePath) {
    issues.push({
      severity: 'warning',
      code: 'export-csl-missing',
      message: `${format.toUpperCase()} export contains citations but no CSL style is configured. Pandoc will use its default citation rendering if citeproc is enabled.`,
      line: citationTokens[0]?.line,
    });
  }

  if (hasReferencesDirective(markdown) && citationEntries.length === 0) {
    issues.push({
      severity: 'warning',
      code: 'export-references-empty',
      message: '`:::references` is present, but no bibliography entries are loaded for generated references.',
    });
  }

  const uniqueIssues = dedupeIssues(issues);
  const blockers = uniqueIssues.filter((issue) => issue.severity === 'blocker');
  const warnings = uniqueIssues.filter((issue) => issue.severity === 'warning');

  return {
    ok: blockers.length === 0,
    issues: uniqueIssues,
    blockers,
    warnings,
    document,
  };
}

export function preflightSummary(result: Pick<ExportPreflightResult, 'blockers' | 'warnings'>): string {
  if (result.blockers.length > 0) {
    return `Export blocked by ${result.blockers.length} issue${result.blockers.length === 1 ? '' : 's'}.`;
  }
  if (result.warnings.length > 0) {
    return `Export preflight passed with ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}.`;
  }
  return 'Export preflight passed.';
}

function bibliographyEntriesToBibtex(entries: BibtexEntry[]): string {
  return entries
    .map((entry) => `@${entry.type || 'misc'}{${entry.key},\n  title = {${escapeBibtexField(entry.fields.title || entry.key)}}\n}`)
    .join('\n\n');
}

function escapeBibtexField(value: string): string {
  return value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

function hasReferencesDirective(markdown: string): boolean {
  return /^:::\s*references\b/im.test(markdown);
}

function dedupeIssues(issues: ExportPreflightIssue[]): ExportPreflightIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const signature = `${issue.severity}:${issue.code}:${issue.message}:${issue.line ?? ''}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}
