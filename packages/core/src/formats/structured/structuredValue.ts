import type {
  DocumentFormat,
  FormatDiagnostic,
  StructuredSourceMap,
  StructuredValueType,
} from '../documentFormat.js';

export interface StructuredDocumentStats {
  topLevelType: StructuredValueType;
  objectCount: number;
  arrayCount: number;
  scalarCount: number;
  maxDepth: number;
}

export interface ParsedStructuredDocument {
  value: unknown;
  stats: StructuredDocumentStats;
  sourceMap: StructuredSourceMap;
  warnings: FormatDiagnostic[];
  preservation: StructuredPreservationSummary;
  jsonPreview: StructuredJsonPreview;
}

export interface StructuredJsonPreview {
  format: 'json';
  label: string;
  content: string;
  diagnostics: FormatDiagnostic[];
}

export type StructuredDocumentFormat = Extract<DocumentFormat, 'yaml' | 'toml' | 'xml'>;
export type StructuredSourceMapFeasibility =
  | 'lossy-value-only'
  | 'syntax-tree-readonly'
  | 'cst-spike-required'
  | 'requires-lossless-parser';

export interface StructuredPreservationSummary {
  format: StructuredDocumentFormat;
  visualWritesEnabled: false;
  decision: 'defer-visual-writes';
  sourceMapFeasibility: StructuredSourceMapFeasibility;
  nodeSpanCoverage: 'none' | 'partial';
  candidateLibraries: string[];
  blockers: string[];
  warnings: FormatDiagnostic[];
}

export function analyzeStructuredValue(value: unknown): StructuredDocumentStats {
  const stats: StructuredDocumentStats = {
    topLevelType: structuredValueType(value),
    objectCount: 0,
    arrayCount: 0,
    scalarCount: 0,
    maxDepth: 0,
  };
  const seen = new WeakSet<object>();
  visitStructuredValue(value, 0, stats, seen);
  return stats;
}

export function createStructuredJsonPreview(
  value: unknown,
  diagnostics: readonly FormatDiagnostic[],
  source: DocumentFormat,
): StructuredJsonPreview {
  return {
    format: 'json',
    label: 'JSON preview',
    content: `${JSON.stringify(normalizeStructuredValueForJson(value), null, 2)}\n`,
    diagnostics: [
      ...diagnostics,
      {
        severity: diagnostics.length > 0 ? 'warning' : 'info',
        code: `${source}-json-preview-readonly`,
        message: `${formatLabel(source)} to JSON preview is read-only and may not preserve ${formatLabel(source)}-specific syntax, comments, ordering semantics, or style.`,
        source,
        category: 'preservation',
        blocking: false,
      },
    ],
  };
}

export function createStructuredPreservationSummary({
  format,
  warnings,
  sourceMapFeasibility,
  nodeSpanCoverage = 'none',
  candidateLibraries,
  blockers,
}: {
  format: StructuredDocumentFormat;
  warnings: readonly FormatDiagnostic[];
  sourceMapFeasibility: StructuredSourceMapFeasibility;
  nodeSpanCoverage?: StructuredPreservationSummary['nodeSpanCoverage'];
  candidateLibraries: string[];
  blockers: string[];
}): StructuredPreservationSummary {
  return {
    format,
    visualWritesEnabled: false,
    decision: 'defer-visual-writes',
    sourceMapFeasibility,
    nodeSpanCoverage,
    candidateLibraries,
    blockers,
    warnings: [...warnings],
  };
}

export function normalizeStructuredValueForJson(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map((item) => normalizeStructuredValueForJson(item, seen));
  if (!isPlainObjectLike(value)) return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    normalized[key] = normalizeStructuredValueForJson(child, seen);
  }
  seen.delete(value);
  return normalized;
}

export function lineHasUnquotedHash(line: string): boolean {
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
    if (!quoted && char === '#') return true;
  }
  return false;
}

export function diagnosticFromLineColumn(
  severity: FormatDiagnostic['severity'],
  code: string,
  message: string,
  source: DocumentFormat,
  line?: number,
  column?: number,
  text?: string,
): FormatDiagnostic {
  const offset = line && text ? offsetFromLineColumn(text, line, column ?? 1) : undefined;
  return {
    severity,
    code,
    message,
    line,
    column,
    offset,
    length: offset === undefined ? undefined : 1,
    source,
    category: severity === 'warning' ? 'preservation' : 'parser',
    blocking: severity === 'error',
  };
}

export function offsetFromLineColumn(text: string, line: number, column: number): number {
  if (line <= 1) return Math.max(0, column - 1);
  let currentLine = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      currentLine += 1;
      if (currentLine === line) return Math.min(text.length, index + Math.max(1, column));
    }
  }
  return text.length;
}

function visitStructuredValue(
  value: unknown,
  depth: number,
  stats: StructuredDocumentStats,
  seen: WeakSet<object>,
): void {
  stats.maxDepth = Math.max(stats.maxDepth, depth);
  if (Array.isArray(value)) {
    stats.arrayCount += 1;
    if (seen.has(value)) return;
    seen.add(value);
    for (const item of value) visitStructuredValue(item, depth + 1, stats, seen);
    seen.delete(value);
    return;
  }
  if (isPlainObjectLike(value)) {
    stats.objectCount += 1;
    if (seen.has(value)) return;
    seen.add(value);
    for (const child of Object.values(value)) visitStructuredValue(child, depth + 1, stats, seen);
    seen.delete(value);
    return;
  }
  stats.scalarCount += 1;
}

function structuredValueType(value: unknown): StructuredValueType {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'string';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  return 'boolean';
}

function isPlainObjectLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !(value instanceof Date);
}

function formatLabel(format: DocumentFormat): string {
  if (format === 'yaml') return 'YAML';
  if (format === 'toml') return 'TOML';
  if (format === 'xml') return 'XML';
  return format;
}
