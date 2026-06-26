type VisualEditorStateReader = () => string | null;

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

export function flushVisualEditorState(): string | null {
  return registeredReaders.at(-1)?.reader() ?? null;
}
