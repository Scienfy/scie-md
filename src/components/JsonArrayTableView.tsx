import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import {
  Clipboard,
  Copy,
  FileCode2,
  Pencil,
  Rows3,
  TableProperties,
} from 'lucide-react';
import {
  createJsonRawNumberToken,
  jsonArrayTableCellClipboardValue,
  jsonArrayTableToTsvPreview,
  jsonSourceHash,
  type JsonArrayTableCell,
  type JsonArrayTableModel,
  type JsonArrayTableRow,
  type JsonEditableScalarValue,
  type JsonVisualEditIntent,
  type StructuredNodeRef,
} from '@sciemd/core';
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

export interface JsonArrayTableViewProps {
  model: JsonArrayTableModel | null;
  sourceText?: string;
  editable?: boolean;
  onCopyText?: (content: string, label: string) => void;
  onEditIntent?: (intent: JsonVisualEditIntent) => void;
  onRevealSource?: (node: StructuredNodeRef) => void;
  onUnsupportedEdit?: (message: string) => void;
}

type JsonArrayCellEditState = {
  cell: JsonArrayTableCell;
  row: JsonArrayTableRow;
};

type JsonArrayInlineEditState = {
  cellPointer: string;
  scalarType: JsonArrayScalarDraftType;
  scalarText: string;
  booleanText: string;
  error: string | null;
};

type JsonArrayContextMenuState =
  | {
    kind: 'surface';
    position: { x: number; y: number };
    restoreFocusTo?: HTMLElement | null;
  }
  | {
    kind: 'row';
    row: JsonArrayTableRow;
    position: { x: number; y: number };
    restoreFocusTo?: HTMLElement | null;
  }
  | {
    kind: 'cell';
    row: JsonArrayTableRow;
    cell: JsonArrayTableCell;
    position: { x: number; y: number };
    restoreFocusTo?: HTMLElement | null;
  };

type JsonArrayScalarDraftType = 'string' | 'number' | 'boolean' | 'null';

