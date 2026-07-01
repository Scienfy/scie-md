import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentFormat, FormatParseResult, JsonSchemaSource } from '@sciemd/core';
import { formatParseBudgetBytes } from '@sciemd/core';
import { parseSourceFormatDiagnostics } from '../formatDiagnostics';
import { useSourceFormatDiagnostics } from './useSourceFormatDiagnostics';

const formatWorkerMock = vi.hoisted(() => ({
  parseFormatDocumentAsync: vi.fn(),
  isTransientFormatParserWorkerFailure: vi.fn((error: unknown) => (
    error instanceof Error && /timed out|queue limit|worker failed/i.test(error.message)
  )),
}));

vi.mock('../../domain/formats/formatParserWorker', () => formatWorkerMock);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HookState = ReturnType<typeof useSourceFormatDiagnostics>;
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

describe('useSourceFormatDiagnostics', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestState: HookState | null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latestState = null;
    formatWorkerMock.parseFormatDocumentAsync.mockReset();
    formatWorkerMock.isTransientFormatParserWorkerFailure.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  it('ignores stale parse results when newer source is already pending', async () => {
    const first = deferred<FormatParseResult>();
    const second = deferred<FormatParseResult>();
    formatWorkerMock.parseFormatDocumentAsync
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    renderHook({ text: '{"version":1}' });
    await flushAsync();
    renderHook({ text: '{"version":2}' });
    await flushAsync();

    first.resolve(jsonParseResult('{"version":1}'));
    await flushAsync();
    expect(latestState?.jsonAnalysis).toBeNull();
    expect(latestState?.parsingPending).toBe(true);

    second.resolve(jsonParseResult('{"version":2}'));
    await flushAsync();
    expect(latestState?.parsingPending).toBe(false);
    expect(latestState?.jsonAnalysis?.status).toBe('valid');
    expect(latestState?.structuredModel).toMatchObject({
      format: 'json',
      status: 'valid',
      primaryVisualSurface: expect.objectContaining({ kind: 'tree' }),
      canRenderVisualSurface: true,
    });
    expect(latestState?.jsonAnalysis?.parseResult.parsed?.value).toEqual({ version: 2 });
  });

  it('keeps the previous same-document analysis visible while reparsing changed source', async () => {
    const second = deferred<FormatParseResult>();
    formatWorkerMock.parseFormatDocumentAsync
      .mockResolvedValueOnce(jsonParseResult('{"version":1}'))
      .mockReturnValueOnce(second.promise);

    renderHook({ text: '{"version":1}' });
    await flushAsync();
    expect(latestState?.parsingPending).toBe(false);
    expect(latestState?.jsonAnalysis?.parseResult.parsed?.value).toEqual({ version: 1 });

    renderHook({ text: '{"version":2}' });
    await flushAsync();

    expect(latestState?.parsingPending).toBe(true);
    expect(latestState?.jsonAnalysis?.parseResult.parsed?.value).toEqual({ version: 1 });

    second.resolve(jsonParseResult('{"version":2}'));
    await flushAsync();
    expect(latestState?.parsingPending).toBe(false);
    expect(latestState?.jsonAnalysis?.parseResult.parsed?.value).toEqual({ version: 2 });
  });

  it('keeps source editing active when the worker times out', async () => {
    formatWorkerMock.parseFormatDocumentAsync.mockRejectedValueOnce(new Error('Format parser worker timed out after 8000 ms.'));

    renderHook({ text: '{"ok":true}' });
    await flushAsync();

    expect(latestState?.parsingPending).toBe(false);
    expect(latestState?.jsonAnalysis?.status).toBe('source-only');
    expect(latestState?.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'warning',
      code: 'format-parser-unavailable',
      source: 'json',
    }));
  });

  it('falls back to synchronous diagnostics when the worker fails unexpectedly', async () => {
    formatWorkerMock.parseFormatDocumentAsync.mockRejectedValueOnce(new Error('unexpected worker serialization failure'));

    renderHook({ text: '{"bad": [}' });
    await flushAsync();

    expect(latestState?.parsingPending).toBe(false);
    expect(latestState?.jsonAnalysis?.status).toBe('invalid');
    expect(latestState?.diagnostics[0]).toMatchObject({
      severity: 'error',
      source: 'json',
    });
  });

  it('uses source-only diagnostics for oversized JSON without posting to the worker', async () => {
    const largeJson = `{"payload":"${'x'.repeat(1024 * 1024 + 1)}"}`;

    renderHook({ text: largeJson });
    await flushAsync();

    expect(formatWorkerMock.parseFormatDocumentAsync).not.toHaveBeenCalled();
    expect(latestState?.parsingPending).toBe(false);
    expect(latestState?.jsonAnalysis?.status).toBe('source-only');
    expect(latestState?.diagnostics[0]).toMatchObject({
      code: 'json-source-only-large-file',
      severity: 'warning',
    });
  });

  it('uses source-only diagnostics for oversized structured formats without posting to the worker', async () => {
    const cases: Array<{ format: DocumentFormat; path: string; text: string; statusKey: 'structuredAnalysis' | 'tabularAnalysis' }> = [
      {
        format: 'yaml',
        path: 'C:\\Lab\\config.yaml',
        text: `payload: ${'x'.repeat((formatParseBudgetBytes('yaml') ?? 1024 * 1024) + 1)}`,
        statusKey: 'structuredAnalysis',
      },
      {
        format: 'toml',
        path: 'C:\\Lab\\config.toml',
        text: `payload = "${'x'.repeat((formatParseBudgetBytes('toml') ?? 1024 * 1024) + 1)}"`,
        statusKey: 'structuredAnalysis',
      },
      {
        format: 'tsv',
        path: 'C:\\Lab\\table.tsv',
        text: `value\n${'x'.repeat((formatParseBudgetBytes('tsv') ?? 1024 * 1024) + 1)}\n`,
        statusKey: 'tabularAnalysis',
      },
    ];

    for (const testCase of cases) {
      formatWorkerMock.parseFormatDocumentAsync.mockClear();

      renderHook({ format: testCase.format, text: testCase.text, path: testCase.path });
      await flushAsync();

      expect(formatWorkerMock.parseFormatDocumentAsync).not.toHaveBeenCalled();
      expect(latestState?.parsingPending).toBe(false);
      expect(latestState?.[testCase.statusKey]?.status).toBe('source-only');
      expect(latestState?.diagnostics[0]).toMatchObject({
        code: `${testCase.format}-source-only-large-file`,
        severity: 'warning',
      });
    }
  });

  it('maps async JSONL parse results into record analysis', async () => {
    const parsed = jsonlParseResult('{"id":1}\n\n{"id":2}\n');
    formatWorkerMock.parseFormatDocumentAsync.mockResolvedValueOnce(parsed);

    renderHook({ format: 'jsonl', text: '{"id":1}\n\n{"id":2}\n', path: 'C:\\Lab\\records.jsonl' });
    await flushAsync();

    expect(formatWorkerMock.parseFormatDocumentAsync).toHaveBeenCalledWith(
      'jsonl',
      '{"id":1}\n\n{"id":2}\n',
      'C:\\Lab\\records.jsonl',
    );
    expect(latestState?.parsingPending).toBe(false);
    expect(latestState?.jsonAnalysis).toBeNull();
    expect(latestState?.structuredModel).toMatchObject({
      format: 'jsonl',
      primaryVisualSurface: expect.objectContaining({ kind: 'records' }),
      canRenderVisualSurface: true,
    });
    expect(latestState?.jsonlAnalysis?.recordCount).toBe(2);
    expect(latestState?.jsonlAnalysis?.invalidLineCount).toBe(1);
  });

  it('passes JSON schema sources to the parser worker and refreshes when they change', async () => {
    const schema = {
      kind: 'explicit' as const,
      path: 'C:\\Lab\\result.schema.json',
      text: '{"type":"object"}',
    };
    const parsed = jsonParseResult('{"id":"A"}');
    formatWorkerMock.parseFormatDocumentAsync.mockResolvedValue(parsed);

    renderHook({ text: '{"id":"A"}', jsonSchema: schema });
    await flushAsync();

    expect(formatWorkerMock.parseFormatDocumentAsync).toHaveBeenCalledWith(
      'json',
      '{"id":"A"}',
      'C:\\Lab\\result.json',
      { schema },
    );
  });

  function renderHook(options: {
    format?: DocumentFormat;
    text: string;
    path?: string | null;
    jsonSchema?: JsonSchemaSource | null;
  }) {
    act(() => {
      root.render(
        <Harness
          format={options.format ?? 'json'}
          text={options.text}
          path={options.path ?? 'C:\\Lab\\result.json'}
          jsonSchema={options.jsonSchema ?? null}
          onState={(state) => {
            latestState = state;
          }}
        />,
      );
    });
  }
});

function Harness({
  format,
  text,
  path,
  jsonSchema,
  onState,
}: {
  format: DocumentFormat;
  text: string;
  path: string | null;
  jsonSchema: JsonSchemaSource | null;
  onState: (state: HookState) => void;
}) {
  const state = useSourceFormatDiagnostics(format, text, path, { jsonSchema });
  onState(state);
  return null;
}

function jsonParseResult(text: string): FormatParseResult {
  const state = parseSourceFormatDiagnostics('json', text, null);
  const parseResult = state.jsonAnalysis?.parseResult;
  if (!parseResult) throw new Error('expected JSON parse result');
  return parseResult;
}

function jsonlParseResult(text: string): FormatParseResult {
  const state = parseSourceFormatDiagnostics('jsonl', text, null);
  const parseResult = state.jsonlAnalysis?.parseResult;
  if (!parseResult) throw new Error('expected JSONL parse result');
  return parseResult;
}

function deferred<T>(): Deferred<T> {
  let resolve: Deferred<T>['resolve'] | undefined;
  let reject: Deferred<T>['reject'] | undefined;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return {
    promise,
    resolve: resolve!,
    reject: reject!,
  };
}

async function flushAsync() {
  for (let index = 0; index < 8; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}
