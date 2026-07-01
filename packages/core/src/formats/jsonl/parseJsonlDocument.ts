import { parse, printParseErrorCode } from 'jsonc-parser';
import type { ParseError, ParseOptions } from 'jsonc-parser';
import type { DocumentContent, FormatDiagnostic, FormatParseResult } from '../documentFormat.js';
import { createDocumentContent } from '../documentFormat.js';
import { createStructuredPreviewPageInfo, type StructuredPreviewPageInfo } from '../structured/structuredPaging.js';

const STRICT_JSON_PARSE_OPTIONS: ParseOptions = {
  allowEmptyContent: false,
  allowTrailingComma: false,
  disallowComments: true,
};

export const JSONL_RECORD_PREVIEW_LIMIT = 200;
export const JSONL_FIELD_SUMMARY_LIMIT = 20;
export const JSONL_PARSE_LINE_SCAN_LIMIT = 1000;

export interface JsonlLineResult {
  line: number;
  offset: number;
  length: number;
  recordIndex: number | null;
  valid: boolean;
  value?: unknown;
  valueType: JsonlValueType | null;
  fieldNames: string[];
  preview: string;
  diagnostic?: FormatDiagnostic;
}

export type JsonlValueType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export interface JsonlFieldFrequency {
  field: string;
  presentCount: number;
  missingCount: number;
  types: string[];
}

export interface ParsedJsonlDocument {
  lines: JsonlLineResult[];
  recordCount: number;
  recordCountIsEstimated: boolean;
  invalidLineCount: number;
  blankLineCount: number;
  totalLineCount: number;
  totalLineCountIsEstimated: boolean;
  objectRecordCount: number;
  previewLimit: number;
  scannedLineCount: number;
  scanLineLimit: number;
  previewTruncated: boolean;
  previewPageInfo: StructuredPreviewPageInfo;
  commonFields: JsonlFieldFrequency[];
  missingFieldSummary: JsonlFieldFrequency[];
}

export interface JsonlSourceLine {
  line: number;
  offset: number;
  content: string;
  eol: string;
}

export function parseJsonlDocument(content: DocumentContent): FormatParseResult<ParsedJsonlDocument> {
  const diagnostics: FormatDiagnostic[] = [];
  const previewLines: JsonlLineResult[] = [];
  const fieldCounts = new Map<string, { count: number; types: Set<string> }>();
  let recordCount = 0;
  let invalidLineCount = 0;
  let blankLineCount = 0;
  let objectRecordCount = 0;
  let scannedLineCount = 0;
  let scanLimited = false;

  if (content.text.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'jsonl-empty-document',
      message: 'JSON Lines document is empty.',
      line: 1,
      column: 1,
      offset: 0,
      length: 1,
      source: 'jsonl',
    });
  }

  const scanned = scanJsonlSourceLines(content.text, JSONL_PARSE_LINE_SCAN_LIMIT);
  scanLimited = scanned.scanLimited;
  for (const sourceLine of scanned.lines) {
    scannedLineCount += 1;
    const result = parseJsonlLine(sourceLine, recordCount);
    if (result.valid) {
      recordCount += 1;
      if (result.valueType === 'object') {
        objectRecordCount += 1;
        const record = result.value as Record<string, unknown>;
        for (const field of Object.keys(record)) {
          const summary = fieldCounts.get(field) ?? { count: 0, types: new Set<string>() };
          summary.count += 1;
          summary.types.add(jsonlValueType(record[field]));
          fieldCounts.set(field, summary);
        }
      }
    } else {
      invalidLineCount += 1;
      if (sourceLine.content.trim().length === 0) blankLineCount += 1;
      if (result.diagnostic) diagnostics.push(result.diagnostic);
    }
    if (previewLines.length < JSONL_RECORD_PREVIEW_LIMIT) previewLines.push(result);
  }

  if (scanLimited) {
    diagnostics.push({
      severity: 'warning',
      code: 'jsonl-parser-sampled',
      category: 'parser',
      source: 'jsonl',
      message: `Only the first ${JSONL_PARSE_LINE_SCAN_LIMIT} JSON Lines records were sampled for background analysis. Counts are lower bounds; source editing remains available for the full file.`,
    });
  }

  const fieldSummary = Array.from(fieldCounts.entries())
    .map(([field, summary]) => ({
      field,
      presentCount: summary.count,
      missingCount: Math.max(0, objectRecordCount - summary.count),
      types: Array.from(summary.types).sort(),
    }))
    .sort((left, right) => right.presentCount - left.presentCount || left.field.localeCompare(right.field))
    .slice(0, JSONL_FIELD_SUMMARY_LIMIT);

  const totalLineCount = scannedLineCount + (scanLimited ? 1 : 0);
  const boundedRecordCount = recordCount + (scanLimited ? 1 : 0);
  return {
    format: 'jsonl',
    content,
    parsed: {
      lines: previewLines,
      recordCount: boundedRecordCount,
      recordCountIsEstimated: scanLimited,
      invalidLineCount,
      blankLineCount,
      totalLineCount,
      totalLineCountIsEstimated: scanLimited,
      objectRecordCount,
      previewLimit: JSONL_RECORD_PREVIEW_LIMIT,
      scannedLineCount,
      scanLineLimit: JSONL_PARSE_LINE_SCAN_LIMIT,
      previewTruncated: scanLimited || scannedLineCount > JSONL_RECORD_PREVIEW_LIMIT,
      previewPageInfo: createStructuredPreviewPageInfo({
        itemLabel: 'line',
        totalItems: totalLineCount,
        parsedItems: previewLines.length,
      }),
      commonFields: fieldSummary,
      missingFieldSummary: fieldSummary.filter((field) => field.missingCount > 0),
    },
    diagnostics,
    sourceOnly: false,
  };
}

