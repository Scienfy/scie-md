import type {
  DocumentFormat,
  FormatDiagnostic,
  FormatParseResult,
  SourceSpan,
  StructuredSourceMap,
} from '../documentFormat.js';
import { createSourceOnlyFormatParseResult, formatExceedsParseBudget } from '../formatPolicy.js';
import { createJsonContent, parseJsonDocument, type ParsedJsonDocument } from '../json/parseJsonDocument.js';
import { createJsonlContent, parseJsonlDocument, type ParsedJsonlDocument } from '../jsonl/parseJsonlDocument.js';
import { createTomlContent, parseTomlDocument, type ParsedTomlDocument } from '../toml/parseTomlDocument.js';
import { createXmlContent, parseXmlDocument, type ParsedXmlDocument } from '../xml/parseXmlDocument.js';
import { createYamlContent, parseYamlDocument, type ParsedYamlDocument } from '../yaml/parseYamlDocument.js';
import { structuredContextValueForJsonl } from './structuredContext.js';
import { structuredPreviewDocumentOperations, type StructuredOperationMetadata } from './structuredOperations.js';

export type StructuredPreviewFormat = Extract<DocumentFormat, 'json' | 'jsonl' | 'yaml' | 'toml' | 'xml'>;

export interface StructuredPreviewMetric {
  label: string;
  value: string;
}

export interface StructuredPreviewModelInput {
  format: StructuredPreviewFormat;
  text: string;
  path?: string | null;
}

export interface StructuredPreviewEditPolicy {
  previewReadonly: true;
  canApplyClipboardReplace: boolean;
  clipboardReplaceRequiresOptIn: boolean;
  clipboardReplaceCommandId?: string;
  reason: string;
}

export type StructuredPreviewSourceRevealStrategy = 'source-map' | 'line-records' | 'none';

export interface StructuredPreviewSourceRevealTarget {
  pointer: string;
  displayPath: string;
  line: number;
  column: number;
  offset: number;
  length: number;
}

export interface StructuredPreviewSourceRevealMetadata {
  available: boolean;
  strategy: StructuredPreviewSourceRevealStrategy;
  mappedNodeCount: number;
  totalNodeCount: number;
  sampleTargets: StructuredPreviewSourceRevealTarget[];
  reason: string;
}

export interface StructuredPreviewModel {
  format: StructuredPreviewFormat;
  label: string;
  value: unknown;
  diagnostics: FormatDiagnostic[];
  metrics: StructuredPreviewMetric[];
  sourceText: string;
  editPolicy: StructuredPreviewEditPolicy;
  operations: StructuredOperationMetadata[];
  sourceReveal: StructuredPreviewSourceRevealMetadata;
}

export function isStructuredPreviewFormat(format: DocumentFormat | null | undefined): format is StructuredPreviewFormat {
  return format === 'json' || format === 'jsonl' || format === 'yaml' || format === 'toml' || format === 'xml';
}

export function createStructuredPreviewModel(input: StructuredPreviewModelInput): StructuredPreviewModel {
  switch (input.format) {
    case 'json':
      return jsonModel(input);
    case 'jsonl':
      return jsonlModel(input);
    case 'yaml':
      return yamlModel(input);
    case 'toml':
      return tomlModel(input);
    case 'xml':
      return xmlModel(input);
  }
}

function jsonModel(input: StructuredPreviewModelInput): StructuredPreviewModel {
  const result = sourceOnlyPreviewParseResult<ParsedJsonDocument>(input)
    ?? parseJsonDocument(createJsonContent(input.text, input.path ?? null));
  const parsed = result.parsed;
  const editPolicy = result.sourceOnly ? sourceOnlyPolicy('JSON', result.diagnostics[0]?.message) : jsonJsonlEditPolicy('JSON');
  return {
    format: 'json',
    label: 'JSON',
    value: parsed?.value ?? null,
    diagnostics: result.diagnostics,
    sourceText: input.text,
    editPolicy,
    operations: previewOperations(editPolicy),
    sourceReveal: result.sourceOnly ? sourceOnlySourceReveal('JSON') : sourceRevealFromSourceMap('JSON', parsed?.sourceMap),
    metrics: parsed
      ? [
          { label: 'root', value: parsed.root.type },
          { label: 'objects', value: String(parsed.health.objectCount) },
          { label: 'arrays', value: String(parsed.health.arrayCount) },
          { label: 'depth', value: String(parsed.health.maxDepth) },
        ]
      : [{ label: 'root', value: result.sourceOnly ? 'source-only' : 'invalid' }],
  };
}

