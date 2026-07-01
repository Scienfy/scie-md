import {
  adapterForFormat,
  createJsonContent,
  createSourceOnlyFormatParseResult,
  formatExceedsParseBudget,
  JSON_PARSE_BUDGET_BYTES,
  parseJsonDocument,
  structuredSurfaceForKind,
} from '@sciemd/core';
import type {
  DocumentFormat,
  FormatCapabilities,
  FormatDiagnostic,
  FormatParseResult,
  JsonSchemaSource,
  ParsedDelimitedText,
  ParsedJsonDocument,
  ParsedJsonlDocument,
  ParsedStructuredDocument,
  ParsedXmlDocument,
  ParsedYamlDocument,
  StructuredAnalysisMetrics,
  StructuredAnalysisModel,
  StructuredAnalysisStatus,
  StructuredVisualSurfaceKind,
} from '@sciemd/core';
import type { ValidationIssue } from '../markdown/markdownValidation';

export const JSON_TREE_RENDER_NODE_BUDGET = 2500;
export const JSON_SOURCE_ONLY_PARSE_BYTES = JSON_PARSE_BUDGET_BYTES;

export type JsonDocumentAnalysisStatus = 'valid' | 'invalid' | 'too-large' | 'source-only';

export interface JsonDocumentAnalysis {
  status: JsonDocumentAnalysisStatus;
  parseResult: FormatParseResult<ParsedJsonDocument>;
  nodeCount: number;
  treeBudget: number;
}

export interface SourceFormatDiagnosticsOptions {
  jsonSchema?: JsonSchemaSource | null;
}

export type JsonlDocumentAnalysisStatus = 'valid' | 'invalid' | 'source-only' | 'preview-truncated';

export interface JsonlDocumentAnalysis {
  status: JsonlDocumentAnalysisStatus;
  parseResult: FormatParseResult<ParsedJsonlDocument>;
  recordCount: number;
  invalidLineCount: number;
  previewLimit: number;
  previewTruncated: boolean;
}

export type StructuredDocumentAnalysisStatus = 'valid' | 'invalid' | 'too-large' | 'source-only';

export interface StructuredDocumentAnalysis {
  format: 'yaml' | 'toml' | 'xml';
  status: StructuredDocumentAnalysisStatus;
  parseResult: FormatParseResult<ParsedStructuredDocument>;
  nodeCount: number;
  treeBudget: number;
}

export type TabularDocumentAnalysisStatus = 'valid' | 'invalid' | 'source-only' | 'preview-truncated';

export interface TabularDocumentAnalysis {
  format: 'csv' | 'tsv';
  status: TabularDocumentAnalysisStatus;
  parseResult: FormatParseResult<ParsedDelimitedText>;
  dataRowCount: number;
  columnCount: number;
  previewLimit: number;
  previewTruncated: boolean;
}

export interface SourceFormatDiagnosticState {
  diagnostics: FormatDiagnostic[];
  structuredModel: StructuredAnalysisModel | null;
  jsonAnalysis: JsonDocumentAnalysis | null;
  jsonlAnalysis: JsonlDocumentAnalysis | null;
  structuredAnalysis: StructuredDocumentAnalysis | null;
  tabularAnalysis: TabularDocumentAnalysis | null;
}

export function parseSourceFormatDiagnostics(
  format: DocumentFormat,
  text: string,
  path: string | null,
  options: SourceFormatDiagnosticsOptions = {},
): SourceFormatDiagnosticState {
  if (format === 'markdown') return emptySourceFormatDiagnostics();
  if (format === 'json') {
    const parseResult = shouldUseSourceOnlyFormatParsing(format, text)
      ? createSourceOnlyFormatParseResult<ParsedJsonDocument>(format, text, path)
      : parseJsonDocument(createJsonContent(text, path), { schema: options.jsonSchema ?? null });
    return sourceFormatDiagnosticsFromParseResult(parseResult);
  }
  const adapter = adapterForFormat(format);
  if (!adapter?.capabilities.diagnostics) return emptySourceFormatDiagnostics();
  if (shouldUseSourceOnlyFormatParsing(format, text)) {
    return sourceFormatDiagnosticsFromParseResult(createSourceOnlyFormatParseResult(format, text, path));
  }
  return sourceFormatDiagnosticsFromParseResult(adapter.parse(adapter.createContent(text, path)));
}

