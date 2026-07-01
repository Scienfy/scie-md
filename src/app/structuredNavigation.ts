import type {
  DocumentFormat,
  FormatDiagnostic,
  ParsedDelimitedText,
  SourceSpan,
  StructuredNodeRef,
} from '@sciemd/core';
import type {
  JsonDocumentAnalysis,
  JsonlDocumentAnalysis,
  StructuredDocumentAnalysis,
  TabularDocumentAnalysis,
} from './formatDiagnostics';

export type StructuredNavigationItemKind =
  | 'node'
  | 'record'
  | 'row'
  | 'cell'
  | 'column'
  | 'diagnostic';

export interface StructuredNavigationSourceRange {
  from: number;
  to: number;
  line: number;
  displayPath: string;
}

export interface StructuredNavigationTarget {
  kind: StructuredNavigationItemKind;
  format: DocumentFormat;
  sourceRange: StructuredNavigationSourceRange | null;
  path?: string;
  pointer?: string;
  line?: number;
  recordIndex?: number;
  rowIndex?: number;
  columnIndex?: number;
  diagnosticCode?: string;
}

export interface StructuredNavigationItem {
  id: string;
  kind: StructuredNavigationItemKind;
  label: string;
  detail: string;
  level: number;
  target: StructuredNavigationTarget;
  severity?: FormatDiagnostic['severity'];
  searchText: string;
}

export interface StructuredNavigationIndex {
  format: DocumentFormat;
  title: string;
  summary: string;
  items: StructuredNavigationItem[];
  diagnostics: StructuredNavigationItem[];
  searchableItemCount: number;
  truncated: boolean;
}

export interface StructuredNavigationIndexOptions {
  format: DocumentFormat;
  diagnostics: readonly FormatDiagnostic[];
  jsonAnalysis?: JsonDocumentAnalysis | null;
  jsonlAnalysis?: JsonlDocumentAnalysis | null;
  structuredAnalysis?: StructuredDocumentAnalysis | null;
  tabularAnalysis?: TabularDocumentAnalysis | null;
}

const MAX_NAVIGATION_ITEMS = 1200;
const MAX_CELLS_PER_ROW = 8;

export function createStructuredNavigationIndex({
  format,
  diagnostics,
  jsonAnalysis = null,
  jsonlAnalysis = null,
  structuredAnalysis = null,
  tabularAnalysis = null,
}: StructuredNavigationIndexOptions): StructuredNavigationIndex | null {
  if (!isStructuredNavigationFormat(format)) return null;

  const items: StructuredNavigationItem[] = [];
  const addItem = (item: StructuredNavigationItem) => {
    if (items.length >= MAX_NAVIGATION_ITEMS) return;
    items.push(item);
  };

  if (format === 'json') {
    for (const node of jsonAnalysis?.parseResult.parsed?.sourceMap.nodes ?? []) {
      addItem(itemFromStructuredNode(format, node));
    }
  } else if (format === 'jsonl') {
    for (const line of jsonlAnalysis?.parseResult.parsed?.lines ?? []) {
      addItem({
        id: `jsonl-line:${line.line}`,
        kind: line.valid ? 'record' : 'diagnostic',
        label: line.valid ? `Record ${line.recordIndex === null ? line.line : line.recordIndex + 1}` : `Invalid line ${line.line}`,
        detail: line.valid
          ? jsonlRecordDetail(line.fieldNames, line.valueType)
          : line.diagnostic?.message ?? 'Invalid JSON Lines record',
        level: 0,
        severity: line.valid ? undefined : 'error',
        target: {
          kind: line.valid ? 'record' : 'diagnostic',
          format,
          line: line.line,
          recordIndex: line.recordIndex ?? undefined,
          diagnosticCode: line.diagnostic?.code,
          sourceRange: {
            from: line.offset,
            to: line.offset + Math.max(1, line.length),
            line: line.line,
            displayPath: `line ${line.line}`,
          },
        },
        searchText: searchable([`line ${line.line}`, line.preview, ...line.fieldNames]),
      });
    }
  } else if (format === 'csv' || format === 'tsv') {
    const parsed = tabularAnalysis?.parseResult.parsed;
    if (parsed) addTabularItems(format, parsed, addItem);
  } else {
    for (const node of structuredAnalysis?.parseResult.parsed?.sourceMap.nodes ?? []) {
      addItem(itemFromStructuredNode(format, node));
    }
  }

  const diagnosticItems = diagnosticNavigationItems(format, diagnostics, items.length);
  for (const diagnostic of diagnosticItems) addItem(diagnostic);

  const searchableItemCount = items.length;
  const truncated = items.length >= MAX_NAVIGATION_ITEMS;
  return {
    format,
    title: structuredNavigationTitle(format),
    summary: structuredNavigationSummary(format, items, diagnostics, truncated),
    items,
    diagnostics: items.filter((item) => item.kind === 'diagnostic'),
    searchableItemCount,
    truncated,
  };
}

