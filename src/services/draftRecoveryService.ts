import type { FileMetadata } from '../app/documentState';

export interface UntitledDraft {
  markdown: string;
  savedAt: number;
  baseMetadata?: DraftBaseMetadata;
}

interface DraftBaseMetadata {
  lastKnownMtimeMs: number;
  lastKnownSizeBytes: number;
  contentHash: string | null;
}

const UNTITLED_DRAFT_KEY = 'scie_md.untitledDraft.v1';
const FILE_DRAFT_PREFIX = 'scie_md.fileDraft.v2.sha256.';
const LEGACY_FILE_DRAFT_PREFIX = 'scie_md.fileDraft.v1.';
const DRAFT_DB_NAME = 'scie_md_drafts';
const DRAFT_STORE_NAME = 'drafts';
const MAX_DRAFT_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const INDEXED_DRAFT_THRESHOLD_BYTES = 1024 * 1024;
const MAX_FILE_DRAFTS = 40;
const memoryDrafts = new Map<string, UntitledDraft>();
const indexedDraftOperations = new Map<string, Promise<void>>();
let lastQuotaWarningAt = 0;

export function loadUntitledDraft(now = Date.now()): UntitledDraft | null {
  try {
    const raw = localStorage.getItem(UNTITLED_DRAFT_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<UntitledDraft> : memoryDrafts.get(UNTITLED_DRAFT_KEY);
    if (!parsed) return null;
    if (typeof parsed.markdown !== 'string' || typeof parsed.savedAt !== 'number') {
      clearUntitledDraft();
      return null;
    }
    if (!parsed.markdown.trim() || now - parsed.savedAt > MAX_DRAFT_AGE_MS) {
      clearUntitledDraft();
      return null;
    }
    return draftWithOptionalBaseMetadata(parsed.markdown, parsed.savedAt, parsed.baseMetadata);
  } catch {
    clearUntitledDraft();
    return null;
  }
}

export function saveUntitledDraft(markdown: string, savedAt = Date.now()): void {
  if (!markdown.trim()) {
    clearUntitledDraft();
    return;
  }
  persistDraft(UNTITLED_DRAFT_KEY, { markdown, savedAt });
}

export function clearUntitledDraft(): void {
  memoryDrafts.delete(UNTITLED_DRAFT_KEY);
  try {
    localStorage.removeItem(UNTITLED_DRAFT_KEY);
  } catch {
    // Ignore storage failures; the saved document state remains authoritative.
  }
  void queueIndexedDraftDelete(UNTITLED_DRAFT_KEY);
}

export function loadFileDraft(filePath: string, now = Date.now()): UntitledDraft | null {
  const key = fileDraftKey(filePath);
  const legacyKeys = legacyFileDraftKeys(filePath);
  try {
    const raw = localStorage.getItem(key) ?? firstLocalStorageValue(legacyKeys);
    const parsed = raw ? JSON.parse(raw) as Partial<UntitledDraft> : memoryDrafts.get(key) ?? firstMemoryDraft(legacyKeys);
    if (!parsed) return null;
    if (typeof parsed.markdown !== 'string' || typeof parsed.savedAt !== 'number') {
      clearFileDraft(filePath);
      return null;
    }
    if (!parsed.markdown.trim() || now - parsed.savedAt > MAX_DRAFT_AGE_MS) {
      clearFileDraft(filePath);
      return null;
    }
    return draftWithOptionalBaseMetadata(parsed.markdown, parsed.savedAt, parsed.baseMetadata);
  } catch {
    clearFileDraft(filePath);
    return null;
  }
}

export function saveFileDraft(filePath: string, markdown: string, savedAt = Date.now(), baseMetadata?: FileMetadata | null): void {
  if (!markdown.trim()) {
    clearFileDraft(filePath);
    return;
  }
  persistDraft(fileDraftKey(filePath), {
    markdown,
    savedAt,
    baseMetadata: baseMetadata ? draftBaseMetadata(baseMetadata) : undefined,
  });
}

export function clearFileDraft(filePath: string): void {
  const key = fileDraftKey(filePath);
  const legacyKeys = legacyFileDraftKeys(filePath);
  memoryDrafts.delete(key);
  for (const legacyKey of legacyKeys) memoryDrafts.delete(legacyKey);
  try {
    localStorage.removeItem(key);
    for (const legacyKey of legacyKeys) localStorage.removeItem(legacyKey);
  } catch {
    // Ignore storage failures; the saved document state remains authoritative.
  }
  void queueIndexedDraftDelete(key);
  for (const legacyKey of legacyKeys) void queueIndexedDraftDelete(legacyKey);
}

export async function loadUntitledDraftAsync(now = Date.now()): Promise<UntitledDraft | null> {
  return loadUntitledDraft(now) ?? await loadIndexedDraft(UNTITLED_DRAFT_KEY, now);
}

export async function loadFileDraftAsync(filePath: string, now = Date.now()): Promise<UntitledDraft | null> {
  const legacyKeys = legacyFileDraftKeys(filePath);
  return loadFileDraft(filePath, now)
    ?? await loadIndexedDraft(fileDraftKey(filePath), now)
    ?? await loadFirstIndexedDraft(legacyKeys, now);
}

export function shouldPersistUntitledDraft(markdown: string, initialMarkdown: string, options: { suppressBundledWelcome?: boolean } = {}): boolean {
  if (!markdown.trim() || markdown === initialMarkdown) return false;
  if (options.suppressBundledWelcome && isBundledWelcomeMarkdown(markdown) && isBundledWelcomeMarkdown(initialMarkdown)) return false;
  return true;
}

export function shouldOfferFileDraftRestore(draft: UntitledDraft, diskMetadata: FileMetadata): boolean {
  if (draft.baseMetadata) {
    const base = draft.baseMetadata;
    if (base.contentHash && diskMetadata.contentHash && base.contentHash === diskMetadata.contentHash) return true;
    if (
      base.lastKnownMtimeMs > 0
      && base.lastKnownMtimeMs === diskMetadata.lastKnownMtimeMs
      && base.lastKnownSizeBytes === diskMetadata.lastKnownSizeBytes
    ) {
      return true;
    }
  }

  return draft.savedAt > diskMetadata.lastKnownMtimeMs + 1000;
}

export function isBundledWelcomeMarkdown(markdown: string): boolean {
  return /(?:^|\n)title:\s*["']?ScieMD Tutorial["']?/i.test(markdown)
    || /^#\s+ScieMD Tutorial\s*$/im.test(markdown);
}

function fileDraftKey(filePath: string): string {
  return `${FILE_DRAFT_PREFIX}${sha256Hex(normalizeDraftPath(filePath))}`;
}

function legacyFileDraftKeys(filePath: string): string[] {
  const normalized = normalizeDraftPath(filePath);
  return [
    `${LEGACY_FILE_DRAFT_PREFIX}${encodeURIComponent(normalized)}`,
    `${LEGACY_FILE_DRAFT_PREFIX}${legacyStablePathHash(filePath)}`,
  ];
}

function normalizeDraftPath(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) return normalized.toLowerCase();
  if (/^\/\/[^/]+\/[^/]+/.test(normalized)) return normalized.toLowerCase();
  return normalized;
}

function persistDraft(key: string, draft: UntitledDraft): void {
  memoryDrafts.set(key, draft);
  pruneFileDrafts(key);
  const raw = JSON.stringify(draft);
  const rawBytes = byteLength(raw);
  void warnIfStorageQuotaIsTight(rawBytes);
  if (rawBytes >= INDEXED_DRAFT_THRESHOLD_BYTES) {
    removeLocalDraft(key);
    void queueIndexedDraftSave(key, draft);
    return;
  }

  try {
    localStorage.setItem(key, raw);
    pruneFileDrafts(key);
    void queueIndexedDraftDelete(key);
  } catch (error) {
    removeLocalDraft(key);
    emitDraftStorageWarning(
      'Local draft storage is full. ScieMD will keep using the larger draft database for recovery.',
      error,
    );
    void queueIndexedDraftSave(key, draft);
  }
}

function pruneFileDrafts(currentKey: string): void {
  if (!isFileDraftKey(currentKey)) return;

  const memoryCandidates = Array.from(memoryDrafts.entries())
    .filter(([key]) => isFileDraftKey(key))
    .map(([key, draft]) => ({ key, savedAt: draft.savedAt }));
  for (const stale of staleDraftKeys(memoryCandidates, currentKey)) {
    memoryDrafts.delete(stale);
  }

  try {
    const localCandidates: Array<{ key: string; savedAt: number }> = [];
    const localKeys = Array.from({ length: localStorage.length }, (_value, index) => localStorage.key(index));
    for (const key of localKeys) {
      if (!key || !isFileDraftKey(key)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as Partial<UntitledDraft>;
        localCandidates.push({ key, savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0 });
      } catch {
        localStorage.removeItem(key);
        void queueIndexedDraftDelete(key);
      }
    }
    for (const stale of staleDraftKeys(localCandidates, currentKey)) {
      localStorage.removeItem(stale);
      void queueIndexedDraftDelete(stale);
    }
  } catch {
    // Draft pruning is best-effort. Failure must not interrupt recovery writes.
  }
  void pruneIndexedFileDrafts(currentKey);
}

function staleDraftKeys(candidates: Array<{ key: string; savedAt: number }>, currentKey: string): string[] {
  return candidates
    .sort((left, right) => right.savedAt - left.savedAt || left.key.localeCompare(right.key))
    .slice(MAX_FILE_DRAFTS)
    .map((candidate) => candidate.key)
    .filter((key) => key !== currentKey);
}

function isFileDraftKey(key: string): boolean {
  return key.startsWith(FILE_DRAFT_PREFIX) || key.startsWith(LEGACY_FILE_DRAFT_PREFIX);
}

function draftBaseMetadata(metadata: FileMetadata): DraftBaseMetadata {
  return {
    lastKnownMtimeMs: metadata.lastKnownMtimeMs,
    lastKnownSizeBytes: metadata.lastKnownSizeBytes,
    contentHash: metadata.contentHash,
  };
}

function normalizeDraftBaseMetadata(value: unknown): DraftBaseMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Partial<DraftBaseMetadata>;
  if (
    typeof record.lastKnownMtimeMs !== 'number'
    || typeof record.lastKnownSizeBytes !== 'number'
    || !(typeof record.contentHash === 'string' || record.contentHash === null)
  ) {
    return undefined;
  }
  return {
    lastKnownMtimeMs: record.lastKnownMtimeMs,
    lastKnownSizeBytes: record.lastKnownSizeBytes,
    contentHash: record.contentHash,
  };
}

