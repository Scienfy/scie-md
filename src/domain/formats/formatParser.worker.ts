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

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<FormatParseWorkerRequest>) => void) | null;
  postMessage: (message: FormatParseWorkerResponse) => void;
};

workerScope.onmessage = (event) => {
  const { id, format, text, path, options } = event.data;
  try {
    workerScope.postMessage({
      id,
      parseResult: parseFormatDocumentSync(format, text, path, options),
    });
  } catch (error) {
    workerScope.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
