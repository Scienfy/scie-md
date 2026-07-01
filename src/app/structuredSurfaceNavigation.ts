import type { DocumentFormat } from '@sciemd/core';
import type {
  JsonDocumentAnalysis,
  JsonlDocumentAnalysis,
  StructuredDocumentAnalysis,
  TabularDocumentAnalysis,
} from './formatDiagnostics';
import type { FormatUiCapabilities } from './formatCapabilities';
import type { EditorMode } from './documentState';

export type StructuredSurfaceId =
  | 'markdown-visual'
  | 'source'
  | 'tree'
  | 'records'
  | 'table'
  | 'cards'
  | 'health';

export interface StructuredSurfaceOption {
  id: StructuredSurfaceId;
  label: string;
  shortLabel: string;
  mode: EditorMode;
  enabled: boolean;
  disabledReason: string | null;
}

export interface StructuredSurfaceNavigationModel {
  format: DocumentFormat;
  activeSurface: StructuredSurfaceId;
  preferredVisualSurface: StructuredSurfaceId | null;
  surfaces: StructuredSurfaceOption[];
  sourceSurface: StructuredSurfaceOption;
  visualSurfaces: StructuredSurfaceOption[];
}

export interface StructuredSurfaceNavigationInput {
  format: DocumentFormat;
  mode: EditorMode;
  formatCapabilities: FormatUiCapabilities;
  preferredVisualSurface?: StructuredSurfaceId | null;
  parsingPending?: boolean;
  jsonAnalysis?: JsonDocumentAnalysis | null;
  jsonArrayTableAvailable?: boolean;
  jsonlAnalysis?: JsonlDocumentAnalysis | null;
  structuredAnalysis?: StructuredDocumentAnalysis | null;
  tabularAnalysis?: TabularDocumentAnalysis | null;
}

export function createStructuredSurfaceNavigationModel({
  format,
  mode,
  formatCapabilities,
  preferredVisualSurface = null,
  parsingPending = false,
  jsonAnalysis = null,
  jsonArrayTableAvailable = false,
  jsonlAnalysis = null,
  structuredAnalysis = null,
  tabularAnalysis = null,
}: StructuredSurfaceNavigationInput): StructuredSurfaceNavigationModel {
  const sourceSurface = surfaceOption('source', 'Source', 'Source', 'source', true);
  const visualSurfaces = visualSurfaceOptions({
    format,
    formatCapabilities,
    parsingPending,
    jsonAnalysis,
    jsonArrayTableAvailable,
    jsonlAnalysis,
    structuredAnalysis,
    tabularAnalysis,
  });
  const surfaces = [...visualSurfaces, sourceSurface];
  const preferred = preferredVisualSurface && preferredVisualSurface !== 'source'
    ? preferredVisualSurface
    : defaultPreferredSurface(visualSurfaces);
  const preferredOption = preferred ? visualSurfaces.find((surface) => surface.id === preferred) ?? null : null;
  const activeSurface = mode === 'source'
    ? 'source'
    : preferredOption?.enabled
      ? preferredOption.id
      : defaultEnabledVisualSurface(visualSurfaces)?.id ?? 'source';

  return {
    format,
    activeSurface,
    preferredVisualSurface: preferred,
    surfaces,
    sourceSurface,
    visualSurfaces,
  };
}

export function structuredSurfaceLabel(surfaceId: StructuredSurfaceId): string {
  switch (surfaceId) {
    case 'markdown-visual':
      return 'Visual';
    case 'source':
      return 'Source';
    case 'tree':
      return 'Tree';
    case 'records':
      return 'Records';
    case 'table':
      return 'Table';
    case 'cards':
      return 'Cards';
    case 'health':
      return 'Health';
  }
}

