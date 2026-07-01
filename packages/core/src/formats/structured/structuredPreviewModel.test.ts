import { describe, expect, it } from 'vitest';
import { formatParseBudgetBytes } from '../formatPolicy.js';
import { createStructuredPreviewModel, isStructuredPreviewFormat } from './structuredPreviewModel.js';

describe('structured preview model', () => {
  it('creates JSON preview models from the shared parser boundary', () => {
    const model = createStructuredPreviewModel({
      format: 'json',
      text: '{"cohort":{"n":12},"active":true}\n',
      path: 'cohort.json',
    });

    expect(model.label).toBe('JSON');
    expect(model.value).toEqual({ cohort: { n: 12 }, active: true });
    expect(model.metrics).toContainEqual({ label: 'objects', value: '2' });
    expect(model.editPolicy.canApplyClipboardReplace).toBe(true);
    expect(model.operations).toContainEqual(expect.objectContaining({
      id: 'applyClipboardReplace',
      enabled: true,
      requiresOptIn: true,
      readonlyPreview: true,
    }));
    expect(model.sourceReveal).toMatchObject({
      available: true,
      strategy: 'source-map',
    });
    expect(model.sourceReveal.sampleTargets[0]).toEqual(expect.objectContaining({
      displayPath: '$',
      line: 1,
      column: 1,
    }));
  });

  it('creates JSONL preview models as valid record arrays and keeps invalid-line diagnostics', () => {
    const model = createStructuredPreviewModel({
      format: 'jsonl',
      text: '{"id":1,"name":"A"}\n\n{"id":2}\n',
    });

    expect(model.label).toBe('JSON Lines');
    expect(model.value).toEqual([{ id: 1, name: 'A' }, { id: 2 }]);
    expect(model.metrics).toContainEqual({ label: 'records', value: '2' });
    expect(model.diagnostics).toContainEqual(expect.objectContaining({ code: 'jsonl-blank-line' }));
    expect(model.editPolicy.canApplyClipboardReplace).toBe(true);
    expect(model.sourceReveal).toMatchObject({
      available: true,
      strategy: 'line-records',
      mappedNodeCount: 2,
      totalNodeCount: 2,
    });
  });

  it('keeps YAML and TOML preview-only while exposing normalized values', () => {
    const yaml = createStructuredPreviewModel({ format: 'yaml', text: 'sample:\n  name: Alpha\n' });
    const toml = createStructuredPreviewModel({ format: 'toml', text: '[sample]\nname = "Alpha"\n' });

    expect(yaml.value).toEqual({ sample: { name: 'Alpha' } });
    expect(toml.value).toEqual({ sample: { name: 'Alpha' } });
    expect(yaml.editPolicy.canApplyClipboardReplace).toBe(false);
    expect(toml.editPolicy.canApplyClipboardReplace).toBe(false);
    expect(yaml.operations).toContainEqual(expect.objectContaining({
      id: 'applyClipboardReplace',
      enabled: false,
    }));
    expect(yaml.sourceReveal.available).toBe(true);
    expect(toml.sourceReveal).toMatchObject({
      available: false,
      strategy: 'none',
    });
  });

  it('creates XML read-only preview models with source reveal metadata', () => {
    const model = createStructuredPreviewModel({
      format: 'xml',
      text: '<study xmlns="urn:study"><sample id="S-001">ready</sample></study>\n',
      path: 'study.xml',
    });

    expect(model.label).toBe('XML');
    expect(model.metrics).toContainEqual({ label: 'elements', value: '2' });
    expect(model.editPolicy.canApplyClipboardReplace).toBe(false);
    expect(model.operations).toContainEqual(expect.objectContaining({
      id: 'applyClipboardReplace',
      enabled: false,
    }));
    expect(model.sourceReveal).toMatchObject({
      available: true,
      strategy: 'source-map',
    });
  });

  it('keeps oversized preview documents source-only before parsing', () => {
    const budget = formatParseBudgetBytes('json') ?? 1024 * 1024;
    const model = createStructuredPreviewModel({
      format: 'json',
      text: `{"payload":"${'x'.repeat(budget + 1)}"}`,
      path: 'large.json',
    });

    expect(model.metrics).toContainEqual({ label: 'root', value: 'source-only' });
    expect(model.diagnostics).toContainEqual(expect.objectContaining({
      code: 'json-source-only-large-file',
      severity: 'warning',
    }));
    expect(model.editPolicy.canApplyClipboardReplace).toBe(false);
    expect(model.operations).toContainEqual(expect.objectContaining({
      id: 'applyClipboardReplace',
      enabled: false,
    }));
    expect(model.sourceReveal).toMatchObject({
      available: false,
      strategy: 'none',
    });
  });

  it('identifies only structured preview formats', () => {
    expect(isStructuredPreviewFormat('json')).toBe(true);
    expect(isStructuredPreviewFormat('jsonl')).toBe(true);
    expect(isStructuredPreviewFormat('yaml')).toBe(true);
    expect(isStructuredPreviewFormat('toml')).toBe(true);
    expect(isStructuredPreviewFormat('xml')).toBe(true);
    expect(isStructuredPreviewFormat('csv')).toBe(false);
    expect(isStructuredPreviewFormat('markdown')).toBe(false);
  });
});
