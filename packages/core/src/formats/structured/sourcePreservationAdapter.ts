import type {
  DocumentFormat,
  FormatDiagnostic,
  SourceSpan,
  StructuredPathSegment,
  StructuredSourceMap,
} from '../documentFormat.js';
import { displayPathFromPath, pointerFromPath } from './sourceMap.js';

export type SourcePreservationFormat = Extract<DocumentFormat, 'yaml' | 'toml' | 'xml'>;

export type SourcePreservationAdapterStatus =
  | 'read-only'
  | 'experimental-readonly-evidence'
  | 'planned-write-adapter'
  | 'write-enabled';

export type SourcePreservationGuard =
  | 'source-hash'
  | 'expected-old-source'
  | 'raw-token'
  | 'post-parse-validation'
  | 'unsupported-feature-gate'
  | 'untouched-region-compare';

export interface SourcePreservationUnsupportedFeature {
  kind: string;
  code: string;
  message: string;
  path: StructuredPathSegment[];
  pointer: string;
  displayPath: string;
  span: SourceSpan | null;
  blocking?: boolean;
}

export interface SourcePreservationNoOpRoundTrip {
  preserved: boolean;
  sourceHash: string;
  serializedHash: string;
  sourceLengthBytes: number;
  serializedLengthBytes: number;
}

export interface SourcePreservationAnalysis<
  TFormat extends SourcePreservationFormat = SourcePreservationFormat,
  TUnsupportedFeature extends SourcePreservationUnsupportedFeature = SourcePreservationUnsupportedFeature,
> {
  format: TFormat;
  adapterStatus: SourcePreservationAdapterStatus;
  visualWritesEnabled: boolean;
  sourceHash: string;
  sourceLengthBytes: number;
  sourceMap: StructuredSourceMap | null;
  diagnostics: FormatDiagnostic[];
  unsupportedFeatures: TUnsupportedFeature[];
  unsupportedFeatureCount: number;
  unsupportedKinds: string[];
  noOpRoundTrip: SourcePreservationNoOpRoundTrip | null;
  requiredGuards: SourcePreservationGuard[];
  decision: 'defer-visual-writes' | 'allow-guarded-writes';
  rationale: string[];
}

export interface SourcePreservationEditRequest {
  format: SourcePreservationFormat;
  sourceText: string;
  sourceHash: string;
  path: StructuredPathSegment[];
  pointer?: string;
  expectedOldSource: string;
  replacementSource: string;
  span: SourceSpan;
  operation: 'replace-value' | 'insert-field' | 'delete-field' | 'rename-field' | 'reorder' | 'custom';
}

export interface SourcePreservationPatch {
  span: Pick<SourceSpan, 'offset' | 'length'>;
  replacementSource: string;
  expectedOldSource?: string;
}

export type SourcePreservationEditPlan =
  | {
      status: 'ready';
      patches: SourcePreservationPatch[];
      sourceHash: string;
      requiredGuards: SourcePreservationGuard[];
      diagnostics: FormatDiagnostic[];
    }
  | {
      status: 'unsupported';
      reason: string;
      diagnostics: FormatDiagnostic[];
    };

export interface SourcePreservationValidationResult {
  ok: boolean;
  diagnostics: FormatDiagnostic[];
}

export interface SourcePreservationAdapter<
  TFormat extends SourcePreservationFormat = SourcePreservationFormat,
  TAnalysis extends SourcePreservationAnalysis<TFormat> = SourcePreservationAnalysis<TFormat>,
> {
  format: TFormat;
  label: string;
  status: SourcePreservationAdapterStatus;
  requiredGuards: readonly SourcePreservationGuard[];
  analyze(sourceText: string): TAnalysis;
  planEdit?(request: SourcePreservationEditRequest, analysis: TAnalysis): SourcePreservationEditPlan;
  validateAfterEdit?(sourceText: string, analysis: TAnalysis): SourcePreservationValidationResult;
}

export interface UntouchedRegionComparison {
  ok: boolean;
  checkedRegionCount: number;
  mismatches: Array<{
    originalOffset: number;
    nextOffset: number;
    expected: string;
    actual: string;
  }>;
}

const DEFAULT_REQUIRED_GUARDS: SourcePreservationGuard[] = [
  'source-hash',
  'expected-old-source',
  'raw-token',
  'post-parse-validation',
  'unsupported-feature-gate',
  'untouched-region-compare',
];

export function createDisabledSourcePreservationAnalysis<
  TFormat extends SourcePreservationFormat,
  TUnsupportedFeature extends SourcePreservationUnsupportedFeature = SourcePreservationUnsupportedFeature,
