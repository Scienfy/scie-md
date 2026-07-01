import type { FormatDiagnostic } from '../documentFormat.js';
import {
  parseDelimitedText,
  type DelimitedTextDelimiter,
  type ParsedDelimitedText,
} from './parseDelimitedText.js';

export type TabularVisualEditFormat = 'csv' | 'tsv';

export interface TabularTextEdit {
  offset: number;
  length: number;
  content: string;
}

export type TabularVisualEditIntent =
  | {
    kind: 'replaceCell';
    format: TabularVisualEditFormat;
    dataRowIndex: number;
    columnIndex: number;
    nextValue: string;
    expectedSourceHash?: string;
  }
  | {
    kind: 'appendRow';
    format: TabularVisualEditFormat;
    values: string[];
    expectedSourceHash?: string;
  };

export interface TabularVisualEditPlan {
  ok: boolean;
  edits: TabularTextEdit[];
  diagnostics: FormatDiagnostic[];
  previewLabel: string;
  nextSource?: string;
  unsupportedReason?: string;
}

export function tabularSourceHash(source: string): string {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(hash ^ source.charCodeAt(index), 16777619) >>> 0;
  }
  return `${source.length.toString(36)}:${hash.toString(36)}`;
}

export function applyTabularTextEdits(source: string, edits: readonly TabularTextEdit[]): string {
  return [...edits]
    .sort((left, right) => right.offset - left.offset)
    .reduce((current, edit) => (
      `${current.slice(0, edit.offset)}${edit.content}${current.slice(edit.offset + edit.length)}`
    ), source);
}

export function planTabularVisualEdit(
  source: string,
  intent: TabularVisualEditIntent,
): TabularVisualEditPlan {
  if (intent.expectedSourceHash && intent.expectedSourceHash !== tabularSourceHash(source)) {
    return unsupportedEditPlan(
      'tabular-edit-stale-source',
      'Table source changed before this visual edit could be applied. Re-select the cell and try again.',
    );
  }

  const parsed = parseDelimitedText(source, {
    delimiter: delimiterForFormat(intent.format),
  });
  const guard = tabularEditGuard(parsed);
  if (!guard.ok) return unsupportedEditPlan('tabular-edit-unsupported', guard.reason);

  const edit = intent.kind === 'replaceCell'
    ? planCellReplacement(parsed, intent)
    : planRowAppend(source, parsed, intent);
  if (!edit.ok) return unsupportedEditPlan('tabular-edit-unsupported', edit.reason);

  const nextSource = applyTabularTextEdits(source, [edit.edit]);
  const nextParsed = parseDelimitedText(nextSource, {
    delimiter: delimiterForFormat(intent.format),
  });
  const nextGuard = tabularEditGuard(nextParsed);
  if (!nextGuard.ok) {
    return unsupportedEditPlan(
      'tabular-edit-invalid-result',
      `The table edit was rejected because the resulting source is not safely editable. ${nextGuard.reason}`,
    );
  }

  return {
    ok: true,
    edits: [edit.edit],
    diagnostics: [],
    previewLabel: previewLabelForIntent(intent),
    nextSource,
  };
}

function planCellReplacement(
  parsed: ParsedDelimitedText,
  intent: Extract<TabularVisualEditIntent, { kind: 'replaceCell' }>,
): { ok: true; edit: TabularTextEdit } | { ok: false; reason: string } {
  if (!Number.isInteger(intent.dataRowIndex) || intent.dataRowIndex < 0) {
    return { ok: false, reason: 'Table row index must be a non-negative integer.' };
  }
  if (!Number.isInteger(intent.columnIndex) || intent.columnIndex < 0 || intent.columnIndex >= parsed.columnCount) {
    return { ok: false, reason: 'Table column index is outside the parsed table.' };
  }
  const sourceRowIndex = parsed.header.hasHeader ? intent.dataRowIndex + 1 : intent.dataRowIndex;
  const row = parsed.sourceRows[sourceRowIndex];
  if (!row) return { ok: false, reason: 'The selected table row is outside the parsed preview.' };
  const cell = row.cells[intent.columnIndex];
  if (!cell) return { ok: false, reason: 'The selected table cell is not source-mapped.' };

  return {
    ok: true,
    edit: {
      offset: cell.span.offset,
      length: cell.span.length,
      content: serializeDelimitedCell(intent.nextValue, parsed.delimiter, cell.quoted),
    },
  };
}

