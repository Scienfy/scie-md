import { describe, expect, it } from 'vitest';
import { inferStructuredDocument } from './structuredIngest';

describe('structured ingest inference', () => {
  it('uses path and URL extensions as high-confidence signals', () => {
    expect(inferStructuredDocument({ text: '', path: 'C:\\lab\\results.JSON' })).toMatchObject({
      format: 'json',
      confidence: 'high',
    });

    const fromUrl = inferStructuredDocument({
      text: '',
      url: 'https://example.test/export/records.ndjson?download=1',
      origin: 'url',
    });

    expect(fromUrl.format).toBe('jsonl');
    expect(fromUrl.signals.some((signal) => signal.source === 'url')).toBe(true);
    expect(fromUrl.capabilityPolicy.safeForAutomaticFileCreation).toBe(false);
  });

  it('uses specific MIME types and keeps generic text MIME open to content sniffing', () => {
    expect(inferStructuredDocument({ text: '{"id":1}', mimeType: 'application/ld+json; charset=utf-8' })).toMatchObject({
      format: 'json',
      confidence: 'high',
    });

    const csv = inferStructuredDocument({
      text: 'sample,count\nA,1\nB,2\n',
      mimeType: 'text/plain',
      origin: 'clipboard',
    });

    expect(csv.format).toBe('csv');
    expect(csv.capabilityPolicy.requiresUserConfirmation).toBe(true);
    expect(csv.conversionOptions.map((option) => option.outputFormat)).toEqual(['markdown', 'json', 'jsonl', 'yaml', 'toml']);
  });

  it('detects JSON snippets and reports invalid JSON when JSON is the selected format', () => {
    const valid = inferStructuredDocument({ text: '{"trial":{"id":2}}' });
    expect(valid.format).toBe('json');
    expect(valid.diagnostics).toEqual([]);
    expect(valid.capabilityPolicy.canEditVisually).toBe(true);

    const invalid = inferStructuredDocument({ text: '{"trial":', path: '/tmp/data.json' });
    expect(invalid.format).toBe('json');
    expect(invalid.diagnostics.some((diagnostic) => diagnostic.code === 'ingest-json-parse-error')).toBe(true);
  });

  it('detects XML from path, MIME type, content, and +xml structured media types', () => {
    expect(inferStructuredDocument({ text: '', path: 'C:\\lab\\metadata.xml' })).toMatchObject({
      format: 'xml',
      confidence: 'high',
    });
    expect(inferStructuredDocument({ text: '', mimeType: 'application/vnd.science+xml' })).toMatchObject({
      format: 'xml',
      confidence: 'high',
    });
    const content = inferStructuredDocument({ text: '<?xml version="1.0"?><root><sample id="S-001"/></root>' });
    expect(content).toMatchObject({
      format: 'xml',
      confidence: 'high',
      capabilityPolicy: expect.objectContaining({
        canPreview: true,
        canUseVisualTree: true,
        canEditVisually: false,
      }),
    });
  });

  it('flags XML DOCTYPE input as unsafe during ingest', () => {
    const result = inferStructuredDocument({
      text: '<!DOCTYPE root [<!ENTITY x SYSTEM "file:///etc/passwd">]><root>&x;</root>',
      path: 'unsafe.xml',
    });

    expect(result.format).toBe('xml');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'ingest-xml-doctype-disabled',
      severity: 'error',
      blocking: true,
    }));
  });

  it('detects JSON Lines snippets and records line-level diagnostics', () => {
    const valid = inferStructuredDocument({ text: '{"id":1}\n{"id":2}\n' });
    expect(valid.format).toBe('jsonl');
    expect(valid.diagnostics).toEqual([]);
    expect(valid.capabilityPolicy.canEditVisually).toBe(true);

    const invalid = inferStructuredDocument({ text: '{"id":1}\n{"id":\n', path: 'records.jsonl' });
    expect(invalid.format).toBe('jsonl');
    expect(invalid.diagnostics).toEqual([
      expect.objectContaining({
        code: 'ingest-jsonl-parse-error',
        line: 2,
      }),
    ]);
  });

  it('detects YAML and TOML snippets conservatively', () => {
    expect(inferStructuredDocument({
      text: 'sample:\n  name: Alpha\n  count: 2\n',
    })).toMatchObject({
      format: 'yaml',
      confidence: 'medium',
    });

    expect(inferStructuredDocument({
      text: '[sample]\nname = "Alpha"\ncount = 2\n',
    })).toMatchObject({
      format: 'toml',
      confidence: 'medium',
    });
  });

  it('detects TSV snippets and exposes delimited conversion choices', () => {
    const result = inferStructuredDocument({
      text: 'sample\tcount\nA\t1\nB\t2\n',
      origin: 'clipboard',
    });

    expect(result.format).toBe('tsv');
    expect(result.tabularPreview?.parsed.delimiter).toBe('\t');
    expect(result.capabilityPolicy.canPreview).toBe(true);
    expect(result.capabilityPolicy.canEditVisually).toBe(true);
    expect(result.capabilityPolicy.sourceOnly).toBe(false);
    expect(result.capabilityPolicy.canConvertFromDelimited).toBe(true);
    expect(result.conversionOptions.find((option) => option.id === 'json-lines')?.content).toContain('{"sample":"A","count":"1"}');
  });

  it('keeps Markdown and ambiguous plain text out of structured conversion paths', () => {
    const markdown = inferStructuredDocument({ text: '---\ntitle: Trial\n---\n# Methods\n' });
    expect(markdown.format).toBe('markdown');
    expect(markdown.capabilityPolicy.canOpenAsDocument).toBe(true);

    const plain = inferStructuredDocument({ text: 'This is prose.\nIt has two ordinary lines.' });
    expect(plain.format).toBe('plainText');
    expect(plain.confidence).toBe('none');
    expect(plain.conversionOptions).toEqual([]);
  });

  it('reports conflicting high-confidence signals without overriding local path format', () => {
    const result = inferStructuredDocument({
      text: '{"id":1}',
      path: 'notes.txt',
      mimeType: 'application/json',
    });

    expect(result.format).toBe('json');
    expect(result.diagnostics).toEqual([]);
    expect(result.signals.map((signal) => signal.source)).toContain('path');
    expect(result.signals.map((signal) => signal.source)).toContain('mime');
  });
});
