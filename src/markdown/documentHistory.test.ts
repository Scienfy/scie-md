import { describe, expect, it } from 'vitest';
import {
  createDocumentHistory,
  MIN_DOCUMENT_HISTORY_LIMIT,
  recordDocumentEdit,
  redoDocumentHistory,
  resetDocumentHistory,
  undoDocumentHistory,
} from './documentHistory';

describe('documentHistory', () => {
  it('keeps at least 20 command-level snapshots', () => {
    const history = createDocumentHistory(3);
    expect(history.limit).toBe(MIN_DOCUMENT_HISTORY_LIMIT);

    for (let index = 0; index < 25; index += 1) {
      recordDocumentEdit(history, `version-${index}`);
    }

    expect(history.past).toHaveLength(MIN_DOCUMENT_HISTORY_LIMIT);
    expect(history.past[0]).toBe('version-5');
  });

  it('undoes and redoes distinct document snapshots', () => {
    const history = createDocumentHistory(20);
    recordDocumentEdit(history, 'alpha');
    recordDocumentEdit(history, 'beta');

    expect(undoDocumentHistory(history, 'gamma')).toBe('beta');
    expect(undoDocumentHistory(history, 'beta')).toBe('alpha');
    expect(undoDocumentHistory(history, 'alpha')).toBeNull();

    expect(redoDocumentHistory(history, 'alpha')).toBe('beta');
    expect(redoDocumentHistory(history, 'beta')).toBe('gamma');
    expect(redoDocumentHistory(history, 'gamma')).toBeNull();
  });

  it('clears redo snapshots after a new command edit', () => {
    const history = createDocumentHistory(20);
    recordDocumentEdit(history, 'alpha');
    expect(undoDocumentHistory(history, 'beta')).toBe('alpha');
    recordDocumentEdit(history, 'alpha-edited');
    expect(redoDocumentHistory(history, 'delta')).toBeNull();
  });

  it('resets both undo and redo stacks when a different document is loaded', () => {
    const history = createDocumentHistory(20);
    recordDocumentEdit(history, 'alpha');
    expect(undoDocumentHistory(history, 'beta')).toBe('alpha');
    resetDocumentHistory(history);

    expect(undoDocumentHistory(history, 'alpha')).toBeNull();
    expect(redoDocumentHistory(history, 'alpha')).toBeNull();
  });
});
