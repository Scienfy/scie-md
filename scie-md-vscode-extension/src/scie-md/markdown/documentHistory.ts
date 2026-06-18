export interface DocumentHistoryState {
  past: string[];
  future: string[];
  limit: number;
}

export const MIN_DOCUMENT_HISTORY_LIMIT = 20;
export const DEFAULT_DOCUMENT_HISTORY_LIMIT = 100;

export function createDocumentHistory(limit = DEFAULT_DOCUMENT_HISTORY_LIMIT): DocumentHistoryState {
  return {
    past: [],
    future: [],
    limit: Math.max(MIN_DOCUMENT_HISTORY_LIMIT, Math.floor(limit)),
  };
}

export function resetDocumentHistory(history: DocumentHistoryState): void {
  history.past = [];
  history.future = [];
}

export function recordDocumentEdit(history: DocumentHistoryState, previous: string): void {
  if (history.past.at(-1) === previous) return;
  history.past.push(previous);
  trimOldest(history.past, history.limit);
  history.future = [];
}

export function undoDocumentHistory(history: DocumentHistoryState, current: string): string | null {
  const previous = popDistinct(history.past, current);
  if (previous === null) return null;
  history.future.push(current);
  trimOldest(history.future, history.limit);
  return previous;
}

export function redoDocumentHistory(history: DocumentHistoryState, current: string): string | null {
  const next = popDistinct(history.future, current);
  if (next === null) return null;
  history.past.push(current);
  trimOldest(history.past, history.limit);
  return next;
}

function popDistinct(stack: string[], current: string): string | null {
  let value = stack.pop();
  while (value !== undefined && value === current) {
    value = stack.pop();
  }
  return value ?? null;
}

function trimOldest(stack: string[], limit: number): void {
  if (stack.length > limit) stack.splice(0, stack.length - limit);
}