export function structuredNavigationTargetKey(target: StructuredNavigationTarget | null | undefined): string | null {
  if (!target) return null;
  if (target.path) return `${target.format}:path:${target.path}`;
  if (target.line !== undefined) return `${target.format}:line:${target.line}`;
  if (target.rowIndex !== undefined && target.columnIndex !== undefined) {
    return `${target.format}:cell:${target.rowIndex}:${target.columnIndex}`;
  }
  if (target.rowIndex !== undefined) return `${target.format}:row:${target.rowIndex}`;
  if (target.columnIndex !== undefined) return `${target.format}:column:${target.columnIndex}`;
  if (target.sourceRange) return `${target.format}:source:${target.sourceRange.from}:${target.sourceRange.to}`;
  return null;
}

function itemFromStructuredNode(format: DocumentFormat, node: StructuredNodeRef): StructuredNavigationItem {
  const label = labelForStructuredNode(node);
  const detailParts = [
    node.displayPath,
    node.type,
    node.childCount !== undefined && node.childCount > 0 ? `${node.childCount} ${node.childCount === 1 ? 'child' : 'children'}` : '',
    node.lossy ? 'read-only projection' : '',
  ].filter(Boolean);
  return {
    id: `${format}:node:${node.pointer || '$'}`,
    kind: 'node',
    label,
    detail: detailParts.join(' · '),
    level: node.path.length,
    target: {
      kind: 'node',
      format,
      path: node.displayPath,
      pointer: node.pointer,
      sourceRange: sourceRangeFromSpan(node.span ?? node.valueSpan ?? null, node.displayPath),
    },
    searchText: searchable([label, node.displayPath, node.pointer, node.type]),
  };
}

function addTabularItems(
  format: Extract<DocumentFormat, 'csv' | 'tsv'>,
  parsed: ParsedDelimitedText,
  addItem: (item: StructuredNavigationItem) => void,
): void {
  const headerSourceRow = parsed.header.hasHeader ? parsed.sourceRows[0] : null;
  parsed.header.names.forEach((name, columnIndex) => {
    const cell = headerSourceRow?.cells[columnIndex] ?? null;
    addItem({
      id: `${format}:column:${columnIndex}`,
      kind: 'column',
      label: name || `Column ${columnIndex + 1}`,
      detail: `Column ${columnIndex + 1}${parsed.columns[columnIndex]?.types.length ? ` · ${parsed.columns[columnIndex].types.join(', ')}` : ''}`,
      level: 0,
      target: {
        kind: 'column',
        format,
        columnIndex,
        sourceRange: sourceRangeFromDelimitedSpan(cell?.span ?? null, name || `Column ${columnIndex + 1}`),
      },
      searchText: searchable([name, `column ${columnIndex + 1}`, parsed.columns[columnIndex]?.types.join(' ')]),
    });
  });

  parsed.dataRows.forEach((row, dataRowIndex) => {
    const sourceRowIndex = parsed.header.hasHeader ? dataRowIndex + 1 : dataRowIndex;
    const sourceRow = parsed.sourceRows[sourceRowIndex] ?? null;
    const label = `Row ${dataRowIndex + 1}`;
    const rowPreview = row.slice(0, 4).filter(Boolean).join(' · ');
    addItem({
      id: `${format}:row:${dataRowIndex}`,
      kind: 'row',
      label,
      detail: rowPreview || `${parsed.columnCount} ${parsed.columnCount === 1 ? 'cell' : 'cells'}`,
      level: 0,
      target: {
        kind: 'row',
        format,
        rowIndex: dataRowIndex,
        sourceRange: sourceRangeFromDelimitedSpan(sourceRow?.span ?? null, label),
      },
      searchText: searchable([label, rowPreview, ...row]),
    });

    row.slice(0, MAX_CELLS_PER_ROW).forEach((value, columnIndex) => {
      const header = parsed.header.names[columnIndex] || `Column ${columnIndex + 1}`;
      const cell = sourceRow?.cells[columnIndex] ?? null;
      addItem({
        id: `${format}:cell:${dataRowIndex}:${columnIndex}`,
        kind: 'cell',
        label: header,
        detail: value || '(empty)',
        level: 1,
        target: {
          kind: 'cell',
          format,
          rowIndex: dataRowIndex,
          columnIndex,
          sourceRange: sourceRangeFromDelimitedSpan(cell?.valueSpan ?? cell?.span ?? null, `${label}, ${header}`),
        },
        searchText: searchable([label, header, value, `row ${dataRowIndex + 1}`, `column ${columnIndex + 1}`]),
      });
    });
  });
}

