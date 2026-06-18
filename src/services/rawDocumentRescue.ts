export const PLAIN_SOURCE_MODE_EVENT = 'scie-md:plain-source-mode';

interface RawDocumentRescueSnapshot {
  markdown: string;
  filePath: string | null;
  updatedAt: number;
}

const RESCUE_SNAPSHOT_KEY = 'scie-md:raw-document-rescue';
const PLAIN_SOURCE_REQUEST_KEY = 'scie-md:plain-source-requested';

let currentSnapshot: RawDocumentRescueSnapshot | null = null;

export function updateRawDocumentRescue(markdown: string, filePath: string | null): void {
  currentSnapshot = { markdown, filePath, updatedAt: Date.now() };
  try {
    window.sessionStorage.setItem(RESCUE_SNAPSHOT_KEY, JSON.stringify(currentSnapshot));
  } catch {
    // The in-memory snapshot still covers same-session error recovery.
  }
}

export function getRawDocumentRescueSnapshot(): RawDocumentRescueSnapshot | null {
  if (currentSnapshot) return currentSnapshot;
  try {
    const raw = window.sessionStorage.getItem(RESCUE_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RawDocumentRescueSnapshot>;
    if (typeof parsed.markdown !== 'string') return null;
    currentSnapshot = {
      markdown: parsed.markdown,
      filePath: typeof parsed.filePath === 'string' ? parsed.filePath : null,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
    return currentSnapshot;
  } catch {
    return null;
  }
}

export function hasRawDocumentRescueMarkdown(): boolean {
  return Boolean(getRawDocumentRescueSnapshot()?.markdown.length);
}

export function exportRawDocumentRescueMarkdown(): boolean {
  const snapshot = getRawDocumentRescueSnapshot();
  if (!snapshot) return false;
  try {
    const blob = new Blob([snapshot.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = rescueFileName(snapshot.filePath);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false;
  }
}

export function requestPlainSourceMode(): void {
  try {
    window.sessionStorage.setItem(PLAIN_SOURCE_REQUEST_KEY, '1');
  } catch {
    // The custom event still reaches a mounted app instance.
  }
  window.dispatchEvent(new CustomEvent(PLAIN_SOURCE_MODE_EVENT));
}

export function consumePlainSourceModeRequest(): boolean {
  try {
    const requested = window.sessionStorage.getItem(PLAIN_SOURCE_REQUEST_KEY) === '1';
    if (requested) window.sessionStorage.removeItem(PLAIN_SOURCE_REQUEST_KEY);
    return requested;
  } catch {
    return false;
  }
}

function rescueFileName(filePath: string | null): string {
  if (!filePath) return 'scie-md-rescue.md';
  const baseName = filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? 'document.md';
  const withoutExtension = baseName.replace(/\.(md|markdown|mdown|mkdn)$/i, '');
  return `${withoutExtension || 'document'}.rescue.md`;
}
