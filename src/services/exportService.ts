import { invoke } from '@tauri-apps/api/core';
import { basename } from '../app/documentState';
import type { ExportRequestOptions, PandocExportFormat } from '../export/exportTypes';
import { exportFileExtension } from '../export/exportTypes';

export type { PandocExportFormat } from '../export/exportTypes';

export interface PandocExportResponse {
  outputPath: string;
  stderr: string;
}

export function defaultPandocExportPath(documentPath: string | null, format: PandocExportFormat): string {
  const extension = exportFileExtension(format);
  if (!documentPath) return `Untitled.${extension}`;
  const normalized = documentPath.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  const parent = slash >= 0 ? documentPath.slice(0, slash + 1) : '';
  const name = basename(documentPath).replace(/\.(md|markdown)$/i, `.${extension}`);
  return `${parent}exports/${name}`;
}

export async function exportWithPandoc(
  markdown: string,
  documentPath: string | null,
  outputPath: string,
  format: PandocExportFormat,
  options?: ExportRequestOptions,
): Promise<PandocExportResponse> {
  return invoke<PandocExportResponse>('export_with_pandoc', {
    markdown,
    documentPath,
    outputPath,
    format,
    citationStylePath: options?.citationStylePath ?? null,
    extraArgs: options?.extraPandocArgs ?? [],
  });
}

export async function exportHtmlWithPandoc(
  html: string,
  documentPath: string | null,
  outputPath: string,
  format: PandocExportFormat,
  options?: ExportRequestOptions,
): Promise<PandocExportResponse> {
  return invoke<PandocExportResponse>('export_html_with_pandoc', {
    html,
    documentPath,
    outputPath,
    format,
    citationStylePath: options?.citationStylePath ?? null,
    extraArgs: options?.extraPandocArgs ?? [],
  });
}

export async function exportStyledHtmlToPdf(
  html: string,
  outputPath: string,
): Promise<PandocExportResponse> {
  return invoke<PandocExportResponse>('export_styled_html_to_pdf', {
    html,
    outputPath,
  });
}

export async function exportHtmlToDocxNative(
  html: string,
  outputPath: string,
): Promise<PandocExportResponse> {
  return invoke<PandocExportResponse>('export_html_to_docx_native', {
    html,
    outputPath,
  });
}

export async function checkPandocAvailable(): Promise<string> {
  return invoke<string>('check_pandoc_available');
}
