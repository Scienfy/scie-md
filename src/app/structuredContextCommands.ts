import {
  createRedactedStructuredPreview,
  createStructuredParserDiagnosticsContext,
  createSelectedStructureContext,
  createStructuredHealthContext,
  createStructuredSchemaSummaryContext,
  createStructuredTableSampleContext,
  inferObservedJsonShape,
  structuredContextValueForDelimitedText,
  structuredContextValueForJsonl,
  type FormatDiagnostic,
  type StructuredContextFormat,
  type StructuredContextPacket,
  type StructuredSourceMap,
} from '@sciemd/core';
import type {
  JsonDocumentAnalysis,
  JsonlDocumentAnalysis,
  StructuredDocumentAnalysis,
  TabularDocumentAnalysis,
} from './formatDiagnostics';

export interface StructuredContextCommandState {
  format: StructuredContextFormat;
  sourcePath: string | null;
  selectedPath: string | null;
  jsonAnalysis: JsonDocumentAnalysis | null;
  jsonlAnalysis: JsonlDocumentAnalysis | null;
  structuredAnalysis: StructuredDocumentAnalysis | null;
  tabularAnalysis: TabularDocumentAnalysis | null;
}

export function canCreateStructuredContextPackets(state: StructuredContextCommandState): boolean {
  return Boolean(resolveStructuredContextSource(state));
}

export function createCurrentSelectedStructureContext(state: StructuredContextCommandState): StructuredContextPacket | null {
  const source = resolveStructuredContextSource(state);
  if (!source) return null;
  return createSelectedStructureContext({
    format: state.format,
    value: source.value,
    sourceMap: source.sourceMap,
    selectedPath: state.selectedPath ?? '$',
    sourcePath: state.sourcePath,
    diagnostics: source.diagnostics,
  });
}

export function createCurrentWholeStructuredContext(state: StructuredContextCommandState): StructuredContextPacket | null {
  const source = resolveStructuredContextSource(state);
  if (!source) return null;
  return createSelectedStructureContext({
    format: state.format,
    value: source.value,
    sourceMap: source.sourceMap,
    selectedPath: '$',
    sourcePath: state.sourcePath,
    diagnostics: source.diagnostics,
  });
}

export function createCurrentSchemaSummaryContext(state: StructuredContextCommandState): StructuredContextPacket | null {
  const source = resolveStructuredContextSource(state);
  if (!source) return null;
  const jsonParsed = state.jsonAnalysis?.parseResult.parsed ?? null;
  return createStructuredSchemaSummaryContext({
    format: state.format,
    sourcePath: state.sourcePath,
    schemaValidation: jsonParsed?.schemaValidation ?? null,
    observedShape: jsonParsed?.observedShape ?? inferObservedJsonShape(source.value),
    diagnostics: source.diagnostics,
  });
}

export function canCreateStructuredTableSamplePacket(state: StructuredContextCommandState): boolean {
  return Boolean(resolveStructuredContextTableSource(state));
}

export function createCurrentStructuredTableSampleContext(state: StructuredContextCommandState): StructuredContextPacket | null {
  const source = resolveStructuredContextTableSource(state);
  if (!source) return null;
  return createStructuredTableSampleContext({
    format: source.format,
    sourcePath: state.sourcePath,
    parsed: source.parsed,
    diagnostics: source.diagnostics,
  });
}

export function createCurrentParserDiagnosticsContext(state: StructuredContextCommandState): StructuredContextPacket {
  const diagnostics = state.jsonAnalysis?.parseResult.diagnostics
    ?? state.jsonlAnalysis?.parseResult.diagnostics
    ?? state.structuredAnalysis?.parseResult.diagnostics
    ?? state.tabularAnalysis?.parseResult.diagnostics
    ?? [];
  const status = state.jsonAnalysis?.status
    ?? state.jsonlAnalysis?.status
    ?? state.structuredAnalysis?.status
    ?? state.tabularAnalysis?.status
    ?? null;
  return createStructuredParserDiagnosticsContext({
    format: state.format,
    sourcePath: state.sourcePath,
    diagnostics,
    status,
  });
}

