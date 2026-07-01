import type { FormatDiagnostic, FormatDiagnosticCategory, FormatDiagnosticSeverity } from '../documentFormat.js';
import { createStructuredPreviewPageInfo, type StructuredPreviewPageInfo } from '../structured/structuredPaging.js';

export type DelimitedTextDelimiter = ',' | '\t' | ';';
export type DelimitedTextHeaderMode = 'infer' | 'present' | 'absent';
export type DelimitedTextConversionFormat = 'markdown' | 'json' | 'jsonl' | 'yaml' | 'toml';
export type DelimitedTextCellType = 'empty' | 'string' | 'number' | 'boolean' | 'date';

export interface DelimitedTextParseOptions {
  delimiter?: DelimitedTextDelimiter;
  header?: DelimitedTextHeaderMode;
  maxRows?: number;
  maxScanRows?: number;
}

export interface DelimitedTextHeader {
  hasHeader: boolean;
  source: 'inferred' | 'provided' | 'generated';
  names: string[];
  jsonKeys: string[];
  emptyHeaders: number[];
  duplicateHeaders: string[];
}

export interface DelimitedTextColumnSummary {
  index: number;
  name: string;
  types: DelimitedTextCellType[];
  emptyCount: number;
  numericRiskCount: number;
  sampleValues: string[];
}