export function sourceFormatDiagnosticsFromParseResult(parseResult: FormatParseResult): SourceFormatDiagnosticState {
  if (parseResult.format === 'json') {
    const jsonParseResult = parseResult as FormatParseResult<ParsedJsonDocument>;
    const jsonAnalysis = createJsonAnalysis(jsonParseResult);
    return {
      diagnostics: jsonParseResult.diagnostics,
      structuredModel: createStructuredAnalysisModel({
        parseResult: jsonParseResult,
        status: jsonAnalysis.status,
        primarySurfaceKind: 'tree',
        canRenderVisualSurface: jsonAnalysis.status === 'valid',
        metrics: {
          nodeCount: jsonAnalysis.nodeCount,
          treeBudget: jsonAnalysis.treeBudget,
        },
      }),
      jsonAnalysis,
      jsonlAnalysis: null,
      structuredAnalysis: null,
      tabularAnalysis: null,
    };
  }
  if (parseResult.format === 'jsonl') {
    const jsonlParseResult = parseResult as FormatParseResult<ParsedJsonlDocument>;
    const jsonlAnalysis = createJsonlAnalysis(jsonlParseResult);
    return {
      diagnostics: jsonlParseResult.diagnostics,
      structuredModel: createStructuredAnalysisModel({
        parseResult: jsonlParseResult,
        status: jsonlAnalysis.status,
        primarySurfaceKind: 'records',
        canRenderVisualSurface: Boolean(jsonlAnalysis.parseResult.parsed) && jsonlAnalysis.status !== 'source-only',
        metrics: {
          recordCount: jsonlAnalysis.recordCount,
          invalidLineCount: jsonlAnalysis.invalidLineCount,
          ...(jsonlAnalysis.parseResult.parsed ? { totalLineCount: jsonlAnalysis.parseResult.parsed.totalLineCount } : {}),
          previewLimit: jsonlAnalysis.previewLimit,
          previewTruncated: jsonlAnalysis.previewTruncated,
        },
      }),
      jsonAnalysis: null,
      jsonlAnalysis,
      structuredAnalysis: null,
      tabularAnalysis: null,
    };
  }
  if (parseResult.format === 'yaml' || parseResult.format === 'toml' || parseResult.format === 'xml') {
    const structuredParseResult = parseResult as FormatParseResult<ParsedStructuredDocument>;
    const structuredAnalysis = createStructuredAnalysis(parseResult.format, structuredParseResult);
    const yamlInspection = parseResult.format === 'yaml'
      ? (structuredParseResult as FormatParseResult<ParsedYamlDocument>).parsed?.sourceMapInspection
      : null;
    const xmlInspection = parseResult.format === 'xml'
      ? (structuredParseResult as FormatParseResult<ParsedXmlDocument>).parsed
      : null;
    return {
      diagnostics: structuredParseResult.diagnostics,
      structuredModel: createStructuredAnalysisModel({
        parseResult: structuredParseResult,
        status: structuredAnalysis.status,
        primarySurfaceKind: 'tree',
        canRenderVisualSurface: structuredAnalysis.status === 'valid',
        metrics: {
          nodeCount: structuredAnalysis.nodeCount,
          treeBudget: structuredAnalysis.treeBudget,
          ...(yamlInspection ? {
            sourceMappedNodeCount: yamlInspection.spannedNodeCount,
            unmappedVisualNodeCount: yamlInspection.unmappedVisualNodeCount,
            unsupportedFeatureCount: yamlInspection.unsupportedFeatureCount,
          } : {}),
          ...(xmlInspection ? {
            sourceMappedNodeCount: xmlInspection.sourceMap.nodes.filter((node) => Boolean(node.span ?? node.valueSpan)).length,
            unsupportedFeatureCount: xmlInspection.doctypeCount,
          } : {}),
        },
      }),
      jsonAnalysis: null,
      jsonlAnalysis: null,
      structuredAnalysis,
      tabularAnalysis: null,
    };
  }
  if (parseResult.format === 'csv' || parseResult.format === 'tsv') {
    const tabularParseResult = parseResult as FormatParseResult<ParsedDelimitedText>;
    const tabularAnalysis = createTabularAnalysis(parseResult.format, tabularParseResult);
    return {
      diagnostics: tabularParseResult.diagnostics,
      structuredModel: createStructuredAnalysisModel({
        parseResult: tabularParseResult,
        status: tabularAnalysis.status,
        primarySurfaceKind: 'table',
        canRenderVisualSurface: tabularAnalysis.status !== 'invalid'
          && tabularAnalysis.status !== 'source-only'
          && Boolean(tabularAnalysis.parseResult.parsed),
        metrics: {
          dataRowCount: tabularAnalysis.dataRowCount,
          ...(tabularAnalysis.parseResult.parsed ? {
            totalDataRowCount: tabularAnalysis.parseResult.parsed.totalDataRowCount,
            parsedDataRowCount: tabularAnalysis.parseResult.parsed.parsedDataRowCount,
          } : {}),
          columnCount: tabularAnalysis.columnCount,
          previewLimit: tabularAnalysis.previewLimit,
          previewTruncated: tabularAnalysis.previewTruncated,
        },
      }),
      jsonAnalysis: null,
      jsonlAnalysis: null,
      structuredAnalysis: null,
      tabularAnalysis,
    };
  }
  return {
    diagnostics: parseResult.diagnostics,
    structuredModel: null,
    jsonAnalysis: null,
    jsonlAnalysis: null,
    structuredAnalysis: null,
    tabularAnalysis: null,
  };
}

