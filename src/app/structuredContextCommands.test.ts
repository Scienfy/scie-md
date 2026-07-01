import { describe, expect, it } from 'vitest';
import { parseSourceFormatDiagnostics } from './formatDiagnostics';
import {
  canCreateStructuredContextPackets,
  createCurrentRedactedStructuredPreview,
  createCurrentParserDiagnosticsContext,
  createCurrentSchemaSummaryContext,
  createCurrentSelectedStructureContext,
  createCurrentStructuredTableSampleContext,
  createCurrentStructuredHealthContext,
  createCurrentWholeStructuredContext,
} from './structuredContextCommands';

describe('structured context command adapters', () => {
  it('builds selected, schema, health, and redacted packets for JSON', () => {
    const diagnostics = parseSourceFormatDiagnostics('json', '{"name":"Alpha","secret":"hidden"}\n', 'sample.json');
    const state = {
      format: 'json' as const,
      sourcePath: 'sample.json',
      selectedPath: '$.name',
      jsonAnalysis: diagnostics.jsonAnalysis,
      jsonlAnalysis: null,
      structuredAnalysis: null,
      tabularAnalysis: null,
    };

    expect(canCreateStructuredContextPackets(state)).toBe(true);
    expect(createCurrentWholeStructuredContext(state)?.content).toContain('Selected path: $');
    expect(createCurrentSelectedStructureContext(state)?.content).toContain('Selected path: $.name');
    expect(createCurrentSchemaSummaryContext(state)?.content).toContain('Observed top level: object');
    expect(createCurrentStructuredHealthContext(state)?.content).toContain('Scope: parser health report');
    expect(createCurrentParserDiagnosticsContext(state).content).toContain('Scope: parser diagnostics');
    expect(createCurrentRedactedStructuredPreview(state)?.content).toContain('"secret": "[REDACTED]"');
  });

  it('uses valid JSONL records as an observed array value', () => {
    const diagnostics = parseSourceFormatDiagnostics('jsonl', '{"id":1,"name":"A"}\n{"id":2}\n', 'records.jsonl');
    const state = {
      format: 'jsonl' as const,
      sourcePath: 'records.jsonl',
      selectedPath: '$',
      jsonAnalysis: null,
      jsonlAnalysis: diagnostics.jsonlAnalysis,
      structuredAnalysis: null,
      tabularAnalysis: null,
    };

    expect(createCurrentSchemaSummaryContext(state)?.content).toContain('Observed top level: array');
    expect(createCurrentStructuredHealthContext(state)?.content).toContain('- name: missing 1');
  });

  it('returns null when the current structured document is invalid', () => {
    const diagnostics = parseSourceFormatDiagnostics('toml', 'name = [\n', 'bad.toml');
    const state = {
      format: 'toml' as const,
      sourcePath: 'bad.toml',
      selectedPath: '$',
      jsonAnalysis: null,
      jsonlAnalysis: null,
      structuredAnalysis: diagnostics.structuredAnalysis,
      tabularAnalysis: null,
    };

    expect(canCreateStructuredContextPackets(state)).toBe(false);
    expect(createCurrentSelectedStructureContext(state)).toBeNull();
    expect(createCurrentParserDiagnosticsContext(state).content).toContain('Status: invalid');
  });

  it('builds table sample packets for CSV and TSV previews', () => {
    const diagnostics = parseSourceFormatDiagnostics('csv', 'id,count\n001,12\n002,13\n', 'table.csv');
    const state = {
      format: 'csv' as const,
      sourcePath: 'table.csv',
      selectedPath: '$',
      jsonAnalysis: null,
      jsonlAnalysis: null,
      structuredAnalysis: null,
      tabularAnalysis: diagnostics.tabularAnalysis,
    };

    expect(canCreateStructuredContextPackets(state)).toBe(true);
    expect(createCurrentSelectedStructureContext(state)?.content).toContain('Format: CSV');
    expect(createCurrentStructuredTableSampleContext(state)?.content).toContain('Scope: table sample');
    expect(createCurrentStructuredTableSampleContext(state)?.content).toContain('id: 001');
  });
});
