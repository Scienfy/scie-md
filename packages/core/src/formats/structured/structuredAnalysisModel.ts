import type {
  DocumentFormat,
  FormatDiagnostic,
  FormatParseResult,
  StructuredFormatEditPolicy,
  StructuredFormatPreservationPolicy,
  StructuredVisualSurface,
  StructuredVisualSurfaceKind,
} from '../documentFormat.js';

export type StructuredAnalysisStatus =
  | 'valid'
  | 'invalid'
  | 'too-large'
  | 'source-only'
  | 'preview-truncated';

export interface StructuredAnalysisMetrics {
  nodeCount?: number;
  treeBudget?: number;
  sourceMappedNodeCount?: number;
  unmappedVisualNodeCount?: number;
  unsupportedFeatureCount?: number;
  recordCount?: number;
  invalidLineCount?: number;
  totalLineCount?: number;
  dataRowCount?: number;
  totalDataRowCount?: number;
  parsedDataRowCount?: number;
  columnCount?: number;
  previewLimit?: number;
  previewTruncated?: boolean;
}

export interface StructuredAnalysisModel<TParsed = unknown> {
  format: DocumentFormat;
  status: StructuredAnalysisStatus;
  diagnostics: FormatDiagnostic[];
  parseResult: FormatParseResult<TParsed>;
  visualSurfaces: readonly StructuredVisualSurface[];
  primaryVisualSurface: StructuredVisualSurface | null;
  canRenderVisualSurface: boolean;
  metrics: StructuredAnalysisMetrics;
  parseBudgetBytes?: number;
  editPolicy: StructuredFormatEditPolicy;
  preservationPolicy: StructuredFormatPreservationPolicy;
  sourceOnly: boolean;
}

export function structuredSurfaceForKind(
  surfaces: readonly StructuredVisualSurface[],
  kind: StructuredVisualSurfaceKind,
): StructuredVisualSurface | null {
  return surfaces.find((surface) => surface.kind === kind) ?? null;
}

export function structuredAnalysisCanRenderSurface(
  model: StructuredAnalysisModel | null | undefined,
  kind: StructuredVisualSurfaceKind,
): boolean {
  return Boolean(
    model?.canRenderVisualSurface
    && model.primaryVisualSurface?.kind === kind,
  );
}

export function structuredAnalysisHasDeclaredSurface(
  model: StructuredAnalysisModel | null | undefined,
  kind: StructuredVisualSurfaceKind,
): boolean {
  return Boolean(model && structuredSurfaceForKind(model.visualSurfaces, kind));
}
