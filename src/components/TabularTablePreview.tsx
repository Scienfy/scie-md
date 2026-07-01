import { AlertTriangle, Clipboard, Code2, Pencil, Plus, TableProperties } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import {
  convertDelimitedText,
  createStructuredPreviewPageInfo,
  structuredPreviewPageItems,
  tabularSourceHash,
  type DelimitedTextConversionFormat,
  type DelimitedTextConversionResult,
  type ParsedDelimitedText,
  type StructuredPreviewPageInfo,
  type StructuredPreviewPageWindow,
  type TabularVisualEditIntent,
} from '@sciemd/core';
import type { TabularDocumentAnalysis } from '../app/formatDiagnostics';
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

export const TABULAR_TABLE_COLUMN_BUDGET = 12;
type VisibleTabularColumn = { index: number; name: string };

export interface TabularTablePreviewProps {
  analysis: TabularDocumentAnalysis | null;
  sourceText?: string;
  editable?: boolean;
  onCopyText?: (content: string, label: string) => void;
  onConversionAction?: (request: StructuredConversionRequest) => void;
  onEditIntent?: (intent: TabularVisualEditIntent) => void;
  onJumpToLine?: (line: number) => void;
  onUnsupportedEdit?: (message: string) => void;
}

type TabularEditDialogState =
  | {
    kind: 'replaceCell';
    dataRowIndex: number;
    columnIndex: number;
    header: string;
    value: string;
  }
  | {
    kind: 'appendRow';
    values: string[];
  };

type TabularInlineCellEditState = {
  dataRowIndex: number;
  columnIndex: number;
  rowPosition: number;
  columnPosition: number;
  value: string;
  error: string | null;
};

type TabularContextMenuState =
  | { kind: 'cell'; rowIndex: number; columnIndex: number; position: { x: number; y: number }; restoreFocusTo?: HTMLElement | null }
  | { kind: 'header'; columnIndex: number; position: { x: number; y: number }; restoreFocusTo?: HTMLElement | null }
  | { kind: 'table'; position: { x: number; y: number }; restoreFocusTo?: HTMLElement | null };

