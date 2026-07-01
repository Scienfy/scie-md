import { describe, expect, it } from 'vitest';
import {
  addJsonObjectField,
  applyJsonEdits,
  createJsonRawNumberToken,
  createJsonEditSourcePreview,
  deleteJsonObjectField,
  insertJsonArrayItem,
  jsonFormattingPolicyForSource,
  jsonSourceHash,
  planJsonVisualEdit,
  removeJsonArrayItem,
  renameJsonObjectKey,
  replaceJsonScalarAtPath,
  replaceJsonValueAtPathWithRawSource,
} from './jsonEdits';
import { validateJsonValueAgainstSchema } from '../schema/jsonSchemaValidation';

describe('jsonEdits', () => {
  it('does not concatenate independent edit results; callers apply one plan at a time', () => {
    const source = '{"a":1,"b":2,"items":[1,2]}';
    const first = replaceJsonScalarAtPath(source, ['a'], 10);
    const afterFirst = applyJsonEdits(source, first.edits);
    const second = replaceJsonScalarAtPath(afterFirst, ['b'], 20);

    expect(applyJsonEdits(afterFirst, second.edits)).toBe('{"a":10,"b":20,"items":[1,2]}');
  });

  it('uses CRLF insertion formatting when the source uses CRLF', () => {
    const source = '{\r\n  "items": [\r\n    1\r\n  ]\r\n}\r\n';
    const plan = insertJsonArrayItem(source, ['items'], 1, 2);

    expect(jsonFormattingPolicyForSource(source).eol).toBe('\r\n');
    expect(applyJsonEdits(source, plan.edits)).toContain('1,\r\n    2');
  });

  it('returns no-op edits for key rename to the same name', () => {
    expect(renameJsonObjectKey('{"a":1}', [], 'a', 'a')).toEqual({ edits: [] });
  });

  it('removes an array item without reserializing the whole array', () => {
    const source = '{\n  "items": [\n    "a",\n    "b",\n    "c"\n  ],\n  "kept": true\n}\n';
    const plan = removeJsonArrayItem(source, ['items'], 1);
    const next = applyJsonEdits(source, plan.edits);

    expect(plan.edits.length).toBeGreaterThan(0);
    expect(next).toBe('{\n  "items": [\n    "a",\n    "c"\n  ],\n  "kept": true\n}\n');
  });

  it('adds object fields through a single modify/apply operation', () => {
    const source = '{\n  "meta": {}\n}\n';
    const next = applyJsonEdits(source, addJsonObjectField(source, ['meta'], 'ok', true).edits);

    expect(next).toBe('{\n  "meta": {\n    "ok": true\n  }\n}\n');
  });

  it('deletes object fields through a localized modify/apply operation', () => {
    const source = '{\n  "meta": {\n    "remove": true,\n    "keep": 1\n  },\n  "tail": null\n}\n';
    const next = applyJsonEdits(source, deleteJsonObjectField(source, ['meta'], 'remove').edits);

    expect(next).toBe('{\n  "meta": {\n    "keep": 1\n  },\n  "tail": null\n}\n');
  });

  it('plans scalar, object, and array edits with post-edit JSON validation', () => {
    let source = '{\n  "name": "A",\n  "meta": {},\n  "items": [1, 2]\n}\n';

    const replace = planJsonVisualEdit(source, {
      kind: 'replaceScalar',
      path: ['name'],
      nextValue: 'B',
      expectedSourceHash: jsonSourceHash(source),
    });
    expect(replace).toMatchObject({ ok: true, previewLabel: 'Updated $.name.' });
    source = replace.nextSource ?? source;

    const addField = planJsonVisualEdit(source, {
      kind: 'addObjectField',
      path: ['meta'],
      key: 'ok',
      value: true,
      expectedSourceHash: jsonSourceHash(source),
    });
    expect(addField.ok).toBe(true);
    source = addField.nextSource ?? source;

    const addItem = planJsonVisualEdit(source, {
      kind: 'addArrayItem',
      path: ['items'],
      index: 2,
      value: 3,
      expectedSourceHash: jsonSourceHash(source),
    });
    expect(addItem.ok).toBe(true);
    source = addItem.nextSource ?? source;

    const deleteItem = planJsonVisualEdit(source, {
      kind: 'deleteArrayItem',
      path: ['items', 0],
      expectedSourceHash: jsonSourceHash(source),
    });
    expect(deleteItem.ok).toBe(true);
    source = deleteItem.nextSource ?? source;

    const rename = planJsonVisualEdit(source, {
      kind: 'renameObjectKey',
      path: ['meta', 'ok'],
      newKey: 'enabled',
      expectedSourceHash: jsonSourceHash(source),
    });
    expect(rename.ok).toBe(true);
    source = rename.nextSource ?? source;

    const deleteField = planJsonVisualEdit(source, {
      kind: 'deleteObjectField',
      path: ['meta', 'enabled'],
      expectedSourceHash: jsonSourceHash(source),
    });
    expect(deleteField.ok).toBe(true);

    expect(JSON.parse(deleteField.nextSource ?? source)).toEqual({
      name: 'B',
      meta: {},
      items: [2, 3],
    });
  });

  it('preserves validated raw JSON number tokens in visual edit plans', () => {
    const large = createJsonRawNumberToken('900719925474099312345');
    const exponent = createJsonRawNumberToken('1.2300e+12');
    expect(large).not.toBeNull();
    expect(exponent).not.toBeNull();

    let source = '{"id":1,"meta":{},"values":[0]}';
    const replace = planJsonVisualEdit(source, {
      kind: 'replaceScalar',
      path: ['id'],
      nextValue: large!,
    });
    expect(replace.ok).toBe(true);
    expect(replace.nextSource).toBe('{"id":900719925474099312345,"meta":{},"values":[0]}');
    source = replace.nextSource ?? source;

    const addField = planJsonVisualEdit(source, {
      kind: 'addObjectField',
      path: ['meta'],
      key: 'threshold',
      value: exponent!,
    });
    expect(addField.ok).toBe(true);
    expect(addField.nextSource).toContain('"threshold": 1.2300e+12');
    source = addField.nextSource ?? source;

    const addItem = planJsonVisualEdit(source, {
      kind: 'addArrayItem',
      path: ['values'],
      index: 1,
      value: createJsonRawNumberToken('-0')!,
    });
    expect(addItem.ok).toBe(true);
    expect(addItem.nextSource).toContain('-0');
  });

  it('patches raw JSON source values without stringifying them through jsonc modify', () => {
    const source = '{\n  "current": 1\n}\n';
    const plan = replaceJsonValueAtPathWithRawSource(source, ['current'], '{\n  "large": 900719925474099312345,\n  "spelled": 1.0\n}');

    expect(plan.unsupportedReason).toBeUndefined();
    expect(applyJsonEdits(source, plan.edits)).toBe('{\n  "current": {\n  "large": 900719925474099312345,\n  "spelled": 1.0\n}\n}\n');
  });

  it('creates bounded source previews for successful edit plans', () => {
    const source = '{\n  "meta": {\n    "old": true\n  },\n  "tail": 1\n}\n';
    const plan = planJsonVisualEdit(source, {
      kind: 'addObjectField',
      path: ['meta'],
      key: 'status',
      value: 'draft',
    });

    const preview = createJsonEditSourcePreview(source, plan, { contextCharacters: 14 });

    expect(preview).toMatchObject({
      previewLabel: 'Added $.meta.status.',
      riskLabel: 'Replace source range',
      editCount: 1,
      range: expect.objectContaining({
        line: 3,
        column: 1,
        removedLength: 15,
        insertedLength: expect.any(Number),
      }),
    });
    expect(preview?.beforeSnippet).toContain('"old": true');
    expect(preview?.afterSnippet).toContain('"status": "draft"');
  });

  it('rejects stale source, duplicate keys, unsafe numbers, and unsupported targets', () => {
    expect(planJsonVisualEdit('{"a":1}', {
      kind: 'replaceScalar',
      path: ['a'],
      nextValue: 2,
      expectedSourceHash: 'stale',
    })).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'json-edit-stale-source', category: 'edit' })],
    });

    expect(planJsonVisualEdit('{"a":1,"a":2}', {
      kind: 'replaceScalar',
      path: ['a'],
      nextValue: 3,
    })).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'json-edit-duplicate-keys' })],
    });

    expect(planJsonVisualEdit('{"a":1}', {
      kind: 'replaceScalar',
      path: ['a'],
      nextValue: Number.POSITIVE_INFINITY,
    })).toMatchObject({
      ok: false,
      unsupportedReason: 'Only finite JSON scalar values can be written.',
    });

    expect(planJsonVisualEdit('{"a":{"nested":true}}', {
      kind: 'replaceScalar',
      path: ['a'],
      nextValue: false,
    })).toMatchObject({
      ok: false,
      unsupportedReason: 'Only scalar JSON values can be replaced at $.a.',
    });
  });

  it('keeps CRLF and tab indentation when planning visual edits', () => {
    const source = '{\r\n\t"items": [\r\n\t\t1\r\n\t]\r\n}\r\n';
    const plan = planJsonVisualEdit(source, {
      kind: 'addArrayItem',
      path: ['items'],
      value: 2,
    });

    expect(plan.ok).toBe(true);
    expect(plan.nextSource).toContain('1,\r\n\t\t2');
  });

  it('rejects schema-known enum, type, and additional-property violations', () => {
    const source = '{"status":"draft","count":1,"meta":{}}';
    const schemaValidation = validateJsonValueAgainstSchema(JSON.parse(source), {
      kind: 'explicit',
      path: 'C:\\lab\\result.schema.json',
      text: JSON.stringify({
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { enum: ['draft', 'final'] },
          count: { type: 'integer' },
          meta: {
            type: 'object',
            additionalProperties: false,
            required: ['enabled'],
            properties: {
              enabled: { type: 'boolean' },
            },
          },
        },
      }),
    });

    expect(planJsonVisualEdit(source, {
      kind: 'replaceScalar',
      path: ['status'],
      nextValue: 'unknown',
    }, { schemaValidation })).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'json-edit-schema-constraint' })],
      unsupportedReason: 'Value "unknown" is not one of the schema enum options for $.status.',
    });

    expect(planJsonVisualEdit(source, {
      kind: 'replaceScalar',
      path: ['count'],
      nextValue: 1.5,
    }, { schemaValidation })).toMatchObject({
      ok: false,
      unsupportedReason: 'Value 1.5 does not match the schema type for $.count.',
    });

    expect(planJsonVisualEdit(source, {
      kind: 'addObjectField',
      path: ['meta'],
      key: 'extra',
      value: true,
    }, { schemaValidation })).toMatchObject({
      ok: false,
      unsupportedReason: 'Schema does not allow additional field $.meta.extra.',
    });

    expect(planJsonVisualEdit(source, {
      kind: 'addObjectField',
      path: ['meta'],
      key: 'enabled',
      value: true,
    }, { schemaValidation })).toMatchObject({
      ok: true,
      previewLabel: 'Added $.meta.enabled.',
    });
  });

  it('adds schema-generated nested values through reviewed local source patches', () => {
    const source = '{"meta":{}}';
    const schemaSource = {
      kind: 'explicit' as const,
      path: 'C:\\lab\\result.schema.json',
      text: JSON.stringify({
        type: 'object',
        additionalProperties: false,
        properties: {
          meta: {
            type: 'object',
            additionalProperties: false,
            properties: {
              settings: {
                type: 'object',
                required: ['enabled', 'threshold'],
                additionalProperties: false,
                properties: {
                  enabled: { type: 'boolean', default: true },
                  threshold: { type: 'number' },
                },
              },
              tags: { type: 'array', default: ['qc'] },
            },
          },
        },
      }),
    };
    const schemaValidation = validateJsonValueAgainstSchema(JSON.parse(source), schemaSource);

    const addSettings = planJsonVisualEdit(source, {
      kind: 'addObjectField',
      path: ['meta'],
      key: 'settings',
      value: { enabled: true, threshold: 0 },
      schemaGeneratedValueExplanation: 'Generated from required schema fields.',
    }, { schemaValidation });

    expect(addSettings).toMatchObject({
      ok: true,
      previewLabel: 'Added $.meta.settings.',
    });
    expect(addSettings.nextSource).toContain('"settings": {');
    expect(validateJsonValueAgainstSchema(JSON.parse(addSettings.nextSource ?? source), schemaSource).status).toBe('valid');

    expect(planJsonVisualEdit(source, {
      kind: 'addObjectField',
      path: ['meta'],
      key: 'settings',
      value: { enabled: false, threshold: 0 },
    }, { schemaValidation })).toMatchObject({
      ok: false,
      unsupportedReason: 'Schema field $.meta.settings must use its generated object default.',
    });

    const addTags = planJsonVisualEdit(source, {
      kind: 'addObjectField',
      path: ['meta'],
      key: 'tags',
      value: ['qc'],
    }, { schemaValidation });
    expect(addTags).toMatchObject({ ok: true, previewLabel: 'Added $.meta.tags.' });
    expect(addTags.nextSource).toContain('"tags": [');
  });
});
