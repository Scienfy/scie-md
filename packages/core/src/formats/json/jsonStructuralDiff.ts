import { applyEdits, modify, type Edit as JsoncEdit, type JSONPath } from 'jsonc-parser';
import type {
  FormatDiagnostic,
  SourceSpan,
  StructuredPathSegment,
  StructuredSourceMap,
} from '../documentFormat.js';
import {
  displayPathFromPath,
  pointerFromPath,
} from '../structured/sourceMap.js';
import { createJsonContent, parseJsonDocument, type ParsedJsonDocument } from './parseJsonDocument.js';
import { jsonFormattingPolicyForSource, replaceJsonValueAtPathWithRawSource, type JsonTextEdit } from './jsonEdits.js';

export type JsonStructuralChangeKind = 'added' | 'removed' | 'changed';
export type JsonStructuralReviewStatus = 'ready' | 'fallback';

export interface JsonStructuralDiffEntry {
  id: string;
  kind: JsonStructuralChangeKind;
  path: StructuredPathSegment[];
  pointer: string;
  displayPath: string;
  baseType: string;
  currentType: string;
  diskType: string;
  basePreview: string;
  currentPreview: string;
  diskPreview: string;
  diskValue: unknown;
  diskRawValue: string | null;
  baseSpan: SourceSpan | null;
  currentSpan: SourceSpan | null;
  diskSpan: SourceSpan | null;
  conflict: boolean;
  warnings: string[];
}

export interface JsonStructuralReviewPlan {
  status: JsonStructuralReviewStatus;
  baseSource: string;
  currentSource: string;
  diskSource: string;
  entries: JsonStructuralDiffEntry[];
  diagnostics: FormatDiagnostic[];
  fallbackReason?: string;
}

export interface JsonStructuralReviewApplyResult {
  ok: boolean;
  nextSource?: string;
  diagnostics: FormatDiagnostic[];
  unsupportedReason?: string;
}

interface JsonStructuralRawChange {
  kind: JsonStructuralChangeKind;
  path: StructuredPathSegment[];
}

interface ParsedStrictJson {
  parsed: ParsedJsonDocument;
  diagnostics: FormatDiagnostic[];
}

export function createJsonStructuralReview(
  baseSource: string,
  currentSource: string,
  diskSource: string,
): JsonStructuralReviewPlan {
  const base = parseStrictJsonForReview('base', baseSource);
  const current = parseStrictJsonForReview('current', currentSource);
  const disk = parseStrictJsonForReview('disk', diskSource);
  const diagnostics = [
    ...base.diagnostics,
    ...current.diagnostics,
    ...disk.diagnostics,
  ];

  const baseParsed = base.parsed;
  const currentParsed = current.parsed;
  const diskParsed = disk.parsed;
  if (!baseParsed || !currentParsed || !diskParsed) {
    return fallbackReviewPlan(
      baseSource,
      currentSource,
      diskSource,
      'Both current and disk JSON must parse before structural review is available.',
      diagnostics,
    );
  }

  const duplicateDiagnostics = diagnostics.filter((diagnostic) => diagnostic.code === 'json-duplicate-key');
  if (duplicateDiagnostics.length > 0) {
    return fallbackReviewPlan(
      baseSource,
      currentSource,
      diskSource,
      'Resolve duplicate JSON object keys before using path-level structural review.',
      duplicateDiagnostics,
    );
  }

  const diskChanges = collectJsonStructuralChanges(baseParsed.value, diskParsed.value, []);
  const currentChanges = collectJsonStructuralChanges(baseParsed.value, currentParsed.value, []);
  const entries = diskChanges.map((change, index) => createDiffEntry({
    index,
    change,
    base: baseParsed,
    current: currentParsed,
    disk: diskParsed,
    diskSource,
    currentChanges,
  }));

  return {
    status: 'ready',
    baseSource,
    currentSource,
    diskSource,
    entries,
    diagnostics,
  };
}

export function applyJsonStructuralReviewDecisions(
  review: JsonStructuralReviewPlan,
  rejectedDiskChangeIds: ReadonlySet<string>,
): JsonStructuralReviewApplyResult {
  if (review.status !== 'ready') {
    return unsupportedApplyResult(
      review.fallbackReason ?? 'JSON structural review is not available for this conflict.',
    );
  }

  const acceptedEntries = review.entries.filter((entry) => !rejectedDiskChangeIds.has(entry.id));
  if (acceptedEntries.length === 0) {
    return {
      ok: true,
      nextSource: review.currentSource,
      diagnostics: [],
    };
  }

  const current = parseStrictJsonForReview('current', review.currentSource);
  if (!current.parsed) {
    return unsupportedApplyResult('Current JSON changed and no longer parses before structural review could be applied.');
  }

  let nextSource = review.currentSource;
  for (const entry of sortEntriesForApply(acceptedEntries)) {
    const editResult = applyStructuralEntry(nextSource, entry);
    if (!editResult.ok) return editResult;
    if (editResult.nextSource === undefined) {
      return unsupportedApplyResult('Structural review did not produce updated JSON source.');
    }
    nextSource = editResult.nextSource;
  }

  const next = parseStrictJsonForReview('current', nextSource);
  if (!next.parsed) {
    return unsupportedApplyResult('Structural review was rejected because the merged JSON would not parse.');
  }

  return {
    ok: true,
    nextSource,
    diagnostics: next.diagnostics,
  };
}

