import { describe, expect, it } from 'vitest';
import { createJsonContent, parseJsonDocument } from '../json/parseJsonDocument.js';
import { createJsonlContent, parseJsonlDocument } from '../jsonl/parseJsonlDocument.js';
import { createCsvContent, parseCsvDocument } from '../tabular/tabularAdapter.js';
import {
  createRedactedStructuredPreview,
  createStructuredParserDiagnosticsContext,
  createSelectedStructureContext,
  createStructuredHealthContext,
  createStructuredSchemaSummaryContext,
  createStructuredTableSampleContext,
  structuredContextValueForDelimitedText,
  structuredContextValueForJsonl,
  validateStructuredPasteBack,
} from './structuredContext.js';

describe('structured context packets', () => {
  it('creates selected path context with pointer and bounded value preview', () => {
    const result = parseJsonDocument(createJsonContent('{"items":[{"id":1,"name":"Alpha"}]}\n', 'data.json'));
    const parsed = result.parsed;
    expect(parsed).not.toBeNull();

    const packet = createSelectedStructureContext({
      format: 'json',
      value: parsed?.value,
      sourceMap: parsed?.sourceMap,
      selectedPath: '$.items[0]',
      sourcePath: 'data.json',
      diagnostics: result.diagnostics,
    });

    expect(packet.kind).toBe('selected-structure');
    expect(packet.content).toContain('Selected path: $.items[0]');
    expect(packet.content).toContain('JSON pointer: /items/0');
    expect(packet.content).toContain('"name": "Alpha"');
    expect(packet.content).toContain('untrusted user data');
  });

  it('creates schema and observed-shape summaries without requiring a network schema client', () => {
    const schema = JSON.stringify({
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Display name' },
        score: { type: 'number' },
      },
    });
    const result = parseJsonDocument(createJsonContent('{"name":"Alpha","score":2}\n'), {
      schema: { kind: 'explicit', text: schema, path: 'schema.json', label: 'schema.json' },
    });
    const parsed = result.parsed;
    expect(parsed?.schemaValidation?.status).toBe('valid');

    const packet = createStructuredSchemaSummaryContext({
      format: 'json',
      schemaValidation: parsed?.schemaValidation,
      observedShape: parsed?.observedShape,
    });

    expect(packet.content).toContain('Schema status: valid');
    expect(packet.content).toContain('- $.name: string required - Display name');
    expect(packet.content).toContain('Observed top level: object');
  });

  it('summarizes JSONL inconsistent fields for health reports', () => {
    const result = parseJsonlDocument(createJsonlContent('{"id":1,"name":"Alpha"}\n{"id":2}\n'));
    const parsed = result.parsed;
    expect(parsed).not.toBeNull();

    const packet = createStructuredHealthContext({
      format: 'jsonl',
      jsonl: parsed,
      diagnostics: result.diagnostics,
    });

    expect(packet.content).toContain('Records: 2');
    expect(packet.content).toContain('- name: missing 1');
  });

  it('creates local redacted previews and labels the limitation', () => {
    const packet = createRedactedStructuredPreview({
      format: 'json',
      value: {
        user: 'alpha',
        password: 'open sesame',
        nested: { apiToken: 'token-1' },
      },
    });

    expect(packet.content).toContain('Redacted values: 2');
    expect(packet.content).toContain('"password": "[REDACTED]"');
    expect(packet.content).toContain('"apiToken": "[REDACTED]"');
    expect(packet.content).toContain('not a privacy or de-identification guarantee');
  });

  it('validates pasted-back structured text without replacing source', () => {
    const valid = validateStructuredPasteBack({ format: 'json', text: '{"ok":true}\n' });
    const invalid = validateStructuredPasteBack({ format: 'json', text: '{"ok":\n' });
    const csv = validateStructuredPasteBack({ format: 'csv', text: 'id,count\n001,12\n' });

    expect(valid.content).toContain('Status: valid');
    expect(valid.content).toContain('no document content was replaced');
    expect(invalid.content).toContain('Status: invalid');
    expect(invalid.diagnostics[0]?.severity).toBe('error');
    expect(csv.content).toContain('Format: CSV');
    expect(csv.content).toContain('Status: valid');
  });

  it('normalizes valid JSONL records into a redaction-ready array value', () => {
    const result = parseJsonlDocument(createJsonlContent('{"id":1}\n\n{"id":2}\n'));
    const values = structuredContextValueForJsonl(result.parsed!);

    expect(values).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('creates parser diagnostics packets even when visual context is unavailable', () => {
    const packet = createStructuredParserDiagnosticsContext({
      format: 'toml',
      sourcePath: 'bad.toml',
      status: 'invalid',
      diagnostics: [{
        severity: 'error',
        code: 'toml-parse-error',
        message: 'Expected value.',
        source: 'toml',
        line: 2,
        column: 1,
      }],
    });

    expect(packet.kind).toBe('parser-diagnostics');
    expect(packet.content).toContain('Scope: parser diagnostics');
    expect(packet.content).toContain('Status: invalid');
    expect(packet.content).toContain('error: toml-parse-error at line 2, column 1 - Expected value.');
  });

  it('creates CSV table samples with rows, columns, diagnostics, and local safety text', () => {
    const result = parseCsvDocument(createCsvContent('id,count\n001,12\n002,13\n', 'table.csv'));
    const parsed = result.parsed;
    expect(parsed).not.toBeNull();

    const packet = createStructuredTableSampleContext({
      format: 'csv',
      sourcePath: 'table.csv',
      parsed: parsed!,
      diagnostics: result.diagnostics,
    });

    expect(packet.kind).toBe('table-sample');
    expect(packet.content).toContain('Format: CSV');
    expect(packet.content).toContain('Scope: table sample');
    expect(packet.content).toContain('- id: number; empty=0; numeric-risk=2');
    expect(packet.content).toContain('Row 1: id: 001 | count: 12');
    expect(packet.content).toContain('untrusted user data');
    expect(structuredContextValueForDelimitedText(parsed!)).toEqual([
      { id: '001', count: '12' },
      { id: '002', count: '13' },
    ]);
  });
});
