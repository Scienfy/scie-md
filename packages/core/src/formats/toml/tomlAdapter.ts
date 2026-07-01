import type { FormatAdapter } from '../documentFormat.js';
import { createTomlContent, parseTomlDocument, type ParsedTomlDocument } from './parseTomlDocument.js';

export const TOML_FORMAT_EXTENSIONS = ['toml'] as const;
export const TOML_PARSE_BUDGET_BYTES = 1 * 1024 * 1024;

export const tomlAdapter: FormatAdapter<ParsedTomlDocument> = {
  format: 'toml',
  label: 'TOML',
  extensions: TOML_FORMAT_EXTENSIONS,
  mediaTypes: ['application/toml', 'application/x-toml'],
  capabilities: {
    sourceEditing: true,
    sourceEditor: {
      languageId: 'toml',
      codeMirrorLanguage: 'plainText',
      codeMirrorLanguageAvailable: false,
      formatter: 'none',
      lintProfile: 'structured',
      diagnosticsRangeSupport: 'line-column',
      commentSyntax: 'toml',
      sourceOnlyThresholdBytes: TOML_PARSE_BUDGET_BYTES,
      contextMenuOperations: [
        'copyText',
        'copyLine',
        'copyDiagnostics',
        'selectLine',
        'switchToVisual',
        'validateSelection',
        'validateClipboard',
      ],
      plainTextReason: 'No bundled first-party CodeMirror TOML language package; parser diagnostics still run in source mode.',
    },
    visualEditing: false,
    readonlyTree: true,
    visualSurfaces: [{
      kind: 'tree',
      label: 'TOML tree',
      readonly: true,
      editable: false,
      preservesSource: false,
      requiresValidParse: true,
      lossy: true,
    }],
    diagnostics: true,
    schemaValidation: false,
    formatPreservingEdits: false,
    parseBudgetBytes: TOML_PARSE_BUDGET_BYTES,
    editPolicy: 'lossy-readonly',
    preservationPolicy: 'lossy-projection',
    imageReferences: false,
    frontmatter: false,
    conflictMarkersAllowed: false,
    defaultMode: 'source',
  },
  createContent: createTomlContent,
  parse: parseTomlDocument,
};