export function JsonArrayTableView({
  model,
  sourceText,
  editable = false,
  onCopyText,
  onEditIntent,
  onRevealSource,
  onUnsupportedEdit,
}: JsonArrayTableViewProps) {
  const [editState, setEditState] = useState<JsonArrayCellEditState | null>(null);
  const [contextMenu, setContextMenu] = useState<JsonArrayContextMenuState | null>(null);
  const expectedSourceHash = useMemo(() => (
    sourceText === undefined ? undefined : jsonSourceHash(sourceText)
  ), [sourceText]);

  if (!model) return null;

  const copyText = (content: string, label: string) => {
    if (onCopyText) {
      onCopyText(content, label);
      return Promise.resolve();
    }
    return writeContextMenuClipboardText(content, label);
  };
  const editConnected = Boolean(editable && onEditIntent && sourceText !== undefined);
  const openCellEditDialog = (row: JsonArrayTableRow, cell: JsonArrayTableCell) => {
    setContextMenu(null);
    if (!editConnected || !cell.editable) {
      onUnsupportedEdit?.(cell.unsupportedReason ?? 'This JSON table cell cannot be edited visually.');
      return;
    }
    setEditState({ row, cell });
  };
  const revealRowSource = (row: JsonArrayTableRow) => {
    setContextMenu(null);
    if (!row.sourceRef || !onRevealSource) {
      onUnsupportedEdit?.('Source location is not available for this JSON row.');
      return;
    }
    onRevealSource(row.sourceRef);
  };
  const revealCellSource = (cell: JsonArrayTableCell) => {
    setContextMenu(null);
    if (!cell.sourceRef || !onRevealSource) {
      onUnsupportedEdit?.('Source location is not available for this JSON cell.');
      return;
    }
    onRevealSource(cell.sourceRef);
  };
  const copyRow = (row: JsonArrayTableRow) => copyText(JSON.stringify(row.value, null, 2) ?? '{}', `JSON row ${row.index + 1}`);
  const copyTablePreview = () => copyText(jsonArrayTableToTsvPreview(model), `${model.displayPath} table preview`);
  const openSurfaceContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setContextMenu({
      kind: 'surface',
      position: { x: event.clientX, y: event.clientY },
      restoreFocusTo: event.currentTarget,
    });
  };
  const openSurfaceKeyboardContextMenu = (event: KeyboardEvent<HTMLElement>) => {
    if (!isKeyboardContextMenuEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: 'surface',
      position: contextMenuPositionFromElement(event.currentTarget),
      restoreFocusTo: event.currentTarget,
    });
  };
  const openRowContextMenu = (row: JsonArrayTableRow, event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: 'row',
      row,
      position: { x: event.clientX, y: event.clientY },
      restoreFocusTo: event.currentTarget,
    });
  };
  const openRowKeyboardContextMenu = (row: JsonArrayTableRow, event: KeyboardEvent<HTMLElement>) => {
    if (!isKeyboardContextMenuEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: 'row',
      row,
      position: contextMenuPositionFromElement(event.currentTarget),
      restoreFocusTo: event.currentTarget,
    });
  };
  const openCellContextMenu = (row: JsonArrayTableRow, cell: JsonArrayTableCell, event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: 'cell',
      row,
      cell,
      position: { x: event.clientX, y: event.clientY },
      restoreFocusTo: event.currentTarget,
    });
  };
  const openCellKeyboardContextMenu = (row: JsonArrayTableRow, cell: JsonArrayTableCell, event: KeyboardEvent<HTMLElement>) => {
    if (!isKeyboardContextMenuEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: 'cell',
      row,
      cell,
      position: contextMenuPositionFromElement(event.currentTarget),
      restoreFocusTo: event.currentTarget,
    });
  };
  const contextMenuSections = contextMenu
    ? jsonArrayContextMenuSections({
      contextMenu,
      editConnected,
      onCopyCell: (cell) => copyText(jsonArrayTableCellClipboardValue(cell), `${cell.displayPath} cell`),
      onCopyRow: copyRow,
      onCopyTable: copyTablePreview,
      onEditCell: openCellEditDialog,
      onRevealCell: revealCellSource,
      onRevealRow: revealRowSource,
    })
    : [];

  return (
    <section
      className={`json-array-table-view mode-${model.viewMode}`}
      aria-label={`${model.displayPath} JSON array ${model.viewMode === 'cards' ? 'cards' : 'table'}`}
    >
      <header
        className="json-array-table-header"
        tabIndex={0}
        onContextMenu={openSurfaceContextMenu}
        onKeyDown={openSurfaceKeyboardContextMenu}
      >
        <div>
          {model.viewMode === 'cards' ? <Rows3 size={16} /> : <TableProperties size={16} />}
          <strong>{model.viewMode === 'cards' ? 'JSON cards' : 'JSON table'}</strong>
          <span>{model.displayPath}</span>
        </div>
        <div className="json-array-table-actions" aria-label="JSON array table actions">
          <button type="button" onClick={copyTablePreview}>
            <Clipboard size={14} />
            Copy table
          </button>
        </div>
        <div className="json-array-table-metrics" aria-label="JSON array table summary">
          <Metric label="Rows" value={model.rowCount} />
          <Metric label="Columns" value={model.columnCount} />
          <Metric label="Mode" value={model.viewMode === 'cards' ? 'Cards' : 'Table'} />
        </div>
      </header>

      {model.viewMode === 'cards' ? (
        <JsonArrayCards
          model={model}
          sourceText={sourceText}
          expectedSourceHash={expectedSourceHash}
          editConnected={editConnected}
          onInlineEditIntent={onEditIntent}
          onCopyRow={copyRow}
          onEditCell={openCellEditDialog}
          onRevealRow={revealRowSource}
          onOpenRowContextMenu={openRowContextMenu}
          onOpenRowKeyboardContextMenu={openRowKeyboardContextMenu}
          onOpenCellContextMenu={openCellContextMenu}
          onOpenCellKeyboardContextMenu={openCellKeyboardContextMenu}
        />
      ) : (
        <JsonArrayTable
          model={model}
          sourceText={sourceText}
          expectedSourceHash={expectedSourceHash}
          editConnected={editConnected}
          onInlineEditIntent={onEditIntent}
          onEditCell={openCellEditDialog}
          onOpenRowContextMenu={openRowContextMenu}
          onOpenRowKeyboardContextMenu={openRowKeyboardContextMenu}
          onOpenCellContextMenu={openCellContextMenu}
          onOpenCellKeyboardContextMenu={openCellKeyboardContextMenu}
        />
      )}

      {(model.hiddenRowCount > 0 || model.hiddenColumnCount > 0) && (
        <p className="json-array-table-truncated">
          Showing {model.rows.length} of {model.rowCount} rows and {model.visibleColumns.length} of {model.columnCount} columns.
        </p>
      )}

      <JsonArrayCellEditDialog
        key={editState ? editState.cell.pointer : 'closed'}
        state={editState}
        sourceText={sourceText}
        expectedSourceHash={expectedSourceHash}
        onCancel={() => setEditState(null)}
        onSubmit={(intent) => {
          onEditIntent?.(intent);
          setEditState(null);
        }}
      />

      {contextMenu && contextMenuSections.length > 0 && (
        <ContextMenuCard
          ariaLabel={jsonArrayContextMenuLabel(contextMenu)}
          sections={contextMenuSections}
          position={contextMenu.position}
          restoreFocusTo={contextMenu.restoreFocusTo}
          onClose={() => setContextMenu(null)}
        />
      )}
    </section>
  );
}