export function TabularTablePreview({
  analysis,
  sourceText,
  editable = false,
  onCopyText,
  onConversionAction,
  onEditIntent,
  onJumpToLine,
  onUnsupportedEdit,
}: TabularTablePreviewProps) {
  const [conversionDialogOpen, setConversionDialogOpen] = useState(false);
  const [editDialog, setEditDialog] = useState<TabularEditDialogState | null>(null);
  const [inlineCellEdit, setInlineCellEdit] = useState<TabularInlineCellEditState | null>(null);
  const [contextMenu, setContextMenu] = useState<TabularContextMenuState | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [rowSearchQuery, setRowSearchQuery] = useState('');
  const [rowJumpDraft, setRowJumpDraft] = useState('');
  const [columnStartIndex, setColumnStartIndex] = useState(0);
  const [selectedColumnIndex, setSelectedColumnIndex] = useState(0);
  const [pinnedColumnIndex, setPinnedColumnIndex] = useState<number | null>(null);
  const [focusedCell, setFocusedCell] = useState<StructuredGridFocus>({ row: 0, column: 0 });
  const cellRefs = useRef(new Map<string, HTMLElement>());
  const parsed = analysis?.parseResult.parsed ?? null;
  if (!analysis || !parsed) {
    return (
      <section className="tabular-table-preview" aria-label="Tabular preview">
        <header className="tabular-table-header">
          <div>
            <TableProperties size={16} />
            <strong>Table preview</strong>
            <span>No table preview available</span>
          </div>
        </header>
        <div className="tabular-table-empty">Source remains editable while tabular diagnostics are unavailable.</div>
      </section>
    );
  }

  const normalizedRowSearch = rowSearchQuery.trim().toLowerCase();
  const allRows = parsed.dataRows.map((row, dataRowIndex) => ({ row, dataRowIndex }));
  const filteredRows = normalizedRowSearch
    ? allRows.filter((item) => tabularRowMatchesSearch(item.row, item.dataRowIndex, parsed.header.names, normalizedRowSearch))
    : allRows;
  const rowPageInfo = normalizedRowSearch
    ? createStructuredPreviewPageInfo({
      itemLabel: 'row',
      totalItems: filteredRows.length,
      parsedItems: filteredRows.length,
      pageSize: parsed.previewPageInfo.pageSize,
    })
    : parsed.previewPageInfo;
  const pagedRows = structuredPreviewPageItems(
    filteredRows,
    rowPageInfo,
    pageIndex,
  );
  const visibleRows = pagedRows.items;
  const visibleWindow = pagedRows.window;
  const visibleColumns = tabularVisibleColumns({
    headers: parsed.header.names,
    columnStartIndex,
    pinnedColumnIndex,
  });
  const focusedCellKey = structuredGridCellKey(focusedCell.row, focusedCell.column);
  const hiddenColumnCount = Math.max(0, parsed.columnCount - visibleColumns.length);
  const hiddenRowCount = Math.max(0, rowPageInfo.totalItems - visibleRows.length);
  const warningCount = parsed.diagnostics.filter((diagnostic) => diagnostic.severity !== 'info').length;
  const editDisabledReason = tabularEditDisabledReason(parsed);
  const editsAvailable = Boolean(editable && onEditIntent && sourceText !== undefined && !editDisabledReason);
  const appendDisabledReason = editDisabledReason
    ?? (parsed.previewTruncated ? 'Appending rows is disabled while the parser preview is truncated.' : null);
  const appendAvailable = Boolean(editable && onEditIntent && sourceText !== undefined && !appendDisabledReason);
  const readonlyReason = !editable
    ? null
    : editDisabledReason ?? (!onEditIntent || sourceText === undefined ? 'Table edits are not connected for this view.' : null);
  const focusGridCell = (row: number, column: number) => {
    const next = { row: Math.max(0, row), column: Math.max(0, column) };
    setFocusedCell(next);
    window.requestAnimationFrame(() => {
      cellRefs.current.get(structuredGridCellKey(next.row, next.column))?.focus();
    });
  };
  const openConversionDialog = () => {
    setContextMenu(null);
    setConversionDialogOpen(true);
  };
  const openAppendRowDialog = () => {
    setContextMenu(null);
    if (!appendAvailable) {
      onUnsupportedEdit?.(appendDisabledReason ?? 'Table row append is not available.');
      return;
    }
    setEditDialog({
      kind: 'appendRow',
      values: Array.from({ length: parsed.columnCount }, () => ''),
    });
  };
  const startInlineCellEdit = (
    dataRowIndex: number,
    columnIndex: number,
    rowPosition = Math.max(0, visibleRows.findIndex((item) => item.dataRowIndex === dataRowIndex)),
    columnPosition = Math.max(1, visibleColumns.findIndex((column) => column.index === columnIndex) + 1),
  ) => {
    setContextMenu(null);
    if (!editsAvailable) {
      onUnsupportedEdit?.(editDisabledReason ?? 'Table cell editing is not available.');
      return;
    }
    setFocusedCell({ row: rowPosition, column: columnPosition });
    setInlineCellEdit({
      dataRowIndex,
      columnIndex,
      value: parsed.dataRows[dataRowIndex]?.[columnIndex] ?? '',
      rowPosition,
      columnPosition,
      error: null,
    });
  };
  const commitInlineCellEdit = (state: TabularInlineCellEditState) => {
    if (!onEditIntent || sourceText === undefined) {
      setInlineCellEdit({ ...state, error: 'Table cell editing is not connected for this view.' });
      return;
    }
    setInlineCellEdit(null);
    onEditIntent({
      kind: 'replaceCell',
      format: analysis.format,
      dataRowIndex: state.dataRowIndex,
      columnIndex: state.columnIndex,
      nextValue: state.value,
      expectedSourceHash: tabularSourceHash(sourceText),
    });
    focusGridCell(state.rowPosition, state.columnPosition);
  };
  const cancelInlineCellEdit = (state: TabularInlineCellEditState) => {
    setInlineCellEdit(null);
    focusGridCell(state.rowPosition, state.columnPosition);
  };
  const copyText = (content: string, label: string) => {
    if (onCopyText) {
      onCopyText(content, label);
      return Promise.resolve();
    }
    return writeClipboardText(content);
  };
  const openCellContextMenu = (rowIndex: number, columnIndex: number, event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: 'cell',
      rowIndex,
      columnIndex,
      position: { x: event.clientX, y: event.clientY },
      restoreFocusTo: event.currentTarget,
    });
  };
  const openHeaderContextMenu = (columnIndex: number, event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: 'header',
      columnIndex,
      position: { x: event.clientX, y: event.clientY },
      restoreFocusTo: event.currentTarget,
    });
  };
  const openTableContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setContextMenu({
      kind: 'table',
      position: { x: event.clientX, y: event.clientY },
      restoreFocusTo: event.currentTarget,
    });
  };
  const openCellKeyboardContextMenu = (rowIndex: number, columnIndex: number, event: KeyboardEvent<HTMLElement>) => {
    if (!isKeyboardContextMenuEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.target instanceof HTMLElement ? event.target : event.currentTarget;
    setContextMenu({
      kind: 'cell',
      rowIndex,
      columnIndex,
      position: contextMenuPositionFromElement(event.currentTarget),
      restoreFocusTo: target,
    });
  };
  const openHeaderKeyboardContextMenu = (columnIndex: number, event: KeyboardEvent<HTMLElement>) => {
    if (!isKeyboardContextMenuEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: 'header',
      columnIndex,
      position: contextMenuPositionFromElement(event.currentTarget),
      restoreFocusTo: event.currentTarget,
    });
  };
  const openTableKeyboardContextMenu = (event: KeyboardEvent<HTMLElement>) => {
    if (!isKeyboardContextMenuEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: 'table',
      position: contextMenuPositionFromElement(event.currentTarget),
      restoreFocusTo: event.currentTarget,
    });
  };
  const focusSelectedColumn = (columnIndex: number) => {
    const boundedColumn = Math.max(0, Math.min(parsed.columnCount - 1, columnIndex));
    const nextStart = tabularColumnWindowStartForIndex(boundedColumn, parsed.columnCount);
    const nextVisibleColumns = tabularVisibleColumns({
      headers: parsed.header.names,
      columnStartIndex: nextStart,
      pinnedColumnIndex,
    });
    setSelectedColumnIndex(boundedColumn);
    setColumnStartIndex(nextStart);
    setFocusedCell((current) => ({ ...current, column: tabularFocusedColumnPosition(nextVisibleColumns, boundedColumn) }));
  };
  const jumpToTableRow = () => {
    const requested = Number.parseInt(rowJumpDraft.trim(), 10);
    if (!Number.isFinite(requested) || requested <= 0) {
      onUnsupportedEdit?.('Enter a positive row number to jump.');
      return;
    }
    const targetIndex = filteredRows.findIndex((item) => item.dataRowIndex + 1 === requested);
    if (targetIndex < 0) {
      onUnsupportedEdit?.('That row is not present in the parsed preview window.');
      return;
    }
    const nextPageIndex = Math.floor(targetIndex / rowPageInfo.pageSize);
    setPageIndex(nextPageIndex);
    const sourceRowIndex = parsed.header.hasHeader ? requested : requested - 1;
    const line = parsed.sourceRows[sourceRowIndex]?.span.line;
    if (line && onJumpToLine) onJumpToLine(line);
    window.requestAnimationFrame(() => {
      focusGridCell(targetIndex - nextPageIndex * rowPageInfo.pageSize, 0);
    });
  };
  const handleGridCellKeyDown = (
    dataRowIndex: number,
    columnIndex: number,
    rowPosition: number,
    columnPosition: number,
    event: KeyboardEvent<HTMLElement>,
  ) => {
    if (isKeyboardContextMenuEvent(event)) {
      openCellKeyboardContextMenu(dataRowIndex, columnIndex, event);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      startInlineCellEdit(dataRowIndex, columnIndex, rowPosition, columnPosition);
      return;
    }
    if (event.key === 'Escape') {
      event.currentTarget.blur();
      return;
    }
    const next = moveStructuredGridFocus(
      { row: rowPosition, column: columnPosition },
      event,
      { rowCount: visibleRows.length, columnCount: visibleColumns.length + 1, pageStep: Math.max(1, visibleRows.length - 1) },
    );
    if (!next) return;
    event.preventDefault();
    focusGridCell(next.row, next.column);
  };
  const contextMenuSections = contextMenu
    ? tabularContextMenuSections({
      contextMenu,
      headers: parsed.header.names,
      visibleRows,
      parsed,
      editsAvailable,
      appendAvailable,
      editDisabledReason,
      appendDisabledReason,
      canConvert: Boolean(onCopyText || onConversionAction),
      onEditCell: startInlineCellEdit,
      onAppendRow: openAppendRowDialog,
      onConvert: openConversionDialog,
      onCopy: copyText,
    })
    : [];

  return (
    <section className="tabular-table-preview" aria-label={`${formatLabel(analysis.format)} table preview`}>
      <header
        className="tabular-table-header"
        tabIndex={0}
        onKeyDown={openTableKeyboardContextMenu}
        onContextMenu={openTableContextMenu}
      >
        <div>
          <TableProperties size={16} />
          <strong>{formatLabel(analysis.format)} table</strong>
          <span>{tabularStatusLabel(analysis)}</span>
        </div>
        <div className="tabular-table-actions" aria-label="Tabular actions">
          <button
            type="button"
            onClick={openConversionDialog}
            disabled={!onCopyText && !onConversionAction}
            title="Preview table conversions"
          >
            <Code2 size={14} />
            Convert
          </button>
          <button
            type="button"
            onClick={openAppendRowDialog}
            disabled={!appendAvailable}
            title={appendDisabledReason ?? 'Append a row'}
          >
            <Plus size={14} />
            Add row
          </button>
        </div>
        <div className="tabular-table-metrics" aria-label="Table summary">
          <Metric label="Rows" value={tabularCountLabel(parsed.totalDataRowCount, parsed.totalDataRowCountIsEstimated)} />
          <Metric label="Columns" value={parsed.columnCount} />
          <Metric label="Delimiter" value={parsed.delimiterLabel} />
        </div>
      </header>

      {warningCount > 0 && (
        <div className="tabular-table-warning" role="status">
          <AlertTriangle size={14} />
          <span>{warningCount} parser or conversion warning{warningCount === 1 ? '' : 's'}; source remains authoritative.</span>
        </div>
      )}
      {readonlyReason && (
        <div className="tabular-table-warning" role="status">
          <AlertTriangle size={14} />
          <span>{readonlyReason}</span>
        </div>
      )}
      {parsed.previewTruncated && (
        <div className="tabular-table-warning" role="status">
          <AlertTriangle size={14} />
          <span>Parser preview covers {parsed.parsedDataRowCount.toLocaleString()} of {tabularCountLabel(parsed.totalDataRowCount, parsed.totalDataRowCountIsEstimated)} data rows. Source editing remains available for the full file.</span>
        </div>
      )}

      {parsed.columns.length > 0 && (
        <div className="tabular-column-summary" aria-label="Column summary">
          {visibleColumns.slice(0, 10).map((visibleColumn) => {
            const column = parsed.columns[visibleColumn.index];
            if (!column) return null;
            return (
            <span key={`${column.index}:${column.name}`}>
              <strong>{column.name}</strong>
              <small>{column.types.join('|')}{column.emptyCount ? `, ${column.emptyCount} empty` : ''}</small>
            </span>
            );
          })}
        </div>
      )}

      <div className="tabular-table-window-controls" aria-label="Table row window controls">
        <label className="structured-window-search">
          <span>Search</span>
          <input
            aria-label="Search table parsed preview"
            value={rowSearchQuery}
            placeholder="row, header, value"
            onChange={(event) => {
              setRowSearchQuery(event.target.value);
              setPageIndex(0);
              setFocusedCell({ row: 0, column: 0 });
            }}
          />
        </label>
        <label className="structured-window-jump">
          <span>Jump</span>
          <input
            aria-label="Jump to table row"
            inputMode="numeric"
            value={rowJumpDraft}
            placeholder="row"
            onChange={(event) => setRowJumpDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                jumpToTableRow();
              }
            }}
          />
        </label>
        <button type="button" onClick={jumpToTableRow}>Go</button>
        <button type="button" disabled={visibleWindow.pageIndex === 0} onClick={() => setPageIndex((current) => Math.max(0, current - 1))}>
          Previous
        </button>
        <span>{tabularWindowLabel(rowPageInfo, visibleWindow, parsed.totalDataRowCountIsEstimated && !normalizedRowSearch)}</span>
        <button type="button" disabled={visibleWindow.pageIndex >= visibleWindow.pageCount - 1} onClick={() => setPageIndex((current) => Math.min(visibleWindow.pageCount - 1, current + 1))}>
          Next
        </button>
      </div>

      <div className="tabular-column-controls" aria-label="Table column controls">
        <button
          type="button"
          disabled={columnStartIndex <= 0}
          onClick={() => setColumnStartIndex((current) => Math.max(0, current - TABULAR_TABLE_COLUMN_BUDGET))}
        >
          Previous columns
        </button>
        <span>{tabularColumnWindowLabel(visibleColumns, parsed.columnCount, pinnedColumnIndex)}</span>
        <button
          type="button"
          disabled={columnStartIndex + TABULAR_TABLE_COLUMN_BUDGET >= parsed.columnCount}
          onClick={() => setColumnStartIndex((current) => Math.min(tabularMaxColumnStart(parsed.columnCount), current + TABULAR_TABLE_COLUMN_BUDGET))}
        >
          Next columns
        </button>
        <label>
          <span>Column</span>
          <select
            aria-label="Choose visible table column"
            value={Math.min(selectedColumnIndex, Math.max(0, parsed.columnCount - 1))}
            onChange={(event) => focusSelectedColumn(Number.parseInt(event.target.value, 10))}
          >
            {parsed.header.names.map((name, index) => (
              <option key={`${name}:${index}`} value={index}>{index + 1}. {name}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={parsed.columnCount === 0}
          onClick={() => setPinnedColumnIndex((current) => current === selectedColumnIndex ? null : selectedColumnIndex)}
        >
          {pinnedColumnIndex === selectedColumnIndex ? 'Unpin' : 'Pin'}
        </button>
      </div>

      <div className="tabular-table-scroll">
        <table role="grid" aria-rowcount={rowPageInfo.totalItems + 1} aria-colcount={parsed.columnCount + 1}>
          <thead>
            <tr>
              <th>Row</th>
              {visibleColumns.map((column) => (
                <th
                  key={`${column.name}:${column.index}`}
                  aria-colindex={column.index + 2}
                  tabIndex={0}
                  onKeyDown={(event) => openHeaderKeyboardContextMenu(column.index, event)}
                  onContextMenu={(event) => openHeaderContextMenu(column.index, event)}
                >
                  {column.name}
                </th>
              ))}
              {hiddenColumnCount > 0 && <th>+{hiddenColumnCount}</th>}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ row, dataRowIndex }, rowPosition) => (
              <tr key={`row:${dataRowIndex}`} aria-rowindex={visibleWindow.startIndex + rowPosition + 2}>
                <td
                  ref={(node) => {
                    const key = structuredGridCellKey(rowPosition, 0);
                    if (node) cellRefs.current.set(key, node);
                    else cellRefs.current.delete(key);
                  }}
                  role="rowheader"
                  tabIndex={focusedCellKey === structuredGridCellKey(rowPosition, 0) ? 0 : -1}
                  onFocus={() => setFocusedCell({ row: rowPosition, column: 0 })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && onJumpToLine) {
                      event.preventDefault();
                      const sourceRowIndex = parsed.header.hasHeader ? dataRowIndex + 1 : dataRowIndex;
                      const line = parsed.sourceRows[sourceRowIndex]?.span.line;
                      if (line) onJumpToLine(line);
                      return;
                    }
                    const next = moveStructuredGridFocus(
                      { row: rowPosition, column: 0 },
                      event,
                      { rowCount: visibleRows.length, columnCount: visibleColumns.length + 1, pageStep: Math.max(1, visibleRows.length - 1) },
                    );
                    if (!next) return;
                    event.preventDefault();
                    focusGridCell(next.row, next.column);
                  }}
                >
                  {onJumpToLine ? (
                    <button
                      type="button"
                      className="tabular-row-jump"
                      tabIndex={-1}
                      aria-label={`Jump to table row ${dataRowIndex + 1}`}
                      onClick={() => {
                        const sourceRowIndex = parsed.header.hasHeader ? dataRowIndex + 1 : dataRowIndex;
                        const line = parsed.sourceRows[sourceRowIndex]?.span.line;
                        if (line) onJumpToLine(line);
                      }}
                    >
                      {dataRowIndex + 1}
                    </button>
                  ) : dataRowIndex + 1}
                </td>
                {visibleColumns.map((column, columnPosition) => (
                  <td
                    key={`${dataRowIndex}:${column.index}`}
                    ref={(node) => {
                      const key = structuredGridCellKey(rowPosition, columnPosition + 1);
                      if (node) cellRefs.current.set(key, node);
                      else cellRefs.current.delete(key);
                    }}
                    title={row[column.index] ?? ''}
                    tabIndex={focusedCellKey === structuredGridCellKey(rowPosition, columnPosition + 1) ? 0 : -1}
                    aria-colindex={column.index + 2}
                    onFocus={() => setFocusedCell({ row: rowPosition, column: columnPosition + 1 })}
                    onKeyDown={(event) => handleGridCellKeyDown(dataRowIndex, column.index, rowPosition, columnPosition + 1, event)}
                    onContextMenu={(event) => openCellContextMenu(dataRowIndex, column.index, event)}
                  >
                    {inlineCellEdit?.dataRowIndex === dataRowIndex && inlineCellEdit.columnIndex === column.index ? (
                      <TabularInlineCellEditor
                        state={inlineCellEdit}
                        onChange={(next) => setInlineCellEdit(next)}
                        onCommit={commitInlineCellEdit}
                        onCancel={() => cancelInlineCellEdit(inlineCellEdit)}
                      />
                    ) : editable ? (
                      <button
                        type="button"
                        className="tabular-cell-edit-button"
                        disabled={!editsAvailable}
                        tabIndex={-1}
                        title={editDisabledReason ?? `Edit row ${dataRowIndex + 1}, column ${column.index + 1}`}
                        onClick={() => startInlineCellEdit(dataRowIndex, column.index, rowPosition, columnPosition + 1)}
                      >
                        <span>{previewCell(row[column.index] ?? '')}</span>
                        <Pencil size={12} aria-hidden="true" />
                      </button>
                    ) : previewCell(row[column.index] ?? '')}
                  </td>
                ))}
                {hiddenColumnCount > 0 && <td className="tabular-table-more">...</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(hiddenRowCount > 0 || hiddenColumnCount > 0 || parsed.previewTruncated) && (
        <p className="tabular-table-truncated">
          Showing {visibleRows.length} of {tabularCountLabel(rowPageInfo.totalItems, parsed.totalDataRowCountIsEstimated && !normalizedRowSearch)} rows and {visibleColumns.length} of {parsed.columnCount} columns.
          {parsed.previewTruncated ? ` Parser preview is capped at ${parsed.maxRows} source rows.` : ''}
        </p>
      )}
      <TabularConversionDialog
        open={conversionDialogOpen}
        analysis={analysis}
        sourceText={sourceText}
        onCopy={onCopyText}
        onConversionAction={onConversionAction}
        onCancel={() => setConversionDialogOpen(false)}
      />
      <TabularEditDialog
        key={editDialog ? `${editDialog.kind}:${editDialog.kind === 'replaceCell' ? `${editDialog.dataRowIndex}:${editDialog.columnIndex}` : 'append'}` : 'closed'}
        state={editDialog}
        analysis={analysis}
        sourceText={sourceText}
        onCancel={() => setEditDialog(null)}
        onSubmit={(intent) => {
          onEditIntent?.(intent);
          setEditDialog(null);
        }}
      />
      {contextMenu && contextMenuSections.length > 0 && (
        <ContextMenuCard
          ariaLabel={tabularContextMenuLabel(contextMenu, parsed.header.names)}
          sections={contextMenuSections}
          position={contextMenu.position}
          restoreFocusTo={contextMenu.restoreFocusTo}
          onClose={() => setContextMenu(null)}
        />
      )}
    </section>
  );
}