function parseStrictJsonForReview(label: 'base' | 'current' | 'disk', source: string): {
  parsed: ParsedStrictJson['parsed'] | null;
  diagnostics: FormatDiagnostic[];
} {
  const result = parseJsonDocument(createJsonContent(source));
  const diagnostics = result.diagnostics.map((diagnostic) => ({
    ...diagnostic,
    code: diagnostic.code === 'json-duplicate-key'
      ? diagnostic.code
      : `json-review-${label}-${diagnostic.code}`,
    message: `${sourceLabel(label)}: ${diagnostic.message}`,
  }));
  return {
    parsed: result.parsed,
    diagnostics,
  };
}

function collectJsonStructuralChanges(
  before: unknown,
  after: unknown,
  path: StructuredPathSegment[],
): JsonStructuralRawChange[] {
  if (jsonValueType(before) !== jsonValueType(after)) {
    return [{ kind: 'changed', path }];
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const changes: JsonStructuralRawChange[] = [];
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      if (index >= before.length) {
        changes.push({ kind: 'added', path: [...path, index] });
      } else if (index >= after.length) {
        changes.push({ kind: 'removed', path: [...path, index] });
      } else {
        changes.push(...collectJsonStructuralChanges(before[index], after[index], [...path, index]));
      }
    }
    return changes;
  }

  if (isRecord(before) && isRecord(after)) {
    const changes: JsonStructuralRawChange[] = [];
    const beforeKeys = new Set(Object.keys(before));
    const afterKeys = new Set(Object.keys(after));
    const keys = Array.from(new Set([...beforeKeys, ...afterKeys])).sort((left, right) => left.localeCompare(right));
    for (const key of keys) {
      if (!beforeKeys.has(key)) {
        changes.push({ kind: 'added', path: [...path, key] });
      } else if (!afterKeys.has(key)) {
        changes.push({ kind: 'removed', path: [...path, key] });
      } else {
        changes.push(...collectJsonStructuralChanges(before[key], after[key], [...path, key]));
      }
    }
    return changes;
  }

  return scalarValuesEqual(before, after) ? [] : [{ kind: 'changed', path }];
}

function createDiffEntry({
  index,
  change,
  base,
  current,
  disk,
  diskSource,
  currentChanges,
}: {
  index: number;
  change: JsonStructuralRawChange;
  base: ParsedJsonDocument;
  current: ParsedJsonDocument;
  disk: ParsedJsonDocument;
  diskSource: string;
  currentChanges: JsonStructuralRawChange[];
}): JsonStructuralDiffEntry {
  const baseValue = valueAtPath(base.value, change.path);
  const currentValue = valueAtPath(current.value, change.path);
  const diskValue = valueAtPath(disk.value, change.path);
  const pointer = pointerFromPath(change.path);
  const displayPath = displayPathFromPath(change.path);
  const diskSpan = spanForPath(disk.sourceMap, pointer);
  const conflict = currentChanges.some((currentChange) => pathsOverlap(currentChange.path, change.path));
  const warnings = change.path.some((segment) => typeof segment === 'number')
    ? ['Array changes are reviewed by numeric index; confirm the item still means the same record before accepting disk.']
    : [];

  return {
    id: `json-change-${index + 1}-${pointer || 'root'}`,
    kind: change.kind,
    path: [...change.path],
    pointer,
    displayPath,
    baseType: jsonValueType(baseValue),
    currentType: jsonValueType(currentValue),
    diskType: jsonValueType(diskValue),
    basePreview: previewJsonValue(baseValue),
    currentPreview: previewJsonValue(currentValue),
    diskPreview: previewJsonValue(diskValue),
    diskValue,
    diskRawValue: change.kind === 'removed'
      ? null
      : rawDiskValueForEntry(diskSource, diskSpan, change.path),
    baseSpan: spanForPath(base.sourceMap, pointer),
    currentSpan: spanForPath(current.sourceMap, pointer),
    diskSpan,
    conflict,
    warnings,
  };
}