export interface DelimitedTextSourceSpan {
  offset: number;
  length: number;
  endOffset: number;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface DelimitedTextCellSource {
  rowIndex: number;
  columnIndex: number;
  value: string;
  quoted: boolean;
  span: DelimitedTextSourceSpan;
  valueSpan: DelimitedTextSourceSpan;
}

export interface DelimitedTextRowSource {
  rowIndex: number;
  cells: DelimitedTextCellSource[];
  span: DelimitedTextSourceSpan;
  lineEnding: '' | '\n' | '\r\n' | '\r';
}

export interface ParsedDelimitedText {
  delimiter: DelimitedTextDelimiter;
  delimiterLabel: string;
  delimiterAmbiguous: boolean;
  header: DelimitedTextHeader;
  rows: string[][];
  sourceRows: DelimitedTextRowSource[];
  dataRows: string[][];
  rowCount: number;
  dataRowCount: number;
  totalRowCount: number;
  totalRowCountIsEstimated: boolean;
  totalDataRowCount: number;
  totalDataRowCountIsEstimated: boolean;
  parsedRowCount: number;
  parsedDataRowCount: number;
  columnCount: number;
  cellCount: number;
  previewTruncated: boolean;
  maxRows: number;
  scannedRowCount: number;
  scanRowLimit: number;
  previewPageInfo: StructuredPreviewPageInfo;
  columns: DelimitedTextColumnSummary[];
  diagnostics: FormatDiagnostic[];
}

export interface DelimitedTextConversionResult {
  format: DelimitedTextConversionFormat;
  label: string;
  content: string;
  diagnostics: FormatDiagnostic[];
}

export interface DelimitedTextConversionPreview {
  parsed: ParsedDelimitedText;
  markdown: DelimitedTextConversionResult;
  json: DelimitedTextConversionResult;
  jsonl: DelimitedTextConversionResult;
  yaml: DelimitedTextConversionResult;
  toml: DelimitedTextConversionResult;
}

interface ParsedRows {
  rows: string[][];
  sourceRows: DelimitedTextRowSource[];
  diagnostics: FormatDiagnostic[];
  scanLimited: boolean;
  scannedRowCount: number;
  scanRowLimit: number;
}

interface DelimiterScore {
  delimiter: DelimitedTextDelimiter;
  parsed: ParsedRows;
  width: number;
  consistentRows: number;
  nonEmptyRows: number;
  score: number;
}

const DELIMITER_CANDIDATES: DelimitedTextDelimiter[] = ['\t', ',', ';'];
export const TABULAR_DELIMITER_SAMPLE_ROW_LIMIT = 80;
export const TABULAR_PARSE_ROW_SCAN_LIMIT = 1000;

export function parseDelimitedText(text: string, options: DelimitedTextParseOptions = {}): ParsedDelimitedText {
  const maxRows = Math.max(1, options.maxRows ?? Number.MAX_SAFE_INTEGER);
  const scanRowLimit = Math.max(1, Math.min(
    options.maxScanRows ?? TABULAR_PARSE_ROW_SCAN_LIMIT,
    Math.max(maxRows + 1, TABULAR_DELIMITER_SAMPLE_ROW_LIMIT),
  ));
  const stripped = stripBom(text);
  const source = stripped.text.trimEnd();
  const scores = scoreDelimiters(source, options.delimiter, stripped.offset);
  const selectedDelimiter = scores[0]?.delimiter ?? options.delimiter ?? ',';
  const best = scoreDelimiter(source, selectedDelimiter, stripped.offset, scanRowLimit);
  const ambiguous = !options.delimiter && scores.length > 1 && scores[1].score > 0 && scores[1].score === best.score;
  const trimmedRows = trimTrailingEmptyParsedRows(best.parsed);
  const totalRowCountIsEstimated = trimmedRows.scanLimited;
  const totalRowCount = trimmedRows.rows.length + (trimmedRows.scanLimited ? 1 : 0);
  const rawRows = trimmedRows.rows.slice(0, maxRows);
  const sourceRows = trimmedRows.sourceRows.slice(0, maxRows);
  const previewTruncated = trimmedRows.scanLimited || totalRowCount > maxRows;
  const columnCount = Math.max(best.width, ...rawRows.map((row) => row.length), 0);
  const normalizedRows = rawRows.map((row) => normalizeRowWidth(row, columnCount));
  const header = createHeader(normalizedRows, options.header ?? 'infer');
  const dataRows = header.hasHeader ? normalizedRows.slice(1) : normalizedRows;
  const totalDataRowCount = Math.max(0, totalRowCount - (header.hasHeader ? 1 : 0));
  const totalDataRowCountIsEstimated = totalRowCountIsEstimated;
  const diagnostics = [
    ...best.parsed.diagnostics,
    ...createStructuralDiagnostics({
      rows: rawRows,
      columnCount,
      delimiter: best.delimiter,
      delimiterAmbiguous: ambiguous,
      header,
      previewTruncated,
      maxRows,
      scanLimited: trimmedRows.scanLimited,
      scanRowLimit,
    }),
  ];
  const columns = summarizeColumns(dataRows, header, diagnostics, best.delimiter);

  return {
    delimiter: best.delimiter,
    delimiterLabel: delimiterLabel(best.delimiter),
    delimiterAmbiguous: ambiguous,
    header,
    rows: normalizedRows,
    sourceRows,
    dataRows,
    rowCount: normalizedRows.length,
    dataRowCount: dataRows.length,
    totalRowCount,
    totalRowCountIsEstimated,
    totalDataRowCount,
    totalDataRowCountIsEstimated,
    parsedRowCount: normalizedRows.length,
    parsedDataRowCount: dataRows.length,
    columnCount,
    cellCount: normalizedRows.length * columnCount,
    previewTruncated,
    maxRows,
    scannedRowCount: trimmedRows.scannedRowCount,
    scanRowLimit,
    previewPageInfo: createStructuredPreviewPageInfo({
      itemLabel: 'row',
      totalItems: totalDataRowCount,
      parsedItems: dataRows.length,
    }),
    columns,
    diagnostics,
  };
}

export function isLikelyDelimitedText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 3 || !/\r|\n/.test(trimmed)) return false;
  const parsed = parseDelimitedText(trimmed, { maxRows: 20 });
  if (parsed.columnCount < 2 || parsed.dataRowCount < 1) return false;
  const nonEmptyRows = parsed.rows.filter((row) => row.some((cell) => cell.trim().length > 0));
  if (nonEmptyRows.length < 2) return false;
  const rowWidthMatches = nonEmptyRows.filter((row) => row.filter((cell) => cell.length > 0).length > 1).length;
  return rowWidthMatches >= 2 && parsed.diagnostics.every((diagnostic) => diagnostic.severity !== 'error');
}

export function createDelimitedTextConversionPreview(
  text: string,
  options: DelimitedTextParseOptions = {},
): DelimitedTextConversionPreview | null {
  if (!isLikelyDelimitedText(text)) return null;
  const parsed = parseDelimitedText(text, options);
  return {
    parsed,
    markdown: convertDelimitedText(parsed, 'markdown'),
    json: convertDelimitedText(parsed, 'json'),
    jsonl: convertDelimitedText(parsed, 'jsonl'),
    yaml: convertDelimitedText(parsed, 'yaml'),
    toml: convertDelimitedText(parsed, 'toml'),
  };
}

