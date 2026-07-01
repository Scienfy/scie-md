import { parse, parseTree, printParseErrorCode } from 'jsonc-parser';
import type { Node as JsonNode, ParseError, ParseOptions } from 'jsonc-parser';
import type { DocumentContent, FormatDiagnostic, FormatParseResult, StructuredSourceMap } from '../documentFormat.js';
import { createDocumentContent } from '../documentFormat.js';
import { sourceSpanFromOffset } from '../structured/sourceMap.js';
import { analyzeJsonHealth, offsetToLineColumn, type JsonHealthSummary } from './jsonHealth.js';
import { createJsonSourceMap } from './jsonSourceMap.js';
import {
  extractJsonSchemaMetadata,
  inferObservedJsonShape,
  validateJsonValueAgainstSchema,
  type JsonSchemaMetadata,
  type JsonSchemaSource,
  type JsonSchemaValidationResult,
  type ObservedJsonShapeSummary,
} from '../schema/jsonSchemaValidation.js';

const STRICT_JSON_PARSE_OPTIONS: ParseOptions = {
  allowEmptyContent: false,
  allowTrailingComma: false,
  disallowComments: true,
};

export interface JsonTreeSummary {
  type: string;
  offset: number;
  length: number;
  childCount: number;
}

export interface ParsedJsonDocument {
  value: unknown;
  health: JsonHealthSummary;
  root: JsonTreeSummary;
  sourceMap: StructuredSourceMap;
  schemaMetadata: JsonSchemaMetadata;
  schemaValidation: JsonSchemaValidationResult | null;
  observedShape: ObservedJsonShapeSummary;
}

export interface JsonParseOptions {
  schema?: JsonSchemaSource | null;
}

export function parseJsonDocument(
  content: DocumentContent,
  options: JsonParseOptions = {},
): FormatParseResult<ParsedJsonDocument> {
  const text = content.text;
  const parseErrors: ParseError[] = [];
  const value = parse(text, parseErrors, STRICT_JSON_PARSE_OPTIONS) as unknown;
  const syntaxDiagnostics = parseErrors.map((error) => parseErrorToDiagnostic(error, text));
  const treeErrors: ParseError[] = [];
  const root = parseTree(text, treeErrors, STRICT_JSON_PARSE_OPTIONS);

  if (text.trim().length === 0 && syntaxDiagnostics.length === 0) {
    syntaxDiagnostics.push({
      severity: 'error',
      code: 'json-empty-document',
      message: 'JSON document is empty.',
      line: 1,
      column: 1,
      offset: 0,
      length: 1,
      source: 'json',
      category: 'parser',
      span: sourceSpanFromOffset(text, 0, 1),
      blocking: true,
    });
  }

  if (syntaxDiagnostics.length > 0 || !root) {
    return {
      format: 'json',
      content,
      parsed: null,
      diagnostics: syntaxDiagnostics,
      sourceOnly: false,
    };
  }

  const sourceMap = createJsonSourceMap(root, text);
  const healthResult = analyzeJsonHealth(root, text);
  const schemaValidation = options.schema
    ? validateJsonValueAgainstSchema(value, options.schema, { sourceMap })
    : null;
  return {
    format: 'json',
    content,
    parsed: {
      value,
      health: healthResult.health,
      root: summarizeJsonRoot(root),
      sourceMap,
      schemaMetadata: extractJsonSchemaMetadata(value),
      schemaValidation,
      observedShape: inferObservedJsonShape(value),
    },
    diagnostics: [
      ...(schemaValidation?.diagnostics ?? []),
      ...healthResult.diagnostics,
    ],
    sourceOnly: false,
  };
}

export function createJsonContent(text: string, path: string | null = null, metadata?: unknown): DocumentContent {
  return createDocumentContent('json', text, path, metadata);
}

function parseErrorToDiagnostic(error: ParseError, text: string): FormatDiagnostic {
  const location = offsetToLineColumn(text, error.offset);
  const code = printParseErrorCode(error.error);
  return {
    severity: 'error',
    code: `json-syntax-${code}`,
    message: jsonParseErrorMessage(code),
    line: location.line,
    column: location.column,
    offset: error.offset,
    length: Math.max(1, error.length),
    source: 'json',
    category: 'parser',
    span: sourceSpanFromOffset(text, error.offset, Math.max(1, error.length)),
    blocking: true,
  };
}

function jsonParseErrorMessage(code: string): string {
  switch (code) {
    case 'InvalidCommentToken':
      return 'Comments are not valid in strict JSON.';
    case 'CommaExpected':
      return 'Expected a comma between JSON values.';
    case 'ColonExpected':
      return 'Expected a colon after the JSON object key.';
    case 'ValueExpected':
      return 'Expected a JSON value.';
    case 'PropertyNameExpected':
      return 'Expected a quoted JSON object key.';
    case 'CloseBraceExpected':
      return 'Expected a closing brace for this JSON object.';
    case 'CloseBracketExpected':
      return 'Expected a closing bracket for this JSON array.';
    case 'EndOfFileExpected':
      return 'Unexpected content after the end of the JSON document.';
    case 'InvalidEscapeCharacter':
      return 'Invalid escape sequence in JSON string.';
    case 'UnexpectedEndOfString':
      return 'JSON string ended before the closing quote.';
    case 'InvalidNumberFormat':
      return 'Invalid JSON number.';
    default:
      return code.replace(/([a-z])([A-Z])/g, '$1 $2');
  }
}

function summarizeJsonRoot(root: JsonNode): JsonTreeSummary {
  return {
    type: root.type,
    offset: root.offset,
    length: root.length,
    childCount: root.children?.length ?? 0,
  };
}