export function tabularStatusLabel(analysis: TabularDocumentAnalysis | null): string {
  const parsed = analysis?.parseResult.parsed;
  if (!analysis || !parsed) return 'Source only';
  if (analysis.status === 'invalid') return 'Invalid table source';
  if (analysis.status === 'preview-truncated') return `Previewing first ${analysis.previewLimit} rows`;
  return `${tabularCountLabel(parsed.dataRowCount, false)} ${parsed.dataRowCount === 1 ? 'row' : 'rows'}`;
}

function tabularContextMenuSections({
  contextMenu,
  headers,
  visibleRows,
  parsed,
  editsAvailable,
  appendAvailable,
  editDisabledReason,
  appendDisabledReason,
  canConvert,
  onEditCell,
  onAppendRow,
  onConvert,
  onCopy,
}: {
  contextMenu: TabularContextMenuState;
  headers: string[];
  visibleRows: Array<{ row: string[]; dataRowIndex: number }>;
  parsed: ParsedDelimitedText;
  editsAvailable: boolean;
  appendAvailable: boolean;
  editDisabledReason: string | null;
  appendDisabledReason: string | null;
  canConvert: boolean;
  onEditCell: (rowIndex: number, columnIndex: number) => void;
  onAppendRow: () => void;
  onConvert: () => void;
  onCopy: (content: string, label: string) => Promise<void>;
}): ContextMenuSection[] {
  if (contextMenu.kind === 'cell') {
    const row = parsed.dataRows[contextMenu.rowIndex] ?? [];
    const header = headers[contextMenu.columnIndex] ?? `Column ${contextMenu.columnIndex + 1}`;
    const cellValue = row[contextMenu.columnIndex] ?? '';
    return structuredOperationSectionsToContextMenuSections(
      structuredOperationSectionsForTarget({
        kind: 'tabular-cell',
        editsAvailable,
        editDisabledReason,
      }),
      {
        editCell: () => onEditCell(contextMenu.rowIndex, contextMenu.columnIndex),
        copyCell: () => onCopy(cellValue, `${header} cell`),
        copyRow: () => onCopy(formatClipboardRow(row), `Row ${contextMenu.rowIndex + 1}`),
      },
    );
  }

  if (contextMenu.kind === 'header') {
    const header = headers[contextMenu.columnIndex] ?? `Column ${contextMenu.columnIndex + 1}`;
    return structuredOperationSectionsToContextMenuSections(
      structuredOperationSectionsForTarget({ kind: 'tabular-header' }),
      {
        copyColumnName: () => onCopy(header, `${header} column name`),
        copyVisibleColumnValues: () => onCopy(visibleRows.map(({ row }) => row[contextMenu.columnIndex] ?? '').join('\n'), `${header} visible values`),
      },
    );
  }

  return structuredOperationSectionsToContextMenuSections(
    structuredOperationSectionsForTarget({
      kind: 'tabular-table',
      appendAvailable,
      appendDisabledReason,
      canConvert,
    }),
    {
      addRow: onAppendRow,
      convertTable: onConvert,
    },
  );
}