>({
  format,
  sourceText,
  sourceMap,
  diagnostics = [],
  unsupportedFeatures = [],
  noOpSerializedText = null,
  adapterStatus = 'read-only',
  rationale = [],
}: {
  format: TFormat;
  sourceText: string;
  sourceMap: StructuredSourceMap | null;
  diagnostics?: readonly FormatDiagnostic[];
  unsupportedFeatures?: readonly TUnsupportedFeature[];
  noOpSerializedText?: string | null;
  adapterStatus?: Exclude<SourcePreservationAdapterStatus, 'write-enabled'>;
  rationale?: readonly string[];
}): SourcePreservationAnalysis<TFormat, TUnsupportedFeature> {
  return {
    format,
    adapterStatus,
    visualWritesEnabled: false,
    sourceHash: sourcePreservationHash(sourceText),
    sourceLengthBytes: sourceByteLength(sourceText),
    sourceMap,
    diagnostics: [...diagnostics],
    unsupportedFeatures: [...unsupportedFeatures],
    unsupportedFeatureCount: unsupportedFeatures.length,
    unsupportedKinds: Array.from(new Set(unsupportedFeatures.map((feature) => feature.kind))).sort(),
    noOpRoundTrip: noOpSerializedText === null ? null : evaluateNoOpRoundTrip(sourceText, noOpSerializedText),
    requiredGuards: [...DEFAULT_REQUIRED_GUARDS],
    decision: 'defer-visual-writes',
    rationale: [
      `${format.toUpperCase()} visual writes remain disabled until a source-preserving edit planner proves the required guards.`,
      ...rationale,
    ],
  };
}

export function createSourcePreservationUnsupportedDiagnostic(
  format: SourcePreservationFormat,
  reason: string,
  span?: SourceSpan | null,
): FormatDiagnostic {
  return {
    severity: 'warning',
    code: `${format}-visual-write-disabled`,
    message: reason,
    source: format,
    category: 'preservation',
    blocking: false,
    line: span?.line,
    column: span?.column,
    offset: span?.offset,
    length: span?.length,
    span: span ?? undefined,
  };
}

export function createUnsupportedSourcePreservationEditPlan(
  format: SourcePreservationFormat,
  reason: string,
  span?: SourceSpan | null,
): SourcePreservationEditPlan {
  return {
    status: 'unsupported',
    reason,
    diagnostics: [createSourcePreservationUnsupportedDiagnostic(format, reason, span)],
  };
}

