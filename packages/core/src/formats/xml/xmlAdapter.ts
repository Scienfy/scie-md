import type { FormatAdapter } from '../documentFormat.js';
import {
  createXmlContent,
  parseXmlDocument,
  type ParsedXmlDocument,
  XML_PARSE_BUDGET_BYTES,
} from './parseXmlDocument.js';

export const XML_FORMAT_EXTENSIONS = ['xml'] as const;

export const xmlAdapter: FormatAdapter<ParsedXmlDocument> = {
  format: 'xml',
  label: 'XML',
  extensions: XML_FORMAT_EXTENSIONS,
  mediaTypes: ['application/xml', 'text/xml', 'application/rss+xml', 'application/atom+xml'],
  capabilities: {
    sourceEditing: true,
    sourceEditor: {
      languageId: 'xml',
      codeMirrorLanguage: 'xml',
      codeMirrorLanguageAvailable: true,
      formatter: 'none',
      lintProfile: 'structured',
      diagnosticsRangeSupport: 'offset',
      commentSyntax: 'xml',
      sourceOnlyThresholdBytes: XML_PARSE_BUDGET_BYTES,
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
    visualEditing: false,
    readonlyTree: true,
    visualSurfaces: [{
      kind: 'tree',
      label: 'XML tree',
      readonly: true,
      editable: false,
      preservesSource: true,
      requiresValidParse: true,
      lossy: false,
    }],
    diagnostics: true,
    schemaValidation: false,
    formatPreservingEdits: false,
    parseBudgetBytes: XML_PARSE_BUDGET_BYTES,
    editPolicy: 'lossy-readonly',
    preservationPolicy: 'lossless-parse',
    imageReferences: false,
    frontmatter: false,
    conflictMarkersAllowed: false,
    defaultMode: 'source',
  },
  createContent: createXmlContent,
  parse: parseXmlDocument,
};