function tabularContextMenuLabel(contextMenu: TabularContextMenuState, headers: string[]): string {
  if (contextMenu.kind === 'cell') {
    const header = headers[contextMenu.columnIndex] ?? `Column ${contextMenu.columnIndex + 1}`;
    return `Actions for row ${contextMenu.rowIndex + 1}, ${header}`;
  }
  if (contextMenu.kind === 'header') {
    return `Actions for ${headers[contextMenu.columnIndex] ?? `column ${contextMenu.columnIndex + 1}`}`;
  }
  return 'Table actions';
}

function tabularWindowLabel(
  pageInfo: StructuredPreviewPageInfo,
  window: StructuredPreviewPageWindow,
  totalEstimated = false,
): string {
  if (window.empty) return `No ${pageInfo.itemLabel}s`;
  const totalLabel = pageInfo.previewTruncated
    ? `${pageInfo.parsedItems.toLocaleString()} parsed / ${tabularCountLabel(pageInfo.totalItems, totalEstimated)} total`
    : `${pageInfo.totalItems.toLocaleString()} total`;
  return `${window.startOrdinal.toLocaleString()}-${window.endOrdinal.toLocaleString()} of ${totalLabel}`;
}

function tabularVisibleColumns({
  headers,
  columnStartIndex,
  pinnedColumnIndex,
}: {
  headers: readonly string[];
  columnStartIndex: number;
  pinnedColumnIndex: number | null;
}): VisibleTabularColumn[] {
  const start = Math.max(0, Math.min(tabularMaxColumnStart(headers.length), columnStartIndex));
  const windowIndexes = Array.from(
    { length: Math.min(TABULAR_TABLE_COLUMN_BUDGET, Math.max(0, headers.length - start)) },
    (_, index) => start + index,
  );
  const indexes = pinnedColumnIndex === null || windowIndexes.includes(pinnedColumnIndex)
    ? windowIndexes
    : [pinnedColumnIndex, ...windowIndexes.filter((index) => index !== pinnedColumnIndex)].slice(0, TABULAR_TABLE_COLUMN_BUDGET);
  return indexes.map((index) => ({ index, name: headers[index] ?? `Column ${index + 1}` }));
}

