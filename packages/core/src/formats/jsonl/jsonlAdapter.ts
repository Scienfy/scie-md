import type { FormatAdapter } from '../documentFormat.js';
import { createJsonlContent, parseJsonlDocument, type ParsedJsonlDocument } from './parseJsonlDocument.js';

export const JSONL_FORMAT_EXTENSIONS = ['jsonl', 'ndjson'] as const;
export const JSONL_PARSE_BUDGET_BYTES = 1 * 1024 * 1024;

export const jsonlAdapter: FormatAdapter<ParsedJsonlDocument> = {
  format: 'jsonl',
  label: 'JSON Lines',
  extensions: JSONL_FORMAT_EXTENSIONS,
  mediaTypes: ['application/jsonl', 'application/x-ndjson'],
  capabilities: {
    sourceEditing: true,
    sourceEditor: {
      languageId: 'jsonl',
      codeMirrorLanguage: 'json',
      codeMirrorLanguageAvailable: true,
      formatter: 'none',
      lintProfile: 'jsonl',
      diagnosticsRangeSupport: 'line-column',
      commentSyntax: 'none',
      sourceOnlyThresholdBytes: JSONL_PARSE_BUDGET_BYTES,
      contextMenuOperations: [
        'copyText',
        'copyLine',
        'copyDiagnostics',
        'selectLine',
        'switchToVisual',
        'validateSelection',
        'validateClipboard',
      ],
    },
    visualEditing: true,
    readonlyTree: true,
    visualSurfaces: [{
      kind: 'records',
      label: 'JSONL records',
      readonly: false,
      editable: true,
      preservesSource: true,
      requiresValidParse: false,
      lossy: false,
    }],
    diagnostics: true,
    schemaValidation: false,
    formatPreservingEdits: true,
    parseBudgetBytes: JSONL_PARSE_BUDGET_BYTES,
    editPolicy: 'format-preserving',
    preservationPolicy: 'lossless-parse',
    imageReferences: false,
    frontmatter: false,
    conflictMarkersAllowed: false,
    defaultMode: 'source',
  },
  createContent: createJsonlContent,
  parse: parseJsonlDocument,
};