export function shouldUseSourceOnlyFormatParsing(format: DocumentFormat, text: string): boolean {
  return formatExceedsParseBudget(format, text);
}

export function createFormatParserFailureDiagnosticState(
  format: DocumentFormat,
  text: string,
  path: string | null,
  reason: unknown,
): SourceFormatDiagnosticState {
  const message = reason instanceof Error ? reason.message : String(reason || 'The background parser failed.');
  const diagnostic: FormatDiagnostic = {
    severity: 'warning',
    code: 'format-parser-unavailable',
    message: `Background ${format} diagnostics could not finish. Source editing remains available. ${message}`,
    source: format,
  };
  const adapter = adapterForFormat(format);
  return adapter?.capabilities.diagnostics
    ? sourceFormatDiagnosticsFromParseResult(createSourceOnlyFormatParseResult(
      format,
      text,
      path,
      diagnostic.message,
      diagnostic.code,
    ))
    : {
      diagnostics: [diagnostic],
      structuredModel: createFallbackStructuredAnalysisModel(format, text, path, diagnostic),
      jsonAnalysis: null,
      jsonlAnalysis: null,
      structuredAnalysis: null,
      tabularAnalysis: null,
    };
}

export function formatDiagnosticsToValidationIssues(diagnostics: readonly FormatDiagnostic[]): ValidationIssue[] {
  return diagnostics.map((diagnostic) => ({
    severity: diagnostic.severity === 'error' ? 'error' : 'warning',
    code: diagnostic.code,
    message: formatDiagnosticMessage(diagnostic),
  }));
}

function formatDiagnosticMessage(diagnostic: FormatDiagnostic): string {
  const location = diagnostic.line
    ? ` (line ${diagnostic.line}${diagnostic.column ? `, column ${diagnostic.column}` : ''})`
    : '';
  return `${diagnostic.message}${location}`;
}

function createJsonAnalysis(parseResult: FormatParseResult<ParsedJsonDocument>): JsonDocumentAnalysis {
  const nodeCount = parseResult.parsed
    ? parseResult.parsed.health.objectCount + parseResult.parsed.health.arrayCount + parseResult.parsed.health.scalarCount
    : 0;
  const status: JsonDocumentAnalysisStatus = parseResult.sourceOnly
    ? 'source-only'
    : !parseResult.parsed
    ? 'invalid'
    : nodeCount > JSON_TREE_RENDER_NODE_BUDGET
      ? 'too-large'
      : 'valid';
  return {
    status,
    parseResult,
    nodeCount,
    treeBudget: JSON_TREE_RENDER_NODE_BUDGET,
  };
}

function createJsonlAnalysis(parseResult: FormatParseResult<ParsedJsonlDocument>): JsonlDocumentAnalysis {
  const hasErrors = parseResult.diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  const status: JsonlDocumentAnalysisStatus = parseResult.sourceOnly
    ? 'source-only'
    : hasErrors || !parseResult.parsed
    ? 'invalid'
    : parseResult.parsed.previewTruncated
      ? 'preview-truncated'
      : 'valid';
  return {
    status,
    parseResult,
    recordCount: parseResult.parsed?.recordCount ?? 0,
    invalidLineCount: parseResult.parsed?.invalidLineCount ?? 0,
    previewLimit: parseResult.parsed?.previewLimit ?? 0,
    previewTruncated: Boolean(parseResult.parsed?.previewTruncated),
  };
}

