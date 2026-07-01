import type {
  StructuredNodeRef,
  StructuredPathSegment,
  StructuredSourceMap,
  StructuredValueType,
} from '../documentFormat.js';
import {
  displayPathFromPath,
  pointerFromPath,
  structuredValueType,
} from '../structured/sourceMap.js';

export const JSON_ARRAY_TABLE_ROW_BUDGET = 50;
export const JSON_ARRAY_TABLE_COLUMN_BUDGET = 8;
export const JSON_ARRAY_CARD_COLUMN_BUDGET = 24;

export type JsonArrayTableViewMode = 'table' | 'cards';
export type JsonArrayTableCandidateReason = 'selected' | 'top-level' | 'direct-child';
export type JsonArrayTableCellType = StructuredValueType | 'missing';

export interface JsonArrayTableModelOptions {
  selectedPath?: string | null;
  maxRows?: number;
  maxTableColumns?: number;
  maxCardColumns?: number;
  viewMode?: JsonArrayTableViewMode;
}

export interface JsonArrayTableColumn {
  key: string;
  label: string;
  index: number;
  presentCount: number;
  missingCount: number;
  scalarCount: number;
  complexCount: number;
  types: JsonArrayTableCellType[];
  editable: boolean;
}

export interface JsonArrayTableCell {
  rowIndex: number;
  columnKey: string;
  path: StructuredPathSegment[];
  pointer: string;
  displayPath: string;
  sourceRef: StructuredNodeRef | null;
  value: unknown;
  type: JsonArrayTableCellType;
  preview: string;
  editable: boolean;
  missing: boolean;
  unsupportedReason?: string;
}

export interface JsonArrayTableRow {
  index: number;
  path: StructuredPathSegment[];
  pointer: string;
  displayPath: string;
  sourceRef: StructuredNodeRef | null;
  value: Record<string, unknown>;
  cells: JsonArrayTableCell[];
}

export interface JsonArrayTableModel {
  arrayPath: StructuredPathSegment[];
  pointer: string;
  displayPath: string;
  sourceRef: StructuredNodeRef | null;
  reason: JsonArrayTableCandidateReason;
  rowCount: number;
  columnCount: number;
  rowLimit: number;
  tableColumnLimit: number;
  cardColumnLimit: number;
  hiddenRowCount: number;
  hiddenColumnCount: number;
  viewMode: JsonArrayTableViewMode;
  columns: JsonArrayTableColumn[];
  visibleColumns: JsonArrayTableColumn[];
  rows: JsonArrayTableRow[];
}

export function createJsonArrayTableModel(
  value: unknown,
  sourceMap: StructuredSourceMap | null = null,
  options: JsonArrayTableModelOptions = {},
): JsonArrayTableModel | null {
  const maxRows = Math.max(1, options.maxRows ?? JSON_ARRAY_TABLE_ROW_BUDGET);
  const maxTableColumns = Math.max(1, options.maxTableColumns ?? JSON_ARRAY_TABLE_COLUMN_BUDGET);
  const maxCardColumns = Math.max(maxTableColumns, options.maxCardColumns ?? JSON_ARRAY_CARD_COLUMN_BUDGET);
  const candidate = selectJsonArrayTableCandidate(value, sourceMap, options.selectedPath ?? null);
  if (!candidate) return null;

  return buildJsonArrayTableModel({
    value: candidate.value,
    arrayPath: candidate.path,
    sourceMap,
    reason: candidate.reason,
    maxRows,
    maxTableColumns,
    maxCardColumns,
    viewMode: options.viewMode,
  });
}

export function jsonArrayTableToTsvPreview(model: JsonArrayTableModel): string {
  const lines = [
    model.columns.map((column) => tsvCell(column.label)).join('\t'),
    ...model.rows.map((row) => (
      model.columns
        .map((column) => tsvCell(cellForColumn(row, column.key)?.preview ?? ''))
        .join('\t')
    )),
  ];
  return `${lines.join('\n')}\n`;
}

export function jsonArrayTableCellClipboardValue(cell: JsonArrayTableCell): string {
  if (cell.missing) return '';
  if (cell.type === 'string') return String(cell.value);
  if (cell.type === 'number' || cell.type === 'boolean') return String(cell.value);
  if (cell.type === 'null') return 'null';
  return JSON.stringify(cell.value, null, 2) ?? '';
}