function draftWithOptionalBaseMetadata(markdown: string, savedAt: number, baseMetadata: unknown): UntitledDraft {
  const normalizedBaseMetadata = normalizeDraftBaseMetadata(baseMetadata);
  return normalizedBaseMetadata
    ? { markdown, savedAt, baseMetadata: normalizedBaseMetadata }
    : { markdown, savedAt };
}

function firstLocalStorageValue(keys: string[]): string | null {
  for (const key of keys) {
    const raw = localStorage.getItem(key);
    if (raw) return raw;
  }
  return null;
}

function firstMemoryDraft(keys: string[]): UntitledDraft | undefined {
  for (const key of keys) {
    const draft = memoryDrafts.get(key);
    if (draft) return draft;
  }
  return undefined;
}

function removeLocalDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Local storage cleanup is opportunistic; memory/IndexedDB remain authoritative.
  }
}

async function loadFirstIndexedDraft(keys: string[], now: number): Promise<UntitledDraft | null> {
  for (const key of keys) {
    const draft = await loadIndexedDraft(key, now);
    if (draft) return draft;
  }
  return null;
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  return unescape(encodeURIComponent(value)).length;
}

function emitDraftStorageWarning(message: string, error: unknown): void {
  console.warn(message, error);
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('scienfy:draft-storage-warning', {
    detail: { message },
  }));
}