function applyStructuralEntry(source: string, entry: JsonStructuralDiffEntry): JsonStructuralReviewApplyResult {
  if (entry.path.length === 0) {
    if (!entry.diskRawValue) {
      return unsupportedApplyResult('Cannot safely accept the root JSON disk value because its raw source span is unavailable.');
    }
    return {
      ok: true,
      nextSource: entry.diskRawValue,
      diagnostics: [],
    };
  }

  const current = parseStrictJsonForReview('current', source);
  if (!current.parsed) {
    return unsupportedApplyResult('Current JSON changed and no longer parses while applying structural review.');
  }
  const parentPath = entry.path.slice(0, -1);
  const parentValue = valueAtPath(current.parsed.value, parentPath);
  if (parentValue === undefined || parentValue === null || typeof parentValue !== 'object') {
    return unsupportedApplyResult(`Cannot safely apply ${entry.displayPath} because its parent path is missing in current JSON.`);
  }

  const options = {
    formattingOptions: jsonFormattingPolicyForSource(source),
    isArrayInsertion: entry.kind === 'added' && Array.isArray(parentValue) && typeof entry.path.at(-1) === 'number',
  };
  try {
    const editPlan = entry.kind === 'removed'
      ? { edits: toJsonTextEdits(modify(source, entry.path as JSONPath, undefined, options)) }
      : entry.diskRawValue
        ? replaceJsonValueAtPathWithRawSource(source, entry.path as JSONPath, entry.diskRawValue, options)
        : { edits: [], unsupportedReason: `Cannot safely apply ${entry.displayPath} because the disk raw source span is unavailable.` };
    if (editPlan.unsupportedReason) return unsupportedApplyResult(editPlan.unsupportedReason);
    return {
      ok: true,
      nextSource: applyEdits(source, editPlan.edits),
      diagnostics: [],
    };
  } catch (error) {
    return unsupportedApplyResult(error instanceof Error ? error.message : 'Could not apply structural JSON change.');
  }
}

function sortEntriesForApply(entries: readonly JsonStructuralDiffEntry[]): JsonStructuralDiffEntry[] {
  return [...entries].sort((left, right) => {
    const priority = operationPriority(left.kind) - operationPriority(right.kind);
    if (priority !== 0) return priority;
    return comparePathsForApply(left.path, right.path, left.kind === 'removed');
  });
}

function operationPriority(kind: JsonStructuralChangeKind): number {
  if (kind === 'removed') return 0;
  if (kind === 'changed') return 1;
  return 2;
}

function comparePathsForApply(
  left: readonly StructuredPathSegment[],
  right: readonly StructuredPathSegment[],
  descending: boolean,
): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftSegment = left[index];
    const rightSegment = right[index];
    if (leftSegment === undefined) return descending ? 1 : -1;
    if (rightSegment === undefined) return descending ? -1 : 1;
    if (leftSegment === rightSegment) continue;
    if (typeof leftSegment === 'number' && typeof rightSegment === 'number') {
      return descending ? rightSegment - leftSegment : leftSegment - rightSegment;
    }
    return String(leftSegment).localeCompare(String(rightSegment)) * (descending ? -1 : 1);
  }
  return 0;
}

function fallbackReviewPlan(
  baseSource: string,
  currentSource: string,
  diskSource: string,
  fallbackReason: string,
  diagnostics: FormatDiagnostic[],
): JsonStructuralReviewPlan {
  return {
    status: 'fallback',
    baseSource,
    currentSource,
    diskSource,
    entries: [],
    diagnostics,
    fallbackReason,
  };
}

function unsupportedApplyResult(reason: string): JsonStructuralReviewApplyResult {
  return {
    ok: false,
    diagnostics: [{
      severity: 'warning',
      code: 'json-structural-review-unavailable',
      message: reason,
      source: 'json',
      category: 'edit',
      blocking: true,
    }],
    unsupportedReason: reason,
  };
}

function spanForPath(sourceMap: StructuredSourceMap, pointer: string): SourceSpan | null {
  const node = sourceMap.nodesByPointer[pointer] ?? null;
  return node?.valueSpan ?? node?.span ?? null;
}

function rawDiskValueForEntry(
  diskSource: string,
  diskSpan: SourceSpan | null,
  path: readonly StructuredPathSegment[],
): string | null {
  if (path.length === 0) return diskSource;
  if (!diskSpan) return null;
  return diskSource.slice(diskSpan.offset, diskSpan.offset + diskSpan.length);
}

function pathsOverlap(left: readonly StructuredPathSegment[], right: readonly StructuredPathSegment[]): boolean {
  return pathStartsWith(left, right) || pathStartsWith(right, left);
}

function pathStartsWith(path: readonly StructuredPathSegment[], prefix: readonly StructuredPathSegment[]): boolean {
  if (prefix.length > path.length) return false;
  return prefix.every((segment, index) => segment === path[index]);
}

function valueAtPath(value: unknown, path: readonly StructuredPathSegment[]): unknown {
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === 'number') {
      current = current[segment];
    } else if (isRecord(current) && typeof segment === 'string') {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function jsonValueType(value: unknown): string {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function previewJsonValue(value: unknown): string {
  if (value === undefined) return 'missing';
  const raw = JSON.stringify(value);
  if (raw === undefined) return String(value);
  return raw.length > 120 ? `${raw.slice(0, 117)}...` : raw;
}

function scalarValuesEqual(left: unknown, right: unknown): boolean {
  return Object.is(left, right);
}

function sourceLabel(label: 'base' | 'current' | 'disk'): string {
  if (label === 'base') return 'Last saved JSON';
  if (label === 'current') return 'Current JSON';
  return 'Disk JSON';
}

function toJsonTextEdits(edits: JsoncEdit[]): JsonTextEdit[] {
  return edits.map((edit) => ({
    offset: edit.offset,
    length: edit.length,
    content: edit.content,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
