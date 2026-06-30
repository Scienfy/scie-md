import type { EditorReadResult } from './editorAdapter';

type VisualEditorStateReader = () => EditorReadResult | null;

interface RegisteredVisualEditorStateReader {
  id: symbol;
  reader: VisualEditorStateReader;
}

const registeredReaders: RegisteredVisualEditorStateReader[] = [];

export function setVisualEditorStateReader(reader: VisualEditorStateReader): () => void {
  const id = Symbol('visual-editor-state-reader');
  registeredReaders.push({ id, reader });
  return () => {
    const index = registeredReaders.findIndex((entry) => entry.id === id);
    if (index >= 0) registeredReaders.splice(index, 1);
  };
}

export function readVisualEditorState(): EditorReadResult | null {
  return registeredReaders.at(-1)?.reader() ?? null;
}

export function flushVisualEditorState(): string | null {
  return readVisualEditorState()?.markdown ?? null;
}

export function commitVisualEditorReadResult(
  result: EditorReadResult | null,
  onCommit: (markdown: string) => void,
): string | null {
  if (!result) return null;
  if (result.changed) {
    result.markCommitted?.();
    onCommit(result.markdown);
  }
  return result.markdown;
}

export function commitVisualEditorState(onCommit: (markdown: string) => void): string | null {
  return commitVisualEditorReadResult(readVisualEditorState(), onCommit);
}
