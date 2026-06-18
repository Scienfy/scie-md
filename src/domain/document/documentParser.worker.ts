import { safeParseScienfyDocument } from './documentModel';
import type { ParsedScienfyDocument, ParseScienfyDocumentOptions } from './documentModel';

interface ParseWorkerRequest {
  id: number;
  markdown: string;
  options?: ParseScienfyDocumentOptions;
}

interface ParseWorkerResponse {
  id: number;
  document?: ParsedScienfyDocument;
  error?: string;
}

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ParseWorkerRequest>) => void) | null;
  postMessage: (message: ParseWorkerResponse) => void;
};

workerScope.onmessage = (event) => {
  const { id, markdown, options } = event.data;
  try {
    workerScope.postMessage({
      id,
      document: safeParseScienfyDocument(markdown, options),
    });
  } catch (error) {
    workerScope.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
