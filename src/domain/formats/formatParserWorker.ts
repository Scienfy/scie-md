import type { DocumentFormat, FormatParseResult } from '@sciemd/core';
import { parseFormatDocumentSync } from './parseFormatDocument';

interface FormatParseWorkerRequest {
  id: number;
  format: DocumentFormat;
  text: string;
  path: string | null;
  options?: unknown;
}

interface FormatParseWorkerResponse {
  id: number;
  parseResult?: FormatParseResult;
  error?: string;
}

interface PendingFormatParse {
  resolve: (parseResult: FormatParseResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  request: FormatParseWorkerRequest;
  worker: Worker;
  retryCount: number;
  supersedeKey: string | null;
}

let formatParserWorker: Worker | null = null;
let nextRequestId = 1;
const pendingFormatParses = new Map<number, PendingFormatParse>();

export const FORMAT_PARSER_WORKER_TIMEOUT_MS = 8000;
export const FORMAT_PARSER_WORKER_MAX_PENDING = 8;
export const FORMAT_PARSER_WORKER_MAX_RETRIES = 1;
const TRANSIENT_FORMAT_WORKER_FAILURE_PATTERN = /timed out|superseded|queue limit|worker failed|empty response/i;

export function parseFormatDocumentAsync(
  format: DocumentFormat,
  text: string,
  path: string | null = null,
  options?: unknown,
): Promise<FormatParseResult> {
  const worker = getFormatParserWorker();
  if (!worker) return Promise.resolve().then(() => parseFormatDocumentSync(format, text, path, options));

  const id = nextRequestId++;
  const request: FormatParseWorkerRequest = { id, format, text, path, options };
  return new Promise((resolve, reject) => {
    trimPendingFormatParseQueue();
    rejectSupersededFormatParses(supersedeKeyForRequest(request));
    const timeout = setTimeout(() => {
      if (!pendingFormatParses.has(id)) return;
      handleFormatParseTimeout(id);
    }, FORMAT_PARSER_WORKER_TIMEOUT_MS);
    pendingFormatParses.set(id, {
      resolve,
      reject,
      timeout,
      request,
      worker,
      retryCount: 0,
      supersedeKey: supersedeKeyForRequest(request),
    });
    try {
      worker.postMessage(request);
    } catch (error) {
      clearPendingFormatParse(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function isTransientFormatParserWorkerFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_FORMAT_WORKER_FAILURE_PATTERN.test(message);
}

function getFormatParserWorker(): Worker | null {
  if (formatParserWorker) return formatParserWorker;
  if (typeof Worker === 'undefined') return null;
  try {
    const worker = new Worker(new URL('./formatParser.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = handleFormatWorkerMessage;
    worker.onerror = (event) => {
      const message = event.message || 'Format parser worker failed.';
      rejectPendingFormatParses(new Error(message));
    };
    formatParserWorker = worker;
    return formatParserWorker;
  } catch {
    formatParserWorker = null;
    return null;
  }
}

function handleFormatWorkerMessage(event: MessageEvent<FormatParseWorkerResponse>): void {
  const { id, parseResult, error } = event.data;
  const pending = pendingFormatParses.get(id);
  if (!pending) return;
  clearPendingFormatParse(id);
  if (error) {
    pending.reject(new Error(error));
    return;
  }
  if (!parseResult) {
    pending.reject(new Error('Format parser worker returned an empty response.'));
    return;
  }
  pending.resolve(parseResult);
}

function trimPendingFormatParseQueue(): void {
  while (pendingFormatParses.size >= FORMAT_PARSER_WORKER_MAX_PENDING) {
    const oldestId = pendingFormatParses.keys().next().value as number | undefined;
    if (oldestId === undefined) return;
    const pending = pendingFormatParses.get(oldestId);
    clearPendingFormatParse(oldestId);
    pending?.reject(new Error('Format parser worker queue limit exceeded.'));
  }
}

function handleFormatParseTimeout(id: number): void {
  const timedOut = pendingFormatParses.get(id);
  if (!timedOut) return;
  const failedWorker = timedOut.worker;
  clearPendingFormatParse(id);
  timedOut.reject(new Error(`Format parser worker timed out after ${FORMAT_PARSER_WORKER_TIMEOUT_MS} ms.`));
  restartFormatParserWorker(failedWorker, new Error('Format parser worker failed after a request timed out.'));
}

function restartFormatParserWorker(failedWorker: Worker, fallbackError: Error): void {
  if (formatParserWorker === failedWorker) {
    failedWorker.terminate();
    formatParserWorker = null;
  }
  const retryable = Array.from(pendingFormatParses.values())
    .filter((pending) => pending.worker === failedWorker);
  for (const pending of retryable) {
    clearTimeout(pending.timeout);
    if (pending.retryCount >= FORMAT_PARSER_WORKER_MAX_RETRIES) {
      clearPendingFormatParse(pending.request.id);
      pending.reject(fallbackError);
      continue;
    }
    pending.retryCount += 1;
    const worker = getFormatParserWorker();
    if (!worker) {
      clearPendingFormatParse(pending.request.id);
      Promise.resolve()
        .then(() => parseFormatDocumentSync(
          pending.request.format,
          pending.request.text,
          pending.request.path,
          pending.request.options,
        ))
        .then(pending.resolve, pending.reject);
      continue;
    }
    pending.worker = worker;
    pending.timeout = setTimeout(() => {
      if (!pendingFormatParses.has(pending.request.id)) return;
      handleFormatParseTimeout(pending.request.id);
    }, FORMAT_PARSER_WORKER_TIMEOUT_MS);
    try {
      worker.postMessage(pending.request);
    } catch (error) {
      clearPendingFormatParse(pending.request.id);
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function rejectSupersededFormatParses(supersedeKey: string | null): void {
  if (!supersedeKey) return;
  for (const [id, pending] of pendingFormatParses.entries()) {
    if (pending.supersedeKey !== supersedeKey) continue;
    clearPendingFormatParse(id);
    pending.reject(new Error('Format parser worker request superseded by newer source.'));
  }
}

function clearPendingFormatParse(id: number): void {
  const pending = pendingFormatParses.get(id);
  if (pending) clearTimeout(pending.timeout);
  pendingFormatParses.delete(id);
}

function rejectPendingFormatParses(error: Error): void {
  for (const pending of pendingFormatParses.values()) {
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
  pendingFormatParses.clear();
  formatParserWorker?.terminate();
  formatParserWorker = null;
}

function supersedeKeyForRequest(request: FormatParseWorkerRequest): string | null {
  if (!request.path) return null;
  return `${request.format}\0${request.path}\0${stableOptionsKey(request.options)}`;
}

function stableOptionsKey(options: unknown): string {
  if (options === undefined) return '';
  try {
    return JSON.stringify(options);
  } catch {
    return String(options);
  }
}