function tabularMaxColumnStart(columnCount: number): number {
  return Math.max(0, columnCount - TABULAR_TABLE_COLUMN_BUDGET);
}

function tabularColumnWindowStartForIndex(columnIndex: number, columnCount: number): number {
  const halfWindow = Math.floor(TABULAR_TABLE_COLUMN_BUDGET / 2);
  return Math.max(0, Math.min(tabularMaxColumnStart(columnCount), columnIndex - halfWindow));
}

function tabularFocusedColumnPosition(visibleColumns: readonly VisibleTabularColumn[], columnIndex: number): number {
  const position = visibleColumns.findIndex((column) => column.index === columnIndex);
  return position < 0 ? 1 : position + 1;
}

function tabularColumnWindowLabel(
  visibleColumns: readonly VisibleTabularColumn[],
  columnCount: number,
  pinnedColumnIndex: number | null,
): string {
  if (columnCount <= 0 || visibleColumns.length === 0) return 'No columns';
  const ordinals = visibleColumns.map((column) => column.index + 1);
  const start = Math.min(...ordinals);
  const end = Math.max(...ordinals);
  const pinned = pinnedColumnIndex === null ? '' : `; pinned ${pinnedColumnIndex + 1}`;
  return `Columns ${start}-${end} of ${columnCount}${pinned}`;
}

