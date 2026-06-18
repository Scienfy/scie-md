import type { BibtexEntry } from '../../domain/citations/bibtex';

type ToastTone = 'info' | 'success' | 'warning' | 'error';

type ConfirmState = {
  title: string;
  message: string;
  okLabel: string;
  cancelLabel: string;
};

let documentPath: string | null = null;
let citationEntries: BibtexEntry[] = [];
let pushToastCallback: (text: string, tone?: ToastTone) => void = (text, tone = 'info') => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('scie-md-visual-atom-toast', { detail: { text, tone } }));
};
let confirmCallback: (state: ConfirmState) => Promise<boolean> = async () => false;

export function setScieMetadataDocumentPath(nextDocumentPath: string | null): void {
  documentPath = nextDocumentPath;
}

export function getScieMetadataDocumentPath(): string | null {
  return documentPath;
}

export function setScieMetadataCitationEntries(entries: BibtexEntry[]): void {
  citationEntries = entries;
}

export function getScieMetadataCitationEntries(): BibtexEntry[] {
  return citationEntries;
}

export function setScieMetadataUiCallbacks(callbacks: {
  pushToast?: (text: string, tone?: ToastTone) => void;
  confirmText?: (state: ConfirmState) => Promise<boolean>;
}): void {
  if (callbacks.pushToast) pushToastCallback = callbacks.pushToast;
  if (callbacks.confirmText) confirmCallback = callbacks.confirmText;
}

export function visualAtomToast(text: string, tone?: ToastTone): void {
  pushToastCallback(text, tone);
}

export function visualAtomConfirm(state: ConfirmState): Promise<boolean> {
  return confirmCallback(state);
}
