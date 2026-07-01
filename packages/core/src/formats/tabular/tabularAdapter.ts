import type { DocumentContent, FormatAdapter, FormatParseResult } from '../documentFormat.js';
import { createDocumentContent } from '../documentFormat.js';
import {
  parseDelimitedText,
  type DelimitedTextParseOptions,
  type ParsedDelimitedText,
} from './parseDelimitedText.js';

export const CSV_FORMAT_EXTENSIONS = ['csv'] as const;
export const TSV_FORMAT_EXTENSIONS = ['tsv'] as const;
export const TABULAR_DOCUMENT_PREVIEW_ROW_LIMIT = 500;
export const TABULAR_PARSE_BUDGET_BYTES = 1 * 1024 * 1024;

export type TabularDocumentFormat = 'csv' | 'tsv';
export type ParsedTabularDocument = ParsedDelimitedText;

export const csvAdapter: FormatAdapter<ParsedTabularDocument, DelimitedTextParseOptions> = {
  format: 'csv',
  label: 'CSV',
  extensions: CSV_FORMAT_EXTENSIONS,
  mediaTypes: ['text/csv', 'application/csv'],
  capabilities: tabularCapabilities('csv'),
  createContent: createCsvContent,
  parse: (content, options) => parseTabularDocument('csv', content, options),
};

export const tsvAdapter: FormatAdapter<ParsedTabularDocument, DelimitedTextParseOptions> = {
  format: 'tsv',
  label: 'TSV',
  extensions: TSV_FORMAT_EXTENSIONS,
  mediaTypes: ['text/tab-separated-values'],
  capabilities: tabularCapabilities('tsv'),
  createContent: createTsvContent,
  parse: (content, options) => parseTabularDocument('tsv', content, options),
};

export function createCsvContent(text: string, path: string | null = null, metadata?: unknown): DocumentContent {
  return createDocumentContent('csv', text, path, metadata);
}

export function createTsvContent(text: string, path: string | null = null, metadata?: unknown): DocumentContent {
  return createDocumentContent('tsv', text, path, metadata);
}

export function parseCsvDocument(
  content: DocumentContent,
  options: DelimitedTextParseOptions = {},
): FormatParseResult<ParsedTabularDocument> {
  return parseTabularDocument('csv', content, options);
}

export function parseTsvDocument(
  content: DocumentContent,
  options: DelimitedTextParseOptions = {},
): FormatParseResult<ParsedTabularDocument> {
  return parseTabularDocument('tsv', content, options);
}

function parseTabularDocument(
  format: TabularDocumentFormat,
  content: DocumentContent,
  options: DelimitedTextParseOptions = {},
): FormatParseResult<ParsedTabularDocument> {
  const parsed = parseDelimitedText(content.text, {
    maxRows: options.maxRows ?? TABULAR_DOCUMENT_PREVIEW_ROW_LIMIT,
    header: options.header,
    delimiter: format === 'tsv' ? '\t' : options.delimiter,
  });
  return {
    format,
    content: { ...content, format },
    parsed,
    diagnostics: parsed.diagnostics,
    sourceOnly: false,
  };
}

function tabularCapabilities(format: TabularDocumentFormat): FormatAdapter<ParsedTabularDocument>['capabilities'] {
  return {
    sourceEditing: true,
    sourceEditor: {
      languageId: format,
      codeMirrorLanguage: 'plainText',
      codeMirrorLanguageAvailable: false,
      formatter: 'none',
      lintProfile: 'tabular',
      diagnosticsRangeSupport: 'line-column',
      commentSyntax: 'none',
      sourceOnlyThresholdBytes: TABULAR_PARSE_BUDGET_BYTES,
      contextMenuOperations: [
        'copyText',
        'copyLine',
        'copyDiagnostics',
        'selectLine',
        'switchToVisual',
        'validateSelection',
        'validateClipboard',
        'convertSelection',
      ],
      plainTextReason: 'Delimited text uses plain source editing; table preview provides the structured grid surface.',
    },
    visualEditing: true,
    readonlyTree: false,
    visualSurfaces: [{
      kind: 'table',
      label: 'Table preview',
      readonly: false,
      editable: true,
      preservesSource: true,
      requiresValidParse: false,
      lossy: false,
    }],
    diagnostics: true,
    schemaValidation: false,
    formatPreservingEdits: true,
    parseBudgetBytes: TABULAR_PARSE_BUDGET_BYTES,
    editPolicy: 'format-preserving',
    preservationPolicy: 'tabular-normalized',
    imageReferences: false,
    frontmatter: false,
    conflictMarkersAllowed: false,
    defaultMode: 'source',
  };
}
