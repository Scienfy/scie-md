import { readNativeRecoverySnapshot, writeNativeRecoverySnapshot } from './nativeRecoveryService';

interface RawDocumentRescueSnapshot {
  markdown: string;
  filePath: string | null;
  updatedAt: number;
}

const RESCUE_SNAPSHOT_KEY = 'scie-md:raw-document-rescue';
const NATIVE_SNAPSHOT_WRITE_INTERVAL_MS = 2_000;

let currentSnapshot: RawDocumentRescueSnapshot | null = null;
let pendingNativeSnapshot: RawDocumentRescueSnapshot | null = null;
let nativeSnapshotTimer: number | undefined;
let nativeSnapshotWriteInFlight = false;
let lastNativeSnapshotWriteAt = 0;

export function updateRawDocumentRescue(markdown: string, filePath: string | null): void {
  currentSnapshot = { markdown, filePath, updatedAt: Date.now() };
  try {
    window.sessionStorage.setItem(RESCUE_SNAPSHOT_KEY, JSON.stringify(currentSnapshot));
  } catch {
    // The in-memory snapshot still covers same-session error recovery.
  }
  scheduleNativeSnapshotWrite(currentSnapshot);
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

export async function exportRawDocumentRescueMarkdown(): Promise<boolean> {
  const snapshot = getRawDocumentRescueSnapshot() ?? await getNativeRawDocumentRescueSnapshot();
  if (!snapshot) return false;
  try {
    downloadMarkdown(snapshot.markdown, rescueFileName(snapshot.filePath));
    return true;
  } catch {
    return false;
  }
}

export async function flushRawDocumentRescueSnapshotForTests(): Promise<void> {
  if (nativeSnapshotTimer !== undefined) {
    window.clearTimeout(nativeSnapshotTimer);
    nativeSnapshotTimer = undefined;
  }
  await drainNativeSnapshotWrite();
}

function scheduleNativeSnapshotWrite(snapshot: RawDocumentRescueSnapshot): void {
  pendingNativeSnapshot = snapshot;
  if (nativeSnapshotTimer !== undefined) return;
  const elapsed = Date.now() - lastNativeSnapshotWriteAt;
  const delay = Math.max(0, NATIVE_SNAPSHOT_WRITE_INTERVAL_MS - elapsed);
  nativeSnapshotTimer = window.setTimeout(() => {
    nativeSnapshotTimer = undefined;
    void drainNativeSnapshotWrite();
  }, delay);
}

async function drainNativeSnapshotWrite(): Promise<void> {
  if (nativeSnapshotWriteInFlight) return;
  const snapshot = pendingNativeSnapshot;
  if (!snapshot) return;
  pendingNativeSnapshot = null;
  nativeSnapshotWriteInFlight = true;
  lastNativeSnapshotWriteAt = Date.now();
  try {
    await writeNativeRecoverySnapshot({
      markdown: snapshot.markdown,
      filePath: snapshot.filePath,
      updatedAtMs: snapshot.updatedAt,
    });
  } finally {
    nativeSnapshotWriteInFlight = false;
    if (pendingNativeSnapshot && nativeSnapshotTimer === undefined) {
      scheduleNativeSnapshotWrite(pendingNativeSnapshot);
    }
  }
}

async function getNativeRawDocumentRescueSnapshot(): Promise<RawDocumentRescueSnapshot | null> {
  const snapshot = await readNativeRecoverySnapshot();
  if (!snapshot?.markdown) return null;
  return {
    markdown: snapshot.markdown,
    filePath: snapshot.filePath,
    updatedAt: snapshot.updatedAtMs,
  };
}

function downloadMarkdown(markdown: string, fileName: string): void {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function rescueFileName(filePath: string | null): string {
  if (!filePath) return 'scie-md-rescue.md';
  const baseName = filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? 'document.md';
  const withoutExtension = baseName.replace(/\.(md|markdown|mdown|mkdn)$/i, '');
  return `${withoutExtension || 'document'}.rescue.md`;
}
