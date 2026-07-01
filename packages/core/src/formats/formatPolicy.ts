import type {
  DocumentFormat,
  FormatCapabilities,
  FormatDiagnostic,
  FormatParseResult,
  StructuredVisualSurface,
} from './documentFormat.js';
import { createDocumentContent } from './documentFormat.js';
import { formatDefinitionFor } from './formatDefinitions.js';

export const DEFAULT_STRUCTURED_PARSE_BUDGET_BYTES = 1 * 1024 * 1024;
export const STRUCTURED_TEXT_INGRESS_BUDGET_BYTES = 5 * 1024 * 1024;
export const STRUCTURED_CLIPBOARD_INGRESS_BUDGET_BYTES = 5 * 1024 * 1024;

const MARKDOWN_SOURCE_ONLY_FILE_BYTES = 5 * 1024 * 1024;

export interface CanonicalizedIngressText {
  text: string;
  strippedBom: boolean;
}

export interface FormatRuntimePolicy {
  format: DocumentFormat;
  defaultMode: 'visual' | 'source';
  parseBudgetBytes: number | null;
  sourceOnlyFileBytes: number | null;
  browserTextIngressBudgetBytes: number;
  clipboardIngressBudgetBytes: number;
  canOpenAsDocument: boolean;
  canPreview: boolean;
  canImport: boolean;
  canUseVisualTree: boolean;
  canUseRecordList: boolean;
  canUseTablePreview: boolean;
  canEditVisually: boolean;
  canApplyClipboardReplace: boolean;
  sourceOnlyByDefault: boolean;
}

interface FormatRuntimePolicyDeclaration {
  defaultMode: 'visual' | 'source';
  parseBudgetBytes?: number;
  sourceOnlyFileBytes?: number;
  canOpenAsDocument: boolean;
  canPreview: boolean;
  canUseVisualTree?: boolean;
  canUseRecordList?: boolean;
  canUseTablePreview?: boolean;
  canEditVisually?: boolean;
  canApplyClipboardReplace?: boolean;
  sourceOnlyByDefault?: boolean;
}

const FORMAT_POLICY_DECLARATIONS: Record<DocumentFormat, FormatRuntimePolicyDeclaration> = {
  markdown: {
    defaultMode: 'visual',
    parseBudgetBytes: MARKDOWN_SOURCE_ONLY_FILE_BYTES,
    sourceOnlyFileBytes: MARKDOWN_SOURCE_ONLY_FILE_BYTES,
    canOpenAsDocument: true,
    canPreview: true,
    canEditVisually: true,
  },
  json: editableStructuredPolicy({ canUseVisualTree: true, canApplyClipboardReplace: true }),
  jsonl: editableStructuredPolicy({ canUseRecordList: true, canApplyClipboardReplace: true }),
  yaml: readonlyStructuredPolicy({ canUseVisualTree: true }),
  toml: readonlyStructuredPolicy({ canUseVisualTree: true }),
  xml: readonlyStructuredPolicy({ canUseVisualTree: true }),
  csv: editableStructuredPolicy({ canUseTablePreview: true }),
  tsv: editableStructuredPolicy({ canUseTablePreview: true }),
  plainText: {
    defaultMode: 'source',
    canOpenAsDocument: false,
    canPreview: false,
    sourceOnlyByDefault: true,
  },
};

export function formatRuntimePolicyFor(format: DocumentFormat | null | undefined): FormatRuntimePolicy {
  const normalizedFormat = format ?? 'plainText';
  const declaration = FORMAT_POLICY_DECLARATIONS[normalizedFormat] ?? FORMAT_POLICY_DECLARATIONS.plainText;
  const parseBudgetBytes = declaration.parseBudgetBytes ?? null;
  const sourceOnlyFileBytes = declaration.sourceOnlyFileBytes ?? parseBudgetBytes;
  return {
    format: normalizedFormat,
    defaultMode: declaration.defaultMode,
    parseBudgetBytes,
    sourceOnlyFileBytes,
    browserTextIngressBudgetBytes: Math.max(sourceOnlyFileBytes ?? 0, STRUCTURED_TEXT_INGRESS_BUDGET_BYTES),
    clipboardIngressBudgetBytes: STRUCTURED_CLIPBOARD_INGRESS_BUDGET_BYTES,
    canOpenAsDocument: declaration.canOpenAsDocument,
    canPreview: declaration.canPreview,
    canImport: declaration.canOpenAsDocument,
    canUseVisualTree: Boolean(declaration.canUseVisualTree),
    canUseRecordList: Boolean(declaration.canUseRecordList),
    canUseTablePreview: Boolean(declaration.canUseTablePreview),
    canEditVisually: Boolean(declaration.canEditVisually),
    canApplyClipboardReplace: Boolean(declaration.canApplyClipboardReplace),
    sourceOnlyByDefault: Boolean(declaration.sourceOnlyByDefault),
  };
}