function jsonlModel(input: StructuredPreviewModelInput): StructuredPreviewModel {
  const result = sourceOnlyPreviewParseResult<ParsedJsonlDocument>(input)
    ?? parseJsonlDocument(createJsonlContent(input.text, input.path ?? null));
  const parsed = result.parsed;
  const editPolicy = result.sourceOnly ? sourceOnlyPolicy('JSON Lines', result.diagnostics[0]?.message) : jsonJsonlEditPolicy('JSON Lines');
  return {
    format: 'jsonl',
    label: 'JSON Lines',
    value: parsed ? structuredContextValueForJsonl(parsed) : [],
    diagnostics: result.diagnostics,
    sourceText: input.text,
    editPolicy,
    operations: previewOperations(editPolicy),
    sourceReveal: result.sourceOnly
      ? sourceOnlySourceReveal('JSON Lines')
      : parsed
      ? sourceRevealFromJsonlLines(parsed.lines, parsed.recordCount)
      : noSourceReveal('JSON Lines records are unavailable until parser errors are fixed.'),
    metrics: parsed
      ? [
          { label: 'records', value: String(parsed.recordCount) },
          { label: 'invalid', value: String(parsed.invalidLineCount) },
          { label: 'fields', value: String(parsed.commonFields.length) },
        ]
      : [{ label: 'records', value: result.sourceOnly ? 'source-only' : '0' }],
  };
}

function yamlModel(input: StructuredPreviewModelInput): StructuredPreviewModel {
  const result = sourceOnlyPreviewParseResult<ParsedYamlDocument>(input)
    ?? parseYamlDocument(createYamlContent(input.text, input.path ?? null));
  const parsed = result.parsed;
  return {
    format: 'yaml',
    label: 'YAML',
    value: parsed?.value ?? null,
    diagnostics: result.diagnostics,
    sourceText: input.text,
    editPolicy: previewOnlyPolicy('YAML'),
    operations: previewOperations(previewOnlyPolicy('YAML')),
    sourceReveal: result.sourceOnly ? sourceOnlySourceReveal('YAML') : sourceRevealFromSourceMap('YAML', parsed?.sourceMap),
    metrics: parsed
      ? [
          { label: 'root', value: parsed.stats.topLevelType },
          { label: 'objects', value: String(parsed.stats.objectCount) },
          { label: 'arrays', value: String(parsed.stats.arrayCount) },
          { label: 'depth', value: String(parsed.stats.maxDepth) },
        ]
      : [{ label: 'root', value: result.sourceOnly ? 'source-only' : 'invalid' }],
  };
}

function tomlModel(input: StructuredPreviewModelInput): StructuredPreviewModel {
  const result = sourceOnlyPreviewParseResult<ParsedTomlDocument>(input)
    ?? parseTomlDocument(createTomlContent(input.text, input.path ?? null));
  const parsed = result.parsed;
  return {
    format: 'toml',
    label: 'TOML',
    value: parsed?.value ?? null,
    diagnostics: result.diagnostics,
    sourceText: input.text,
    editPolicy: previewOnlyPolicy('TOML'),
    operations: previewOperations(previewOnlyPolicy('TOML')),
    sourceReveal: result.sourceOnly ? sourceOnlySourceReveal('TOML') : sourceRevealFromSourceMap('TOML', parsed?.sourceMap),
    metrics: parsed
      ? [
          { label: 'root', value: parsed.stats.topLevelType },
          { label: 'objects', value: String(parsed.stats.objectCount) },
          { label: 'arrays', value: String(parsed.stats.arrayCount) },
          { label: 'depth', value: String(parsed.stats.maxDepth) },
        ]
      : [{ label: 'root', value: result.sourceOnly ? 'source-only' : 'invalid' }],
  };
}

function xmlModel(input: StructuredPreviewModelInput): StructuredPreviewModel {
  const result = sourceOnlyPreviewParseResult<ParsedXmlDocument>(input)
    ?? parseXmlDocument(createXmlContent(input.text, input.path ?? null));
  const parsed = result.parsed;
  return {
    format: 'xml',
    label: 'XML',
    value: parsed?.value ?? null,
    diagnostics: result.diagnostics,
    sourceText: input.text,
    editPolicy: previewOnlyPolicy('XML'),
    operations: previewOperations(previewOnlyPolicy('XML')),
    sourceReveal: result.sourceOnly ? sourceOnlySourceReveal('XML') : sourceRevealFromSourceMap('XML', parsed?.sourceMap),
    metrics: parsed
      ? [
          { label: 'root', value: parsed.stats.topLevelType },
          { label: 'elements', value: String(parsed.elementCount) },
          { label: 'attributes', value: String(parsed.attributeCount) },
          { label: 'namespaces', value: String(parsed.namespaceCount) },
          { label: 'depth', value: String(parsed.stats.maxDepth) },
        ]
      : [{ label: 'root', value: result.sourceOnly ? 'source-only' : 'invalid' }],
  };
}