export function sourcePreservationHash(sourceText: string): string {
  let hash = 0x811c9dc5;
  for (const byte of utf8Bytes(sourceText)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}:${sourceByteLength(sourceText)}`;
}

export function sourceByteLength(sourceText: string): number {
  return utf8Bytes(sourceText).length;
}

export function evaluateNoOpRoundTrip(
  sourceText: string,
  serializedText: string,
): SourcePreservationNoOpRoundTrip {
  return {
    preserved: sourceText === serializedText,
    sourceHash: sourcePreservationHash(sourceText),
    serializedHash: sourcePreservationHash(serializedText),
    sourceLengthBytes: sourceByteLength(sourceText),
    serializedLengthBytes: sourceByteLength(serializedText),
  };
}

export function createExpectedOldSourceGuard(
  sourceText: string,
  span: Pick<SourceSpan, 'offset' | 'length'>,
): string {
  return sourceText.slice(span.offset, span.offset + span.length);
}

export function validateSourcePreservationGuards(
  sourceText: string,
  request: Pick<SourcePreservationEditRequest, 'sourceHash' | 'expectedOldSource' | 'span'>,
): SourcePreservationValidationResult {
  const diagnostics: FormatDiagnostic[] = [];
  const actualHash = sourcePreservationHash(sourceText);
  if (actualHash !== request.sourceHash) {
    diagnostics.push({
      severity: 'error',
      code: 'source-preservation-hash-mismatch',
      message: 'The source text changed after the preservation plan was created.',
      category: 'preservation',
      blocking: true,
    });
  }
  const actualOldSource = createExpectedOldSourceGuard(sourceText, request.span);
  if (actualOldSource !== request.expectedOldSource) {
    diagnostics.push({
      severity: 'error',
      code: 'source-preservation-expected-old-source-mismatch',
      message: 'The planned source span no longer contains the expected original token.',
      category: 'preservation',
      blocking: true,
      line: request.span.line,
      column: request.span.column,
      offset: request.span.offset,
      length: request.span.length,
      span: request.span,
    });
  }
  return { ok: diagnostics.length === 0, diagnostics };
}

export function applySourcePreservationPatches(
  sourceText: string,
  patches: readonly SourcePreservationPatch[],
): { ok: true; sourceText: string } | { ok: false; diagnostics: FormatDiagnostic[] } {
  const sorted = normalizePatches(patches);
  if (!sorted.ok) return sorted;

  for (const patch of sorted.patches) {
    if (patch.expectedOldSource === undefined) continue;
    const actual = createExpectedOldSourceGuard(sourceText, patch.span);
    if (actual !== patch.expectedOldSource) {
      return {
        ok: false,
        diagnostics: [{
          severity: 'error',
          code: 'source-preservation-patch-expected-old-source-mismatch',
          message: 'A preservation patch did not match its expected old source.',
          category: 'preservation',
          blocking: true,
          offset: patch.span.offset,
          length: patch.span.length,
        }],
      };
    }
  }

  let nextSource = '';
  let cursor = 0;
  for (const patch of sorted.patches) {
    nextSource += sourceText.slice(cursor, patch.span.offset);
    nextSource += patch.replacementSource;
    cursor = patch.span.offset + patch.span.length;
  }
  nextSource += sourceText.slice(cursor);
  return { ok: true, sourceText: nextSource };
}

export function compareUntouchedSourceRegions(
  originalSource: string,
  nextSource: string,
  patches: readonly SourcePreservationPatch[],
): UntouchedRegionComparison {
  const sorted = normalizePatches(patches);
  if (!sorted.ok) {
    return {
      ok: false,
      checkedRegionCount: 0,
      mismatches: sorted.diagnostics.map((diagnostic) => ({
        originalOffset: diagnostic.offset ?? 0,
        nextOffset: diagnostic.offset ?? 0,
        expected: diagnostic.message,
        actual: '',
      })),
    };
  }

  const mismatches: UntouchedRegionComparison['mismatches'] = [];
  let checkedRegionCount = 0;
  let originalCursor = 0;
  let nextCursor = 0;

  for (const patch of sorted.patches) {
    const originalUntouched = originalSource.slice(originalCursor, patch.span.offset);
    const nextUntouched = nextSource.slice(nextCursor, nextCursor + originalUntouched.length);
    checkedRegionCount += 1;
    if (originalUntouched !== nextUntouched) {
      mismatches.push({
        originalOffset: originalCursor,
        nextOffset: nextCursor,
        expected: originalUntouched,
        actual: nextUntouched,
      });
    }
    originalCursor = patch.span.offset + patch.span.length;
    nextCursor += originalUntouched.length + patch.replacementSource.length;
  }

  const originalTail = originalSource.slice(originalCursor);
  const nextTail = nextSource.slice(nextCursor);
  checkedRegionCount += 1;
  if (originalTail !== nextTail) {
    mismatches.push({
      originalOffset: originalCursor,
      nextOffset: nextCursor,
      expected: originalTail,
      actual: nextTail,
    });
  }

  return {
    ok: mismatches.length === 0,
    checkedRegionCount,
    mismatches,
  };
}

export function sourcePreservationFeature(
  kind: string,
  code: string,
  message: string,
  path: readonly StructuredPathSegment[] = [],
  span: SourceSpan | null = null,
): SourcePreservationUnsupportedFeature {
  return {
    kind,
    code,
    message,
    path: [...path],
    pointer: pointerFromPath(path),
    displayPath: displayPathFromPath(path),
    span,
  };
}

export function visualWritesEnabledForSourcePreservationFormat(_format: SourcePreservationFormat): false {
  return false;
}

function normalizePatches(
  patches: readonly SourcePreservationPatch[],
): { ok: true; patches: SourcePreservationPatch[] } | { ok: false; diagnostics: FormatDiagnostic[] } {
  const sorted = [...patches].sort((left, right) => left.span.offset - right.span.offset);
  const diagnostics: FormatDiagnostic[] = [];
  let previousEnd = 0;
  for (const patch of sorted) {
    if (patch.span.offset < 0 || patch.span.length < 0) {
      diagnostics.push({
        severity: 'error',
        code: 'source-preservation-invalid-patch-span',
        message: 'Preservation patches must use non-negative source spans.',
        category: 'preservation',
        blocking: true,
        offset: patch.span.offset,
        length: patch.span.length,
      });
      continue;
    }
    if (patch.span.offset < previousEnd) {
      diagnostics.push({
        severity: 'error',
        code: 'source-preservation-overlapping-patches',
        message: 'Preservation patches must not overlap.',
        category: 'preservation',
        blocking: true,
        offset: patch.span.offset,
        length: patch.span.length,
      });
    }
    previousEnd = Math.max(previousEnd, patch.span.offset + patch.span.length);
  }
  return diagnostics.length === 0 ? { ok: true, patches: sorted } : { ok: false, diagnostics };
}

function utf8Bytes(sourceText: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(sourceText);
  const bytes: number[] = [];
  for (let index = 0; index < sourceText.length; index += 1) {
    const code = sourceText.charCodeAt(index);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return new Uint8Array(bytes);
}
