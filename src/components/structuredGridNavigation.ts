export interface StructuredGridFocus {
  row: number;
  column: number;
}

export interface StructuredGridBounds {
  rowCount: number;
  columnCount: number;
  pageStep?: number;
}

export interface StructuredGridKeyState {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

const GRID_NAVIGATION_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

export function structuredGridCellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

export function isStructuredGridNavigationKey(event: StructuredGridKeyState): boolean {
  return GRID_NAVIGATION_KEYS.has(event.key);
}

export function clampStructuredGridFocus(
  focus: StructuredGridFocus,
  bounds: StructuredGridBounds,
): StructuredGridFocus {
  const rowCount = Math.max(1, Math.floor(bounds.rowCount));
  const columnCount = Math.max(1, Math.floor(bounds.columnCount));
  return {
    row: clampInteger(focus.row, 0, rowCount - 1),
    column: clampInteger(focus.column, 0, columnCount - 1),
  };
}

export function moveStructuredGridFocus(
  current: StructuredGridFocus,
  event: StructuredGridKeyState,
  bounds: StructuredGridBounds,
): StructuredGridFocus | null {
  if (!isStructuredGridNavigationKey(event)) return null;
  const rowCount = Math.max(1, Math.floor(bounds.rowCount));
  const columnCount = Math.max(1, Math.floor(bounds.columnCount));
  const pageStep = Math.max(1, Math.floor(bounds.pageStep ?? Math.min(10, rowCount)));
  const focus = clampStructuredGridFocus(current, { rowCount, columnCount });
  const wholeGrid = Boolean(event.ctrlKey || event.metaKey);

  if (event.key === 'ArrowUp') return clampStructuredGridFocus({ ...focus, row: focus.row - 1 }, { rowCount, columnCount });
  if (event.key === 'ArrowDown') return clampStructuredGridFocus({ ...focus, row: focus.row + 1 }, { rowCount, columnCount });
  if (event.key === 'ArrowLeft') return clampStructuredGridFocus({ ...focus, column: focus.column - 1 }, { rowCount, columnCount });
  if (event.key === 'ArrowRight') return clampStructuredGridFocus({ ...focus, column: focus.column + 1 }, { rowCount, columnCount });
  if (event.key === 'PageUp') return clampStructuredGridFocus({ ...focus, row: focus.row - pageStep }, { rowCount, columnCount });
  if (event.key === 'PageDown') return clampStructuredGridFocus({ ...focus, row: focus.row + pageStep }, { rowCount, columnCount });
  if (event.key === 'Home') return wholeGrid ? { row: 0, column: 0 } : { ...focus, column: 0 };
  if (event.key === 'End') return wholeGrid ? { row: rowCount - 1, column: columnCount - 1 } : { ...focus, column: columnCount - 1 };

  return null;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
