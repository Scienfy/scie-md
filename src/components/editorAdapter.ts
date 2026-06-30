import type { EditorHistoryControls } from './editorControls';

export type EditorSurface = 'source' | 'visual';

export interface EditorReadResult {
  surface: EditorSurface;
  markdown: string;
  changed: boolean;
  markCommitted?: () => void;
}

export interface EditorSelectionAnchor {
  from: number;
  to?: number;
}

export interface EditorAdapter {
  surface: EditorSurface;
  read(): EditorReadResult | null;
  replace(markdown: string): boolean;
  focus(): void;
  getSelectionAnchor?(): EditorSelectionAnchor | null;
  restoreSelectionAnchor?(anchor: EditorSelectionAnchor): boolean;
  flushPendingEdits(): EditorReadResult | null;
  history?: EditorHistoryControls;
}

export type EditorAdapterReady = (adapter: EditorAdapter | undefined) => void;
