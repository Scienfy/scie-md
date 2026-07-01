import { AlertTriangle, Braces, Clipboard, Code2, Copy, Database, ListTree, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import {
  jsonArrayToJsonlPreview,
  jsonlSourceHash,
  jsonlToJsonArrayPreview,
  createStructuredPreviewPageInfo,
  structuredPreviewPageItems,
  type JsonlLineResult,
  type JsonlVisualEditIntent,
  type StructuredPreviewPageInfo,
  type StructuredPreviewPageWindow,
} from '@sciemd/core';
import type { JsonlDocumentAnalysis } from '../app/formatDiagnostics';
import type { StructuredConversionAction, StructuredConversionRequest } from '../app/structuredConversionActions';
import { ContextMenuCard, type ContextMenuSection } from './ContextMenuCard';
import { contextMenuPositionFromElement, isKeyboardContextMenuEvent, writeContextMenuClipboardText } from './contextMenuUtils';
import { DialogActions } from './DialogActions';
import { ModalShell } from './ModalShell';
import { structuredOperationSectionsForTarget } from '../app/structuredOperationRegistry';
import { structuredOperationSectionsToContextMenuSections } from './structuredOperationMenu';
import {
  moveStructuredGridFocus,
  structuredGridCellKey,
  type StructuredGridFocus,
} from './structuredGridNavigation';

export interface JsonlRecordListProps {
  analysis: JsonlDocumentAnalysis | null;
  sourceText?: string;
  editable?: boolean;
  onEditIntent?: (intent: JsonlVisualEditIntent) => void;
  onCopyText?: (content: string, label: string) => void;
  onConversionAction?: (request: StructuredConversionRequest) => void;
  onJumpToLine?: (line: number) => void;
  onUnsupportedEdit?: (message: string) => void;
}

type JsonlLineFilter = 'all' | 'invalid';
const JSONL_RECORD_ROW_COLUMN_COUNT = 5;

type RecordEditorState =
  | { kind: 'append'; draft: string; error: string | null }
  | { kind: 'replace'; line: JsonlLineResult; draft: string; error: string | null };

type JsonlContextMenuState =
  | { kind: 'record'; lineNumber: number; position: { x: number; y: number }; restoreFocusTo?: HTMLElement | null }
  | { kind: 'header'; position: { x: number; y: number }; restoreFocusTo?: HTMLElement | null };

export function JsonlRecordList({
  analysis,
  sourceText,
  editable = true,
  onEditIntent,
  onCopyText,
  onConversionAction,
  onJumpToLine,
  onUnsupportedEdit,
}: JsonlRecordListProps) {
  const parsed = analysis?.parseResult.parsed ?? null;
  const [recordEditor, setRecordEditor] = useState<RecordEditorState | null>(null);
  const [conversionDialogOpen, setConversionDialogOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<JsonlContextMenuState | null>(null);
  const [lineFilter, setLineFilter] = useState<JsonlLineFilter>('all');
  const [pageIndex, setPageIndex] = useState(0);
  const [recordSearchQuery, setRecordSearchQuery] = useState('');
  const [jumpDraft, setJumpDraft] = useState('');
  const [focusedRow, setFocusedRow] = useState<StructuredGridFocus>({ row: 0, column: 0 });
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const sourceHash = useMemo(() => sourceText === undefined ? undefined : jsonlSourceHash(sourceText), [sourceText]);
  const canEditRecords = editable && Boolean(sourceText !== undefined && onEditIntent);
  if (!parsed) {
    return (
      <section className="jsonl-record-list" aria-label="JSONL records">
        <header className="jsonl-record-header">
          <div>
            <ListTree size={16} />
            <strong>JSONL records</strong>
            <span>No record preview available</span>
          </div>
        </header>
        <div className="jsonl-record-empty">Source remains editable while JSONL diagnostics are unavailable.</div>
      </section>
    );
  }

  const objectRows = parsed.lines.filter((line) => line.valid && line.valueType === 'object');
  const tableFields = parsed.commonFields.slice(0, 6).map((field) => field.field);
  const normalizedRecordSearch = recordSearchQuery.trim().toLowerCase();
  const filterBaseLines = lineFilter === 'invalid'
    ? parsed.lines.filter((line) => !line.valid)
    : parsed.lines;
  const filteredLines = normalizedRecordSearch
    ? filterBaseLines.filter((line) => jsonlLineMatchesSearch(line, normalizedRecordSearch))
    : filterBaseLines;
  const pageInfo = lineFilter === 'invalid' || normalizedRecordSearch
    ? createStructuredPreviewPageInfo({
      itemLabel: lineFilter === 'invalid' ? 'invalid line' : 'record',
      totalItems: filteredLines.length,
      parsedItems: filteredLines.length,
      pageSize: parsed.previewPageInfo.pageSize,
    })
    : parsed.previewPageInfo;
  const pagedLines = structuredPreviewPageItems(filteredLines, pageInfo, pageIndex);
  const visibleLines = pagedLines.items;
  const visibleWindow = pagedLines.window;
  const contextLine = contextMenu?.kind === 'record'
    ? parsed.lines.find((line) => line.line === contextMenu.lineNumber) ?? null
    : null;
  const focusedRowKey = structuredGridCellKey(focusedRow.row, focusedRow.column);
  const focusRecordRow = (row: number) => {
    const next = { row: Math.max(0, row), column: 0 };
    setFocusedRow(next);
    window.requestAnimationFrame(() => {
      rowRefs.current.get(structuredGridCellKey(next.row, next.column))?.focus();
    });
  };

  const openAppendEditor = () => {
    setContextMenu(null);
    if (!canEditRecords) {
      onUnsupportedEdit?.('JSONL record editing is not available for this view.');
      return;
    }
    setRecordEditor({ kind: 'append', draft: defaultAppendRecordDraft(tableFields), error: null });
  };

  const openReplaceEditor = (line: JsonlLineResult) => {
    setContextMenu(null);
    if (!canEditRecords) {
      onUnsupportedEdit?.('JSONL record editing is not available for this view.');
      return;
    }
    if (!line.valid) {
      onUnsupportedEdit?.('Fix invalid JSONL lines in source mode before using record actions.');
      return;
    }
    setRecordEditor({
      kind: 'replace',
      line,
      draft: JSON.stringify(line.value, null, 2),
      error: null,
    });
  };

  const dispatchLineIntent = (line: JsonlLineResult, kind: 'duplicateRecord' | 'deleteRecord') => {
    setContextMenu(null);
    if (!canEditRecords || !onEditIntent) {
      onUnsupportedEdit?.('JSONL record editing is not available for this view.');
      return;
    }
    if (!line.valid) {
      onUnsupportedEdit?.('Fix invalid JSONL lines in source mode before using record actions.');
      return;
    }
    onEditIntent({
      kind,
      lineNumber: line.line,
      expectedOffset: line.offset,
      expectedLength: line.length,
      expectedLineText: sourceText?.slice(line.offset, line.offset + line.length),
      expectedSourceHash: sourceHash,
    });
  };
  const openConversionDialog = () => {
    setContextMenu(null);
    setConversionDialogOpen(true);
  };
  const copyText = (content: string, label: string) => {
    if (onCopyText) {
      onCopyText(content, label);
      return Promise.resolve();
    }
    return writeClipboardText(content);
  };
  const openRecordContextMenu = (line: JsonlLineResult, event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: 'record',
      lineNumber: line.line,
      position: { x: event.clientX, y: event.clientY },
      restoreFocusTo: event.currentTarget,
    });
  };
  const openHeaderContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setContextMenu({
      kind: 'header',
      position: { x: event.clientX, y: event.clientY },
      restoreFocusTo: event.currentTarget,
    });
  };
  const openRecordKeyboardContextMenu = (line: JsonlLineResult, event: KeyboardEvent<HTMLElement>) => {
    if (!isKeyboardContextMenuEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: 'record',
      lineNumber: line.line,
      position: contextMenuPositionFromElement(event.currentTarget),
      restoreFocusTo: event.currentTarget,
    });
  };
  const openHeaderKeyboardContextMenu = (event: KeyboardEvent<HTMLElement>) => {
    if (!isKeyboardContextMenuEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: 'header',
      position: contextMenuPositionFromElement(event.currentTarget),
      restoreFocusTo: event.currentTarget,
    });
  };
  const handleRecordRowKeyDown = (line: JsonlLineResult, rowIndex: number, event: KeyboardEvent<HTMLElement>) => {
    if (isKeyboardContextMenuEvent(event)) {
      openRecordKeyboardContextMenu(line, event);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      openReplaceEditor(line);
      return;
    }
    if (event.key === 'Escape') {
      event.currentTarget.blur();
      return;
    }
    const next = moveStructuredGridFocus(
      { row: rowIndex, column: 0 },
      event,
      { rowCount: visibleLines.length, columnCount: JSONL_RECORD_ROW_COLUMN_COUNT, pageStep: Math.max(1, visibleLines.length - 1) },
    );
    if (!next) return;
    event.preventDefault();
    focusRecordRow(next.row);
  };
  const jumpToRecordOrLine = () => {
    const requested = Number.parseInt(jumpDraft.trim(), 10);
    if (!Number.isFinite(requested) || requested <= 0) {
      onUnsupportedEdit?.('Enter a positive line or record number to jump.');
      return;
    }
    const targetIndex = filteredLines.findIndex((line) => (
      line.line === requested || (line.recordIndex !== null && line.recordIndex + 1 === requested)
    ));
    if (targetIndex < 0) {
      onUnsupportedEdit?.('That line or record is not present in the parsed preview window.');
      return;
    }
    const nextPageIndex = Math.floor(targetIndex / pageInfo.pageSize);
    setPageIndex(nextPageIndex);
    window.requestAnimationFrame(() => {
      focusRecordRow(targetIndex - nextPageIndex * pageInfo.pageSize);
    });
    const line = filteredLines[targetIndex];
    if (line?.line && onJumpToLine) onJumpToLine(line.line);
  };
  const contextMenuSections = contextMenu?.kind === 'record' && contextLine
    ? jsonlRecordContextMenuSections({
      line: contextLine,
      sourceText,
      canEditRecords,
      onCopy: copyText,
      onReplace: () => openReplaceEditor(contextLine),
      onDuplicate: () => dispatchLineIntent(contextLine, 'duplicateRecord'),
      onDelete: () => dispatchLineIntent(contextLine, 'deleteRecord'),
    })
    : contextMenu?.kind === 'header'
      ? jsonlHeaderContextMenuSections({
        canEditRecords,
        canConvert: sourceText !== undefined,
        onAppend: openAppendEditor,
        onConvert: openConversionDialog,
      })
      : [];

  const submitRecordEditor = () => {
    if (!recordEditor || !onEditIntent) return;
    let value: unknown;
    try {
      value = JSON.parse(recordEditor.draft) as unknown;
    } catch (error) {
      setRecordEditor({
        ...recordEditor,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (recordEditor.kind === 'append') {
      onEditIntent({ kind: 'appendRecord', value, expectedSourceHash: sourceHash });
    } else {
      const { line } = recordEditor;
      onEditIntent({
        kind: 'replaceRecord',
        lineNumber: line.line,
        value,
        expectedOffset: line.offset,
        expectedLength: line.length,
        expectedLineText: sourceText?.slice(line.offset, line.offset + line.length),
        expectedSourceHash: sourceHash,
      });
    }
    setRecordEditor(null);
  };

  return (
    <section className="jsonl-record-list" aria-label="JSONL records">
      <header
        className="jsonl-record-header"
        tabIndex={0}
        onKeyDown={openHeaderKeyboardContextMenu}
        onContextMenu={openHeaderContextMenu}
      >
        <div>
          <ListTree size={16} />
          <strong>JSONL records</strong>
            <span>{jsonlRecordStatusLabel(analysis)}</span>
        </div>
        <div className="jsonl-record-actions" aria-label="JSONL record actions">
          <button type="button" onClick={openAppendEditor} disabled={!canEditRecords} title="Append JSONL record">
            <Plus size={14} />
            Append
          </button>
          <button
            type="button"
            onClick={openConversionDialog}
            disabled={sourceText === undefined}
            title="Preview JSONL conversion"
          >
            <Code2 size={14} />
            Convert
          </button>
        </div>
        <div className="jsonl-record-metrics" aria-label="JSONL summary">
          <Metric icon={<Database size={14} />} label="Records" value={jsonlCountLabel(parsed.recordCount, parsed.recordCountIsEstimated)} />
          <Metric icon={<AlertTriangle size={14} />} label="Invalid" value={parsed.invalidLineCount} />
          <Metric icon={<Braces size={14} />} label="Object rows" value={parsed.objectRecordCount} />
        </div>
      </header>

      <div className="jsonl-record-window-controls" aria-label="JSONL record window controls">
        <label>
          <span>Rows</span>
          <select
            aria-label="JSONL row filter"
            value={lineFilter}
            onChange={(event) => {
              setLineFilter(event.target.value as JsonlLineFilter);
              setPageIndex(0);
            }}
          >
            <option value="all">Parsed preview</option>
            <option value="invalid">Invalid only</option>
          </select>
        </label>
        <label className="structured-window-search">
          <span>Search</span>
          <input
            aria-label="Search JSONL parsed preview"
            value={recordSearchQuery}
            placeholder="line, type, value"
            onChange={(event) => {
              setRecordSearchQuery(event.target.value);
              setPageIndex(0);
              setFocusedRow({ row: 0, column: 0 });
            }}
          />
        </label>
        <label className="structured-window-jump">
          <span>Jump</span>
          <input
            aria-label="Jump to JSONL line or record"
            inputMode="numeric"
            value={jumpDraft}
            placeholder="line/record"
            onChange={(event) => setJumpDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                jumpToRecordOrLine();
              }
            }}
          />
        </label>
        <button type="button" onClick={jumpToRecordOrLine}>
          Go
        </button>
        <button type="button" disabled={visibleWindow.pageIndex === 0} onClick={() => setPageIndex((current) => Math.max(0, current - 1))}>
          Previous
        </button>
        <span>{jsonlWindowLabel(pageInfo, visibleWindow, lineFilter === 'all' && parsed.totalLineCountIsEstimated)}</span>
        <button type="button" disabled={visibleWindow.pageIndex >= visibleWindow.pageCount - 1} onClick={() => setPageIndex((current) => Math.min(visibleWindow.pageCount - 1, current + 1))}>
          Next
        </button>
      </div>

      {(parsed.commonFields.length > 0 || parsed.missingFieldSummary.length > 0) && (
        <div className="jsonl-field-summary" aria-label="JSONL field summary">
          {parsed.commonFields.slice(0, 8).map((field) => (
            <span key={field.field} className={field.missingCount > 0 ? 'has-missing' : ''}>
              <strong>{field.field}</strong>
              <small>{field.presentCount}/{parsed.objectRecordCount} {field.types.join('|')}</small>
            </span>
          ))}
        </div>
      )}

      {objectRows.length > 0 && tableFields.length > 0 && (
        <div className="jsonl-field-table" aria-label="Common JSONL object fields">
          <div className="jsonl-field-table-row header" role="row">
            <span role="columnheader">Line</span>
            {tableFields.map((field) => <span key={field} role="columnheader">{field}</span>)}
          </div>
          {objectRows.slice(0, 12).map((line) => {
            const record = line.value as Record<string, unknown>;
            return (
              <div key={`fields:${line.line}:${line.offset}`} className="jsonl-field-table-row" role="row">
                <span role="cell">{line.line}</span>
                {tableFields.map((field) => (
                  <span key={field} role="cell" title={record[field] === undefined ? '(missing)' : previewFieldValue(record[field])}>
                    {record[field] === undefined ? '-' : previewFieldValue(record[field])}
                  </span>
                ))}
              </div>
            );
          })}
          {objectRows.length > 12 && <p>{objectRows.length - 12} more object rows in the bounded preview.</p>}
        </div>
      )}

      <div className="jsonl-record-scroll">
        <div
          className="jsonl-record-grid"
          role="grid"
          aria-label="JSONL record preview"
          aria-rowcount={pageInfo.totalItems + 1}
          aria-colcount={JSONL_RECORD_ROW_COLUMN_COUNT}
        >
          <div className="jsonl-record-row header" role="row" aria-rowindex={1}>
            <span role="columnheader">Line</span>
            <span role="columnheader">Record</span>
            <span role="columnheader">Type</span>
            <span role="columnheader">Preview</span>
            <span role="columnheader">Actions</span>
          </div>
          {visibleLines.length === 0 ? (
            <div className="jsonl-record-row empty" role="row">
              <span role="cell">-</span>
              <span role="cell">-</span>
              <span role="cell">none</span>
              <span role="cell">No {lineFilter === 'invalid' ? 'invalid lines' : 'records'} in this parsed preview window.</span>
              <span role="cell">-</span>
            </div>
          ) : visibleLines.map((line, rowIndex) => (
            <div
              key={`${line.line}:${line.offset}`}
              ref={(node) => {
                const key = structuredGridCellKey(rowIndex, 0);
                if (node) rowRefs.current.set(key, node);
                else rowRefs.current.delete(key);
              }}
              className={`jsonl-record-row ${line.valid ? '' : 'invalid'}`}
              role="row"
              aria-rowindex={visibleWindow.startIndex + rowIndex + 2}
              tabIndex={focusedRowKey === structuredGridCellKey(rowIndex, 0) ? 0 : -1}
              onFocus={() => setFocusedRow({ row: rowIndex, column: 0 })}
              onKeyDown={(event) => handleRecordRowKeyDown(line, rowIndex, event)}
              onContextMenu={(event) => openRecordContextMenu(line, event)}
            >
              <span role="cell">
                {onJumpToLine ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    className="jsonl-line-jump"
                    aria-label={`Jump to JSONL line ${line.line}`}
                    onClick={() => onJumpToLine(line.line)}
                  >
                    {line.line}
                  </button>
                ) : line.line}
              </span>
              <span role="cell">{line.recordIndex === null ? '-' : line.recordIndex + 1}</span>
              <span role="cell">
                <span className={`jsonl-record-type ${line.valueType ?? 'invalid'}`}>
                  {line.valueType ?? 'invalid'}
                </span>
              </span>
              <span role="cell" title={line.diagnostic?.message ?? line.preview}>
                {line.valid ? line.preview : line.diagnostic?.message ?? line.preview}
              </span>
              <span role="cell" className="jsonl-record-row-actions">
                <button
                  type="button"
                  aria-label={`Replace JSONL line ${line.line}`}
                  title="Replace record"
                  disabled={!canEditRecords || !line.valid}
                  tabIndex={-1}
                  onClick={() => openReplaceEditor(line)}
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  aria-label={`Duplicate JSONL line ${line.line}`}
                  title="Duplicate record"
                  disabled={!canEditRecords || !line.valid}
                  tabIndex={-1}
                  onClick={() => dispatchLineIntent(line, 'duplicateRecord')}
                >
                  <Copy size={13} />
                </button>
                <button
                  type="button"
                  aria-label={`Delete JSONL line ${line.line}`}
                  title="Delete record"
                  disabled={!canEditRecords || !line.valid}
                  tabIndex={-1}
                  onClick={() => dispatchLineIntent(line, 'deleteRecord')}
                >
                  <Trash2 size={13} />
                </button>
              </span>
            </div>
          ))}
        </div>
        {parsed.previewTruncated && (
          <p className="jsonl-record-truncated">
            Parsed preview covers first {parsed.previewLimit} lines of {jsonlCountLabel(parsed.totalLineCount, parsed.totalLineCountIsEstimated)}. Line diagnostics and source editing remain available for the full file.
          </p>
        )}
      </div>
      <RecordEditorDialog
        state={recordEditor}
        onDraftChange={(draft) => {
          if (!recordEditor) return;
          setRecordEditor({ ...recordEditor, draft, error: null });
        }}
        onSubmit={submitRecordEditor}
        onCancel={() => setRecordEditor(null)}
      />
      <JsonlConversionDialog
        open={conversionDialogOpen}
        sourceText={sourceText ?? ''}
        onCopy={onCopyText}
        onConversionAction={onConversionAction}
        onCancel={() => setConversionDialogOpen(false)}
      />
      {contextMenu && contextMenuSections.length > 0 && (
        <ContextMenuCard
          ariaLabel={contextMenu.kind === 'record' && contextLine ? `Actions for JSONL line ${contextLine.line}` : 'JSONL actions'}
          sections={contextMenuSections}
          position={contextMenu.position}
          restoreFocusTo={contextMenu.restoreFocusTo}
          onClose={() => setContextMenu(null)}
        />
      )}
    </section>
  );
}