function tabularRowMatchesSearch(
  row: readonly string[],
  dataRowIndex: number,
  headers: readonly string[],
  query: string,
): boolean {
  if (String(dataRowIndex + 1).includes(query)) return true;
  return row.some((cell, columnIndex) => {
    const header = headers[columnIndex] ?? `Column ${columnIndex + 1}`;
    return header.toLowerCase().includes(query) || cell.toLowerCase().includes(query);
  });
}

function formatClipboardRow(row: readonly string[]): string {
  return row.join('\t');
}

function TabularInlineCellEditor({
  state,
  onChange,
  onCommit,
  onCancel,
}: {
  state: TabularInlineCellEditState;
  onChange: (state: TabularInlineCellEditState) => void;
  onCommit: (state: TabularInlineCellEditState) => void;
  onCancel: () => void;
}) {
  const cancelingRef = useRef(false);
  const commit = () => {
    if (cancelingRef.current) return;
    onCommit(state);
  };
  return (
    <span className="tabular-inline-cell-editor">
      <input
        autoFocus
        aria-label={`Inline edit row ${state.dataRowIndex + 1}, column ${state.columnIndex + 1}`}
        className={state.error ? 'has-error' : ''}
        value={state.value}
        onChange={(event) => onChange({ ...state, value: event.target.value, error: null })}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            cancelingRef.current = true;
            onCancel();
          }
        }}
      />
      {state.error && <small role="alert">{state.error}</small>}
    </span>
  );
}