function sourceOnlyPreviewParseResult<TParsed>(input: StructuredPreviewModelInput): FormatParseResult<TParsed> | null {
  return formatExceedsParseBudget(input.format, input.text)
    ? createSourceOnlyFormatParseResult<TParsed>(input.format, input.text, input.path ?? null)
    : null;
}

function jsonJsonlEditPolicy(label: string): StructuredPreviewEditPolicy {
  return {
    previewReadonly: true,
    canApplyClipboardReplace: true,
    clipboardReplaceRequiresOptIn: true,
    clipboardReplaceCommandId: 'scieMd.applyStructuredClipboardToJson',
    reason: `${label} preview is read-only; host commands may validate and replace the text document only when explicitly enabled and the source hash still matches.`,
  };
}

function previewOnlyPolicy(label: string): StructuredPreviewEditPolicy {
  return {
    previewReadonly: true,
    canApplyClipboardReplace: false,
    clipboardReplaceRequiresOptIn: false,
    reason: `${label} preview is read-only because source-preserving visual writes are not available.`,
  };
}

function sourceOnlyPolicy(label: string, reason?: string): StructuredPreviewEditPolicy {
  return {
    previewReadonly: true,
    canApplyClipboardReplace: false,
    clipboardReplaceRequiresOptIn: false,
    reason: reason ?? `${label} preview is source-only because the file is above the background parse budget.`,
  };
}

function previewOperations(policy: StructuredPreviewEditPolicy): StructuredOperationMetadata[] {
  return structuredPreviewDocumentOperations({
    canApplyClipboardReplace: policy.canApplyClipboardReplace,
    disabledReason: policy.reason,
    requiresOptIn: policy.clipboardReplaceRequiresOptIn,
  });
}

function sourceRevealFromSourceMap(label: string, sourceMap: StructuredSourceMap | null | undefined): StructuredPreviewSourceRevealMetadata {
  if (!sourceMap || sourceMap.nodes.length === 0) {
    return noSourceReveal(`${label} source reveal metadata is unavailable until the document parses.`);
  }
  const mappedNodes = sourceMap.nodes
    .map((node) => {
      const span = node.valueSpan ?? node.span ?? node.keySpan;
      return span
        ? {
            pointer: node.pointer,
            displayPath: node.displayPath,
            span,
          }
        : null;
    })
    .filter((entry): entry is { pointer: string; displayPath: string; span: SourceSpan } => entry !== null);

  if (mappedNodes.length === 0) {
    return {
      available: false,
      strategy: 'none',
      mappedNodeCount: 0,
      totalNodeCount: sourceMap.nodes.length,
      sampleTargets: [],
      reason: `${label} nodes do not currently expose reliable source ranges.`,
    };
  }

  return {
    available: true,
    strategy: 'source-map',
    mappedNodeCount: mappedNodes.length,
    totalNodeCount: sourceMap.nodes.length,
    sampleTargets: mappedNodes.slice(0, 5).map(({ pointer, displayPath, span }) => sourceRevealTarget(pointer, displayPath, span)),
    reason: `${mappedNodes.length} of ${sourceMap.nodes.length} structured nodes expose source ranges.`,
  };
}

function sourceRevealFromJsonlLines(
  lines: readonly { valid: boolean; recordIndex: number | null; line: number; offset: number; length: number }[],
  recordCount: number,
): StructuredPreviewSourceRevealMetadata {
  const mappedLines = lines
    .filter((line): line is { valid: true; recordIndex: number; line: number; offset: number; length: number } => (
      line.valid && line.recordIndex !== null
    ));
  if (mappedLines.length === 0) {
    return noSourceReveal('JSON Lines records are unavailable until parser errors are fixed.');
  }
  return {
    available: true,
    strategy: 'line-records',
    mappedNodeCount: mappedLines.length,
    totalNodeCount: recordCount,
    sampleTargets: mappedLines.slice(0, 5).map((line) => ({
      pointer: `/${line.recordIndex}`,
      displayPath: `$[${line.recordIndex}]`,
      line: line.line,
      column: 1,
      offset: line.offset,
      length: Math.max(1, line.length),
    })),
    reason: `${mappedLines.length} of ${recordCount} preview records map to source lines.`,
  };
}

function sourceRevealTarget(pointer: string, displayPath: string, span: SourceSpan): StructuredPreviewSourceRevealTarget {
  return {
    pointer,
    displayPath,
    line: span.line,
    column: span.column,
    offset: span.offset,
    length: span.length,
  };
}

function noSourceReveal(reason: string): StructuredPreviewSourceRevealMetadata {
  return {
    available: false,
    strategy: 'none',
    mappedNodeCount: 0,
    totalNodeCount: 0,
    sampleTargets: [],
    reason,
  };
}

function sourceOnlySourceReveal(label: string): StructuredPreviewSourceRevealMetadata {
  return noSourceReveal(`${label} source reveal is disabled because background parsing is in source-only mode.`);
}