async function warnIfStorageQuotaIsTight(nextWriteBytes: number): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return;
  const now = Date.now();
  if (now - lastQuotaWarningAt < 60_000) return;
  try {
    const estimate = await navigator.storage.estimate();
    const quota = estimate.quota ?? 0;
    if (quota <= 0) return;
    const usage = estimate.usage ?? 0;
    const projectedUsage = usage + nextWriteBytes;
    if (projectedUsage < quota * 0.9) return;
    lastQuotaWarningAt = now;
    emitDraftStorageWarning(
      'Local draft storage is nearly full. Save this document to disk or free browser storage so recovery drafts remain available.',
      new Error(`Storage usage ${usage} + draft ${nextWriteBytes} is close to quota ${quota}.`),
    );
  } catch {
    // Some runtimes expose navigator.storage but block estimate(); reactive recovery remains active.
  }
}

function legacyStablePathHash(value: string): string {
  let hash = 0x811c9dc5;
  const normalized = normalizeDraftPath(value);
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function supportsIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!supportsIndexedDb()) {
      reject(new Error('IndexedDB is not available.'));
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DRAFT_DB_NAME, 1);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DRAFT_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open draft database.'));
  });
}

function queueIndexedDraftSave(key: string, draft: UntitledDraft): Promise<void> {
  return queueIndexedDraftOperation(key, () => saveIndexedDraft(key, draft));
}

