export type DocumentFormat =
  | 'markdown'
  | 'json'
  | 'jsonl'
  | 'yaml'
  | 'toml'
  | 'xml'
  | 'csv'
  | 'tsv'
  | 'plainText';

export type FormatDiagnosticSeverity = 'info' | 'warning' | 'error';
export type FormatDiagnosticCategory =
  | 'parser'
  | 'schema'
  | 'health'
  | 'preservation'
  | 'conversion'
  | 'edit'
  | 'worker';

export type StructuredPathSegment = string | number;
export type StructuredValueType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
export type StructuredVisualSurfaceKind = 'markdown' | 'tree' | 'records' | 'table';
export type StructuredFormatEditPolicy =
  | 'none'
  | 'source-only'
  | 'format-preserving'
  | 'lossy-readonly';
export type StructuredFormatPreservationPolicy =
  | 'exact-source'
  | 'lossless-parse'
  | 'lossy-projection'
  | 'tabular-normalized';
export type SourceEditorCodeMirrorLanguage = 'markdown' | 'json' | 'yaml' | 'xml' | 'plainText';
export type SourceEditorFormatterAvailability = 'none' | 'explicit-preview';
export type SourceEditorLintProfile = 'none' | 'markdown' | 'json' | 'jsonl' | 'structured' | 'tabular';
export type SourceEditorDiagnosticsRangeSupport = 'none' | 'line' | 'line-column' | 'offset';
export type SourceEditorCommentSyntax = 'none' | 'markdown' | 'yaml' | 'toml' | 'xml';
export type SourceEditorContextOperation =
  | 'copyText'
  | 'copyLine'
  | 'copyDiagnostics'
  | 'selectLine'
  | 'switchToVisual'
  | 'validateSelection'
  | 'validateClipboard'
  | 'convertSelection';

export interface SourceEditorCapabilities {
  languageId: DocumentFormat;
  codeMirrorLanguage: SourceEditorCodeMirrorLanguage;
  codeMirrorLanguageAvailable: boolean;
  formatter: SourceEditorFormatterAvailability;
  lintProfile: SourceEditorLintProfile;
  diagnosticsRangeSupport: SourceEditorDiagnosticsRangeSupport;
  commentSyntax: SourceEditorCommentSyntax;
  sourceOnlyThresholdBytes?: number;
  contextMenuOperations: readonly SourceEditorContextOperation[];
  plainTextReason?: string;
}

export interface StructuredVisualSurface {
  kind: StructuredVisualSurfaceKind;
  label: string;
  readonly: boolean;
  editable: boolean;
  preservesSource: boolean;
  requiresValidParse: boolean;
  lossy: boolean;
}

export interface SourceSpan {
  offset: number;
  length: number;
  line: number;
  column: number;
}

export interface DocumentContent<TMetadata = unknown> {
  format: DocumentFormat;
  text: string;
  path: string | null;
  metadata?: TMetadata;
}

export interface FormatDiagnostic {
  severity: FormatDiagnosticSeverity;
  code: string;
  message: string;
  line?: number;
  column?: number;
  offset?: number;
  length?: number;
  source?: DocumentFormat;
  category?: FormatDiagnosticCategory;
  path?: StructuredPathSegment[];
  pointer?: string;
  displayPath?: string;
  span?: SourceSpan;
  relatedSpans?: SourceSpan[];
  blocking?: boolean;
}

export interface StructuredNodeRef {
  format: DocumentFormat;
  path: StructuredPathSegment[];
  pointer: string;
  displayPath: string;
  type: StructuredValueType;
  span: SourceSpan | null;
  valueSpan?: SourceSpan | null;
  keySpan?: SourceSpan | null;
  lossy: boolean;
  editable: boolean;
  unsupportedReason?: string;
  childCount?: number;
}

export interface StructuredSourceMap {
  format: DocumentFormat;
  root: StructuredNodeRef | null;
  nodes: StructuredNodeRef[];
  nodesByPointer: Record<string, StructuredNodeRef>;
  nodesByDisplayPath: Record<string, StructuredNodeRef>;
}

export interface FormatParseResult<TParsed = unknown> {
  format: DocumentFormat;
  content: DocumentContent;
  parsed: TParsed | null;
  diagnostics: FormatDiagnostic[];
  sourceOnly: boolean;
}

export interface FormatCapabilities {
  sourceEditing: boolean;
  sourceEditor: SourceEditorCapabilities;
  visualEditing: boolean;
  readonlyTree: boolean;
  visualSurfaces: readonly StructuredVisualSurface[];
  diagnostics: boolean;
  schemaValidation: boolean;
  formatPreservingEdits: boolean;
  parseBudgetBytes?: number;
  editPolicy: StructuredFormatEditPolicy;
  preservationPolicy: StructuredFormatPreservationPolicy;
  imageReferences: boolean;
  frontmatter: boolean;
  conflictMarkersAllowed: boolean;
  defaultMode: 'visual' | 'source';
  sourceOnlyFileBytes?: number;
}

export interface FormatAdapter<TParsed = unknown, TParseOptions = unknown> {
  format: DocumentFormat;
  label: string;
  extensions: readonly string[];
  mediaTypes: readonly string[];
  capabilities: FormatCapabilities;
  createContent(text: string, path?: string | null, metadata?: unknown): DocumentContent;
  parse(content: DocumentContent, options?: TParseOptions): FormatParseResult<TParsed>;
}

export function createDocumentContent<TMetadata = unknown>(
  format: DocumentFormat,
  text: string,
  path: string | null = null,
  metadata?: TMetadata,
): DocumentContent<TMetadata> {
  return metadata === undefined
    ? { format, text, path }
    : { format, text, path, metadata };
}
