import { describe, expect, it } from 'vitest';
import {
  extractJsonSchemaMetadata,
  inferObservedJsonShape,
  jsonSchemaObjectControlForPath,
  jsonSchemaScalarControlForPath,
  jsonSchemaScalarValueMatchesControl,
  validateJsonValueAgainstSchema,
} from './jsonSchemaValidation.js';
import { createJsonContent, parseJsonDocument } from '../json/parseJsonDocument.js';

describe('jsonSchemaValidation', () => {
  it('reports required, type, enum, and additional-property diagnostics with JSON paths', () => {
    const result = validateJsonValueAgainstSchema(
      { count: '2', status: 'unknown', extra: true },
      {
        kind: 'explicit',
        path: 'C:\\lab\\result.schema.json',
        text: JSON.stringify({
          type: 'object',
          required: ['id', 'count'],
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            count: { type: 'number' },
            status: { enum: ['draft', 'final'] },
          },
        }),
      },
    );

    expect(result.status).toBe('invalid');
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'json-schema-required',
        message: 'Missing required field $.id.',
        category: 'schema',
        displayPath: '$',
        blocking: false,
      }),
      expect.objectContaining({
        code: 'json-schema-type',
        message: 'Expected $.count to be number.',
        category: 'schema',
        displayPath: '$.count',
      }),
      expect.objectContaining({
        code: 'json-schema-enum',
        message: 'Value at $.status must be one of "draft", "final".',
        category: 'schema',
        displayPath: '$.status',
      }),
      expect.objectContaining({
        code: 'json-schema-additional-properties',
        message: 'Unexpected field $.extra.',
        category: 'schema',
        displayPath: '$.extra',
      }),
    ]));
  });

  it('maps required, type, enum, and additional-property diagnostics to parsed source nodes', () => {
    const text = '{\n  "count": "2",\n  "status": "unknown",\n  "extra": true\n}\n';
    const parsed = parseJsonDocument(createJsonContent(text)).parsed;
    expect(parsed).not.toBeNull();

    const result = validateJsonValueAgainstSchema(parsed?.value, {
      kind: 'explicit',
      path: 'C:\\lab\\result.schema.json',
      text: JSON.stringify({
        type: 'object',
        required: ['id'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          count: { type: 'number' },
          status: { enum: ['draft', 'final'] },
        },
      }),
    }, { sourceMap: parsed?.sourceMap });

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'json-schema-required',
        path: [],
        pointer: '',
        displayPath: '$',
        span: expect.objectContaining({ offset: 0, line: 1 }),
      }),
      expect.objectContaining({
        code: 'json-schema-type',
        path: ['count'],
        pointer: '/count',
        displayPath: '$.count',
        span: expect.objectContaining({ offset: text.indexOf('"2"'), length: 3, line: 2 }),
      }),
      expect.objectContaining({
        code: 'json-schema-enum',
        path: ['status'],
        pointer: '/status',
        displayPath: '$.status',
        span: expect.objectContaining({ offset: text.indexOf('"unknown"'), length: 9, line: 3 }),
      }),
      expect.objectContaining({
        code: 'json-schema-additional-properties',
        path: ['extra'],
        pointer: '/extra',
        displayPath: '$.extra',
        span: expect.objectContaining({ offset: text.indexOf('"extra"'), line: 4 }),
      }),
    ]));
  });

  it('summarizes schema fields, descriptions, enums, and required fields', () => {
    const result = validateJsonValueAgainstSchema(
      { id: 'A', status: 'draft' },
      {
        kind: 'sibling',
        path: 'C:\\lab\\result.schema.json',
        text: JSON.stringify({
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          title: 'Dataset',
          description: 'Dataset metadata.',
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Identifier.' },
            status: { enum: ['draft', 'final'] },
          },
        }),
      },
    );

    expect(result.status).toBe('valid');
    expect(result.summary).toMatchObject({
      title: 'Dataset',
      description: 'Dataset metadata.',
      draftUri: 'https://json-schema.org/draft/2020-12/schema',
      requiredFields: ['id'],
    });
    expect(result.summary?.knownFields).toContainEqual(expect.objectContaining({
      path: '$.id',
      type: 'string',
      required: true,
      description: 'Identifier.',
    }));
    expect(result.summary?.enumFields).toContainEqual(expect.objectContaining({
      path: '$.status',
      values: ['"draft"', '"final"'],
      scalarValues: ['draft', 'final'],
    }));
  });

  it('derives conservative schema controls for missing required scalar fields', () => {
    const value = { status: 'draft', meta: {} };
    const result = validateJsonValueAgainstSchema(value, {
      kind: 'explicit',
      path: 'C:\\lab\\result.schema.json',
      text: JSON.stringify({
        type: 'object',
        required: ['id', 'status', 'count', 'meta'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', default: 'sample-1', description: 'Identifier.' },
          status: { enum: ['draft', 'final'] },
          count: { type: ['integer', 'null'] },
          meta: {
            type: 'object',
            required: ['flag'],
            properties: {
              flag: { type: 'boolean', default: true },
            },
          },
          tags: { type: 'array' },
        },
      }),
    });

    const rootControl = jsonSchemaObjectControlForPath(result.summary, '$', value);
    expect(rootControl).toMatchObject({
      path: '$',
      additionalPropertiesAllowed: false,
    });
    expect(rootControl?.missingRequiredFields.map((field) => field.key)).toEqual(['id', 'count']);
    expect(rootControl?.fields.find((field) => field.key === 'id')).toMatchObject({
      defaultValue: 'sample-1',
      defaultSource: 'schema-default',
      typeHints: ['string'],
      description: 'Identifier.',
    });
    expect(rootControl?.fields.find((field) => field.key === 'count')).toMatchObject({
      defaultValue: 0,
      defaultSource: 'type',
      typeHints: ['integer', 'null'],
    });
    expect(rootControl?.fields.find((field) => field.key === 'tags')).toMatchObject({
      canEditScalar: false,
    });

    const statusControl = jsonSchemaScalarControlForPath(result.summary, '$.status');
    expect(statusControl).toMatchObject({
      enumValues: ['draft', 'final'],
      defaultValue: 'draft',
      defaultSource: 'enum',
    });
    expect(statusControl && jsonSchemaScalarValueMatchesControl('final', statusControl)).toBe(true);
    expect(statusControl && jsonSchemaScalarValueMatchesControl('unknown', statusControl)).toBe(false);

    const metaControl = jsonSchemaObjectControlForPath(result.summary, '$.meta', value.meta);
    expect(metaControl?.missingRequiredFields).toContainEqual(expect.objectContaining({
      key: 'flag',
      defaultValue: true,
      defaultSource: 'schema-default',
      typeHints: ['boolean'],
    }));
  });

  it('derives deterministic generated values and reasons for nested schema fields', () => {
    const value = {};
    const schema = {
      type: 'object',
      required: ['meta'],
      additionalProperties: false,
      properties: {
        meta: {
          type: 'object',
          required: ['enabled', 'method', 'config'],
          additionalProperties: false,
          properties: {
            enabled: { type: 'boolean', default: true },
            method: { enum: ['mass-spec', 'microscopy'] },
            config: {
              type: 'object',
              required: ['threshold'],
              additionalProperties: false,
              properties: {
                threshold: { type: 'number' },
              },
            },
          },
        },
        tags: { type: 'array', default: ['qc'] },
        firstMeasurement: {
          type: 'array',
          minItems: 1,
          maxItems: 1,
          items: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string', default: 'm-1' },
            },
          },
        },
        choice: { oneOf: [{ type: 'string' }, { type: 'number' }] },
        remote: { $ref: 'https://example.test/schema.json' },
      },
    };

    const result = validateJsonValueAgainstSchema(value, {
      kind: 'explicit',
      path: 'C:\\lab\\result.schema.json',
      text: JSON.stringify(schema),
    });
    const rootControl = jsonSchemaObjectControlForPath(result.summary, '$', value);

    expect(rootControl?.fields.find((field) => field.key === 'meta')?.generatedValue).toMatchObject({
      kind: 'object',
      source: 'required-fields',
      value: {
        enabled: true,
        method: 'mass-spec',
        config: { threshold: 0 },
      },
    });
    expect(rootControl?.fields.find((field) => field.key === 'tags')?.generatedValue).toMatchObject({
      kind: 'array',
      source: 'schema-default',
      value: ['qc'],
    });
    expect(rootControl?.fields.find((field) => field.key === 'firstMeasurement')?.generatedValue).toMatchObject({
      kind: 'array',
      source: 'bounded-array-item',
      value: [{ id: 'm-1' }],
    });
    expect(rootControl?.fields.find((field) => field.key === 'choice')).toMatchObject({
      canEditScalar: false,
      unsupportedReason: expect.stringContaining('oneOf'),
    });
    expect(rootControl?.fields.find((field) => field.key === 'remote')).toMatchObject({
      canEditScalar: false,
      unsupportedReason: expect.stringContaining('Remote $ref'),
    });

    const generated = {
      meta: rootControl?.fields.find((field) => field.key === 'meta')?.generatedValue?.value,
      tags: rootControl?.fields.find((field) => field.key === 'tags')?.generatedValue?.value,
      firstMeasurement: rootControl?.fields.find((field) => field.key === 'firstMeasurement')?.generatedValue?.value,
    };
    const validation = validateJsonValueAgainstSchema(generated, {
      kind: 'explicit',
      path: 'C:\\lab\\result.schema.json',
      text: JSON.stringify({
        ...schema,
        required: ['meta', 'tags', 'firstMeasurement'],
        properties: {
          meta: schema.properties.meta,
          tags: schema.properties.tags,
          firstMeasurement: schema.properties.firstMeasurement,
        },
      }),
    });
    expect(validation.status).toBe('valid');
  });

  it('resolves local $defs refs for controls and bounded generated arrays', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $defs: {
        sampleId: { type: 'string', enum: ['S-001', 'S-002'] },
        metadata: {
          type: 'object',
          required: ['operator'],
          properties: {
            operator: { type: 'string', default: 'AR' },
          },
        },
        measurement: {
          type: 'object',
          required: ['value'],
          properties: {
            value: { type: 'number' },
          },
        },
      },
      type: 'object',
      required: ['id', 'metadata', 'replicates'],
      properties: {
        id: { $ref: '#/$defs/sampleId' },
        metadata: { $ref: '#/$defs/metadata' },
        replicates: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          items: { $ref: '#/$defs/measurement' },
        },
      },
    };

    const result = validateJsonValueAgainstSchema({}, {
      kind: 'explicit',
      path: 'C:\\lab\\result.schema.json',
      text: JSON.stringify(schema),
    });
    const rootControl = jsonSchemaObjectControlForPath(result.summary, '$', {});

    expect(result.profile).toMatchObject({
      draftLabel: '2020-12',
      localRefsSupported: true,
      localRefCount: 3,
      remoteRefsIgnored: false,
    });
    expect(rootControl?.fields.find((field) => field.key === 'id')).toMatchObject({
      enumValues: ['S-001', 'S-002'],
      defaultValue: 'S-001',
      defaultSource: 'enum',
    });
    expect(rootControl?.fields.find((field) => field.key === 'metadata')?.generatedValue).toMatchObject({
      kind: 'object',
      value: { operator: 'AR' },
      explanation: expect.stringContaining('required schema fields'),
    });
    expect(rootControl?.fields.find((field) => field.key === 'replicates')?.generatedValue).toMatchObject({
      kind: 'array',
      source: 'bounded-array-item',
      value: [{ value: 0 }, { value: 0 }],
      explanation: expect.stringContaining('2 items'),
    });

    const generated = {
      id: 'S-001',
      metadata: rootControl?.fields.find((field) => field.key === 'metadata')?.generatedValue?.value,
      replicates: rootControl?.fields.find((field) => field.key === 'replicates')?.generatedValue?.value,
    };
    expect(validateJsonValueAgainstSchema(generated, {
      kind: 'explicit',
      path: 'C:\\lab\\result.schema.json',
      text: JSON.stringify(schema),
    }).status).toBe('valid');
  });

  it('ignores external $ref targets for validation while reporting schema profile limitations', () => {
    const result = validateJsonValueAgainstSchema(
      { external: { any: 'shape' } },
      {
        kind: 'explicit',
        path: 'C:\\lab\\result.schema.json',
        text: JSON.stringify({
          type: 'object',
          properties: {
            external: { $ref: 'https://example.test/external.schema.json' },
            choice: { oneOf: [{ type: 'string' }, { type: 'number' }] },
          },
        }),
      },
    );
    const rootControl = jsonSchemaObjectControlForPath(result.summary, '$', {});

    expect(result.status).toBe('valid');
    expect(result.profile).toMatchObject({
      remoteRefsIgnored: true,
      remoteRefCount: 1,
      remoteRefTargets: ['https://example.test/external.schema.json'],
      unsupportedCompositionKeywords: ['oneOf'],
    });
    expect(rootControl?.fields.find((field) => field.key === 'external')).toMatchObject({
      canEditScalar: false,
      unsupportedReason: expect.stringContaining('Remote $ref'),
    });
  });

  it('returns schema-invalid diagnostics for malformed schema text', () => {
    const result = validateJsonValueAgainstSchema({ ok: true }, {
      kind: 'explicit',
      path: 'C:\\lab\\bad.schema.json',
      text: '{"type": "object",}',
    });

    expect(result.status).toBe('schema-invalid');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'json-schema-syntax-PropertyNameExpected',
      severity: 'warning',
      category: 'schema',
      blocking: false,
    }));
  });

  it('extracts document $schema metadata without fetching it and infers observed shape', () => {
    expect(extractJsonSchemaMetadata({
      $schema: 'https://example.test/schema.json',
      rows: [{ id: 1 }, { id: 2, label: 'B' }],
    })).toEqual({
      uri: 'https://example.test/schema.json',
      source: 'document-$schema',
    });

    expect(inferObservedJsonShape([{ id: 1 }, { id: 2, label: 'B' }])).toMatchObject({
      topLevelType: 'array',
      arrayItemTypes: ['object'],
      fields: [
        { path: '$[].id', types: ['number'], presentCount: 2, optional: false },
        { path: '$[].label', types: ['string'], presentCount: 1, optional: true },
      ],
    });
  });
});