function queueIndexedDraftDelete(key: string): Promise<void> {
  return queueIndexedDraftOperation(key, () => deleteIndexedDraft(key));
}

function queueIndexedDraftOperation(key: string, operation: () => Promise<void>): Promise<void> {
  const previous = indexedDraftOperations.get(key) ?? Promise.resolve();
  let next: Promise<void>;
  next = previous
    .catch(() => undefined)
    .then(operation)
    .catch(() => undefined)
    .finally(() => {
      if (indexedDraftOperations.get(key) === next) {
        indexedDraftOperations.delete(key);
      }
    });
  indexedDraftOperations.set(key, next);
  return next;
}

async function saveIndexedDraft(key: string, draft: UntitledDraft): Promise<void> {
  try {
    const db = await openDraftDb();
    await runDraftTransaction(db, 'readwrite', (store) => store.put(draft, key));
    db.close();
  } catch (error) {
    emitDraftStorageWarning(
      'Draft database storage is unavailable or full. ScieMD will keep this recovery draft in memory for this session.',
      error,
    );
  }
}

async function loadIndexedDraft(key: string, now: number): Promise<UntitledDraft | null> {
  try {
    const db = await openDraftDb();
    const draft = await runDraftTransaction<UntitledDraft | undefined>(db, 'readonly', (store) => store.get(key));
    db.close();
    if (!draft || typeof draft.markdown !== 'string' || typeof draft.savedAt !== 'number') return null;
    if (!draft.markdown.trim() || now - draft.savedAt > MAX_DRAFT_AGE_MS) {
      await deleteIndexedDraft(key);
      return null;
    }
    return draftWithOptionalBaseMetadata(draft.markdown, draft.savedAt, draft.baseMetadata);
  } catch {
    return null;
  }
}

async function deleteIndexedDraft(key: string): Promise<void> {
  try {
    const db = await openDraftDb();
    await runDraftTransaction(db, 'readwrite', (store) => store.delete(key));
    db.close();
  } catch {
    // Ignore storage failures; the saved document state remains authoritative.
  }
}

