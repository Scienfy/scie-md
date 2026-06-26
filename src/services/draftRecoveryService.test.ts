import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearFileDraft,
  clearUntitledDraft,
  flushDraftRecoveryForTests,
  resetDraftRecoveryForTests,
  isBundledWelcomeMarkdown,
  loadFileDraftAsync,
  loadFileDraft,
  loadUntitledDraft,
  saveFileDraft,
  saveUntitledDraft,
  shouldOfferFileDraftRestore,
  shouldPersistUntitledDraft,
} from './draftRecoveryService';
import type { UntitledDraft } from './draftRecoveryService';
import type { FileMetadata } from '../app/documentState';

describe('draftRecoveryService', () => {
  let originalIndexedDb: IDBFactory | undefined;

  beforeEach(() => {
    localStorage.clear();
    resetDraftRecoveryForTests();
    originalIndexedDb = globalThis.indexedDB;
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: originalIndexedDb,
    });
  });

  it('stores and restores an untitled draft', () => {
    saveUntitledDraft('# Draft\n', 1000);

    expect(loadUntitledDraft(1500)).toEqual({ markdown: '# Draft\n', savedAt: 1000 });
  });

  it('drops stale drafts', () => {
    saveUntitledDraft('# Old\n', 1000);

    expect(loadUntitledDraft(16 * 24 * 60 * 60 * 1000)).toBeNull();
  });

  it('keeps large drafts instead of discarding them by character count', () => {
    saveUntitledDraft(`${'x'.repeat(5_000_001)}`, 1000);

    expect(loadUntitledDraft(1500)?.markdown.length).toBe(5_000_001);
    expect(localStorage.getItem('scie_md.untitledDraft.v1')).toBeNull();
  });

  it('stores and restores file-specific drafts', () => {
    saveFileDraft('C:\\docs\\paper.md', '# Edited\n', 1000);

    expect(loadFileDraft('c:/docs/paper.md', 1500)).toEqual({ markdown: '# Edited\n', savedAt: 1000 });
  });

  it('stores file draft base metadata so restore decisions do not rely only on clock ordering', () => {
    const metadata = fileMetadata({ lastKnownMtimeMs: 900, lastKnownSizeBytes: 12, contentHash: 'abc' });
    saveFileDraft('C:\\docs\\paper.md', '# Edited\n', 1000, metadata);

    expect(loadFileDraft('C:\\docs\\paper.md', 1500)).toEqual({
      markdown: '# Edited\n',
      savedAt: 1000,
      baseMetadata: {
        lastKnownMtimeMs: 900,
        lastKnownSizeBytes: 12,
        contentHash: 'abc',
      },
    });
  });

  it('uses SHA-256 file draft keys instead of plaintext paths or legacy FNV keys', () => {
    saveFileDraft('C:\\docs\\paper.md', '# Edited\n', 1000);

    const keys = Object.keys(localStorage);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^scie_md\.fileDraft\.v2\.sha256\.[a-f0-9]{64}$/);
    expect(keys[0]).not.toContain('paper');
    expect(keys[0]).not.toContain('docs');
  });

  it('keeps a localStorage quota failure recoverable in memory', () => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem() {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    };
    try {
      saveFileDraft('C:\\docs\\quota.md', '# Edited despite quota\n', 1000);
      expect(loadFileDraft('c:/docs/quota.md', 1500)).toEqual({
        markdown: '# Edited despite quota\n',
        savedAt: 1000,
      });
    } finally {
      Storage.prototype.setItem = originalSetItem;
    }
  });

  it('warns proactively when browser storage estimate is near quota', async () => {
    const listener = vi.fn();
    window.addEventListener('scienfy:draft-storage-warning', listener);
    const originalStorage = navigator.storage;
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: vi.fn().mockResolvedValue({ usage: 9_500, quota: 10_000 }),
      },
    });
    try {
      saveFileDraft('C:\\docs\\nearly-full.md', '# Draft\n', 1000);
      await Promise.resolve();
      await Promise.resolve();
      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].detail.message).toContain('nearly full');
    } finally {
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: originalStorage,
      });
      window.removeEventListener('scienfy:draft-storage-warning', listener);
    }
  });

  it('keeps POSIX case-sensitive file draft keys distinct', () => {
    saveFileDraft('/tmp/Paper.md', '# Upper\n', 1000);

    expect(loadFileDraft('/tmp/paper.md', 1500)).toBeNull();
    expect(loadFileDraft('/tmp/Paper.md', 1500)).toEqual({ markdown: '# Upper\n', savedAt: 1000 });
  });

  it('prunes older file-specific drafts so local recovery storage cannot grow without bound', () => {
    const corruptKey = `scie_md.fileDraft.v2.sha256.${'0'.repeat(64)}`;
    localStorage.setItem(corruptKey, '{not-json');

    for (let index = 0; index < 45; index += 1) {
      saveFileDraft(`C:\\docs\\paper-${index}.md`, `# Draft ${index}\n`, 1000 + index);
    }

    const fileDraftKeys = Object.keys(localStorage).filter((key) => key.startsWith('scie_md.fileDraft.v2.sha256.'));
    expect(fileDraftKeys).toHaveLength(40);
    expect(localStorage.getItem(corruptKey)).toBeNull();
    expect(loadFileDraft('C:\\docs\\paper-0.md', 2000)).toBeNull();
    expect(loadFileDraft('C:\\docs\\paper-44.md', 2000)?.markdown).toBe('# Draft 44\n');
  });

  it('clears file-specific drafts explicitly', () => {
    saveFileDraft('C:\\docs\\paper.md', '# Edited\n', 1000);
    clearFileDraft('C:\\docs\\paper.md');

    expect(loadFileDraft('C:\\docs\\paper.md')).toBeNull();
  });

  it('offers file draft restore only when its saved base still matches disk or it is clearly newer', () => {
    const draft = {
      markdown: '# Edited\n',
      savedAt: 1000,
      baseMetadata: {
        lastKnownMtimeMs: 500,
        lastKnownSizeBytes: 10,
        contentHash: 'base',
      },
    };

    expect(shouldOfferFileDraftRestore(draft, fileMetadata({ lastKnownMtimeMs: 1500, lastKnownSizeBytes: 20, contentHash: 'base' }))).toBe(true);
    expect(shouldOfferFileDraftRestore(draft, fileMetadata({ lastKnownMtimeMs: 1500, lastKnownSizeBytes: 20, contentHash: 'changed' }))).toBe(false);
    expect(shouldOfferFileDraftRestore({ markdown: '# Edited\n', savedAt: 3000 }, fileMetadata({ lastKnownMtimeMs: 1000 }))).toBe(true);
  });

  it('does not persist the unchanged bundled tutorial', () => {
    expect(shouldPersistUntitledDraft('# Welcome\n', '# Welcome\n')).toBe(false);
    expect(shouldPersistUntitledDraft('# My note\n', '# Welcome\n')).toBe(true);
  });

  it('can suppress edited copies of the bundled welcome tutorial', () => {
    const welcome = '---\ntitle: "ScieMD Tutorial"\n---\n\n# ScieMD Tutorial\n';
    const editedWelcome = `${welcome}\nUser experiment.\n`;

    expect(isBundledWelcomeMarkdown(editedWelcome)).toBe(true);
    expect(shouldPersistUntitledDraft(editedWelcome, welcome, { suppressBundledWelcome: true })).toBe(false);
    expect(shouldPersistUntitledDraft('# ScieMD Tutorial\nUser draft.\n', '# Blank\n', { suppressBundledWelcome: true })).toBe(true);
  });

  it('serializes IndexedDB draft writes so an older slow transaction cannot overwrite a newer draft', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: createFakeIndexedDb(),
    });
    const firstLargeDraft = `${'a'.repeat(1_050_000)}\n`;
    const secondLargeDraft = `${'b'.repeat(1_050_000)}\n`;

    saveFileDraft('C:\\docs\\paper.md', firstLargeDraft, 1000);
    saveFileDraft('C:\\docs\\paper.md', secondLargeDraft, 2000);
    await flushDraftRecoveryForTests();
    resetDraftRecoveryForTests();

    expect(await loadFileDraftAsync('C:\\docs\\paper.md', 3000)).toEqual({
      markdown: secondLargeDraft,
      savedAt: 2000,
    });
  });

  it('keeps a large draft recoverable in memory when IndexedDB access is blocked', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: {
        open: () => {
          throw new DOMException('IndexedDB is blocked', 'SecurityError');
        },
      },
    });
    const largeDraft = `${'x'.repeat(1_050_000)}\n`;

    expect(() => saveFileDraft('C:\\docs\\blocked-db.md', largeDraft, 1000)).not.toThrow();
    await flushDraftRecoveryForTests();

    expect(await loadFileDraftAsync('C:\\docs\\blocked-db.md', 1500)).toEqual({
      markdown: largeDraft,
      savedAt: 1000,
    });
  });

  it('clears drafts explicitly', () => {
    saveUntitledDraft('# Draft\n', 1000);
    clearUntitledDraft();

    expect(loadUntitledDraft()).toBeNull();
  });
});