export function convertDelimitedText(
  parsed: ParsedDelimitedText,
  format: DelimitedTextConversionFormat,
): DelimitedTextConversionResult {
  switch (format) {
    case 'markdown':
      return {
        format,
        label: 'Markdown table',
        content: delimitedTextToMarkdownTable(parsed),
        diagnostics: parsed.diagnostics,
      };
    case 'json':
      return {
        format,
        label: 'JSON array',
        content: `${JSON.stringify(delimitedTextToRecords(parsed), null, 2)}\n`,
        diagnostics: parsed.diagnostics,
      };
    case 'jsonl':
      return {
        format,
        label: 'JSON Lines',
        content: `${delimitedTextToRecords(parsed).map((record) => JSON.stringify(record)).join('\n')}\n`,
        diagnostics: parsed.diagnostics,
      };
    case 'yaml':
      return {
        format,
        label: 'YAML list',
        content: delimitedTextToYamlList(parsed),
        diagnostics: [
          ...parsed.diagnostics,
          conversionWarning(
            parsed,
            'tabular-yaml-string-values',
            'YAML conversion keeps every cell as a quoted string and uses sanitized header keys.',
          ),
        ],
      };
    case 'toml':
      return {
        format,
        label: 'TOML array of tables',
        content: delimitedTextToTomlArrayOfTables(parsed),
        diagnostics: [
          ...parsed.diagnostics,
          conversionWarning(
            parsed,
            'tabular-toml-string-values',
            'TOML conversion writes rows as [[rows]] tables, keeps every cell as a string, and quotes header keys.',
          ),
        ],
      };
  }
}

function scoreDelimiters(source: string, requested?: DelimitedTextDelimiter, sourceOffset = 0): DelimiterScore[] {
  const candidates = requested ? [requested] : DELIMITER_CANDIDATES;
  return candidates
    .map((delimiter) => scoreDelimiter(source, delimiter, sourceOffset, TABULAR_DELIMITER_SAMPLE_ROW_LIMIT))
    .sort((left, right) => right.score - left.score || right.width - left.width);
}

function scoreDelimiter(source: string, delimiter: DelimitedTextDelimiter, sourceOffset = 0, rowLimit = TABULAR_PARSE_ROW_SCAN_LIMIT): DelimiterScore {
  const parsed = parseRows(source, delimiter, sourceOffset, rowLimit);
  const nonEmptyRows = trimTrailingEmptyRows(parsed.rows).filter((row) => row.some((cell) => cell.trim().length > 0));
  const widths = nonEmptyRows.map((row) => row.length);
  const width = mostCommonWidth(widths);
  const consistentRows = widths.filter((candidate) => candidate === width).length;
  const score = width <= 1
    ? 0
    : consistentRows * 100 + width * 10 - parsed.diagnostics.length * 25 - Math.abs(nonEmptyRows.length - consistentRows) * 12;
  return {
    delimiter,
    parsed,
    width,
    consistentRows,
    nonEmptyRows: nonEmptyRows.length,
    score,
  };
}