async function pruneIndexedFileDrafts(currentKey: string): Promise<void> {
  try {
    const db = await openDraftDb();
    const candidates = await listIndexedFileDraftCandidates(db);
    const stale = staleDraftKeys(candidates, currentKey);
    if (stale.length > 0) {
      await runDraftTransaction(db, 'readwrite', (store) => {
        for (const key of stale) store.delete(key);
        return store.get(currentKey);
      });
    }
    db.close();
  } catch {
    // IndexedDB pruning is opportunistic; load paths still expire stale drafts.
  }
}

function listIndexedFileDraftCandidates(db: IDBDatabase): Promise<Array<{ key: string; savedAt: number }>> {
  return new Promise((resolve, reject) => {
    const candidates: Array<{ key: string; savedAt: number }> = [];
    const transaction = db.transaction(DRAFT_STORE_NAME, 'readonly');
    const store = transaction.objectStore(DRAFT_STORE_NAME);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const key = typeof cursor.key === 'string' ? cursor.key : '';
      const value = cursor.value as Partial<UntitledDraft> | undefined;
      if (isFileDraftKey(key)) {
        candidates.push({ key, savedAt: typeof value?.savedAt === 'number' ? value.savedAt : 0 });
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error('Could not enumerate draft database.'));
    transaction.oncomplete = () => resolve(candidates);
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not enumerate draft database.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Draft database enumeration was aborted.'));
  });
}

export async function flushDraftRecoveryForTests(): Promise<void> {
  while (indexedDraftOperations.size > 0) {
    await Promise.all(Array.from(indexedDraftOperations.values()));
  }
}

export function resetDraftRecoveryForTests(): void {
  memoryDrafts.clear();
  indexedDraftOperations.clear();
  lastQuotaWarningAt = 0;
}

function runDraftTransaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DRAFT_STORE_NAME, mode);
    let requestResult: T | undefined;
    let requestCompleted = false;
    let settled = false;
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    transaction.oncomplete = () => {
      if (settled) return;
      if (!requestCompleted) {
        rejectOnce(new Error('Draft database request did not complete.'));
        return;
      }
      settled = true;
      resolve(requestResult as T);
    };
    transaction.onerror = () => rejectOnce(transaction.error ?? new Error('Draft database transaction failed.'));
    transaction.onabort = () => rejectOnce(transaction.error ?? new Error('Draft database transaction was aborted.'));

    let request: IDBRequest<T>;
    try {
      request = operation(transaction.objectStore(DRAFT_STORE_NAME));
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already be inactive.
      }
      rejectOnce(error);
      return;
    }
    request.onsuccess = () => {
      requestResult = request.result;
      requestCompleted = true;
    };
    request.onerror = () => {
      rejectOnce(request.error ?? new Error('Draft database request failed.'));
      try {
        transaction.abort();
      } catch {
        // The browser may have already started aborting the transaction.
      }
    };
  });
}

function sha256Hex(value: string): string {
  const bytes = new TextEncoder().encode(value.normalize('NFC'));
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const words = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = add32(words[index - 16], s0, words[index - 7], s1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = add32(h, s1, ch, SHA256_K[index], words[index]);
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = add32(s0, maj);
      h = g;
      g = f;
      f = e;
      e = add32(d, temp1);
      d = c;
      c = b;
      b = a;
      a = add32(temp1, temp2);
    }

    h0 = add32(h0, a);
    h1 = add32(h1, b);
    h2 = add32(h2, c);
    h3 = add32(h3, d);
    h4 = add32(h4, e);
    h5 = add32(h5, f);
    h6 = add32(h6, g);
    h7 = add32(h7, h);
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((part) => part.toString(16).padStart(8, '0'))
    .join('');
}

function rotateRight(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

function add32(...values: number[]): number {
  return values.reduce((sum, value) => (sum + value) >>> 0, 0);
}

const SHA256_K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
