import * as vscode from 'vscode';
import type { DocumentFormat } from '@sciemd/core/formats/documentFormat';
import { inferStructuredDocument } from '@sciemd/core/formats/structured/structuredIngest';

export const STRUCTURED_PREVIEW_FORMATS = new Set<DocumentFormat>(['json', 'jsonl', 'yaml', 'toml', 'xml']);

export function documentFormatForUri(uri: vscode.Uri, fallbackFileName?: string): DocumentFormat {
  const path = uri.fsPath || uri.path || fallbackFileName || null;
  const result = inferStructuredDocument({
    text: '',
    path,
    url: uri.toString(),
    origin: 'vscode',
    trust: 'trusted',
  });
  return result.confidence === 'none' ? 'markdown' : result.format;
}

export function isStructuredPreviewFormat(format: DocumentFormat): boolean {
  return STRUCTURED_PREVIEW_FORMATS.has(format);
}

export function structuredPreviewFormatList(): string {
  return 'JSON, JSON Lines, YAML, TOML, and XML';
}
