import { afterEach, describe, expect, it, vi } from 'vitest';

describe('documentParserWorker', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('parses through the async API when a Worker implementation is not available', async () => {
    vi.stubGlobal('Worker', undefined);
    const { parseScienfyDocumentAsync } = await import('./documentParserWorker');
    const parsed = await parseScienfyDocumentAsync('---\ntitle: Worker fallback\n---\n\n# Intro\n\nText.');
    expect(parsed.title).toBe('Worker fallback');
    expect(parsed.references.labels).toEqual([]);
  });

  it('terminates a stuck worker and rejects pending parses instead of leaking them', async () => {
    vi.useFakeTimers();
    const workers: HangingWorker[] = [];
    vi.stubGlobal('Worker', class extends HangingWorker {
      constructor(...args: unknown[]) {
        super(...args);
        workers.push(this);
      }
    });
    const { PARSER_WORKER_TIMEOUT_MS, parseScienfyDocumentAsync } = await import('./documentParserWorker');

    const parsePromise = parseScienfyDocumentAsync('# Hanging parse');
    const rejection = expect(parsePromise).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(PARSER_WORKER_TIMEOUT_MS);

    await rejection;
    expect(workers).toHaveLength(1);
    expect(workers[0].terminated).toBe(true);
  });
});

class HangingWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  constructor(..._args: unknown[]) {
    // The worker URL and options are intentionally ignored by this test double.
  }

  postMessage(): void {
    // A hung parser worker never posts a response or an error.
  }

  terminate(): void {
    this.terminated = true;
  }
}
