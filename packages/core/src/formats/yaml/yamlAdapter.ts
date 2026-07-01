import type { FormatAdapter } from '../documentFormat.js';
import { createYamlContent, parseYamlDocument, type ParsedYamlDocument } from './parseYamlDocument.js';

export const YAML_FORMAT_EXTENSIONS = ['yaml', 'yml'] as const;
export const YAML_PARSE_BUDGET_BYTES = 1 * 1024 * 1024;

export const yamlAdapter: FormatAdapter<ParsedYamlDocument> = {
  format: 'yaml',
  label: 'YAML',
  extensions: YAML_FORMAT_EXTENSIONS,
  mediaTypes: ['application/yaml', 'application/x-yaml', 'text/yaml', 'text/x-yaml'],
  capabilities: {
    sourceEditing: true,
    sourceEditor: {
      languageId: 'yaml',
      codeMirrorLanguage: 'yaml',
      codeMirrorLanguageAvailable: true,
      formatter: 'none',
      lintProfile: 'structured',
      diagnosticsRangeSupport: 'line-column',
      commentSyntax: 'yaml',
      sourceOnlyThresholdBytes: YAML_PARSE_BUDGET_BYTES,
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
      label: 'YAML tree',
      readonly: true,
      editable: false,
      preservesSource: false,
      requiresValidParse: true,
      lossy: true,
    }],
    diagnostics: true,
    schemaValidation: false,
    formatPreservingEdits: false,
    parseBudgetBytes: YAML_PARSE_BUDGET_BYTES,
    editPolicy: 'lossy-readonly',
    preservationPolicy: 'lossy-projection',
    imageReferences: false,
    frontmatter: false,
    conflictMarkersAllowed: false,
    defaultMode: 'source',
  },
  createContent: createYamlContent,
  parse: parseYamlDocument,
};
