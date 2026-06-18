type VisualEditorStateReader = () => string | null;

let activeReader: VisualEditorStateReader | null = null;

export function setVisualEditorStateReader(reader: VisualEditorStateReader | null): void {
  activeReader = reader;
}

export function flushVisualEditorState(): string | null {
  return activeReader?.() ?? null;
}