function selectJsonArrayTableCandidate(
  value: unknown,
  sourceMap: StructuredSourceMap | null,
  selectedPath: string | null,
): { value: unknown[]; path: StructuredPathSegment[]; reason: JsonArrayTableCandidateReason } | null {
  const selectedSourcePath = selectedPathFromSourceMap(sourceMap, selectedPath);
  if (selectedSourcePath) {
    for (let length = selectedSourcePath.length; length >= 0; length -= 1) {
      const path = selectedSourcePath.slice(0, length);
      const candidate = valueAtPath(value, path);
      if (isObjectRecordArray(candidate)) {
        return { value: candidate, path, reason: 'selected' };
      }
    }
  }

  if (isObjectRecordArray(value)) {
    return { value, path: [], reason: 'top-level' };
  }

  const directChild = largestDirectChildObjectArray(value);
  return directChild
    ? { ...directChild, reason: 'direct-child' }
    : null;
}

function buildJsonArrayTableModel({
  value,
  arrayPath,
  sourceMap,
  reason,
  maxRows,
  maxTableColumns,
  maxCardColumns,
  viewMode: preferredViewMode,
}: {
  value: unknown[];
  arrayPath: StructuredPathSegment[];
  sourceMap: StructuredSourceMap | null;
  reason: JsonArrayTableCandidateReason;
  maxRows: number;
  maxTableColumns: number;
  maxCardColumns: number;
  viewMode?: JsonArrayTableViewMode;
}): JsonArrayTableModel | null {
  const rows = value.filter(isPlainObject);
  if (rows.length !== value.length || rows.length === 0) return null;

  const columnKeys = columnUnion(rows);
  if (columnKeys.length === 0) return null;

  const viewMode: JsonArrayTableViewMode = preferredViewMode ?? (columnKeys.length > maxTableColumns ? 'cards' : 'table');
  const visibleColumnKeys = columnKeys.slice(0, viewMode === 'cards' ? maxCardColumns : maxTableColumns);
  const visibleRows = rows.slice(0, maxRows);
  const columns = columnKeys.map((key, index) => buildColumn(key, index, rows, sourceMap, arrayPath));
  const visibleColumnSet = new Set(visibleColumnKeys);
  const renderedColumns = columns.filter((column) => visibleColumnSet.has(column.key));
  const arrayPointer = pointerFromPath(arrayPath);

  return {
    arrayPath,
    pointer: arrayPointer,
    displayPath: displayPathFromPath(arrayPath),
    sourceRef: sourceMap?.nodesByPointer[arrayPointer] ?? null,
    reason,
    rowCount: rows.length,
    columnCount: columns.length,
    rowLimit: maxRows,
    tableColumnLimit: maxTableColumns,
    cardColumnLimit: maxCardColumns,
    hiddenRowCount: Math.max(0, rows.length - visibleRows.length),
    hiddenColumnCount: Math.max(0, columns.length - renderedColumns.length),
    viewMode,
    columns,
    visibleColumns: renderedColumns,
    rows: visibleRows.map((row, index) => buildRow(row, index, arrayPath, columns, sourceMap)),
  };
}

function buildColumn(
  key: string,
  index: number,
  rows: readonly Record<string, unknown>[],
  sourceMap: StructuredSourceMap | null,
  arrayPath: readonly StructuredPathSegment[],
): JsonArrayTableColumn {
  let presentCount = 0;
  let scalarCount = 0;
  let complexCount = 0;
  let editableCount = 0;
  const types = new Set<JsonArrayTableCellType>();

  rows.forEach((row, rowIndex) => {
    if (!Object.prototype.hasOwnProperty.call(row, key)) {
      types.add('missing');
      return;
    }
    presentCount += 1;
    const value = row[key];
    const type = structuredValueType(value);
    types.add(type);
    if (isJsonScalar(value)) {
      scalarCount += 1;
      const path = [...arrayPath, rowIndex, key];
      const sourceRef = sourceMap?.nodesByPointer[pointerFromPath(path)] ?? null;
      if (sourceRef?.editable && !sourceRef.lossy) editableCount += 1;
    } else {
      complexCount += 1;
    }
  });

  return {
    key,
    label: key,
    index,
    presentCount,
    missingCount: rows.length - presentCount,
    scalarCount,
    complexCount,
    types: Array.from(types).sort(typeSort),
    editable: editableCount > 0 && editableCount === scalarCount && complexCount === 0,
  };
}

