import type { BibtexEntry } from '@sciemd/core';

type ToastTone = 'info' | 'success' | 'warning' | 'error';

type ConfirmState = {
  title: string;
  message: string;
  okLabel: string;
  cancelLabel: string;
};

interface ScieMetadataRuntimeContext {
  documentPath: string | null;
  citationEntries: BibtexEntry[];
  pushToast: (text: string, tone?: ToastTone) => void;
  confirmText: (state: ConfirmState) => Promise<boolean>;
}

const defaultPushToast = (text: string, tone: ToastTone = 'info') => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('scie-md-visual-atom-toast', { detail: { text, tone } }));
};

const fallbackContext: ScieMetadataRuntimeContext = {
  documentPath: null,
  citationEntries: [],
  pushToast: defaultPushToast,
  confirmText: async () => false,
};
const editorContexts = new Map<string, ScieMetadataRuntimeContext>();

export function registerScieMetadataEditorContext(
  id: string,
  context: Partial<ScieMetadataRuntimeContext>,
): void {
  editorContexts.set(id, { ...fallbackContext, ...context });
}

export function updateScieMetadataEditorContext(
  id: string,
  context: Partial<ScieMetadataRuntimeContext>,
): void {
  editorContexts.set(id, {
    ...(editorContexts.get(id) ?? fallbackContext),
    ...context,
  });
}

export function unregisterScieMetadataEditorContext(id: string): void {
  editorContexts.delete(id);
}

export function setScieMetadataDocumentPath(nextDocumentPath: string | null): void {
  fallbackContext.documentPath = nextDocumentPath;
}

export function getScieMetadataDocumentPath(anchor?: Element | null): string | null {
  return getScieMetadataRuntimeContext(anchor).documentPath;
}

export function setScieMetadataCitationEntries(entries: BibtexEntry[]): void {
  fallbackContext.citationEntries = entries;
}

export function getScieMetadataCitationEntries(anchor?: Element | null): BibtexEntry[] {
  return getScieMetadataRuntimeContext(anchor).citationEntries;
}

export function setScieMetadataUiCallbacks(callbacks: {
  pushToast?: (text: string, tone?: ToastTone) => void;
  confirmText?: (state: ConfirmState) => Promise<boolean>;
}): void {
  if (callbacks.pushToast) fallbackContext.pushToast = callbacks.pushToast;
  if (callbacks.confirmText) fallbackContext.confirmText = callbacks.confirmText;
}

export function visualAtomToast(text: string, tone?: ToastTone, anchor?: Element | null): void {
  getScieMetadataRuntimeContext(anchor).pushToast(text, tone);
}

export function visualAtomConfirm(state: ConfirmState, anchor?: Element | null): Promise<boolean> {
  return getScieMetadataRuntimeContext(anchor).confirmText(state);
}

function getScieMetadataRuntimeContext(anchor?: Element | null): ScieMetadataRuntimeContext {
  const contextId = findRuntimeContextId(anchor);
  if (contextId) {
    return editorContexts.get(contextId) ?? fallbackContext;
  }
  return fallbackContext;
}

function findRuntimeContextId(anchor?: Element | null): string | null {
  if (!anchor) return null;
  const root = anchor.closest<HTMLElement>('[data-scie-md-runtime-context]');
  return root?.dataset.scieMdRuntimeContext ?? null;
}
