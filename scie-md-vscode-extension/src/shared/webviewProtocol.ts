export interface ScieMDDocumentSnapshot {
  uri: string;
  fileName: string;
  text: string;
  version: number;
  isDirty: boolean;
  isReadonly?: boolean;
  readonlyReason?: string;
}

export type DocumentUpdateReason = 'initial' | 'changed' | 'saved';

export type ExtensionToWebviewMessage =
  | {
      type: 'documentUpdate';
      reason: DocumentUpdateReason;
      snapshot: ScieMDDocumentSnapshot;
      sourceEditId?: string | null;
    }
  | {
      type: 'operationResult';
      id?: string;
      ok: boolean;
      message: string;
    };

export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'replaceDocument'; text: string; editId: string; baseText?: string; baseVersion?: number; rejectedHunkIds?: string[] }
  | {
      type: 'save';
      pendingText?: string;
      editId?: string;
      baseText?: string;
      baseVersion?: number;
      rejectedHunkIds?: string[];
    }
  | {
      type: 'undo';
      pendingText?: string;
      editId?: string;
      baseText?: string;
      baseVersion?: number;
      rejectedHunkIds?: string[];
    }
  | {
      type: 'redo';
      pendingText?: string;
      editId?: string;
      baseText?: string;
      baseVersion?: number;
      rejectedHunkIds?: string[];
    }
  | { type: 'copyLlmSkill' }
  | { type: 'generateLlmSkillFile' }
  | { type: 'copyText'; text: string; label?: string }
  | { type: 'showMessage'; severity: 'info' | 'warning' | 'error'; message: string };
