import { adapterForFormat } from '@sciemd/core';
import type { DocumentFormat, FormatParseResult } from '@sciemd/core';

export function parseFormatDocumentSync(
  format: DocumentFormat,
  text: string,
  path: string | null = null,
  options?: unknown,
): FormatParseResult {
  const adapter = adapterForFormat(format);
  if (!adapter) throw new Error(`No format adapter is registered for ${format}.`);
  return adapter.parse(adapter.createContent(text, path), options);
}
