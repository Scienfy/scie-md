import { describe, expect, it } from 'vitest';
import { jsonAdapter } from './json/jsonAdapter';
import { jsonlAdapter } from './jsonl/jsonlAdapter';
import { markdownAdapter } from './markdown/markdownAdapter';
import { csvAdapter, tsvAdapter } from './tabular/tabularAdapter';
import { tomlAdapter } from './toml/tomlAdapter';
import { xmlAdapter } from './xml/xmlAdapter';
import { yamlAdapter } from './yaml/yamlAdapter';
import {
  adapterForFormat,
  extensionFromPath,
  formatFromMediaType,
  formatFromPath,
  isMarkdownFormat,
  isStructuredFormat,
  knownDocumentExtensions,
  sourceEditorCapabilitiesFor,
} from './registry';

describe('format registry', () => {
  it('detects known document formats from path extensions without requiring active adapters', () => {
    expect(formatFromPath('C:\\lab\\paper.md')).toBe('markdown');
    expect(formatFromPath('/lab/paper.markdown')).toBe('markdown');
    expect(formatFromPath('C:\\lab\\results.JSON')).toBe('json');
    expect(formatFromPath('/lab/records.ndjson')).toBe('jsonl');
    expect(formatFromPath('/lab/config.yml')).toBe('yaml');
    expect(formatFromPath('/lab/settings.toml')).toBe('toml');
    expect(formatFromPath('/lab/metadata.xml')).toBe('xml');
    expect(formatFromPath('/lab/table.tsv')).toBe('tsv');
    expect(formatFromPath('/lab/notes.txt')).toBe('plainText');
  });

  it('uses an explicit unknown-path policy', () => {
    expect(formatFromPath('/lab/archive.bin')).toBeNull();
    expect(formatFromPath('/lab/README')).toBeNull();
    expect(formatFromPath('/lab/.env')).toBeNull();
    expect(formatFromPath(null)).toBeNull();
  });

  it('extracts path extensions across platform separators and URL-like suffixes', () => {
    expect(extensionFromPath('C:\\Lab\\Paper.MD')).toBe('md');
    expect(extensionFromPath('/lab/results.json?cache=1')).toBe('json');
    expect(extensionFromPath('/lab/results.json#section')).toBe('json');
    expect(extensionFromPath('/lab/folder/')).toBeNull();
  });

  it('detects known document formats from media types without loading adapters', () => {
    expect(formatFromMediaType('application/json')).toBe('json');
    expect(formatFromMediaType('application/ld+json; charset=utf-8')).toBe('json');
    expect(formatFromMediaType('application/x-ndjson')).toBe('jsonl');
    expect(formatFromMediaType('text/yaml')).toBe('yaml');
    expect(formatFromMediaType('application/xml')).toBe('xml');
    expect(formatFromMediaType('application/vnd.science+xml')).toBe('xml');
    expect(formatFromMediaType('text/csv; charset=utf-8')).toBe('csv');
    expect(formatFromMediaType('text/plain')).toBe('plainText');
    expect(formatFromMediaType('application/octet-stream')).toBeNull();
  });

  it('registers active adapters while recognizing future structured formats', () => {
    expect(adapterForFormat('markdown')).toBe(markdownAdapter);
    expect(adapterForFormat('json')).toBe(jsonAdapter);
    expect(adapterForFormat('jsonl')).toBe(jsonlAdapter);
    expect(adapterForFormat('yaml')).toBe(yamlAdapter);
    expect(adapterForFormat('toml')).toBe(tomlAdapter);
    expect(adapterForFormat('xml')).toBe(xmlAdapter);
    expect(adapterForFormat('csv')).toBe(csvAdapter);
    expect(adapterForFormat('tsv')).toBe(tsvAdapter);
    expect(isMarkdownFormat('markdown')).toBe(true);
    expect(isMarkdownFormat('json')).toBe(false);
    expect(isStructuredFormat('json')).toBe(true);
    expect(isStructuredFormat('jsonl')).toBe(true);
    expect(isStructuredFormat('yaml')).toBe(true);
    expect(isStructuredFormat('xml')).toBe(true);
    expect(isStructuredFormat('csv')).toBe(true);
    expect(isStructuredFormat('tsv')).toBe(true);
    expect(isStructuredFormat('plainText')).toBe(false);
    expect(isStructuredFormat(null)).toBe(false);
  });

  it('publishes known extensions for future picker and explorer plumbing', () => {
    expect(knownDocumentExtensions).toEqual([
      'csv',
      'json',
      'jsonl',
      'markdown',
      'md',
      'ndjson',
      'text',
      'toml',
      'tsv',
      'txt',
      'xml',
      'yaml',
      'yml',
    ]);
  });

  it('returns adapter-declared source editor capabilities with a plain-text fallback', () => {
    expect(sourceEditorCapabilitiesFor('yaml')).toMatchObject({
      languageId: 'yaml',
      codeMirrorLanguage: 'yaml',
      codeMirrorLanguageAvailable: true,
    });
    expect(sourceEditorCapabilitiesFor('plainText')).toMatchObject({
      languageId: 'plainText',
      codeMirrorLanguage: 'plainText',
      lintProfile: 'none',
      contextMenuOperations: ['copyText', 'copyLine', 'selectLine'],
    });
  });
});
