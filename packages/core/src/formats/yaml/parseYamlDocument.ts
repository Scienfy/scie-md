import { parseDocument } from 'yaml';
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
import {
  createYamlSourceMap,
  type YamlSourceMapInspection,
  type YamlSourceMapUnsupportedFeature,
} from './yamlSourceMap.js';

export const YAML_ALIAS_COUNT_LIMIT = 50;

export interface ParsedYamlDocument extends ParsedStructuredDocument {
  featureWarnings: FormatDiagnostic[];
  sourceMapInspection: YamlSourceMapInspection;
  sourceMapUnsupportedFeatures: YamlSourceMapUnsupportedFeature[];
}

export function parseYamlDocument(content: DocumentContent): FormatParseResult<ParsedYamlDocument> {
  const text = content.text;
  const document = parseDocument(text, {
    keepSourceTokens: true,
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  const syntaxDiagnostics = [
    ...document.errors.map((error) => yamlErrorToDiagnostic(error, text, 'error')),
    ...document.warnings.map((warning) => yamlErrorToDiagnostic(warning, text, 'warning')),
  ];
  const featureWarnings = detectYamlFeatureWarnings(text);

  if (text.trim().length === 0 && syntaxDiagnostics.length === 0) {
    syntaxDiagnostics.push({
      severity: 'error',
      code: 'yaml-empty-document',
      message: 'YAML document is empty.',
      line: 1,
      column: 1,
      offset: 0,
      length: 1,
      source: 'yaml',
      category: 'parser',
      blocking: true,
    });
  }

  if (syntaxDiagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return {
      format: 'yaml',
      content,
      parsed: null,
      diagnostics: [...syntaxDiagnostics, ...featureWarnings],
      sourceOnly: false,
    };
  }

  let value: unknown;
  try {
    value = normalizeStructuredValueForJson(document.toJS({ maxAliasCount: YAML_ALIAS_COUNT_LIMIT }));
  } catch (error) {
    return {
      format: 'yaml',
      content,
      parsed: null,
      diagnostics: [
        ...syntaxDiagnostics,
        ...featureWarnings,
        yamlConversionErrorToDiagnostic(error),
      ],
      sourceOnly: false,
    };
  }

  const warnings = [...syntaxDiagnostics.filter((diagnostic) => diagnostic.severity !== 'error'), ...featureWarnings];
  const yamlSourceMap = createYamlSourceMap(text, document, value);
  const jsonPreview = createStructuredJsonPreview(value, warnings, 'yaml');
  return {
    format: 'yaml',
    content,
    parsed: {
      value,
      stats: analyzeStructuredValue(value),
      sourceMap: yamlSourceMap.sourceMap,
      warnings,
      preservation: createStructuredPreservationSummary({
        format: 'yaml',
        warnings,
        nodeSpanCoverage: yamlSourceMap.inspection.spanCoverage === 'none' ? 'none' : 'partial',
        sourceMapFeasibility: 'cst-spike-required',
        candidateLibraries: ['yaml'],
        blockers: [
          'Current adapter still normalizes through document.toJS(), so visual values may include alias or merge-key expansions that do not have local editable source spans.',
          'The yaml package exposes parsed node ranges and source tokens, and ScieMD now records them for inspection; writes still need a CST-backed edit planner with fixture-proven untouched-region preservation.',
          'Comments, anchors, aliases, tags, merge keys, flow collections, and block scalar styles remain explicit read-only blockers.',
        ],
      }),
      jsonPreview,
      featureWarnings,
      sourceMapInspection: yamlSourceMap.inspection,
      sourceMapUnsupportedFeatures: yamlSourceMap.unsupportedFeatures,
    },
    diagnostics: warnings,
    sourceOnly: false,
  };
}

export function createYamlContent(text: string, path: string | null = null, metadata?: unknown): DocumentContent {
  return createDocumentContent('yaml', text, path, metadata);
}

export function createYamlJsonPreview(parseResult: FormatParseResult<ParsedYamlDocument>): StructuredJsonPreview | null {
  if (!parseResult.parsed) return null;
  return parseResult.parsed.jsonPreview;
}

function detectYamlFeatureWarnings(text: string): FormatDiagnostic[] {
  const warnings: FormatDiagnostic[] = [];
  const anchorMatches = Array.from(text.matchAll(/(?:^|[\s[{,])&([A-Za-z0-9_-]+)/g));
  const aliasMatches = Array.from(text.matchAll(/(?:^|[\s[{,])\*([A-Za-z0-9_-]+)/g));
  const tagMatches = Array.from(text.matchAll(/(?:^|[\s[{,])!{1,2}(?![=\s])([^\s,[\]{}#]+)/g));
  const blockScalarLines = collectLineMatches(text, /^\s*(?:[^#\n]+:\s*)?[|>][+-]?\d*(?:\s+#.*)?$/);
  const commentLines = collectCommentLines(text);

  if (anchorMatches.length > 0) {
    warnings.push(featureWarning(
      'yaml-anchor-readonly',
      'YAML anchors are resolved for the read-only tree. Source syntax and anchor names will not be preserved by JSON preview.',
      text,
      anchorMatches[0].index,
    ));
  }
  if (aliasMatches.length > 0) {
    warnings.push(featureWarning(
      'yaml-alias-readonly',
      'YAML aliases are resolved for the read-only tree. Review source before relying on duplicated values.',
      text,
      aliasMatches[0].index,
    ));
  }
  if (aliasMatches.length > YAML_ALIAS_COUNT_LIMIT) {
    warnings.push(featureWarning(
      'yaml-alias-count-limit',
      `YAML contains ${aliasMatches.length} aliases; conversion is limited to ${YAML_ALIAS_COUNT_LIMIT} alias expansions for safety.`,
      text,
      aliasMatches[YAML_ALIAS_COUNT_LIMIT].index,
    ));
  }
  if (tagMatches.length > 0) {
    warnings.push(featureWarning(
      'yaml-tag-readonly',
      'YAML tags may carry type information that is not preserved by the read-only tree or JSON preview.',
      text,
      tagMatches[0].index,
    ));
  }
  if (blockScalarLines.length > 0) {
    warnings.push(diagnosticFromLineColumn(
      'warning',
      'yaml-block-scalar-readonly',
      'YAML block scalar style is not preserved by the read-only tree or JSON preview.',
      'yaml',
      blockScalarLines[0],
      1,
      text,
    ));
  }
  if (commentLines.length > 0) {
    warnings.push(diagnosticFromLineColumn(
      'warning',
      'yaml-comments-readonly',
      'YAML comments are source-only and are not represented in the read-only tree or JSON preview.',
      'yaml',
      commentLines[0],
      1,
      text,
    ));
  }

  return warnings;
}

function yamlErrorToDiagnostic(
  error: { name?: string; code?: string; message?: string; pos?: [number, number]; linePos?: Array<{ line: number; col: number }> },
  text: string,
  severity: 'error' | 'warning',
): FormatDiagnostic {
  const linePosition = error.linePos?.[0];
  const offset = error.pos?.[0];
  return {
    severity,
    code: `yaml-${severity === 'error' ? 'syntax' : 'warning'}-${normalizeCode(error.code ?? error.name ?? 'parse')}`,
    message: stripPrettyYamlSnippet(error.message ?? 'YAML parser reported a problem.'),
    line: linePosition?.line,
    column: linePosition?.col,
    offset,
    length: offset === undefined ? undefined : Math.max(1, (error.pos?.[1] ?? offset + 1) - offset),
    source: 'yaml',
    category: 'parser',
    blocking: severity === 'error',
  };
}

function yamlConversionErrorToDiagnostic(error: unknown): FormatDiagnostic {
  const message = error instanceof Error ? error.message : String(error || 'YAML conversion failed.');
  return {
    severity: 'error',
    code: 'yaml-conversion-failed',
    message: `YAML parsed, but the read-only tree could not be built. ${stripPrettyYamlSnippet(message)}`,
    source: 'yaml',
    category: 'conversion',
    blocking: true,
  };
}

function featureWarning(code: string, message: string, text: string, offset: number | undefined): FormatDiagnostic {
  if (offset === undefined) {
    return { severity: 'warning', code, message, source: 'yaml', category: 'preservation', blocking: false };
  }
  const location = lineColumnFromOffset(text, offset);
  return {
    severity: 'warning',
    code,
    message,
    line: location.line,
    column: location.column,
    offset,
    length: 1,
    source: 'yaml',
    category: 'preservation',
    blocking: false,
  };
}

function collectLineMatches(text: string, pattern: RegExp): number[] {
  return splitLines(text)
    .map((line, index) => pattern.test(line) ? index + 1 : 0)
    .filter((line) => line > 0);
}

function collectCommentLines(text: string): number[] {
  return splitLines(text)
    .map((line, index) => lineHasUnquotedHash(line) ? index + 1 : 0)
    .filter((line) => line > 0);
}

function splitLines(text: string): string[] {
  return text.length === 0 ? [] : text.split(/\r?\n/);
}

function lineColumnFromOffset(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < Math.min(offset, text.length); index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

function normalizeCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'parse';
}

function stripPrettyYamlSnippet(message: string): string {
  return message.split(/\n\s*\n/)[0]?.trim() || message.trim();
}