function JsonArrayTable({
  model,
  sourceText,
  expectedSourceHash,
  editConnected,
  onInlineEditIntent,
  onEditCell,
  onOpenRowContextMenu,
  onOpenRowKeyboardContextMenu,
  onOpenCellContextMenu,
  onOpenCellKeyboardContextMenu,
}: {
  model: JsonArrayTableModel;
  sourceText?: string;
  expectedSourceHash?: string;
  editConnected: boolean;
  onInlineEditIntent?: (intent: JsonVisualEditIntent) => void;
  onEditCell: (row: JsonArrayTableRow, cell: JsonArrayTableCell) => void;
  onOpenRowContextMenu: (row: JsonArrayTableRow, event: MouseEvent<HTMLElement>) => void;
  onOpenRowKeyboardContextMenu: (row: JsonArrayTableRow, event: KeyboardEvent<HTMLElement>) => void;
  onOpenCellContextMenu: (row: JsonArrayTableRow, cell: JsonArrayTableCell, event: MouseEvent<HTMLElement>) => void;
  onOpenCellKeyboardContextMenu: (row: JsonArrayTableRow, cell: JsonArrayTableCell, event: KeyboardEvent<HTMLElement>) => void;
}) {
  const [focusedCell, setFocusedCell] = useState<StructuredGridFocus>({ row: 0, column: 0 });
  const [inlineEdit, setInlineEdit] = useState<JsonArrayInlineEditState | null>(null);
  const cellRefs = useRef(new Map<string, HTMLElement>());
  const focusedCellKey = structuredGridCellKey(focusedCell.row, focusedCell.column);
  const focusCell = (row: number, column: number) => {
    const next = { row: Math.max(0, row), column: Math.max(0, column) };
    setFocusedCell(next);
    window.requestAnimationFrame(() => {
      cellRefs.current.get(structuredGridCellKey(next.row, next.column))?.focus();
    });
  };
  const startInlineEdit = (row: JsonArrayTableRow, cell: JsonArrayTableCell, rowPosition: number, columnPosition: number) => {
    if (!canInlineEditJsonArrayCell(editConnected, cell)) {
      onEditCell(row, cell);
      return;
    }
    setFocusedCell({ row: rowPosition, column: columnPosition });
    setInlineEdit({
      cellPointer: cell.pointer,
      scalarType: scalarTypeForCell(cell),
      scalarText: scalarTextForCell(cell, sourceText),
      booleanText: cell.value === false ? 'false' : 'true',
      error: null,
    });
  };
  const commitInlineEdit = (rowPosition: number, columnPosition: number, cell: JsonArrayTableCell, state: JsonArrayInlineEditState) => {
    const scalar = parseScalarDraft(state.scalarType, state.scalarText, state.booleanText);
    if (!scalar.ok) {
      setInlineEdit({ ...state, error: scalar.error });
      return;
    }
    setInlineEdit(null);
    onInlineEditIntent?.({
      kind: 'replaceScalar',
      path: cell.path,
      nextValue: scalar.value,
      expectedSourceHash,
    });
    focusCell(rowPosition, columnPosition);
  };
  const cancelInlineEdit = (rowPosition: number, columnPosition: number) => {
    setInlineEdit(null);
    focusCell(rowPosition, columnPosition);
  };
  const handleCellNavigation = (
    row: JsonArrayTableRow,
    rowPosition: number,
    columnPosition: number,
    event: KeyboardEvent<HTMLElement>,
    cell?: JsonArrayTableCell,
  ) => {
    if (isKeyboardContextMenuEvent(event)) {
      if (cell) onOpenCellKeyboardContextMenu(row, cell, event);
      else onOpenRowKeyboardContextMenu(row, event);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (cell) startInlineEdit(row, cell, rowPosition, columnPosition);
      return;
    }
    if (event.key === 'Escape') {
      event.currentTarget.blur();
      return;
    }
    const next = moveStructuredGridFocus(
      { row: rowPosition, column: columnPosition },
      event,
      { rowCount: model.rows.length, columnCount: model.visibleColumns.length + 1, pageStep: Math.max(1, model.rows.length - 1) },
    );
    if (!next) return;
    event.preventDefault();
    focusCell(next.row, next.column);
  };
  return (
    <div className="json-array-table-scroll">
      <table role="grid" aria-rowcount={model.rowCount + 1} aria-colcount={model.columnCount + 1}>
        <thead>
          <tr>
            <th>Row</th>
            {model.visibleColumns.map((column, columnPosition) => (
              <th key={column.key} title={jsonArrayColumnTitle(column.types, column.missingCount)} aria-colindex={columnPosition + 2}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row, rowPosition) => (
            <tr key={row.pointer} aria-rowindex={row.index + 2}>
              <th
                scope="row"
                ref={(node) => {
                  const key = structuredGridCellKey(rowPosition, 0);
                  if (node) cellRefs.current.set(key, node);
                  else cellRefs.current.delete(key);
                }}
                tabIndex={focusedCellKey === structuredGridCellKey(rowPosition, 0) ? 0 : -1}
                onFocus={() => setFocusedCell({ row: rowPosition, column: 0 })}
                onContextMenu={(event) => onOpenRowContextMenu(row, event)}
                onKeyDown={(event) => handleCellNavigation(row, rowPosition, 0, event)}
              >
                {row.index + 1}
              </th>
              {model.visibleColumns.map((column, columnPosition) => {
                const cell = cellForColumn(row, column.key);
                if (!cell) {
                  return (
                    <td
                      key={`${row.pointer}:${column.key}`}
                      ref={(node) => {
                        const key = structuredGridCellKey(rowPosition, columnPosition + 1);
                        if (node) cellRefs.current.set(key, node);
                        else cellRefs.current.delete(key);
                      }}
                      tabIndex={focusedCellKey === structuredGridCellKey(rowPosition, columnPosition + 1) ? 0 : -1}
                      aria-colindex={columnPosition + 2}
                      onFocus={() => setFocusedCell({ row: rowPosition, column: columnPosition + 1 })}
                      onKeyDown={(event) => handleCellNavigation(row, rowPosition, columnPosition + 1, event)}
                    />
                  );
                }
                return (
                  <td
                    key={cell.pointer}
                    ref={(node) => {
                      const key = structuredGridCellKey(rowPosition, columnPosition + 1);
                      if (node) cellRefs.current.set(key, node);
                      else cellRefs.current.delete(key);
                    }}
                    title={cell.preview}
                    tabIndex={focusedCellKey === structuredGridCellKey(rowPosition, columnPosition + 1) ? 0 : -1}
                    aria-colindex={columnPosition + 2}
                    data-json-cell-type={cell.type}
                    data-json-cell-editable={cell.editable ? 'true' : 'false'}
                    onFocus={() => setFocusedCell({ row: rowPosition, column: columnPosition + 1 })}
                    onContextMenu={(event) => onOpenCellContextMenu(row, cell, event)}
                    onKeyDown={(event) => handleCellNavigation(row, rowPosition, columnPosition + 1, event, cell)}
                  >
                    {inlineEdit?.cellPointer === cell.pointer ? (
                      <JsonArrayInlineCellEditor
                        state={inlineEdit}
                        onChange={(next) => setInlineEdit(next)}
                        onCommit={(next) => commitInlineEdit(rowPosition, columnPosition + 1, cell, next)}
                        onCancel={() => cancelInlineEdit(rowPosition, columnPosition + 1)}
                      />
                    ) : cell.editable ? (
                      <button
                        type="button"
                        className="json-array-cell-edit-button"
                        disabled={!editConnected}
                        tabIndex={-1}
                        title={editConnected ? `Edit ${cell.displayPath}` : 'JSON table editing is not connected.'}
                        onClick={() => startInlineEdit(row, cell, rowPosition, columnPosition + 1)}
                      >
                        <span>{previewCell(cell)}</span>
                        <Pencil size={12} aria-hidden="true" />
                      </button>
                    ) : previewCell(cell)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JsonArrayCards({
  model,
  sourceText,
  expectedSourceHash,
  editConnected,
  onInlineEditIntent,
  onCopyRow,
  onEditCell,
  onRevealRow,
  onOpenRowContextMenu,
  onOpenRowKeyboardContextMenu,
  onOpenCellContextMenu,
  onOpenCellKeyboardContextMenu,
}: {
  model: JsonArrayTableModel;
  sourceText?: string;
  expectedSourceHash?: string;
  editConnected: boolean;
  onInlineEditIntent?: (intent: JsonVisualEditIntent) => void;
  onCopyRow: (row: JsonArrayTableRow) => void;
  onEditCell: (row: JsonArrayTableRow, cell: JsonArrayTableCell) => void;
  onRevealRow: (row: JsonArrayTableRow) => void;
  onOpenRowContextMenu: (row: JsonArrayTableRow, event: MouseEvent<HTMLElement>) => void;
  onOpenRowKeyboardContextMenu: (row: JsonArrayTableRow, event: KeyboardEvent<HTMLElement>) => void;
  onOpenCellContextMenu: (row: JsonArrayTableRow, cell: JsonArrayTableCell, event: MouseEvent<HTMLElement>) => void;
  onOpenCellKeyboardContextMenu: (row: JsonArrayTableRow, cell: JsonArrayTableCell, event: KeyboardEvent<HTMLElement>) => void;
}) {
  const [focusedCell, setFocusedCell] = useState<StructuredGridFocus>({ row: 0, column: 0 });
  const [inlineEdit, setInlineEdit] = useState<JsonArrayInlineEditState | null>(null);
  const cellRefs = useRef(new Map<string, HTMLElement>());
  const focusedCellKey = structuredGridCellKey(focusedCell.row, focusedCell.column);
  const focusCell = (row: number, column: number) => {
    const next = { row: Math.max(0, row), column: Math.max(0, column) };
    setFocusedCell(next);
    window.requestAnimationFrame(() => {
      cellRefs.current.get(structuredGridCellKey(next.row, next.column))?.focus();
    });
  };
  const startInlineEdit = (row: JsonArrayTableRow, cell: JsonArrayTableCell, rowPosition: number, columnPosition: number) => {
    if (!canInlineEditJsonArrayCell(editConnected, cell)) {
      onEditCell(row, cell);
      return;
    }
    setFocusedCell({ row: rowPosition, column: columnPosition });
    setInlineEdit({
      cellPointer: cell.pointer,
      scalarType: scalarTypeForCell(cell),
      scalarText: scalarTextForCell(cell, sourceText),
      booleanText: cell.value === false ? 'false' : 'true',
      error: null,
    });
  };
  const commitInlineEdit = (rowPosition: number, columnPosition: number, cell: JsonArrayTableCell, state: JsonArrayInlineEditState) => {
    const scalar = parseScalarDraft(state.scalarType, state.scalarText, state.booleanText);
    if (!scalar.ok) {
      setInlineEdit({ ...state, error: scalar.error });
      return;
    }
    setInlineEdit(null);
    onInlineEditIntent?.({
      kind: 'replaceScalar',
      path: cell.path,
      nextValue: scalar.value,
      expectedSourceHash,
    });
    focusCell(rowPosition, columnPosition);
  };
  const cancelInlineEdit = (rowPosition: number, columnPosition: number) => {
    setInlineEdit(null);
    focusCell(rowPosition, columnPosition);
  };
  const handleCardKeyDown = (
    row: JsonArrayTableRow,
    rowPosition: number,
    columnPosition: number,
    event: KeyboardEvent<HTMLElement>,
    cell?: JsonArrayTableCell,
  ) => {
    if (isKeyboardContextMenuEvent(event)) {
      event.stopPropagation();
      if (cell) onOpenCellKeyboardContextMenu(row, cell, event);
      else onOpenRowKeyboardContextMenu(row, event);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (cell) startInlineEdit(row, cell, rowPosition, columnPosition);
      else onRevealRow(row);
      return;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.currentTarget.blur();
      return;
    }
    const next = moveStructuredGridFocus(
      { row: rowPosition, column: columnPosition },
      event,
      { rowCount: model.rows.length, columnCount: model.visibleColumns.length + 1, pageStep: Math.max(1, model.rows.length - 1) },
    );
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    focusCell(next.row, next.column);
  };
  return (
    <div className="json-array-card-scroll">
      <div className="json-array-card-grid" role="grid" aria-rowcount={model.rowCount} aria-colcount={model.columnCount + 1}>
        {model.rows.map((row, rowPosition) => (
          <article
            key={row.pointer}
            ref={(node) => {
              const key = structuredGridCellKey(rowPosition, 0);
              if (node) cellRefs.current.set(key, node);
              else cellRefs.current.delete(key);
            }}
            className="json-array-card"
            role="row"
            aria-rowindex={row.index + 1}
            tabIndex={focusedCellKey === structuredGridCellKey(rowPosition, 0) ? 0 : -1}
            onFocus={() => setFocusedCell({ row: rowPosition, column: 0 })}
            onContextMenu={(event) => onOpenRowContextMenu(row, event)}
            onKeyDown={(event) => handleCardKeyDown(row, rowPosition, 0, event)}
          >
            <header>
              <strong>Row {row.index + 1}</strong>
              <div>
                <button type="button" tabIndex={-1} aria-label={`Copy JSON row ${row.index + 1}`} onClick={() => onCopyRow(row)}>
                  <Copy size={14} />
                </button>
                <button type="button" tabIndex={-1} aria-label={`Reveal JSON row ${row.index + 1}`} disabled={!row.sourceRef} onClick={() => onRevealRow(row)}>
                  <FileCode2 size={14} />
                </button>
              </div>
            </header>
            <dl>
              {model.visibleColumns.map((column, columnPosition) => {
                const cell = cellForColumn(row, column.key);
                if (!cell) return null;
                return (
                  <div
                    key={cell.pointer}
                    ref={(node) => {
                      const key = structuredGridCellKey(rowPosition, columnPosition + 1);
                      if (node) cellRefs.current.set(key, node);
                      else cellRefs.current.delete(key);
                    }}
                    className={`json-array-card-field type-${cell.type}`}
                    role="gridcell"
                    aria-colindex={columnPosition + 2}
                    tabIndex={focusedCellKey === structuredGridCellKey(rowPosition, columnPosition + 1) ? 0 : -1}
                    onFocus={() => setFocusedCell({ row: rowPosition, column: columnPosition + 1 })}
                    onContextMenu={(event) => onOpenCellContextMenu(row, cell, event)}
                    onKeyDown={(event) => handleCardKeyDown(row, rowPosition, columnPosition + 1, event, cell)}
                  >
                    <dt>{column.label}</dt>
                    <dd>
                      {inlineEdit?.cellPointer === cell.pointer ? (
                        <JsonArrayInlineCellEditor
                          state={inlineEdit}
                          onChange={(next) => setInlineEdit(next)}
                          onCommit={(next) => commitInlineEdit(rowPosition, columnPosition + 1, cell, next)}
                          onCancel={() => cancelInlineEdit(rowPosition, columnPosition + 1)}
                        />
                      ) : cell.editable ? (
                        <button
                          type="button"
                          className="json-array-card-edit-button"
                          disabled={!editConnected}
                          tabIndex={-1}
                          onClick={() => startInlineEdit(row, cell, rowPosition, columnPosition + 1)}
                        >
                          <span>{previewCell(cell)}</span>
                          <Pencil size={12} aria-hidden="true" />
                        </button>
                      ) : previewCell(cell)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}

function JsonArrayCellEditDialog({
  state,
  sourceText,
  expectedSourceHash,
  onCancel,
  onSubmit,
}: {
  state: JsonArrayCellEditState | null;
  sourceText?: string;
  expectedSourceHash?: string;
  onCancel: () => void;
  onSubmit: (intent: JsonVisualEditIntent) => void;
}) {
  const initial = state?.cell;
  const [scalarType, setScalarType] = useState<JsonArrayScalarDraftType>(() => scalarTypeForCell(initial));
  const [scalarText, setScalarText] = useState(() => scalarTextForCell(initial, sourceText));
  const [booleanText, setBooleanText] = useState(() => initial?.value === false ? 'false' : 'true');
  const [error, setError] = useState<string | null>(null);

  if (!state) return null;

  const submit = () => {
    const scalar = parseScalarDraft(scalarType, scalarText, booleanText);
    if (!scalar.ok) {
      setError(scalar.error);
      return;
    }
    onSubmit({
      kind: 'replaceScalar',
      path: state.cell.path,
      nextValue: scalar.value,
      expectedSourceHash,
    });
  };

  return (
    <ModalShell open titleId="json-array-cell-edit-title" className="json-array-cell-edit-dialog" onCancel={onCancel}>
      <header className="json-array-cell-edit-header">
        <div>
          <h2 id="json-array-cell-edit-title">Edit JSON Cell</h2>
          <p>{state.cell.displayPath}</p>
        </div>
        <button type="button" aria-label="Close JSON cell editor" onClick={onCancel}>Close</button>
      </header>
      <label className="json-array-edit-field">
        <span>Type</span>
        <select value={scalarType} onChange={(event) => setScalarType(event.target.value as JsonArrayScalarDraftType)}>
          <option value="string">String</option>
          <option value="number">Number</option>
          <option value="boolean">Boolean</option>
          <option value="null">Null</option>
        </select>
      </label>
      {scalarType === 'boolean' ? (
        <label className="json-array-edit-field">
          <span>Boolean</span>
          <select value={booleanText} onChange={(event) => setBooleanText(event.target.value)}>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </label>
      ) : scalarType === 'null' ? null : (
        <label className="json-array-edit-field">
          <span>{scalarType === 'number' ? 'Number' : 'Text'}</span>
          <textarea
            value={scalarText}
            onChange={(event) => setScalarText(event.target.value)}
            autoFocus
          />
        </label>
      )}
      {error && <p className="json-array-edit-error">{error}</p>}
      <DialogActions>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" onClick={submit}>Apply cell edit</button>
      </DialogActions>
    </ModalShell>
  );
}

function JsonArrayInlineCellEditor({
  state,
  onChange,
  onCommit,
  onCancel,
}: {
  state: JsonArrayInlineEditState;
  onChange: (state: JsonArrayInlineEditState) => void;
  onCommit: (state: JsonArrayInlineEditState) => void;
  onCancel: () => void;
}) {
  const cancelingRef = useRef(false);
  const commit = () => {
    if (cancelingRef.current) return;
    onCommit(state);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelingRef.current = true;
      onCancel();
    }
  };
  const commonProps = {
    autoFocus: true,
    className: state.error ? 'has-error' : '',
    onKeyDown: handleKeyDown,
    onBlur: commit,
  };

  return (
    <span className="json-array-inline-cell-editor">
      {state.scalarType === 'boolean' ? (
        <select
          {...commonProps}
          aria-label="Inline edit JSON boolean cell"
          value={state.booleanText}
          onChange={(event) => onChange({ ...state, booleanText: event.target.value, error: null })}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <input
          {...commonProps}
          aria-label="Inline edit JSON cell"
          inputMode={state.scalarType === 'number' ? 'decimal' : undefined}
          value={state.scalarText}
          onChange={(event) => onChange({ ...state, scalarText: event.target.value, error: null })}
        />
      )}
      {state.error && <small role="alert">{state.error}</small>}
    </span>
  );
}

function jsonArrayContextMenuSections({
  contextMenu,
  editConnected,
  onCopyCell,
  onCopyRow,
  onCopyTable,
  onEditCell,
  onRevealCell,
  onRevealRow,
}: {
  contextMenu: JsonArrayContextMenuState;
  editConnected: boolean;
  onCopyCell: (cell: JsonArrayTableCell) => Promise<void>;
  onCopyRow: (row: JsonArrayTableRow) => Promise<void>;
  onCopyTable: () => Promise<void>;
  onEditCell: (row: JsonArrayTableRow, cell: JsonArrayTableCell) => void;
  onRevealCell: (cell: JsonArrayTableCell) => void;
  onRevealRow: (row: JsonArrayTableRow) => void;
}): ContextMenuSection[] {
  if (contextMenu.kind === 'cell') {
    const editDisabled = !editConnected || !contextMenu.cell.editable;
    return structuredOperationSectionsToContextMenuSections(
      structuredOperationSectionsForTarget({
        kind: 'json-array-cell',
        editable: contextMenu.cell.editable,
        editConnected,
        editDisabledReason: editDisabled ? contextMenu.cell.unsupportedReason ?? 'JSON table cell editing is unavailable.' : null,
        canRevealSource: Boolean(contextMenu.cell.sourceRef),
      }),
      {
        editCell: () => onEditCell(contextMenu.row, contextMenu.cell),
        revealSource: () => onRevealCell(contextMenu.cell),
        copyCell: () => onCopyCell(contextMenu.cell),
        copyRow: () => onCopyRow(contextMenu.row),
        copyTable: onCopyTable,
      },
    );
  }

  if (contextMenu.kind === 'row') {
    return structuredOperationSectionsToContextMenuSections(
      structuredOperationSectionsForTarget({
        kind: 'json-array-row',
        canRevealSource: Boolean(contextMenu.row.sourceRef),
      }),
      {
        revealSource: () => onRevealRow(contextMenu.row),
        copyRow: () => onCopyRow(contextMenu.row),
        copyTable: onCopyTable,
      },
    );
  }

  return structuredOperationSectionsToContextMenuSections(
    structuredOperationSectionsForTarget({ kind: 'json-array-surface' }),
    { copyTable: onCopyTable },
  );
}

function jsonArrayContextMenuLabel(contextMenu: JsonArrayContextMenuState): string {
  if (contextMenu.kind === 'cell') return `Actions for ${contextMenu.cell.displayPath}`;
  if (contextMenu.kind === 'row') return `Actions for JSON row ${contextMenu.row.index + 1}`;
  return 'JSON table actions';
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <span>
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  );
}

function jsonArrayColumnTitle(types: readonly string[], missingCount: number): string {
  const typeText = types.join(' | ');
  return missingCount > 0 ? `${typeText}; ${missingCount} missing` : typeText;
}

function cellForColumn(row: JsonArrayTableRow, columnKey: string): JsonArrayTableCell | null {
  return row.cells.find((cell) => cell.columnKey === columnKey) ?? null;
}

function canInlineEditJsonArrayCell(editConnected: boolean, cell: JsonArrayTableCell): boolean {
  return editConnected && cell.editable && (cell.type === 'string' || cell.type === 'number' || cell.type === 'boolean');
}

function previewCell(cell: JsonArrayTableCell): string {
  if (cell.missing) return '-';
  return cell.preview.length > 140 ? `${cell.preview.slice(0, 137)}...` : cell.preview;
}

function scalarTypeForCell(cell: JsonArrayTableCell | undefined): JsonArrayScalarDraftType {
  if (!cell) return 'string';
  if (cell.type === 'number') return 'number';
  if (cell.type === 'boolean') return 'boolean';
  if (cell.type === 'null') return 'null';
  return 'string';
}

function scalarTextForCell(cell: JsonArrayTableCell | undefined, sourceText: string | undefined): string {
  if (!cell) return '';
  if (cell.type === 'number') {
    return sourceTextForCell(cell, sourceText) ?? String(cell.value);
  }
  if (cell.type === 'string') return String(cell.value);
  return '';
}

function parseScalarDraft(
  scalarType: JsonArrayScalarDraftType,
  scalarText: string,
  booleanText: string,
): { ok: true; value: JsonEditableScalarValue } | { ok: false; error: string } {
  if (scalarType === 'string') return { ok: true, value: scalarText };
  if (scalarType === 'boolean') return { ok: true, value: booleanText === 'true' };
  if (scalarType === 'null') return { ok: true, value: null };
  const trimmed = scalarText.trim();
  if (!trimmed) return { ok: false, error: 'Number value cannot be empty.' };
  const value = createJsonRawNumberToken(trimmed);
  return value
    ? { ok: true, value }
    : { ok: false, error: 'Number value must be a valid JSON number.' };
}

function sourceTextForCell(cell: JsonArrayTableCell, sourceText: string | undefined): string | null {
  const valueSpan = cell.sourceRef?.valueSpan ?? null;
  if (!sourceText || !valueSpan) return null;
  return sourceText.slice(valueSpan.offset, valueSpan.offset + valueSpan.length);
}
