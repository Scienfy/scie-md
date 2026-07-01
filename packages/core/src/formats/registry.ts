import type { DocumentFormat, FormatAdapter, SourceEditorCapabilities } from './documentFormat';
import { jsonAdapter } from './json/jsonAdapter';
import { jsonlAdapter } from './jsonl/jsonlAdapter';
import { markdownAdapter } from './markdown/markdownAdapter';
import { csvAdapter, tsvAdapter } from './tabular/tabularAdapter';
import { tomlAdapter } from './toml/tomlAdapter';
import { xmlAdapter } from './xml/xmlAdapter';
import { yamlAdapter } from './yaml/yamlAdapter';

export type { DocumentFormatDefinition } from './formatDefinitions';
export {
  documentFormatDefinitions,
  extensionFromPath,
  formatDefinitionFor,
  formatFromMediaType,
  formatFromPath,
  isMarkdownFormat,
  isStructuredFormat,
  knownDocumentExtensions,
} from './formatDefinitions';

const registeredAdapters = new Map<DocumentFormat, FormatAdapter>();
registerFormatAdapter(markdownAdapter);
registerFormatAdapter(jsonAdapter);
registerFormatAdapter(jsonlAdapter);
registerFormatAdapter(yamlAdapter);
registerFormatAdapter(tomlAdapter);
registerFormatAdapter(xmlAdapter);
registerFormatAdapter(csvAdapter);
registerFormatAdapter(tsvAdapter);

export function registerFormatAdapter(adapter: FormatAdapter): void {
  const existing = registeredAdapters.get(adapter.format);
  if (existing && existing !== adapter) {
    throw new Error(`A format adapter is already registered for ${adapter.format}.`);
  }
  registeredAdapters.set(adapter.format, adapter);
}

export function adapterForFormat(format: DocumentFormat | null | undefined): FormatAdapter | null {
  if (!format) return null;
  return registeredAdapters.get(format) ?? null;
}

export function sourceEditorCapabilitiesFor(format: DocumentFormat | null | undefined): SourceEditorCapabilities {
  const normalizedFormat = format ?? 'plainText';
  return adapterForFormat(normalizedFormat)?.capabilities.sourceEditor ?? {
    languageId: normalizedFormat,
    codeMirrorLanguage: 'plainText',
    codeMirrorLanguageAvailable: false,
    formatter: 'none',
    lintProfile: 'none',
    diagnosticsRangeSupport: 'none',
    commentSyntax: 'none',
    contextMenuOperations: ['copyText', 'copyLine', 'selectLine'],
    plainTextReason: 'Plain text has no parser-backed source metadata.',
  };
}

export function registeredFormatAdapters(): FormatAdapter[] {
  return Array.from(registeredAdapters.values());
}