export function createJsonlContent(text: string, path: string | null = null, metadata?: unknown): DocumentContent {
  return createDocumentContent('jsonl', text, path, metadata);
}

export function splitJsonlSourceLines(source: string): JsonlSourceLine[] {
  return scanJsonlSourceLines(source, Number.MAX_SAFE_INTEGER).lines;
}

function scanJsonlSourceLines(source: string, lineLimit: number): { lines: JsonlSourceLine[]; scanLimited: boolean } {
  const lines: JsonlSourceLine[] = [];
  let offset = 0;
  let line = 1;
  const safeLineLimit = Math.max(1, Math.floor(lineLimit));
  while (offset < source.length && lines.length < safeLineLimit) {
    const newlineIndex = source.indexOf('\n', offset);
    const lineEnd = newlineIndex === -1 ? source.length : newlineIndex;
    const hasCr = lineEnd > offset && source.charCodeAt(lineEnd - 1) === 13;
    const contentEnd = hasCr ? lineEnd - 1 : lineEnd;
    lines.push({
      line,
      offset,
      content: source.slice(offset, contentEnd),
      eol: newlineIndex === -1 ? '' : hasCr ? '\r\n' : '\n',
    });
    offset = newlineIndex === -1 ? source.length : newlineIndex + 1;
    line += 1;
  }
  return {
    lines,
    scanLimited: offset < source.length,
  };
}

function parseJsonlLine(sourceLine: JsonlSourceLine, recordIndex: number): JsonlLineResult {
  const raw = sourceLine.content;
  if (raw.trim().length === 0) {
    const diagnostic = lineDiagnostic(
      'jsonl-blank-line',
      'Blank lines are not valid JSON Lines records.',
      sourceLine,
      0,
      Math.max(1, raw.length),
    );
    return invalidLine(sourceLine, diagnostic);
  }
  const errors: ParseError[] = [];
  const value = parse(raw, errors, STRICT_JSON_PARSE_OPTIONS) as unknown;
  if (errors.length > 0) {
    const firstError = errors[0];
    const diagnostic = lineDiagnostic(
      `jsonl-syntax-${printParseErrorCode(firstError.error)}`,
      jsonlParseErrorMessage(printParseErrorCode(firstError.error)),
      sourceLine,
      firstError.offset,
      Math.max(1, firstError.length),
    );
    return invalidLine(sourceLine, diagnostic);
  }
  const valueType = jsonlValueType(value);
  return {
    line: sourceLine.line,
    offset: sourceLine.offset,
    length: raw.length,
    recordIndex,
    valid: true,
    value,
    valueType,
    fieldNames: valueType === 'object' ? Object.keys(value as Record<string, unknown>) : [],
    preview: previewJsonlValue(value),
  };
}

function invalidLine(sourceLine: JsonlSourceLine, diagnostic: FormatDiagnostic): JsonlLineResult {
  return {
    line: sourceLine.line,
    offset: sourceLine.offset,
    length: sourceLine.content.length,
    recordIndex: null,
    valid: false,
    valueType: null,
    fieldNames: [],
    preview: sourceLine.content.trim() || '(blank line)',
    diagnostic,
  };
}

function lineDiagnostic(code: string, message: string, line: JsonlSourceLine, offset: number, length: number): FormatDiagnostic {
  return {
    severity: 'error',
    code,
    message,
    line: line.line,
    column: offset + 1,
    offset: line.offset + offset,
    length,
    source: 'jsonl',
  };
}

function jsonlValueType(value: unknown): JsonlValueType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  return 'boolean';
}

function previewJsonlValue(value: unknown): string {
  const text = JSON.stringify(value);
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function jsonlParseErrorMessage(code: string): string {
  switch (code) {
    case 'InvalidCommentToken':
      return 'Comments are not valid in strict JSON Lines records.';
    case 'CommaExpected':
      return 'Expected a comma inside this JSON Lines record.';
    case 'ColonExpected':
      return 'Expected a colon after the JSON object key.';
    case 'ValueExpected':
      return 'Expected a JSON value on this line.';
    case 'PropertyNameExpected':
      return 'Expected a quoted JSON object key.';
    case 'CloseBraceExpected':
      return 'Expected a closing brace for this object record.';
    case 'CloseBracketExpected':
      return 'Expected a closing bracket for this array record.';
    case 'EndOfFileExpected':
      return 'Each JSON Lines record must fit on one line.';
    default:
      return code.replace(/([a-z])([A-Z])/g, '$1 $2');
  }
}
