import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '../app/runtime';
import { loadSettings, updateSettings } from './settingsService';

export type SvgExportFormat = 'png' | 'pdf';

export interface InkscapeInfo {
  path: string;
  version: string;
}

export interface InkscapeSession {
  sessionId: string;
  tempPath: string;
}

export interface InkscapeSessionStatus {
  sessionId: string;
  tempPath: string;
  modifiedMs: number;
  changed: boolean;
}

export interface SvgExportResponse {
  outputPath: string;
  format: SvgExportFormat;
  cached: boolean;
}

export async function checkInkscapeAvailable(customPath = loadSettings().inkscapePath): Promise<InkscapeInfo> {
  ensureTauri();
  const info = await invoke<InkscapeInfo>('check_inkscape_available', { customPath });
  if (customPath && info.path) updateSettings({ inkscapePath: info.path });
  return info;
}

export async function openSvgInInkscape(svgSource: string, documentPath: string | null): Promise<InkscapeSession> {
  ensureTauri();
  const settings = loadSettings();
  const response = await invoke<InkscapeSession>('open_svg_in_inkscape', {
    svgSource,
    documentPath,
    customPath: settings.inkscapePath,
  });
  return response;
}

export async function readInkscapeSvgSession(sessionId: string): Promise<string> {
  ensureTauri();
  return invoke<string>('read_inkscape_svg_session', { sessionId });
}

export async function statInkscapeSvgSession(sessionId: string): Promise<InkscapeSessionStatus> {
  ensureTauri();
  return invoke<InkscapeSessionStatus>('stat_inkscape_svg_session', { sessionId });
}

export async function cleanupInkscapeSvgSession(sessionId: string): Promise<void> {
  ensureTauri();
  await invoke('cleanup_inkscape_svg_session', { sessionId });
}

export async function exportSvgWithInkscape(
  svgSource: string,
  documentPath: string | null,
  format: SvgExportFormat,
): Promise<SvgExportResponse> {
  ensureTauri();
  if (!documentPath) throw new Error('Save the Markdown document before exporting SVG assets.');
  return invoke<SvgExportResponse>('export_svg_with_inkscape', {
    svgSource,
    documentPath,
    format,
    customPath: loadSettings().inkscapePath,
  });
}

function ensureTauri(): void {
  if (!isTauriRuntime()) {
    throw new Error('Inkscape actions are available in the desktop app.');
  }
}