export function createCurrentStructuredHealthContext(state: StructuredContextCommandState): StructuredContextPacket | null {
  const source = resolveStructuredContextSource(state);
  if (!source) return null;
  const jsonParsed = state.jsonAnalysis?.parseResult.parsed ?? null;
  const structuredParsed = state.structuredAnalysis?.parseResult.parsed ?? null;
  const jsonlParsed = state.jsonlAnalysis?.parseResult.parsed ?? null;
  const tabularParsed = state.tabularAnalysis?.parseResult.parsed ?? null;
  return createStructuredHealthContext({
    format: state.format,
    sourcePath: state.sourcePath,
    diagnostics: source.diagnostics,
    jsonHealth: jsonParsed?.health ?? null,
    structuredStats: structuredParsed?.stats ?? null,
    jsonl: jsonlParsed,
    nodeCount: state.jsonAnalysis?.nodeCount ?? state.structuredAnalysis?.nodeCount ?? tabularParsed?.cellCount,
    treeBudget: state.jsonAnalysis?.treeBudget ?? state.structuredAnalysis?.treeBudget ?? state.tabularAnalysis?.previewLimit,
  });
}

export function createCurrentRedactedStructuredPreview(state: StructuredContextCommandState): StructuredContextPacket | null {
  const source = resolveStructuredContextSource(state);
  if (!source) return null;
  return createRedactedStructuredPreview({
    format: state.format,
    value: source.value,
    sourcePath: state.sourcePath,
  });
}

function resolveStructuredContextSource(state: StructuredContextCommandState): {
  value: unknown;
  sourceMap: StructuredSourceMap | null;
  diagnostics: readonly FormatDiagnostic[];
} | null {
  if (state.format === 'json') {
    const parsed = state.jsonAnalysis?.parseResult.parsed;
    if (!parsed || state.jsonAnalysis?.status !== 'valid') return null;
    return {
      value: parsed.value,
      sourceMap: parsed.sourceMap,
      diagnostics: state.jsonAnalysis.parseResult.diagnostics,
    };
  }
  if (state.format === 'jsonl') {
    const analysis = state.jsonlAnalysis;
    const parsed = analysis?.parseResult.parsed;
    if (!analysis || !parsed || analysis.status === 'invalid') return null;
    return {
      value: structuredContextValueForJsonl(parsed),
      sourceMap: null,
      diagnostics: analysis.parseResult.diagnostics,
    };
  }
  if (state.format === 'csv' || state.format === 'tsv') {
    const analysis = state.tabularAnalysis;
    const parsed = analysis?.parseResult.parsed;
    if (!analysis || !parsed || analysis.status === 'invalid' || analysis.status === 'source-only') return null;
    return {
      value: structuredContextValueForDelimitedText(parsed),
      sourceMap: null,
      diagnostics: analysis.parseResult.diagnostics,
    };
  }
  const parsed = state.structuredAnalysis?.parseResult.parsed;
  if (!parsed || state.structuredAnalysis?.status !== 'valid') return null;
  return {
    value: parsed.value,
    sourceMap: parsed.sourceMap,
    diagnostics: state.structuredAnalysis.parseResult.diagnostics,
  };
}

function resolveStructuredContextTableSource(state: StructuredContextCommandState): {
  format: 'csv' | 'tsv';
  parsed: NonNullable<TabularDocumentAnalysis['parseResult']['parsed']>;
  diagnostics: readonly FormatDiagnostic[];
} | null {
  if (state.format !== 'csv' && state.format !== 'tsv') return null;
  const analysis = state.tabularAnalysis;
  const parsed = analysis?.parseResult.parsed;
  if (!analysis || !parsed || analysis.status === 'invalid' || analysis.status === 'source-only') return null;
  return {
    format: state.format,
    parsed,
    diagnostics: analysis.parseResult.diagnostics,
  };
}
