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

export async function checkInkscapeAvailable(_customPath?: string | null): Promise<InkscapeInfo> {
  throw new Error('Inkscape actions are not available in the VS Code extension MVP.');
}

export async function openSvgInInkscape(_svgSource: string, _documentPath: string | null): Promise<InkscapeSession> {
  throw new Error('Inkscape actions are not available in the VS Code extension MVP.');
}

export async function readInkscapeSvgSession(_sessionId: string): Promise<string> {
  throw new Error('Inkscape actions are not available in the VS Code extension MVP.');
}

export async function statInkscapeSvgSession(_sessionId: string): Promise<InkscapeSessionStatus> {
  throw new Error('Inkscape actions are not available in the VS Code extension MVP.');
}

export async function cleanupInkscapeSvgSession(_sessionId: string): Promise<void> {
  return undefined;
}

export async function exportSvgWithInkscape(
  _svgSource: string,
  _documentPath: string | null,
  _format: SvgExportFormat,
): Promise<SvgExportResponse> {
  throw new Error('Inkscape actions are not available in the VS Code extension MVP.');
}