function buildRow(
  row: Record<string, unknown>,
  index: number,
  arrayPath: readonly StructuredPathSegment[],
  columns: readonly JsonArrayTableColumn[],
  sourceMap: StructuredSourceMap | null,
): JsonArrayTableRow {
  const rowPath = [...arrayPath, index];
  const rowPointer = pointerFromPath(rowPath);
  return {
    index,
    path: rowPath,
    pointer: rowPointer,
    displayPath: displayPathFromPath(rowPath),
    sourceRef: sourceMap?.nodesByPointer[rowPointer] ?? null,
    value: row,
    cells: columns.map((column) => buildCell(row, index, arrayPath, column.key, sourceMap)),
  };
}

function buildCell(
  row: Record<string, unknown>,
  rowIndex: number,
  arrayPath: readonly StructuredPathSegment[],
  columnKey: string,
  sourceMap: StructuredSourceMap | null,
): JsonArrayTableCell {
  const path = [...arrayPath, rowIndex, columnKey];
  const pointer = pointerFromPath(path);
  const sourceRef = sourceMap?.nodesByPointer[pointer] ?? null;
  const missing = !Object.prototype.hasOwnProperty.call(row, columnKey);
  const value = missing ? undefined : row[columnKey];
  const type = missing ? 'missing' : structuredValueType(value);
  const scalar = isJsonScalar(value);
  const editable = Boolean(!missing && scalar && sourceRef?.editable && !sourceRef.lossy);
  return {
    rowIndex,
    columnKey,
    path,
    pointer,
    displayPath: displayPathFromPath(path),
    sourceRef,
    value,
    type,
    preview: missing ? '' : previewJsonCell(value),
    editable,
    missing,
    unsupportedReason: missing
      ? 'This row does not contain this field.'
      : scalar
        ? sourceRef?.unsupportedReason
        : 'Nested objects and arrays are copy/reveal only in the table surface.',
  };
}

function selectedPathFromSourceMap(
  sourceMap: StructuredSourceMap | null,
  selectedPath: string | null,
): StructuredPathSegment[] | null {
  if (!sourceMap || !selectedPath) return null;
  const node = sourceMap.nodesByDisplayPath[selectedPath] ?? sourceMap.nodesByPointer[selectedPath] ?? null;
  return node ? [...node.path] : null;
}

function valueAtPath(value: unknown, path: readonly StructuredPathSegment[]): unknown {
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === 'number') {
      current = current[segment];
    } else if (isPlainObject(current) && typeof segment === 'string') {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function largestDirectChildObjectArray(value: unknown): { value: unknown[]; path: StructuredPathSegment[] } | null {
  if (!isPlainObject(value)) return null;
  let best: { value: unknown[]; path: StructuredPathSegment[] } | null = null;
  for (const [key, child] of Object.entries(value)) {
    if (!isObjectRecordArray(child)) continue;
    if (!best || child.length > best.value.length) best = { value: child, path: [key] };
  }
  return best;
}

function isObjectRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0 && value.every(isPlainObject);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isJsonScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function columnUnion(rows: readonly Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

function cellForColumn(row: JsonArrayTableRow, columnKey: string): JsonArrayTableCell | null {
  return row.cells.find((cell) => cell.columnKey === columnKey) ?? null;
}

function previewJsonCell(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value) ?? '';
}

function tsvCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ').trim();
}

function typeSort(left: JsonArrayTableCellType, right: JsonArrayTableCellType): number {
  return typeRank(left) - typeRank(right) || left.localeCompare(right);
}

function typeRank(type: JsonArrayTableCellType): number {
  switch (type) {
    case 'string':
      return 1;
    case 'number':
      return 2;
    case 'boolean':
      return 3;
    case 'null':
      return 4;
    case 'object':
      return 5;
    case 'array':
      return 6;
    case 'missing':
      return 7;
  }
}