export function formatParseBudgetBytes(format: DocumentFormat | null | undefined): number | null {
  return formatRuntimePolicyFor(format).parseBudgetBytes;
}

export function formatSourceOnlyFileBytes(format: DocumentFormat | null | undefined): number | null {
  return formatRuntimePolicyFor(format).sourceOnlyFileBytes;
}

export function formatBrowserTextIngressBudgetBytes(format: DocumentFormat | null | undefined): number {
  return formatRuntimePolicyFor(format).browserTextIngressBudgetBytes;
}

export function formatClipboardIngressBudgetBytes(format: DocumentFormat | null | undefined): number {
  return formatRuntimePolicyFor(format).clipboardIngressBudgetBytes;
}

export function formatExceedsParseBudget(format: DocumentFormat | null | undefined, text: string): boolean {
  const budget = formatParseBudgetBytes(format);
  return budget !== null && formatByteLengthUtf8(text) > budget;
}

export function formatByteLengthUtf8(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${Math.round(bytes / 1024 / 1024)} MiB`;
}

export function canonicalizeStructuredIngressText(text: string): CanonicalizedIngressText {
  return text.charCodeAt(0) === 0xfeff
    ? { text: text.slice(1), strippedBom: true }
    : { text, strippedBom: false };
}

export function createSourceOnlyFormatParseResult<TParsed = unknown>(
  format: DocumentFormat,
  text: string,
  path: string | null,
  message = defaultSourceOnlyMessage(format),
  code = `${format}-source-only-large-file`,
): FormatParseResult<TParsed> {
  const diagnostic: FormatDiagnostic = {
    severity: 'warning',
    code,
    message,
    source: format,
  };
  return {
    format,
    content: createDocumentContent(format, text, path),
    parsed: null,
    diagnostics: [diagnostic],
    sourceOnly: true,
  };
}

export function editableStructuredSurfaces(capabilities: FormatCapabilities | null | undefined): StructuredVisualSurface[] {
  return (capabilities?.visualSurfaces ?? []).filter((surface) => surface.editable && !surface.readonly);
}

function defaultSourceOnlyMessage(format: DocumentFormat): string {
  const budget = formatParseBudgetBytes(format);
  const label = formatDefinitionFor(format)?.label ?? format.toUpperCase();
  return budget === null
    ? `${label} parsing is disabled for this document. Source editing remains available.`
    : `${label} exceeds the ${formatBytes(budget)} background parse budget. Source editing remains available; visual inspection is disabled for this file.`;
}

function editableStructuredPolicy(
  overrides: Pick<FormatRuntimePolicyDeclaration, 'canUseVisualTree' | 'canUseRecordList' | 'canUseTablePreview' | 'canApplyClipboardReplace'>,
): FormatRuntimePolicyDeclaration {
  return {
    defaultMode: 'source',
    parseBudgetBytes: DEFAULT_STRUCTURED_PARSE_BUDGET_BYTES,
    canOpenAsDocument: true,
    canPreview: true,
    canEditVisually: true,
    ...overrides,
  };
}

function readonlyStructuredPolicy(
  overrides: Pick<FormatRuntimePolicyDeclaration, 'canUseVisualTree' | 'canUseRecordList' | 'canUseTablePreview'>,
): FormatRuntimePolicyDeclaration {
  return {
    defaultMode: 'source',
    parseBudgetBytes: DEFAULT_STRUCTURED_PARSE_BUDGET_BYTES,
    canOpenAsDocument: true,
    canPreview: true,
    canEditVisually: false,
    ...overrides,
  };
}
