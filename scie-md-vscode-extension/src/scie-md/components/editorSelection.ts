export interface EditorSelectionSnapshot {
  text: string;
  line?: number;
  endLine?: number;
  from?: number;
  to?: number;
  prefix?: string;
  suffix?: string;
  surface?: 'source' | 'visual' | 'unknown';
}

export type EditorSelectionGetter = () => EditorSelectionSnapshot;