function TabularEditDialog({
  state,
  analysis,
  sourceText,
  onCancel,
  onSubmit,
}: {
  state: TabularEditDialogState | null;
  analysis: TabularDocumentAnalysis;
  sourceText?: string;
  onCancel: () => void;
  onSubmit: (intent: TabularVisualEditIntent) => void;
}) {
  const parsed = analysis.parseResult.parsed;
  const [cellValue, setCellValue] = useState(state?.kind === 'replaceCell' ? state.value : '');
  const [rowValues, setRowValues] = useState(state?.kind === 'appendRow' ? state.values : []);
  const [error, setError] = useState<string | null>(null);

  if (!state || !parsed || sourceText === undefined) return null;

  const submit = () => {
    if (state.kind === 'replaceCell') {
      onSubmit({
        kind: 'replaceCell',
        format: analysis.format,
        dataRowIndex: state.dataRowIndex,
        columnIndex: state.columnIndex,
        nextValue: cellValue,
        expectedSourceHash: tabularSourceHash(sourceText),
      });
      return;
    }
    if (rowValues.length !== parsed.columnCount) {
      setError(`New rows must contain exactly ${parsed.columnCount} cells.`);
      return;
    }
    onSubmit({
      kind: 'appendRow',
      format: analysis.format,
      values: rowValues,
      expectedSourceHash: tabularSourceHash(sourceText),
    });
  };

  return (
    <ModalShell open titleId="tabular-edit-title" className="tabular-edit-dialog" onCancel={onCancel}>
      <header className="tabular-conversion-header">
        <div>
          <h2 id="tabular-edit-title">{state.kind === 'replaceCell' ? 'Edit Table Cell' : 'Append Table Row'}</h2>
          <p>{state.kind === 'replaceCell' ? `Row ${state.dataRowIndex + 1}, ${state.header}` : 'Values are written as strings without type inference.'}</p>
        </div>
        <button type="button" aria-label="Close table edit" onClick={onCancel}>Close</button>
      </header>

      {state.kind === 'replaceCell' ? (
        <label className="tabular-edit-field">
          <span>Value</span>
          <textarea
            value={cellValue}
            onChange={(event) => setCellValue(event.target.value)}
            autoFocus
          />
        </label>
      ) : (
        <div className="tabular-edit-row-fields" aria-label="New row values">
          {parsed.header.names.map((name, index) => (
            <label key={`${name}:${index}`} className="tabular-edit-field">
              <span>{name}</span>
              <input
                value={rowValues[index] ?? ''}
                onChange={(event) => {
                  const next = [...rowValues];
                  next[index] = event.target.value;
                  setRowValues(next);
                }}
              />
            </label>
          ))}
        </div>
      )}

      {error && <p className="tabular-edit-error">{error}</p>}

      <DialogActions>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" onClick={submit}>
          {state.kind === 'replaceCell' ? 'Apply cell edit' : 'Append row'}
        </button>
      </DialogActions>
    </ModalShell>
  );
}