function planRowAppend(
  source: string,
  parsed: ParsedDelimitedText,
  intent: Extract<TabularVisualEditIntent, { kind: 'appendRow' }>,
): { ok: true; edit: TabularTextEdit } | { ok: false; reason: string } {
  if (parsed.previewTruncated) {
    return { ok: false, reason: 'Appending rows is disabled while the parser preview is truncated.' };
  }
  if (intent.values.length !== parsed.columnCount) {
    return { ok: false, reason: `New rows must contain exactly ${parsed.columnCount} cells.` };
  }
  const trailing = source.slice(source.trimEnd().length);
  if (trailing && !/^(?:\r\n|\n|\r)+$/.test(trailing)) {
    return { ok: false, reason: 'Trailing non-line-ending whitespace must be cleaned up before appending rows visually.' };
  }
  const eol = lineEndingForSource(source, parsed);
  const rowText = intent.values.map((value) => serializeDelimitedCell(value, parsed.delimiter, false)).join(parsed.delimiter);
  const content = source.length === 0 || sourceEndsWithLineEnding(source)
    ? `${rowText}${eol}`
    : `${eol}${rowText}${eol}`;
  return {
    ok: true,
    edit: {
      offset: source.length,
      length: 0,
      content,
    },
  };
}

function tabularEditGuard(parsed: ParsedDelimitedText): { ok: true } | { ok: false; reason: string } {
  const error = parsed.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (error) return { ok: false, reason: error.message };
  if (parsed.delimiterAmbiguous) return { ok: false, reason: 'Delimiter inference is ambiguous; choose source editing for this table.' };
  const blocking = parsed.diagnostics.find((diagnostic) => (
    diagnostic.code === 'tabular-inconsistent-row-width'
    || diagnostic.code === 'tabular-characters-after-quote'
  ));
  if (blocking) return { ok: false, reason: blocking.message };
  return { ok: true };
}

function delimiterForFormat(format: TabularVisualEditFormat): DelimitedTextDelimiter | undefined {
  return format === 'tsv' ? '\t' : undefined;
}

function serializeDelimitedCell(value: string, delimiter: DelimitedTextDelimiter, forceQuote: boolean): string {
  const shouldQuote = forceQuote
    || value.includes(delimiter)
    || value.includes('"')
    || value.includes('\n')
    || value.includes('\r')
    || /^\s|\s$/.test(value);
  return shouldQuote ? `"${value.replace(/"/g, '""')}"` : value;
}

function lineEndingForSource(source: string, parsed: ParsedDelimitedText): '\n' | '\r\n' | '\r' {
  const existing = parsed.sourceRows.find((row) => row.lineEnding)?.lineEnding;
  if (existing) return existing;
  if (source.includes('\r\n')) return '\r\n';
  if (source.includes('\r')) return '\r';
  return '\n';
}

function sourceEndsWithLineEnding(source: string): boolean {
  return source.endsWith('\n') || source.endsWith('\r');
}

function previewLabelForIntent(intent: TabularVisualEditIntent): string {
  if (intent.kind === 'replaceCell') {
    return `Updated row ${intent.dataRowIndex + 1}, column ${intent.columnIndex + 1}.`;
  }
  return 'Appended table row.';
}

function unsupportedEditPlan(code: string, reason: string): TabularVisualEditPlan {
  return {
    ok: false,
    edits: [],
    diagnostics: [{
      severity: 'warning',
      code,
      message: reason,
      source: 'csv',
      category: 'edit',
      blocking: true,
    }],
    previewLabel: 'Table edit unavailable',
    unsupportedReason: reason,
  };
}
