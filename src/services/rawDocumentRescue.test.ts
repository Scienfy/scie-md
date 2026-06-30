import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeNativeRecoverySnapshot } from './nativeRecoveryService';
import {
  RAW_RESCUE_SESSION_STORAGE_MAX_BYTES,
  flushRawDocumentRescueSnapshotForTests,
  nativeRescueMarkdown,
  rawDocumentRescuePolicy,
  updateRawDocumentRescue,
} from './rawDocumentRescue';

vi.mock('./nativeRecoveryService', () => ({
  readNativeRecoverySnapshot: vi.fn(async () => null),
  writeNativeRecoverySnapshot: vi.fn(async () => true),
}));

const RESCUE_SNAPSHOT_KEY = 'scie-md:raw-document-rescue';

describe('raw document rescue policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
    vi.mocked(writeNativeRecoverySnapshot).mockClear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.useRealTimers();
  });

  it('keeps small rescue snapshots in sessionStorage and native storage', async () => {
    updateRawDocumentRescue('# Small draft', 'C:\\Lab\\paper.md');
    await vi.runOnlyPendingTimersAsync();
    await flushRawDocumentRescueSnapshotForTests();

    expect(JSON.parse(window.sessionStorage.getItem(RESCUE_SNAPSHOT_KEY) ?? '{}')).toMatchObject({
      markdown: '# Small draft',
      filePath: 'C:\\Lab\\paper.md',
    });
    expect(writeNativeRecoverySnapshot).toHaveBeenCalledWith(expect.objectContaining({
      markdown: '# Small draft',
      filePath: 'C:\\Lab\\paper.md',
    }));
  });

  it('skips sessionStorage for large markdown and writes native fallback immediately', async () => {
    const largeMarkdown = `# Large\n\n${'x'.repeat(RAW_RESCUE_SESSION_STORAGE_MAX_BYTES + 1)}`;

    updateRawDocumentRescue(largeMarkdown, 'C:\\Lab\\large.md');
    await flushRawDocumentRescueSnapshotForTests();

    const sessionPayload = JSON.parse(window.sessionStorage.getItem(RESCUE_SNAPSHOT_KEY) ?? '{}');
    expect(sessionPayload).toMatchObject({
      markdown: '',
      nativeFallbackOnly: true,
      filePath: 'C:\\Lab\\large.md',
    });
    expect(writeNativeRecoverySnapshot).toHaveBeenCalledWith(expect.objectContaining({
      markdown: largeMarkdown,
      filePath: 'C:\\Lab\\large.md',
    }));
  });

  it('marks native rescue markdown when the native cap requires truncation', () => {
    const markdown = [
      '# Head',
      'A'.repeat(128),
      'B'.repeat(128),
      'Tail marker',
    ].join('\n');

    expect(rawDocumentRescuePolicy(markdown, 120)).toMatchObject({
      nativeStorage: 'truncated',
    });
    const rescue = nativeRescueMarkdown(markdown, 120);

    expect(rescue).toContain('ScieMD rescue snapshot truncated');
    expect(rescue).toContain('Original markdown bytes:');
    expect(rescue).toContain('Native rescue cap bytes: 120');
    expect(rescue).toContain('Tail marker');
  });
});