function diagnosticNavigationItems(
  format: DocumentFormat,
  diagnostics: readonly FormatDiagnostic[],
  idOffset: number,
): StructuredNavigationItem[] {
  return diagnostics.map((diagnostic, index) => {
    const displayPath = diagnostic.displayPath
      ?? (diagnostic.path ? `$${diagnostic.path.map((segment) => typeof segment === 'number' ? `[${segment}]` : `.${segment}`).join('')}` : null)
      ?? (diagnostic.line ? `line ${diagnostic.line}` : diagnostic.code);
    const span = diagnostic.span
      ?? (diagnostic.offset !== undefined ? {
        offset: diagnostic.offset,
        length: Math.max(1, diagnostic.length ?? 1),
        line: diagnostic.line ?? 1,
        column: diagnostic.column ?? 1,
      } : null);
    return {
      id: `${format}:diagnostic:${idOffset + index}:${diagnostic.code}`,
      kind: 'diagnostic',
      label: diagnostic.severity === 'error' ? 'Error' : diagnostic.severity === 'warning' ? 'Warning' : 'Info',
      detail: `${diagnostic.code}: ${diagnostic.message}`,
      level: 0,
      severity: diagnostic.severity,
      target: {
        kind: 'diagnostic',
        format,
        path: diagnostic.displayPath,
        pointer: diagnostic.pointer,
        line: diagnostic.line,
        diagnosticCode: diagnostic.code,
        sourceRange: sourceRangeFromSpan(span, displayPath),
      },
      searchText: searchable([diagnostic.code, diagnostic.message, diagnostic.severity, displayPath]),
    };
  });
}

function sourceRangeFromSpan(span: SourceSpan | null, displayPath: string): StructuredNavigationSourceRange | null {
  if (!span) return null;
  return {
    from: span.offset,
    to: span.offset + Math.max(1, span.length),
    line: span.line,
    displayPath,
  };
}

function sourceRangeFromDelimitedSpan(
  span: { offset: number; length: number; line: number } | null,
  displayPath: string,
): StructuredNavigationSourceRange | null {
  if (!span) return null;
  return {
    from: span.offset,
    to: span.offset + Math.max(1, span.length),
    line: span.line,
    displayPath,
  };
}

function labelForStructuredNode(node: StructuredNodeRef): string {
  if (node.path.length === 0) return 'root';
  const segment = node.path.at(-1);
  return typeof segment === 'number' ? `[${segment}]` : String(segment);
}

function jsonlRecordDetail(fields: readonly string[], type: string | null): string {
  if (fields.length > 0) return fields.slice(0, 5).join(', ');
  return type ?? 'record';
}

function structuredNavigationTitle(format: DocumentFormat): string {
  if (format === 'jsonl') return 'JSONL structure';
  if (format === 'csv') return 'CSV structure';
  if (format === 'tsv') return 'TSV structure';
  return `${format.toUpperCase()} structure`;
}

function structuredNavigationSummary(
  format: DocumentFormat,
  items: readonly StructuredNavigationItem[],
  diagnostics: readonly FormatDiagnostic[],
  truncated: boolean,
): string {
  const base = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
  const diagnosticText = diagnostics.length > 0
    ? ` · ${diagnostics.length} diagnostic${diagnostics.length === 1 ? '' : 's'}`
    : '';
  const truncationText = truncated ? ' · sampled' : '';
  return `${base}${diagnosticText}${truncationText} · ${format.toUpperCase()}`;
}

function searchable(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function isStructuredNavigationFormat(format: DocumentFormat): boolean {
  return format === 'json'
    || format === 'jsonl'
    || format === 'yaml'
    || format === 'toml'
    || format === 'xml'
    || format === 'csv'
    || format === 'tsv';
}