function fileMetadata(overrides: Partial<FileMetadata> = {}): FileMetadata {
  return {
    lineEnding: 'lf',
    encoding: 'utf8',
    hasBom: false,
    hasMixedLineEndings: false,
    lastKnownMtimeMs: 0,
    lastKnownSizeBytes: 0,
    contentHash: null,
    cloudState: 'local',
    ...overrides,
  };
}

function createFakeIndexedDb(): IDBFactory {
  const values = new Map<IDBValidKey, unknown>();
  const db = new FakeDraftDb(values);
  return {
    open: () => {
      const request = new FakeOpenRequest(db);
      scheduleMicrotasks(0, () => {
        request.result = db as unknown as IDBDatabase;
        request.onupgradeneeded?.({ target: request } as unknown as IDBVersionChangeEvent);
        request.onsuccess?.({ target: request } as unknown as Event);
      });
      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}

class FakeOpenRequest {
  result: IDBDatabase | null = null;
  error: DOMException | null = null;
  onsuccess: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onupgradeneeded: ((event: IDBVersionChangeEvent) => void) | null = null;

  constructor(readonly db: FakeDraftDb) {}
}

class FakeDraftDb {
  constructor(private readonly values: Map<IDBValidKey, unknown>) {}

  createObjectStore() {
    return {};
  }

  transaction(_storeName: string, _mode: IDBTransactionMode) {
    return new FakeTransaction(this.values);
  }

  close() {
    // No-op for the in-memory test database.
  }
}

class FakeTransaction {
  oncomplete: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onabort: ((event: Event) => void) | null = null;
  error: DOMException | null = null;

  constructor(private readonly values: Map<IDBValidKey, unknown>) {}

  objectStore(_storeName: string) {
    return new FakeObjectStore(this, this.values);
  }

  complete() {
    scheduleMicrotasks(0, () => this.oncomplete?.(new Event('complete')));
  }

  abort() {
    this.onabort?.(new Event('abort'));
  }
}

class FakeObjectStore {
  constructor(
    private readonly transaction: FakeTransaction,
    private readonly values: Map<IDBValidKey, unknown>,
  ) {}

  put(value: UntitledDraft, key: IDBValidKey) {
    const request = new FakeRequest<IDBValidKey>();
    const delay = value.savedAt === 1000 ? 3 : 0;
    scheduleMicrotasks(delay, () => {
      this.values.set(key, value);
      request.succeed(key);
      this.transaction.complete();
    });
    return request as unknown as IDBRequest<IDBValidKey>;
  }

  get(key: IDBValidKey) {
    const request = new FakeRequest<unknown>();
    scheduleMicrotasks(0, () => {
      request.succeed(this.values.get(key));
      this.transaction.complete();
    });
    return request as unknown as IDBRequest<unknown>;
  }

  delete(key: IDBValidKey) {
    const request = new FakeRequest<undefined>();
    scheduleMicrotasks(0, () => {
      this.values.delete(key);
      request.succeed(undefined);
      this.transaction.complete();
    });
    return request as unknown as IDBRequest<undefined>;
  }

  openCursor() {
    const request = new FakeRequest<FakeCursor | null>();
    const entries = Array.from(this.values.entries());
    let index = 0;
    const fire = () => {
      if (index >= entries.length) {
        request.succeed(null);
        this.transaction.complete();
        return;
      }
      const [key, value] = entries[index];
      request.succeed(new FakeCursor(key, value, () => {
        index += 1;
        scheduleMicrotasks(0, fire);
      }));
    };
    scheduleMicrotasks(0, fire);
    return request as unknown as IDBRequest<IDBCursorWithValue | null>;
  }
}

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  succeed(result: T) {
    this.result = result;
    this.onsuccess?.({ target: this } as unknown as Event);
  }
}

class FakeCursor {
  constructor(
    readonly key: IDBValidKey,
    readonly value: unknown,
    private readonly continueCallback: () => void,
  ) {}

  continue() {
    this.continueCallback();
  }
}

function scheduleMicrotasks(count: number, callback: () => void): void {
  if (count <= 0) {
    queueMicrotask(callback);
    return;
  }
  queueMicrotask(() => scheduleMicrotasks(count - 1, callback));
}