function parseRows(source: string, delimiter: DelimitedTextDelimiter, sourceOffset = 0, rowLimit = TABULAR_PARSE_ROW_SCAN_LIMIT): ParsedRows {
  const rows: string[][] = [];
  const sourceRows: DelimitedTextRowSource[] = [];
  const diagnostics: FormatDiagnostic[] = [];
  const safeRowLimit = Math.max(1, Math.floor(rowLimit));
  let scanLimited = false;
  let row: string[] = [];
  let sourceCells: DelimitedTextCellSource[] = [];
  let cell = '';
  let quoted = false;
  let cellQuoted = false;
  let afterQuote = false;
  let cellStarted = false;
  let line = 1;
  let column = 1;
  let rowStartOffset = sourceOffset;
  let rowStartLine = 1;
  let rowStartColumn = 1;
  let cellStartOffset = sourceOffset;
  let cellStartLine = 1;
  let cellStartColumn = 1;
  let valueStartOffset = sourceOffset;
  let valueStartLine = 1;
  let valueStartColumn = 1;
  let valueEndOffset = sourceOffset;
  let valueEndLine = 1;
  let valueEndColumn = 1;

  const pushCell = (endOffset: number, endLine: number, endColumn: number) => {
    const rowIndex = rows.length;
    const columnIndex = row.length;
    const span = sourceSpan(cellStartOffset, cellStartLine, cellStartColumn, endOffset, endLine, endColumn);
    const valueSpan = cellQuoted
      ? sourceSpan(valueStartOffset, valueStartLine, valueStartColumn, valueEndOffset, valueEndLine, valueEndColumn)
      : span;
    sourceCells.push({
      rowIndex,
      columnIndex,
      value: cell,
      quoted: cellQuoted,
      span,
      valueSpan,
    });
    row.push(cell);
    cell = '';
    cellQuoted = false;
    afterQuote = false;
    cellStarted = false;
  };
  const pushRow = (
    rowEndOffset: number,
    rowEndLine: number,
    rowEndColumn: number,
    lineEnding: DelimitedTextRowSource['lineEnding'],
  ) => {
    pushCell(rowEndOffset, rowEndLine, rowEndColumn);
    rows.push(row);
    sourceRows.push({
      rowIndex: sourceRows.length,
      cells: sourceCells,
      span: sourceSpan(rowStartOffset, rowStartLine, rowStartColumn, rowEndOffset, rowEndLine, rowEndColumn),
      lineEnding,
    });
    row = [];
    sourceCells = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    const offset = sourceOffset + index;
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
        column += 2;
        continue;
      }
      if (char === '"') {
        valueEndOffset = offset;
        valueEndLine = line;
        valueEndColumn = column;
        quoted = false;
        afterQuote = true;
        column += 1;
        continue;
      }
      if (char === '\r' && next === '\n') {
        cell += '\r\n';
        index += 1;
        line += 1;
        column = 1;
        continue;
      }
      cell += char;
      if (char === '\n' || char === '\r') {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      continue;
    }

    if (afterQuote && char !== delimiter && char !== '\r' && char !== '\n') {
      if (char.trim().length > 0) {
        diagnostics.push(tabularDiagnostic(
          'warning',
          'tabular-characters-after-quote',
          'Unexpected characters after a closing quote. They were kept in the cell.',
          line,
          column,
          delimiter,
        ));
      }
      cell += char;
      column += 1;
      continue;
    }

    if (char === '"' && !cellStarted) {
      quoted = true;
      cellQuoted = true;
      cellStarted = true;
      valueStartOffset = offset + 1;
      valueStartLine = line;
      valueStartColumn = column + 1;
      valueEndOffset = valueStartOffset;
      valueEndLine = valueStartLine;
      valueEndColumn = valueStartColumn;
      column += 1;
      continue;
    }

    if (char === delimiter) {
      pushCell(offset, line, column);
      cellStartOffset = offset + 1;
      cellStartLine = line;
      cellStartColumn = column + 1;
      valueStartOffset = cellStartOffset;
      valueStartLine = cellStartLine;
      valueStartColumn = cellStartColumn;
      valueEndOffset = valueStartOffset;
      valueEndLine = valueStartLine;
      valueEndColumn = valueStartColumn;
      column += 1;
      continue;
    }

    if (char === '\n') {
      pushRow(offset, line, column, '\n');
      if (rows.length >= safeRowLimit && index + 1 < source.length) {
        scanLimited = true;
        break;
      }
      line += 1;
      column = 1;
      rowStartOffset = offset + 1;
      rowStartLine = line;
      rowStartColumn = column;
      cellStartOffset = rowStartOffset;
      cellStartLine = rowStartLine;
      cellStartColumn = rowStartColumn;
      valueStartOffset = cellStartOffset;
      valueStartLine = cellStartLine;
      valueStartColumn = cellStartColumn;
      valueEndOffset = valueStartOffset;
      valueEndLine = valueStartLine;
      valueEndColumn = valueStartColumn;
      continue;
    }

    if (char === '\r') {
      const lineEnding = next === '\n' ? '\r\n' : '\r';
      const nextIndex = index + lineEnding.length;
      pushRow(offset, line, column, lineEnding);
      if (rows.length >= safeRowLimit && nextIndex < source.length) {
        scanLimited = true;
        break;
      }
      if (next === '\n') index += 1;
      line += 1;
      column = 1;
      rowStartOffset = offset + lineEnding.length;
      rowStartLine = line;
      rowStartColumn = column;
      cellStartOffset = rowStartOffset;
      cellStartLine = rowStartLine;
      cellStartColumn = rowStartColumn;
      valueStartOffset = cellStartOffset;
      valueStartLine = cellStartLine;
      valueStartColumn = cellStartColumn;
      valueEndOffset = valueStartOffset;
      valueEndLine = valueStartLine;
      valueEndColumn = valueStartColumn;
      continue;
    }

    if (!cellStarted) {
      valueStartOffset = offset;
      valueStartLine = line;
      valueStartColumn = column;
    }
    cellStarted = true;
    cell += char;
    column += 1;
  }

  if (quoted) {
    diagnostics.push(tabularDiagnostic(
      'error',
      'tabular-unclosed-quote',
      'A quoted cell was not closed before the end of the pasted text.',
      line,
      column,
      delimiter,
    ));
  }
  if (!scanLimited) {
    pushRow(sourceOffset + source.length, line, column, '');
  }
  return {
    rows,
    sourceRows,
    diagnostics,
    scanLimited,
    scannedRowCount: rows.length,
    scanRowLimit: safeRowLimit,
  };
}