function TabularConversionDialog({
  open,
  analysis,
  sourceText,
  onCopy,
  onConversionAction,
  onCancel,
}: {
  open: boolean;
  analysis: TabularDocumentAnalysis;
  sourceText?: string;
  onCopy?: (content: string, label: string) => void;
  onConversionAction?: (request: StructuredConversionRequest) => void;
  onCancel: () => void;
}) {
  const parsed = analysis.parseResult.parsed;
  const [selectedFormat, setSelectedFormat] = useState<DelimitedTextConversionFormat>('json');
  const conversions = useMemo(() => parsed ? conversionOptions(parsed) : [], [parsed]);
  const selected = conversions.find((conversion) => conversion.format === selectedFormat) ?? conversions[0];
  const warnings = selected?.diagnostics.filter((diagnostic) => diagnostic.severity !== 'info') ?? [];
  const dispatchConversion = (action: StructuredConversionAction) => {
    if (!selected) return;
    if (action === 'copy' && !onConversionAction) {
      onCopy?.(selected.content, selected.label);
      onCancel();
      return;
    }
    onConversionAction?.({
      action,
      content: selected.content,
      format: selected.format,
      label: selected.label,
      sourceFormat: analysis.format,
      sourceHash: sourceText === undefined ? undefined : tabularSourceHash(sourceText),
      warnings: warnings.map((warning) => warning.message),
    });
    onCancel();
  };

  if (!open || !parsed || !selected) return null;

  return (
    <ModalShell open={open} titleId="tabular-conversion-title" className="tabular-conversion-dialog" onCancel={onCancel}>
      <header className="tabular-conversion-header">
        <div>
          <h2 id="tabular-conversion-title">Table Conversions</h2>
          <p>Preview string-preserving conversions before copying output.</p>
        </div>
        <button type="button" aria-label="Close table conversions" onClick={onCancel}>Close</button>
      </header>

      <div className="tabular-paste-options" role="radiogroup" aria-label="Table conversion format">
        {conversions.map((conversion) => (
          <label key={conversion.format} className={selected.format === conversion.format ? 'selected' : ''}>
            <input
              type="radio"
              name="tabular-conversion-format"
              checked={selected.format === conversion.format}
              onChange={() => setSelectedFormat(conversion.format)}
            />
            <span>{conversion.label}</span>
          </label>
        ))}
      </div>

      {warnings.length > 0 && (
        <section className="tabular-paste-warnings" aria-label="Conversion warnings">
          {warnings.slice(0, 5).map((warning, index) => (
            <p key={`${warning.code}:${warning.line ?? 0}:${warning.column ?? 0}:${index}`}>{warning.message}</p>
          ))}
          {warnings.length > 5 && <p>{warnings.length - 5} more warnings in this conversion.</p>}
        </section>
      )}

      <section className="tabular-paste-preview" aria-label={`${selected.label} preview`}>
        <div>
          <TableProperties size={15} />
          <strong>{selected.label}</strong>
        </div>
        <pre>{truncatePreview(selected.content)}</pre>
      </section>

      <DialogActions>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          disabled={!onCopy && !onConversionAction}
          onClick={() => dispatchConversion('copy')}
        >
          <Clipboard size={15} />
          Copy
        </button>
        <button type="button" disabled={!onConversionAction} onClick={() => dispatchConversion('replace-current')}>Replace current</button>
        <button type="button" disabled={!onConversionAction} onClick={() => dispatchConversion('open-new')}>Open as new</button>
        <button type="button" className="primary" disabled={!onConversionAction} onClick={() => dispatchConversion('save-as')}>Save as</button>
      </DialogActions>
    </ModalShell>
  );
}

function conversionOptions(parsed: NonNullable<TabularDocumentAnalysis['parseResult']['parsed']>): DelimitedTextConversionResult[] {
  return [
    convertDelimitedText(parsed, 'markdown'),
    convertDelimitedText(parsed, 'json'),
    convertDelimitedText(parsed, 'jsonl'),
    convertDelimitedText(parsed, 'yaml'),
    convertDelimitedText(parsed, 'toml'),
  ];
}

function tabularEditDisabledReason(parsed: ParsedDelimitedText): string | null {
  const error = parsed.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (error) return error.message;
  if (parsed.delimiterAmbiguous) return 'Table edits are disabled because delimiter inference is ambiguous.';
  const blocking = parsed.diagnostics.find((diagnostic) => (
    diagnostic.code === 'tabular-inconsistent-row-width'
    || diagnostic.code === 'tabular-characters-after-quote'
  ));
  return blocking?.message ?? null;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <span>
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  );
}

function tabularCountLabel(value: number, estimated: boolean): string {
  return `${estimated ? 'at least ' : ''}${value.toLocaleString()}`;
}

function formatLabel(format: 'csv' | 'tsv'): string {
  return format === 'tsv' ? 'TSV' : 'CSV';
}

function previewCell(value: string): string {
  if (value.length === 0) return '-';
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function truncatePreview(value: string): string {
  return value.length > 6000 ? `${value.slice(0, 6000)}\n...` : value;
}

async function writeClipboardText(text: string): Promise<void> {
  return writeContextMenuClipboardText(text, 'table content');
}