export function jsonlRecordStatusLabel(analysis: JsonlDocumentAnalysis | null): string {
  const parsed = analysis?.parseResult.parsed;
  if (!analysis || !parsed) return 'Source only';
  if (analysis.status === 'invalid') return `${parsed.invalidLineCount} invalid ${parsed.invalidLineCount === 1 ? 'line' : 'lines'}`;
  if (analysis.status === 'preview-truncated') return `Previewing ${parsed.previewLimit} of ${jsonlCountLabel(parsed.totalLineCount, parsed.totalLineCountIsEstimated)} lines`;
  return `${jsonlCountLabel(parsed.recordCount, parsed.recordCountIsEstimated)} ${parsed.recordCount === 1 ? 'record' : 'records'}`;
}

function jsonlLineMatchesSearch(line: JsonlLineResult, query: string): boolean {
  const recordOrdinal = line.recordIndex === null ? '' : String(line.recordIndex + 1);
  const searchable = [
    String(line.line),
    recordOrdinal,
    line.valueType ?? 'invalid',
    line.preview,
    line.diagnostic?.message ?? '',
    line.valid ? JSON.stringify(line.value) ?? '' : '',
  ].join('\n').toLowerCase();
  return searchable.includes(query);
}

function jsonlRecordContextMenuSections({
  line,
  sourceText,
  canEditRecords,
  onCopy,
  onReplace,
  onDuplicate,
  onDelete,
}: {
  line: JsonlLineResult;
  sourceText?: string;
  canEditRecords: boolean;
  onCopy: (content: string, label: string) => Promise<void>;
  onReplace: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}): ContextMenuSection[] {
  const lineText = jsonlLineText(line, sourceText);
  return structuredOperationSectionsToContextMenuSections(
    structuredOperationSectionsForTarget({
      kind: 'jsonl-record',
      valid: line.valid,
      invalidReason: line.diagnostic?.message,
      canEditRecords,
    }),
    {
      copyLine: () => onCopy(lineText, `JSONL line ${line.line}`),
      copyRecordJson: () => onCopy(JSON.stringify(line.value, null, 2) ?? 'null', `JSONL record ${line.recordIndex === null ? line.line : line.recordIndex + 1}`),
      replaceRecord: onReplace,
      duplicateRecord: onDuplicate,
      deleteRecord: onDelete,
    },
  );
}

