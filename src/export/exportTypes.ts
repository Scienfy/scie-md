import type { ThemeMode } from '../services/settingsService';
import type { VisualStyleId } from '../services/visualStyleService';

export type PandocExportFormat =
  | 'docx'
  | 'epub'
  | 'latex'
  | 'pdf'
  | 'odt'
  | 'jats'
  | 'plain'
  | 'rst'
  | 'asciidoc'
  | 'docbook';

export type ExportFormat = PandocExportFormat | 'html';

export type PaperSize = 'A4' | 'Letter' | 'Legal' | 'A5' | 'B5';
export type PageOrientation = 'portrait' | 'landscape';
export type PageNumberMode = 'none' | 'bottom-center' | 'bottom-right' | 'top-right';

export interface PageMargins {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

export interface PdfExportOptions {
  paperSize: PaperSize;
  orientation: PageOrientation;
  margins: PageMargins;
  pageNumbers: PageNumberMode;
  runningHeader: string;
  runningFooter: string;
}

export interface ExportLayoutMetrics {
  viewportWidthPx?: number;
  contentWidthPx?: number;
}

export interface ExportRequestOptions {
  profileId: string;
  pdf: PdfExportOptions;
  citationStylePath: string | null;
  extraPandocArgs?: string[];
  cssOverrides?: string;
}

export interface ExportProfile {
  id: string;
  name: string;
  description: string;
  formats: ExportFormat[];
  pdf: PdfExportOptions;
  citationStylePath?: string | null;
  extraPandocArgs?: string[];
  cssOverrides?: string;
}

export type ExportLogLevel = 'info' | 'warn' | 'error';
export type ExportLogPhase = 'prepare' | 'render' | 'convert' | 'write' | 'validate';

export interface ExportLogEntry {
  timestamp: number;
  phase: ExportLogPhase;
  level: ExportLogLevel;
  message: string;
  durationMs?: number;
}

export interface ExportRunResult {
  ok: boolean;
  format: ExportFormat;
  message: string;
  outputPath?: string;
  cancelled?: boolean;
}

export interface ExportStyleOptions {
  themeMode: ThemeMode;
  resolvedTheme: Exclude<ThemeMode, 'system'>;
  visualStyle: VisualStyleId;
  fontScale: number;
  embedFonts: boolean;
  exportOptions: ExportRequestOptions;
}

export const DEFAULT_PDF_EXPORT_OPTIONS: PdfExportOptions = {
  paperSize: 'A4',
  orientation: 'portrait',
  margins: {
    top: '16mm',
    right: '16mm',
    bottom: '18mm',
    left: '16mm',
  },
  pageNumbers: 'bottom-center',
  runningHeader: '',
  runningFooter: '',
};

export const DEFAULT_EXPORT_OPTIONS: ExportRequestOptions = {
  profileId: 'default',
  pdf: DEFAULT_PDF_EXPORT_OPTIONS,
  citationStylePath: null,
};

export function normalizePdfExportOptions(value: unknown): PdfExportOptions {
  if (!value || typeof value !== 'object') return DEFAULT_PDF_EXPORT_OPTIONS;
  const candidate = value as Partial<PdfExportOptions>;
  return {
    paperSize: isPaperSize(candidate.paperSize) ? candidate.paperSize : DEFAULT_PDF_EXPORT_OPTIONS.paperSize,
    orientation: candidate.orientation === 'landscape' || candidate.orientation === 'portrait'
      ? candidate.orientation
      : DEFAULT_PDF_EXPORT_OPTIONS.orientation,
    margins: normalizeMargins(candidate.margins),
    pageNumbers: isPageNumberMode(candidate.pageNumbers) ? candidate.pageNumbers : DEFAULT_PDF_EXPORT_OPTIONS.pageNumbers,
    runningHeader: typeof candidate.runningHeader === 'string' ? candidate.runningHeader : '',
    runningFooter: typeof candidate.runningFooter === 'string' ? candidate.runningFooter : '',
  };
}

export function normalizeExportOptions(value: unknown): ExportRequestOptions {
  if (!value || typeof value !== 'object') return DEFAULT_EXPORT_OPTIONS;
  const candidate = value as Partial<ExportRequestOptions>;
  return {
    profileId: typeof candidate.profileId === 'string' && candidate.profileId.trim()
      ? candidate.profileId
      : DEFAULT_EXPORT_OPTIONS.profileId,
    pdf: normalizePdfExportOptions(candidate.pdf),
    citationStylePath: typeof candidate.citationStylePath === 'string' && candidate.citationStylePath.trim()
      ? candidate.citationStylePath.trim()
      : null,
    extraPandocArgs: Array.isArray(candidate.extraPandocArgs)
      ? candidate.extraPandocArgs.filter((item): item is string => typeof item === 'string')
      : undefined,
    cssOverrides: typeof candidate.cssOverrides === 'string' ? candidate.cssOverrides : undefined,
  };
}

export function exportFileExtension(format: ExportFormat): string {
  switch (format) {
    case 'latex':
      return 'tex';
    case 'jats':
    case 'docbook':
      return 'xml';
    case 'plain':
      return 'txt';
    case 'asciidoc':
      return 'adoc';
    default:
      return format;
  }
}

export function ensureExportFileExtension(path: string, format: ExportFormat): string {
  const trimmed = path.trim();
  if (!trimmed) return trimmed;
  const expectedExtension = exportFileExtension(format);
  const normalized = trimmed.replace(/\\/g, '/');
  const fileName = normalized.split('/').at(-1) ?? normalized;
  if (fileName.toLowerCase().endsWith(`.${expectedExtension.toLowerCase()}`)) return trimmed;
  if (/\.[^.]+$/.test(fileName)) {
    return trimmed.slice(0, trimmed.length - fileName.length) + fileName.replace(/\.[^.]+$/, `.${expectedExtension}`);
  }
  return `${trimmed}.${expectedExtension}`;
}

function normalizeMargins(value: unknown): PageMargins {
  if (!value || typeof value !== 'object') return DEFAULT_PDF_EXPORT_OPTIONS.margins;
  const candidate = value as Partial<PageMargins>;
  return {
    top: normalizeCssLength(candidate.top, DEFAULT_PDF_EXPORT_OPTIONS.margins.top),
    right: normalizeCssLength(candidate.right, DEFAULT_PDF_EXPORT_OPTIONS.margins.right),
    bottom: normalizeCssLength(candidate.bottom, DEFAULT_PDF_EXPORT_OPTIONS.margins.bottom),
    left: normalizeCssLength(candidate.left, DEFAULT_PDF_EXPORT_OPTIONS.margins.left),
  };
}

function normalizeCssLength(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return /^\d+(?:\.\d+)?(?:mm|cm|in|pt|px)$/i.test(trimmed) ? trimmed : fallback;
}

function isPaperSize(value: unknown): value is PaperSize {
  return value === 'A4' || value === 'Letter' || value === 'Legal' || value === 'A5' || value === 'B5';
}

function isPageNumberMode(value: unknown): value is PageNumberMode {
  return value === 'none' || value === 'bottom-center' || value === 'bottom-right' || value === 'top-right';
}