function createHeader(rows: string[][], headerMode: DelimitedTextHeaderMode): DelimitedTextHeader {
  const columnCount = Math.max(...rows.map((row) => row.length), 0);
  const firstRow = rows[0] ?? [];
  const hasHeader = headerMode === 'present' || (headerMode === 'infer' && inferHeader(rows));
  const rawNames = hasHeader
    ? normalizeRowWidth(firstRow, columnCount).map((cell) => cell.trim())
    : Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`);
  const emptyHeaders = rawNames
    .map((name, index) => (name.length === 0 ? index : -1))
    .filter((index) => index >= 0);
  const names = rawNames.map((name, index) => name || `Column ${index + 1}`);
  const duplicateHeaders = duplicatedValues(names.map((name) => name.toLowerCase()));
  return {
    hasHeader,
    source: hasHeader ? (headerMode === 'present' ? 'provided' : 'inferred') : 'generated',
    names,
    jsonKeys: createJsonKeys(names),
    emptyHeaders,
    duplicateHeaders,
  };
}

function inferHeader(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const firstRow = rows[0].map((cell) => cell.trim());
  if (firstRow.length < 2 || firstRow.some((cell) => cell.length === 0)) return false;
  if (duplicatedValues(firstRow.map((cell) => cell.toLowerCase())).length > 0) return false;
  const firstRowLooksTextual = firstRow.every((cell) => inferCellType(cell) === 'string');
  if (!firstRowLooksTextual) return false;
  if (firstRow.every((cell) => /^[A-Za-z_][\w .-]*$/.test(cell))) return true;
  const sampleRows = rows.slice(1, 6);
  return sampleRows.some((row) => row.some((cell) => {
    const type = inferCellType(cell.trim());
    return type === 'number' || type === 'boolean' || type === 'date' || type === 'empty';
  }));
}

function createStructuralDiagnostics({
  rows,
  columnCount,
  delimiter,
  delimiterAmbiguous,
  header,
  previewTruncated,
  maxRows,
  scanLimited,
  scanRowLimit,
}: {
  rows: string[][];
  columnCount: number;
  delimiter: DelimitedTextDelimiter;
  delimiterAmbiguous: boolean;
  header: DelimitedTextHeader;
  previewTruncated: boolean;
  maxRows: number;
  scanLimited: boolean;
  scanRowLimit: number;
}): FormatDiagnostic[] {
  const diagnostics: FormatDiagnostic[] = [];
  if (delimiterAmbiguous) {
    diagnostics.push(tabularDiagnostic(
      'warning',
      'tabular-ambiguous-delimiter',
      'Multiple delimiters looked plausible. Review the preview before inserting.',
      undefined,
      undefined,
      delimiter,
    ));
  }
  rows.forEach((row, index) => {
    if (row.length !== columnCount) {
      diagnostics.push(tabularDiagnostic(
        'warning',
        'tabular-inconsistent-row-width',
        `Row ${index + 1} has ${row.length} cells; expected ${columnCount}. Missing cells will be padded.`,
        index + 1,
        undefined,
        delimiter,
      ));
    }
  });
  for (const headerIndex of header.emptyHeaders) {
    diagnostics.push(tabularDiagnostic(
      'warning',
      'tabular-empty-header',
      `Column ${headerIndex + 1} has an empty header. A generated name will be used.`,
      1,
      headerIndex + 1,
      delimiter,
    ));
  }
  for (const headerName of header.duplicateHeaders) {
    diagnostics.push(tabularDiagnostic(
      'warning',
      'tabular-duplicate-header',
      `Header "${headerName}" is duplicated. JSON keys will be made unique.`,
      1,
      undefined,
      delimiter,
    ));
  }
  if (previewTruncated) {
    diagnostics.push(tabularDiagnostic(
      'warning',
      'tabular-preview-truncated',
      scanLimited
        ? `Only the first ${scanRowLimit} source rows were sampled for parser preview. Counts are lower bounds; source editing remains available for the full file.`
        : `Only the first ${maxRows} rows were parsed for preview.`,
      undefined,
      undefined,
      delimiter,
    ));
  }
  return diagnostics;
}

function summarizeColumns(
  rows: string[][],
  header: DelimitedTextHeader,
  diagnostics: FormatDiagnostic[],
  delimiter: DelimitedTextDelimiter,
): DelimitedTextColumnSummary[] {
  return header.names.map((name, index) => {
    const values = rows.map((row) => row[index] ?? '');
    const typeSet = new Set<DelimitedTextCellType>();
    let emptyCount = 0;
    let numericRiskCount = 0;
    const samples: string[] = [];
    for (const value of values) {
      const trimmed = value.trim();
      const type = inferCellType(trimmed);
      typeSet.add(type);
      if (type === 'empty') emptyCount += 1;
      if (hasNumericCoercionRisk(trimmed)) numericRiskCount += 1;
      if (trimmed && samples.length < 3 && !samples.includes(trimmed)) samples.push(trimmed);
    }
    const nonEmptyTypes = Array.from(typeSet).filter((type) => type !== 'empty');
    if (numericRiskCount > 0) {
      diagnostics.push(tabularDiagnostic(
        'warning',
        'tabular-number-risk',
        `Column "${name}" contains number-like values that may be identifiers or precision-sensitive. Conversion keeps them as strings.`,
        undefined,
        index + 1,
        delimiter,
      ));
    }
    if (nonEmptyTypes.length > 1) {
      diagnostics.push(tabularDiagnostic(
        'warning',
        'tabular-mixed-column-types',
        `Column "${name}" mixes ${nonEmptyTypes.join(', ')} values.`,
        undefined,
        index + 1,
        delimiter,
      ));
    }
    return {
      index,
      name,
      types: Array.from(typeSet).sort(),
      emptyCount,
      numericRiskCount,
      sampleValues: samples,
    };
  });
}

function delimitedTextToMarkdownTable(parsed: ParsedDelimitedText): string {
  const headers = parsed.header.names.map(markdownTableCell);
  const rows = parsed.dataRows.map((row) => normalizeRowWidth(row, parsed.columnCount).map(markdownTableCell));
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
    '',
  ].join('\n');
}

function delimitedTextToRecords(parsed: ParsedDelimitedText): Array<Record<string, string>> {
  return parsed.dataRows.map((row) => {
    const normalized = normalizeRowWidth(row, parsed.columnCount);
    const record: Record<string, string> = {};
    parsed.header.jsonKeys.forEach((key, index) => {
      record[key] = normalized[index] ?? '';
    });
    return record;
  });
}

function delimitedTextToYamlList(parsed: ParsedDelimitedText): string {
  const records = delimitedTextToRecords(parsed);
  if (records.length === 0) return '[]\n';
  return `${records.map((record) => {
    const entries = parsed.header.jsonKeys.map((key) => `  ${yamlKey(key)}: ${quotedString(record[key] ?? '')}`);
    return `-\n${entries.join('\n')}`;
  }).join('\n')}\n`;
}

function delimitedTextToTomlArrayOfTables(parsed: ParsedDelimitedText): string {
  const records = delimitedTextToRecords(parsed);
  if (records.length === 0) return '';
  return `${records.map((record) => [
    '[[rows]]',
    ...parsed.header.jsonKeys.map((key) => `${tomlKey(key)} = ${quotedString(record[key] ?? '')}`),
    '',
  ].join('\n')).join('\n')}`;
}

function markdownTableCell(value: string): string {
  return value
    .replace(/\r?\n/g, '<br>')
    .replace(/\|/g, '\\|')
    .trim();
}

function yamlKey(value: string): string {
  return /^[A-Za-z_][\w.-]*$/.test(value) ? value : quotedString(value);
}

function tomlKey(value: string): string {
  return quotedString(value);
}

function quotedString(value: string): string {
  return JSON.stringify(value);
}

function conversionWarning(parsed: ParsedDelimitedText, code: string, message: string): FormatDiagnostic {
  return tabularDiagnostic('warning', code, message, undefined, undefined, parsed.delimiter, 'conversion');
}

function tabularDiagnostic(
  severity: FormatDiagnosticSeverity,
  code: string,
  message: string,
  line: number | undefined,
  column: number | undefined,
  delimiter: DelimitedTextDelimiter,
  category?: FormatDiagnosticCategory,
): FormatDiagnostic {
  return {
    severity,
    code,
    message,
    line,
    column,
    source: delimiter === '\t' ? 'tsv' : 'csv',
    category,
  };
}

function sourceSpan(
  offset: number,
  line: number,
  column: number,
  endOffset: number,
  endLine: number,
  endColumn: number,
): DelimitedTextSourceSpan {
  return {
    offset,
    length: Math.max(0, endOffset - offset),
    endOffset,
    line,
    column,
    endLine,
    endColumn,
  };
}

function stripBom(value: string): { text: string; offset: number } {
  return value.charCodeAt(0) === 0xFEFF
    ? { text: value.slice(1), offset: 1 }
    : { text: value, offset: 0 };
}

function trimTrailingEmptyRows(rows: string[][]): string[][] {
  let end = rows.length;
  while (end > 0 && rows[end - 1].every((cell) => cell.length === 0)) end -= 1;
  return rows.slice(0, end);
}

function trimTrailingEmptyParsedRows(parsed: ParsedRows): ParsedRows {
  let end = parsed.rows.length;
  while (end > 0 && parsed.rows[end - 1].every((cell) => cell.length === 0)) end -= 1;
  return {
    rows: parsed.rows.slice(0, end),
    sourceRows: parsed.sourceRows.slice(0, end),
    diagnostics: parsed.diagnostics,
    scanLimited: parsed.scanLimited,
    scannedRowCount: end,
    scanRowLimit: parsed.scanRowLimit,
  };
}

function normalizeRowWidth(row: string[], width: number): string[] {
  return Array.from({ length: width }, (_, index) => row[index] ?? '');
}

function mostCommonWidth(widths: number[]): number {
  const counts = new Map<number, number>();
  for (const width of widths) counts.set(width, (counts.get(width) ?? 0) + 1);
  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1] || right[0] - left[0])[0]?.[0] ?? 0;
}

function inferCellType(value: string): DelimitedTextCellType {
  if (value.length === 0) return 'empty';
  if (/^(true|false)$/i.test(value)) return 'boolean';
  if (/^[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return 'number';
  if (/^\d{4}-\d{2}-\d{2}(?:[T ][0-2]\d:[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-][0-2]\d:?[0-5]\d)?)?$/.test(value)) return 'date';
  return 'string';
}

function hasNumericCoercionRisk(value: string): boolean {
  return /^0\d+/.test(value)
    || /^\d{16,}$/.test(value)
    || /^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(value);
}

function duplicatedValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return Array.from(duplicates);
}

function createJsonKeys(names: string[]): string[] {
  const counts = new Map<string, number>();
  return names.map((name, index) => {
    const base = sanitizeJsonKey(name) || `column_${index + 1}`;
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

function sanitizeJsonKey(name: string): string {
  return name.trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function delimiterLabel(delimiter: DelimitedTextDelimiter): string {
  if (delimiter === '\t') return 'Tab';
  if (delimiter === ';') return 'Semicolon';
  return 'Comma';
}