function createStructuredAnalysis(
  format: 'yaml' | 'toml' | 'xml',
  parseResult: FormatParseResult<ParsedStructuredDocument>,
): StructuredDocumentAnalysis {
  const nodeCount = parseResult.parsed
    ? parseResult.parsed.stats.objectCount + parseResult.parsed.stats.arrayCount + parseResult.parsed.stats.scalarCount
    : 0;
  const hasErrors = parseResult.diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  const status: StructuredDocumentAnalysisStatus = parseResult.sourceOnly
    ? 'source-only'
    : hasErrors || !parseResult.parsed
    ? 'invalid'
    : nodeCount > JSON_TREE_RENDER_NODE_BUDGET
      ? 'too-large'
      : 'valid';
  return {
    format,
    status,
    parseResult,
    nodeCount,
    treeBudget: JSON_TREE_RENDER_NODE_BUDGET,
  };
}

function createTabularAnalysis(
  format: 'csv' | 'tsv',
  parseResult: FormatParseResult<ParsedDelimitedText>,
): TabularDocumentAnalysis {
  const hasErrors = parseResult.diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  const status: TabularDocumentAnalysisStatus = parseResult.sourceOnly
    ? 'source-only'
    : hasErrors || !parseResult.parsed
    ? 'invalid'
    : parseResult.parsed.previewTruncated
      ? 'preview-truncated'
      : 'valid';
  return {
    format,
    status,
    parseResult,
    dataRowCount: parseResult.parsed?.dataRowCount ?? 0,
    columnCount: parseResult.parsed?.columnCount ?? 0,
    previewLimit: parseResult.parsed?.maxRows ?? 0,
    previewTruncated: Boolean(parseResult.parsed?.previewTruncated),
  };
}

function createStructuredAnalysisModel<TParsed>({
  parseResult,
  status,
  primarySurfaceKind,
  canRenderVisualSurface,
  metrics,
}: {
  parseResult: FormatParseResult<TParsed>;
  status: StructuredAnalysisStatus;
  primarySurfaceKind: StructuredVisualSurfaceKind;
  canRenderVisualSurface: boolean;
  metrics: StructuredAnalysisMetrics;
}): StructuredAnalysisModel<TParsed> {
  const capabilities = adapterForFormat(parseResult.format)?.capabilities;
  return structuredAnalysisModelFromCapabilities({
    format: parseResult.format,
    parseResult,
    status,
    capabilities,
    primarySurfaceKind,
    canRenderVisualSurface,
    metrics,
  });
}

function createFallbackStructuredAnalysisModel(
  format: DocumentFormat,
  text: string,
  path: string | null,
  diagnostic: FormatDiagnostic,
): StructuredAnalysisModel {
  const capabilities = adapterForFormat(format)?.capabilities;
  return structuredAnalysisModelFromCapabilities({
    format,
    parseResult: {
      format,
      content: { format, text, path },
      parsed: null,
      diagnostics: [diagnostic],
      sourceOnly: true,
    },
    status: 'source-only',
    capabilities,
    primarySurfaceKind: capabilities?.visualSurfaces[0]?.kind ?? 'tree',
    canRenderVisualSurface: false,
    metrics: {},
  });
}

function structuredAnalysisModelFromCapabilities<TParsed>({
  format,
  parseResult,
  status,
  capabilities,
  primarySurfaceKind,
  canRenderVisualSurface,
  metrics,
}: {
  format: DocumentFormat;
  parseResult: FormatParseResult<TParsed>;
  status: StructuredAnalysisStatus;
  capabilities: FormatCapabilities | null | undefined;
  primarySurfaceKind: StructuredVisualSurfaceKind;
  canRenderVisualSurface: boolean;
  metrics: StructuredAnalysisMetrics;
}): StructuredAnalysisModel<TParsed> {
  const visualSurfaces = capabilities?.visualSurfaces ?? [];
  return {
    format,
    status,
    diagnostics: parseResult.diagnostics,
    parseResult,
    visualSurfaces,
    primaryVisualSurface: structuredSurfaceForKind(visualSurfaces, primarySurfaceKind),
    canRenderVisualSurface,
    metrics,
    parseBudgetBytes: capabilities?.parseBudgetBytes,
    editPolicy: capabilities?.editPolicy ?? 'source-only',
    preservationPolicy: capabilities?.preservationPolicy ?? 'exact-source',
    sourceOnly: parseResult.sourceOnly,
  };
}

function emptySourceFormatDiagnostics(): SourceFormatDiagnosticState {
  return {
    diagnostics: [],
    structuredModel: null,
    jsonAnalysis: null,
    jsonlAnalysis: null,
    structuredAnalysis: null,
    tabularAnalysis: null,
  };
}
