import { describe, expect, it, vi } from 'vitest';
import {
  commitVisualEditorReadResult,
  commitVisualEditorState,
  flushVisualEditorState,
  readVisualEditorState,
  setVisualEditorStateReader,
} from './visualEditorStateSync';

describe('visualEditorStateSync', () => {
  it('reads the registered visual editor state without committing it', () => {
    const onCommit = vi.fn();
    const markCommitted = vi.fn();
    const dispose = setVisualEditorStateReader(() => ({
      surface: 'visual',
      markdown: '# Draft',
      changed: true,
      markCommitted,
    }));

    try {
      expect(readVisualEditorState()).toMatchObject({ markdown: '# Draft', changed: true });
      expect(flushVisualEditorState()).toBe('# Draft');
      expect(onCommit).not.toHaveBeenCalled();
      expect(markCommitted).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('commits changed visual state only through the explicit commit helper', () => {
    const onCommit = vi.fn();
    const markCommitted = vi.fn();
    const dispose = setVisualEditorStateReader(() => ({
      surface: 'visual',
      markdown: '# Draft',
      changed: true,
      markCommitted,
    }));

    try {
      expect(commitVisualEditorState(onCommit)).toBe('# Draft');
      expect(markCommitted).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith('# Draft');
    } finally {
      dispose();
    }
  });

  it('commits a previously-read visual state without asking the editor twice', () => {
    const onCommit = vi.fn();
    const markCommitted = vi.fn();
    const result = {
      surface: 'visual' as const,
      markdown: '# Snapshot',
      changed: true,
      markCommitted,
    };

    expect(commitVisualEditorReadResult(result, onCommit)).toBe('# Snapshot');
    expect(markCommitted).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('# Snapshot');
  });

  it('does not call commit hooks when visual state matches React state', () => {
    const onCommit = vi.fn();
    const markCommitted = vi.fn();
    const dispose = setVisualEditorStateReader(() => ({
      surface: 'visual',
      markdown: '# Draft',
      changed: false,
      markCommitted,
    }));

    try {
      expect(commitVisualEditorState(onCommit)).toBe('# Draft');
      expect(markCommitted).not.toHaveBeenCalled();
      expect(onCommit).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });
});