function jsonlHeaderContextMenuSections({
  canEditRecords,
  canConvert,
  onAppend,
  onConvert,
}: {
  canEditRecords: boolean;
  canConvert: boolean;
  onAppend: () => void;
  onConvert: () => void;
}): ContextMenuSection[] {
  return structuredOperationSectionsToContextMenuSections(
    structuredOperationSectionsForTarget({
      kind: 'jsonl-header',
      canEditRecords,
      canConvert,
    }),
    {
      appendRecord: onAppend,
      convertJsonl: onConvert,
    },
  );
}

function jsonlLineText(line: JsonlLineResult, sourceText?: string): string {
  return sourceText === undefined
    ? line.preview
    : sourceText.slice(line.offset, line.offset + line.length);
}

function jsonlWindowLabel(
  pageInfo: StructuredPreviewPageInfo,
  window: StructuredPreviewPageWindow,
  totalEstimated = false,
): string {
  if (window.empty) return `No ${pageInfo.itemLabel}s`;
  const totalLabel = pageInfo.previewTruncated
    ? `${pageInfo.parsedItems.toLocaleString()} parsed / ${jsonlCountLabel(pageInfo.totalItems, totalEstimated)} total`
    : `${pageInfo.totalItems.toLocaleString()} total`;
  return `${window.startOrdinal.toLocaleString()}-${window.endOrdinal.toLocaleString()} of ${totalLabel}`;
}

