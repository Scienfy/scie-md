import { normalizeVisualStyleId } from './visualStyleService';
import type { VisualStyleId } from './visualStyleService';
import { DEFAULT_EXPORT_OPTIONS, normalizeExportOptions } from '../export/exportTypes';
import type { ExportRequestOptions } from '../export/exportTypes';

export interface PersistedSettings {
  recentFiles: string[];
  themeMode: ThemeMode;
  fontScale: number;
  visualStyle: VisualStyleId;
  outlineOpen: boolean;
  sidebarWidth: number;
  sidebarView: SidebarView;
  explorerRootPath: string | null;
  inspectorOpen: boolean;
  authorshipVisible: boolean;
  focusMode: boolean;
  documentType: DocumentType;
  onboardingComplete: boolean;
  inkscapePath: string | null;
  exportOptions: ExportRequestOptions;
}

export type ThemeMode = 'system' | 'light' | 'dark' | 'sepia';
export type DocumentType = 'lab-note' | 'report' | 'memo' | 'notes' | 'other';
export type SidebarView = 'files' | 'outline' | 'references' | 'data';

const SETTINGS_KEY = 'scienfy.markdown.settings.v1';
const SCIENCE_DEFAULT_MIGRATION_KEY = 'scienfy.markdown.settings.scienceDefaultMigrated.v1';
const RECENT_LIMIT = 15;
export const SIDEBAR_WIDTH_DEFAULT = 360;
export const SIDEBAR_WIDTH_MIN = 248;
export const SIDEBAR_WIDTH_MAX = 560;
const DEFAULT_SETTINGS: PersistedSettings = {
  recentFiles: [],
  themeMode: 'dark',
  fontScale: 1,
  visualStyle: 'science',
  outlineOpen: true,
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  sidebarView: 'outline',
  explorerRootPath: null,
  inspectorOpen: false,
  authorshipVisible: true,
  focusMode: false,
  documentType: 'report',
  onboardingComplete: false,
  inkscapePath: null,
  exportOptions: DEFAULT_EXPORT_OPTIONS,
};

export function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    const parsedVisualStyle = normalizeVisualStyleId(parsed.visualStyle);
    const shouldMigrateLegacyDefault = shouldMigrateLegacyScienfyDefault(parsed.visualStyle, parsedVisualStyle);
    const visualStyle = shouldMigrateLegacyDefault ? 'science' : parsedVisualStyle ?? DEFAULT_SETTINGS.visualStyle;

    const settings = {
      recentFiles: Array.isArray(parsed.recentFiles) ? parsed.recentFiles.filter((item) => typeof item === 'string').slice(0, RECENT_LIMIT) : [],
      themeMode: isThemeMode(parsed.themeMode) ? parsed.themeMode : DEFAULT_SETTINGS.themeMode,
      fontScale: normalizeFontScale(parsed.fontScale),
      visualStyle,
      outlineOpen: typeof parsed.outlineOpen === 'boolean' ? parsed.outlineOpen : DEFAULT_SETTINGS.outlineOpen,
      sidebarWidth: normalizeSidebarWidth(parsed.sidebarWidth),
      sidebarView: isSidebarView(parsed.sidebarView) ? parsed.sidebarView : DEFAULT_SETTINGS.sidebarView,
      explorerRootPath: typeof parsed.explorerRootPath === 'string' ? parsed.explorerRootPath : DEFAULT_SETTINGS.explorerRootPath,
      inspectorOpen: typeof parsed.inspectorOpen === 'boolean' ? parsed.inspectorOpen : DEFAULT_SETTINGS.inspectorOpen,
      authorshipVisible: typeof parsed.authorshipVisible === 'boolean' ? parsed.authorshipVisible : DEFAULT_SETTINGS.authorshipVisible,
      focusMode: typeof parsed.focusMode === 'boolean' ? parsed.focusMode : DEFAULT_SETTINGS.focusMode,
      documentType: isDocumentType(parsed.documentType) ? parsed.documentType : DEFAULT_SETTINGS.documentType,
      onboardingComplete: typeof parsed.onboardingComplete === 'boolean' ? parsed.onboardingComplete : DEFAULT_SETTINGS.onboardingComplete,
      inkscapePath: typeof parsed.inkscapePath === 'string' && parsed.inkscapePath.trim() ? parsed.inkscapePath : DEFAULT_SETTINGS.inkscapePath,
      exportOptions: normalizeExportOptions(parsed.exportOptions),
    };
    if (shouldMigrateLegacyDefault) saveSettings(settings);
    return settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: PersistedSettings): void {
  try {
    localStorage.setItem(SCIENCE_DEFAULT_MIGRATION_KEY, 'true');
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      recentFiles: settings.recentFiles.slice(0, RECENT_LIMIT),
      themeMode: settings.themeMode,
      fontScale: settings.fontScale,
      visualStyle: settings.visualStyle,
      outlineOpen: settings.outlineOpen,
      sidebarWidth: normalizeSidebarWidth(settings.sidebarWidth),
      sidebarView: settings.sidebarView,
      explorerRootPath: settings.explorerRootPath,
      inspectorOpen: settings.inspectorOpen,
      authorshipVisible: settings.authorshipVisible,
      focusMode: settings.focusMode,
      documentType: settings.documentType,
      onboardingComplete: settings.onboardingComplete,
      inkscapePath: settings.inkscapePath,
      exportOptions: normalizeExportOptions(settings.exportOptions),
    }));
  } catch {
    // Settings are convenient state, not document data. Storage failures must not
    // interrupt editing or saving.
  }
}

export function updateSettings(patch: Partial<PersistedSettings>): PersistedSettings {
  const next = { ...loadSettings(), ...patch };
  saveSettings(next);
  return next;
}

export function rememberRecentFile(filePath: string): PersistedSettings {
  const settings = loadSettings();
  const recentFiles = [filePath, ...settings.recentFiles.filter((item) => item !== filePath)].slice(0, RECENT_LIMIT);
  const next = { ...settings, recentFiles };
  saveSettings(next);
  return next;
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark' || value === 'sepia';
}

function isDocumentType(value: unknown): value is DocumentType {
  return value === 'lab-note' || value === 'report' || value === 'memo' || value === 'notes' || value === 'other';
}

function isSidebarView(value: unknown): value is SidebarView {
  return value === 'files' || value === 'outline' || value === 'references' || value === 'data';
}

function normalizeFontScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SETTINGS.fontScale;
  return Math.min(1.35, Math.max(0.85, value));
}

export function normalizeSidebarWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.round(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, value)));
}

function shouldMigrateLegacyScienfyDefault(rawVisualStyle: unknown, visualStyle: VisualStyleId | null): boolean {
  return rawVisualStyle === 'scienfy'
    && visualStyle === 'scienfy'
    && localStorage.getItem(SCIENCE_DEFAULT_MIGRATION_KEY) !== 'true';
}

export function forgetRecentFile(filePath: string): PersistedSettings {
  const settings = loadSettings();
  const next = {
    ...settings,
    recentFiles: settings.recentFiles.filter((item) => item !== filePath),
  };
  saveSettings(next);
  return next;
}