function visualSurfaceOptions({
  format,
  formatCapabilities,
  parsingPending = false,
  jsonAnalysis = null,
  jsonArrayTableAvailable = false,
  jsonlAnalysis = null,
  structuredAnalysis = null,
  tabularAnalysis = null,
}: Omit<StructuredSurfaceNavigationInput, 'mode' | 'preferredVisualSurface'>): StructuredSurfaceOption[] {
  if (formatCapabilities.canUseVisualMarkdown) {
    return [surfaceOption('markdown-visual', 'Visual', 'Visual', 'visual', true)];
  }

  if (format === 'json') {
    const treeReason = structuredTreeDisabledReason(parsingPending, jsonAnalysis?.status ?? null, Boolean(jsonAnalysis?.parseResult.parsed));
    const tableReason = jsonArraySurfaceDisabledReason(treeReason, jsonArrayTableAvailable);
    return [
      surfaceOption('tree', 'Tree', 'Tree', 'visual', !treeReason, treeReason),
      surfaceOption('table', 'Table', 'Table', 'visual', !tableReason, tableReason),
      surfaceOption('cards', 'Cards', 'Cards', 'visual', !tableReason, tableReason),
      surfaceOption('health', 'Health', 'Health', 'visual', !treeReason, treeReason),
    ];
  }

  if (format === 'jsonl') {
    const reason = jsonlRecordsDisabledReason(parsingPending, jsonlAnalysis);
    return [surfaceOption('records', 'Records', 'Records', 'visual', !reason, reason)];
  }

  if (format === 'csv' || format === 'tsv') {
    const reason = tabularTableDisabledReason(parsingPending, tabularAnalysis);
    return [surfaceOption('table', 'Table', 'Table', 'visual', !reason, reason)];
  }

  if (format === 'yaml' || format === 'toml' || format === 'xml') {
    const reason = structuredTreeDisabledReason(parsingPending, structuredAnalysis?.status ?? null, Boolean(structuredAnalysis?.parseResult.parsed));
    return [surfaceOption('tree', 'Tree', 'Tree', 'visual', !reason, reason)];
  }

  return [];
}

function surfaceOption(
  id: StructuredSurfaceId,
  label: string,
  shortLabel: string,
  mode: EditorMode,
  enabled: boolean,
  disabledReason: string | null = null,
): StructuredSurfaceOption {
  return { id, label, shortLabel, mode, enabled, disabledReason };
}

function defaultPreferredSurface(surfaces: readonly StructuredSurfaceOption[]): StructuredSurfaceId | null {
  return surfaces.find((surface) => surface.enabled)?.id ?? surfaces[0]?.id ?? null;
}

function defaultEnabledVisualSurface(surfaces: readonly StructuredSurfaceOption[]): StructuredSurfaceOption | null {
  return surfaces.find((surface) => surface.enabled && surface.id !== 'health') ?? null;
}

function structuredTreeDisabledReason(
  parsingPending: boolean,
  status: string | null,
  hasParsedValue: boolean,
): string | null {
  if (parsingPending && !hasParsedValue) return 'Parser is still preparing this view.';
  if (status === 'valid' && hasParsedValue) return null;
  if (status === 'invalid') return 'Fix parser errors before using the structured view.';
  if (status === 'too-large' || status === 'source-only') return 'This file is over the visual parse budget; source remains available.';
  return 'Structured view is not available for this document yet.';
}

function jsonArraySurfaceDisabledReason(treeDisabledReason: string | null, available: boolean): string | null {
  if (treeDisabledReason) return treeDisabledReason;
  return available ? null : 'No table-shaped object array is selected or discoverable.';
}

function jsonlRecordsDisabledReason(
  parsingPending: boolean,
  analysis: JsonlDocumentAnalysis | null,
): string | null {
  if (parsingPending && !analysis?.parseResult.parsed) return 'Parser is still preparing records.';
  if (analysis?.parseResult.parsed && analysis.status !== 'source-only') return null;
  if (analysis?.status === 'source-only') return 'This JSONL file is over the preview budget; source remains available.';
  return 'Records are unavailable until the file is parsed.';
}

function tabularTableDisabledReason(
  parsingPending: boolean,
  analysis: TabularDocumentAnalysis | null,
): string | null {
  if (parsingPending && !analysis?.parseResult.parsed) return 'Parser is still preparing the table.';
  if (analysis?.parseResult.parsed && analysis.status !== 'invalid' && analysis.status !== 'source-only') return null;
  if (analysis?.status === 'invalid') return 'Fix table parser errors before using the preview.';
  if (analysis?.status === 'source-only') return 'This table is over the preview budget; source remains available.';
  return 'Table preview is unavailable until the file is parsed.';
}