function jsonlCountLabel(value: number, estimated: boolean): string {
  return `${estimated ? 'at least ' : ''}${value.toLocaleString()}`;
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number | string }) {
  return (
    <span>
      {icon}
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  );
}

function RecordEditorDialog({
  state,
  onDraftChange,
  onSubmit,
  onCancel,
}: {
  state: RecordEditorState | null;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const title = state?.kind === 'replace'
    ? `Replace JSONL line ${state.line.line}`
    : 'Append JSONL record';
  return (
    <ModalShell open={Boolean(state)} titleId="jsonl-record-editor-title" className="jsonl-record-editor-dialog" onCancel={onCancel}>
      <header className="jsonl-dialog-header">
        <div>
          <h2 id="jsonl-record-editor-title">{title}</h2>
          <p>Enter one JSON value. Formatted JSON is accepted and will be written as one JSONL line.</p>
        </div>
        <button type="button" aria-label="Close JSONL record editor" onClick={onCancel}><X size={16} /></button>
      </header>
      <textarea
        aria-label="JSONL record JSON input"
        spellCheck={false}
        value={state?.draft ?? ''}
        onChange={(event) => onDraftChange(event.target.value)}
      />
      {state?.error && <p className="jsonl-dialog-error">{state.error}</p>}
      <DialogActions>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" onClick={onSubmit}>
          {state?.kind === 'replace' ? 'Replace' : 'Append'}
        </button>
      </DialogActions>
    </ModalShell>
  );
}

function JsonlConversionDialog({
  open,
  sourceText,
  onCopy,
  onConversionAction,
  onCancel,
}: {
  open: boolean;
  sourceText: string;
  onCopy?: (content: string, label: string) => void;
  onConversionAction?: (request: StructuredConversionRequest) => void;
  onCancel: () => void;
}) {
  const [jsonArrayDraft, setJsonArrayDraft] = useState('[\n  {\n    "id": 1\n  }\n]\n');
  const jsonArrayPreview = useMemo(() => jsonlToJsonArrayPreview(sourceText), [sourceText]);
  const jsonlPreview = useMemo(() => (
    jsonArrayDraft.trim().length === 0
      ? { ok: false, content: '', diagnostics: ['Paste a JSON array to preview JSONL output.'] }
      : jsonArrayToJsonlPreview(jsonArrayDraft)
  ), [jsonArrayDraft]);
  const dispatchConversion = (
    action: StructuredConversionAction,
    content: string,
    label: string,
    options: { sourceHash?: string; warnings?: readonly string[] } = {},
  ) => {
    if (action === 'copy' && !onConversionAction) {
      onCopy?.(content, label);
      return;
    }
    onConversionAction?.({
      action,
      content,
      format: label === 'JSON array' ? 'json' : 'jsonl',
      label,
      sourceFormat: 'jsonl',
      sourceHash: options.sourceHash,
      warnings: options.warnings,
    });
  };

  return (
    <ModalShell open={open} titleId="jsonl-conversion-title" className="jsonl-conversion-dialog" onCancel={onCancel}>
      <header className="jsonl-dialog-header">
        <div>
          <h2 id="jsonl-conversion-title">JSONL Conversions</h2>
          <p>Preview conversions explicitly before copying output.</p>
        </div>
        <button type="button" aria-label="Close JSONL conversions" onClick={onCancel}><X size={16} /></button>
      </header>

      <section className="jsonl-conversion-section" aria-label="JSONL to JSON array conversion">
        <div>
          <strong>JSONL to JSON array</strong>
          <ConversionActionButtons
            copyLabel="Copy array"
            disabled={!jsonArrayPreview.ok}
            canCopy={Boolean(onCopy || onConversionAction)}
            canReview={Boolean(onConversionAction)}
            onAction={(action) => dispatchConversion(action, jsonArrayPreview.content, 'JSON array', {
              sourceHash: jsonlSourceHash(sourceText),
              warnings: jsonArrayPreview.diagnostics,
            })}
          />
        </div>
        <ConversionPreview result={jsonArrayPreview} />
      </section>

      <section className="jsonl-conversion-section" aria-label="JSON array to JSONL conversion">
        <div>
          <strong>JSON array to JSONL</strong>
          <ConversionActionButtons
            copyLabel="Copy JSONL"
            disabled={!jsonlPreview.ok}
            canCopy={Boolean(onCopy || onConversionAction)}
            canReview={Boolean(onConversionAction)}
            onAction={(action) => dispatchConversion(action, jsonlPreview.content, 'JSONL', {
              warnings: jsonlPreview.diagnostics,
            })}
          />
        </div>
        <textarea
          aria-label="JSON array input"
          spellCheck={false}
          value={jsonArrayDraft}
          onChange={(event) => setJsonArrayDraft(event.target.value)}
        />
        <ConversionPreview result={jsonlPreview} />
      </section>
    </ModalShell>
  );
}

function ConversionActionButtons({
  copyLabel,
  disabled,
  canCopy,
  canReview,
  onAction,
}: {
  copyLabel: string;
  disabled: boolean;
  canCopy: boolean;
  canReview: boolean;
  onAction: (action: StructuredConversionAction) => void;
}) {
  return (
    <div className="structured-conversion-actions">
      <button type="button" disabled={disabled || !canCopy} onClick={() => onAction('copy')}>
        <Clipboard size={14} />
        {copyLabel}
      </button>
      <button type="button" disabled={disabled || !canReview} onClick={() => onAction('replace-current')}>Replace current</button>
      <button type="button" disabled={disabled || !canReview} onClick={() => onAction('open-new')}>Open as new</button>
      <button type="button" disabled={disabled || !canReview} onClick={() => onAction('save-as')}>Save as</button>
    </div>
  );
}

function ConversionPreview({ result }: { result: { ok: boolean; content: string; diagnostics: string[] } }) {
  if (!result.ok) {
    return (
      <div className="jsonl-conversion-diagnostics" role="alert">
        {result.diagnostics.slice(0, 5).map((diagnostic, index) => <p key={`${diagnostic}:${index}`}>{diagnostic}</p>)}
      </div>
    );
  }
  return <pre>{truncatePreview(result.content)}</pre>;
}

function defaultAppendRecordDraft(fields: readonly string[]): string {
  if (fields.length === 0) return '{\n  "id": null\n}';
  return JSON.stringify(Object.fromEntries(fields.slice(0, 4).map((field) => [field, null])), null, 2);
}

function previewFieldValue(value: unknown): string {
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 77)}...` : value;
  const text = JSON.stringify(value);
  if (text === undefined) return String(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function truncatePreview(value: string): string {
  return value.length > 6000 ? `${value.slice(0, 6000)}\n...` : value;
}

async function writeClipboardText(text: string): Promise<void> {
  return writeContextMenuClipboardText(text, 'JSONL content');
}
