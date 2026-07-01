import Ajv2020 from 'ajv/dist/2020.js';
import type { AnySchema, ErrorObject } from 'ajv';
import { parse as parseJson, type ParseError, printParseErrorCode } from 'jsonc-parser';
import type {
  FormatDiagnostic,
  SourceSpan,
  StructuredNodeRef,
  StructuredPathSegment,
  StructuredSourceMap,
} from '../documentFormat.js';
import { offsetToLineColumn } from '../json/jsonHealth.js';
import {
  displayPathFromPath,
  pathFromPointer,
  pointerFromPath,
  sourceSpanFromOffset,
} from '../structured/sourceMap.js';

export type JsonSchemaSourceKind = 'explicit' | 'sibling';

export interface JsonSchemaSource {
  kind: JsonSchemaSourceKind;
  text: string;
  path: string | null;
  label?: string;
}

export interface JsonSchemaSourceSummary {
  kind: JsonSchemaSourceKind;
  path: string | null;
  label: string;
}

export type JsonSchemaValidationStatus = 'valid' | 'invalid' | 'schema-invalid';

export interface JsonSchemaValidationResult {
  status: JsonSchemaValidationStatus;
  source: JsonSchemaSourceSummary;
  schemaSource?: JsonSchemaSource;
  profile: JsonSchemaProfile;
  diagnostics: FormatDiagnostic[];
  summary: JsonSchemaSummary | null;
}

export interface JsonSchemaValidationOptions {
  sourceMap?: StructuredSourceMap | null;
}

export interface JsonSchemaMetadata {
  uri: string | null;
  source: 'document-$schema' | null;
}

export interface JsonSchemaSummary {
  title: string | null;
  description: string | null;
  schemaUri: string | null;
  draftUri: string | null;
  profile: JsonSchemaProfile;
  requiredFields: string[];
  knownFields: JsonSchemaFieldSummary[];
  enumFields: JsonSchemaEnumSummary[];
  objectFields: JsonSchemaObjectSummary[];
}

export interface JsonSchemaProfile {
  source: JsonSchemaSourceSummary;
  draftUri: string | null;
  draftLabel: string;
  localRefsSupported: boolean;
  localRefCount: number;
  localRefTargets: string[];
  remoteRefsIgnored: boolean;
  remoteRefCount: number;
  remoteRefTargets: string[];
  unsupportedCompositionKeywords: string[];
}

export interface JsonSchemaFieldSummary {
  path: string;
  parentPath: string;
  key: string;
  type: string | null;
  required: boolean;
  description: string | null;
  hasDefault: boolean;
  defaultValue?: JsonSchemaScalarValue;
  generatedValue?: JsonSchemaGeneratedValue;
  generationUnsupportedReason?: string;
}

export interface JsonSchemaEnumSummary {
  path: string;
  values: string[];
  scalarValues: JsonSchemaScalarValue[];
}

export interface JsonSchemaObjectSummary {
  path: string;
  requiredFields: string[];
  additionalPropertiesAllowed: boolean;
}

export type JsonSchemaScalarValue = string | number | boolean | null;
export type JsonSchemaScalarType = 'string' | 'number' | 'integer' | 'boolean' | 'null';
export type JsonSchemaDefaultSource = 'schema-default' | 'enum' | 'type';
export type JsonSchemaGeneratedValueJson =
  | JsonSchemaScalarValue
  | { [key: string]: JsonSchemaGeneratedValueJson }
  | JsonSchemaGeneratedValueJson[];
export type JsonSchemaGeneratedValueKind = 'scalar' | 'object' | 'array';
export type JsonSchemaGeneratedValueSource =
  | JsonSchemaDefaultSource
  | 'required-fields'
  | 'closed-object-defaults'
  | 'bounded-array-item';

export interface JsonSchemaGeneratedValue {
  kind: JsonSchemaGeneratedValueKind;
  source: JsonSchemaGeneratedValueSource;
  value: JsonSchemaGeneratedValueJson;
  explanation: string;
}

export interface JsonSchemaScalarControl {
  path: string;
  typeHints: JsonSchemaScalarType[];
  enumValues: JsonSchemaScalarValue[];
  description: string | null;
  required: boolean;
  defaultValue?: JsonSchemaScalarValue;
  defaultSource: JsonSchemaDefaultSource | null;
  canEditScalar: boolean;
  unsupportedReason?: string;
}

export interface JsonSchemaObjectFieldSuggestion extends JsonSchemaScalarControl {
  key: string;
  present: boolean;
  generatedValue?: JsonSchemaGeneratedValue;
}

export interface JsonSchemaObjectControl {
  path: string;
  additionalPropertiesAllowed: boolean;
  fields: JsonSchemaObjectFieldSuggestion[];
  missingRequiredFields: JsonSchemaObjectFieldSuggestion[];
}

export interface ObservedJsonShapeSummary {
  topLevelType: string;
  fields: ObservedJsonFieldSummary[];
  arrayItemTypes: string[];
}

export interface ObservedJsonFieldSummary {
  path: string;
  types: string[];
  presentCount: number;
  optional: boolean;
}

const OBSERVED_FIELD_LIMIT = 24;
const SCHEMA_FIELD_LIMIT = 48;

export function validateJsonValueAgainstSchema(
  value: unknown,
  schemaSource: JsonSchemaSource,
  options: JsonSchemaValidationOptions = {},
): JsonSchemaValidationResult {
  const source = summarizeSchemaSource(schemaSource);
  const parsedSchema = parseSchemaText(schemaSource.text);
  if (parsedSchema.value === null || parsedSchema.diagnostics.length > 0) {
    const profile = createJsonSchemaProfile(parsedSchema.value, source);
    return {
      status: 'schema-invalid',
      source,
      schemaSource,
      profile,
      diagnostics: parsedSchema.diagnostics,
      summary: null,
    };
  }

  const profile = createJsonSchemaProfile(parsedSchema.value, source);
  const validationSchema = normalizeSchemaRefs(parsedSchema.value, {
    rootSchema: parsedSchema.value,
    ignoreExternalRefs: true,
  }) as AnySchema;
  const summarySchema = normalizeSchemaRefs(parsedSchema.value, {
    rootSchema: parsedSchema.value,
    ignoreExternalRefs: false,
  });
  const summary = summarizeJsonSchema(summarySchema, profile);
  try {
    const ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      allowUnionTypes: true,
      verbose: false,
    });
    const validate = ajv.compile(validationSchema);
    const valid = validate(value);
    const diagnostics = valid
      ? []
      : (validate.errors ?? []).map((error) => schemaErrorToDiagnostic(error, options.sourceMap ?? null));
    return {
      status: diagnostics.length === 0 ? 'valid' : 'invalid',
      source,
      schemaSource,
      profile,
      diagnostics,
      summary,
    };
  } catch (error) {
    return {
      status: 'schema-invalid',
      source,
      schemaSource,
      profile,
      diagnostics: [{
        severity: 'warning',
        code: 'json-schema-compile-error',
        message: `JSON Schema could not be compiled. ${errorMessage(error)}`,
        source: 'json',
        category: 'schema',
        blocking: false,
      }],
      summary,
    };
  }
}

export function extractJsonSchemaMetadata(value: unknown): JsonSchemaMetadata {
  if (!isRecord(value)) return { uri: null, source: null };
  const schemaUri = value.$schema;
  return typeof schemaUri === 'string' && schemaUri.trim()
    ? { uri: schemaUri.trim(), source: 'document-$schema' }
    : { uri: null, source: null };
}

export function summarizeJsonSchema(schema: unknown, profile?: JsonSchemaProfile): JsonSchemaSummary {
  const root = isRecord(schema) ? schema : {};
  const resolvedProfile = profile ?? createJsonSchemaProfile(schema, {
    kind: 'explicit',
    path: null,
    label: 'Inline schema',
  });
  return {
    title: stringValue(root.title),
    description: stringValue(root.description),
    schemaUri: stringValue(root.$id) ?? stringValue(root.id),
    draftUri: stringValue(root.$schema),
    profile: resolvedProfile,
    requiredFields: stringArray(root.required).slice(0, SCHEMA_FIELD_LIMIT),
    knownFields: collectSchemaFields(root).slice(0, SCHEMA_FIELD_LIMIT),
    enumFields: collectSchemaEnums(root).slice(0, SCHEMA_FIELD_LIMIT),
    objectFields: collectSchemaObjects(root).slice(0, SCHEMA_FIELD_LIMIT),
  };
}

export function jsonSchemaScalarControlForPath(
  summary: JsonSchemaSummary | null | undefined,
  path: string,
): JsonSchemaScalarControl | null {
  if (!summary) return null;
  const field = summary.knownFields.find((candidate) => candidate.path === path);
  if (!field) return null;
  return scalarControlForField(summary, field);
}

export function jsonSchemaObjectControlForPath(
  summary: JsonSchemaSummary | null | undefined,
  path: string,
  objectValue: unknown,
): JsonSchemaObjectControl | null {
  if (!summary || !isRecord(objectValue)) return null;
  const objectSummary = summary.objectFields.find((candidate) => candidate.path === path);
  const childFields = summary.knownFields.filter((field) => field.parentPath === path);
  if (!objectSummary && childFields.length === 0) return null;

  const presentKeys = new Set(Object.keys(objectValue));
  const fields = childFields.map((field) => {
    const scalarControl = scalarControlForField(summary, field);
    return {
      ...scalarControl,
      key: field.key,
      present: presentKeys.has(field.key),
      generatedValue: field.generatedValue,
      unsupportedReason: scalarControl.canEditScalar || field.generatedValue
        ? undefined
        : field.generationUnsupportedReason ?? scalarControl.unsupportedReason,
    };
  });
  return {
    path,
    additionalPropertiesAllowed: objectSummary?.additionalPropertiesAllowed ?? true,
    fields,
    missingRequiredFields: fields.filter((field) => field.required && !field.present),
  };
}

export function jsonSchemaScalarValueType(value: JsonSchemaScalarValue): JsonSchemaScalarType {
  if (value === null) return 'null';
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

export function jsonSchemaScalarValueMatchesControl(
  value: JsonSchemaScalarValue,
  control: JsonSchemaScalarControl,
): boolean {
  if (control.enumValues.length > 0 && !control.enumValues.some((candidate) => scalarValuesEqual(candidate, value))) {
    return false;
  }
  if (control.typeHints.length === 0) return true;
  return control.typeHints.some((typeHint) => scalarValueMatchesType(value, typeHint));
}

export function inferObservedJsonShape(value: unknown): ObservedJsonShapeSummary {
  if (Array.isArray(value)) {
    return {
      topLevelType: 'array',
      fields: inferArrayObjectFields(value),
      arrayItemTypes: Array.from(new Set(value.map(jsonValueType))).sort(),
    };
  }
  if (isRecord(value)) {
    return {
      topLevelType: 'object',
      fields: Object.entries(value).slice(0, OBSERVED_FIELD_LIMIT).map(([key, child]) => ({
        path: jsonPathForProperty('$', key),
        types: [jsonValueType(child)],
        presentCount: 1,
        optional: false,
      })),
      arrayItemTypes: [],
    };
  }
  return {
    topLevelType: jsonValueType(value),
    fields: [],
    arrayItemTypes: [],
  };
}

function parseSchemaText(text: string): { value: unknown | null; diagnostics: FormatDiagnostic[] } {
  const errors: ParseError[] = [];
  const value = parseJson(text, errors, {
    allowEmptyContent: false,
    allowTrailingComma: false,
    disallowComments: true,
  }) as unknown;
  if (errors.length > 0) {
    return {
      value: null,
      diagnostics: errors.map((error) => schemaParseErrorToDiagnostic(error, text)),
    };
  }
  if (!isRecord(value) && !Array.isArray(value) && typeof value !== 'boolean') {
    return {
      value: null,
      diagnostics: [{
        severity: 'warning',
        code: 'json-schema-root-invalid',
        message: 'JSON Schema must be a boolean or object schema.',
        source: 'json',
        category: 'schema',
        blocking: false,
      }],
    };
  }
  return { value, diagnostics: [] };
}

function schemaParseErrorToDiagnostic(error: ParseError, text: string): FormatDiagnostic {
  const location = offsetToLineColumn(text, error.offset);
  return {
    severity: 'warning',
    code: `json-schema-syntax-${printParseErrorCode(error.error)}`,
    message: 'JSON Schema file is not valid strict JSON.',
    line: location.line,
    column: location.column,
    offset: error.offset,
    length: Math.max(1, error.length),
    source: 'json',
    category: 'schema',
    span: sourceSpanFromOffset(text, error.offset, Math.max(1, error.length)),
    blocking: false,
  };
}

function createJsonSchemaProfile(schema: unknown, source: JsonSchemaSourceSummary): JsonSchemaProfile {
  const localRefTargets = new Set<string>();
  const remoteRefTargets = new Set<string>();
  const unsupportedCompositionKeywords = new Set<string>();
  collectSchemaProfileSignals(schema, {
    localRefTargets,
    remoteRefTargets,
    unsupportedCompositionKeywords,
  });
  const root = isRecord(schema) ? schema : {};
  const draftUri = stringValue(root.$schema);
  return {
    source,
    draftUri,
    draftLabel: schemaDraftLabel(draftUri),
    localRefsSupported: true,
    localRefCount: localRefTargets.size,
    localRefTargets: Array.from(localRefTargets).sort(),
    remoteRefsIgnored: remoteRefTargets.size > 0,
    remoteRefCount: remoteRefTargets.size,
    remoteRefTargets: Array.from(remoteRefTargets).sort(),
    unsupportedCompositionKeywords: Array.from(unsupportedCompositionKeywords).sort(),
  };
}

function collectSchemaProfileSignals(
  value: unknown,
  profile: {
    localRefTargets: Set<string>;
    remoteRefTargets: Set<string>;
    unsupportedCompositionKeywords: Set<string>;
  },
  seen = new Set<object>(),
): void {
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const item of value) collectSchemaProfileSignals(item, profile, seen);
    return;
  }
  if (!isRecord(value)) return;
  if (seen.has(value)) return;
  seen.add(value);

  if (typeof value.$ref === 'string') {
    if (isLocalSchemaRef(value.$ref)) {
      profile.localRefTargets.add(value.$ref);
    } else {
      profile.remoteRefTargets.add(value.$ref);
    }
  }

  for (const keyword of ['oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else']) {
    if (Object.prototype.hasOwnProperty.call(value, keyword)) {
      profile.unsupportedCompositionKeywords.add(keyword);
    }
  }
  for (const child of Object.values(value)) collectSchemaProfileSignals(child, profile, seen);
}

function schemaDraftLabel(draftUri: string | null): string {
  if (!draftUri) return 'unspecified';
  if (/2020-12/.test(draftUri)) return '2020-12';
  if (/2019-09/.test(draftUri)) return '2019-09';
  if (/draft-07/.test(draftUri)) return 'draft-07';
  if (/draft-06/.test(draftUri)) return 'draft-06';
  if (/draft-04/.test(draftUri)) return 'draft-04';
  return draftUri;
}

interface NormalizeSchemaRefsOptions {
  rootSchema: unknown;
  ignoreExternalRefs: boolean;
  refStack?: string[];
  depth?: number;
}

const LOCAL_SCHEMA_REF_DEPTH_LIMIT = 32;

function normalizeSchemaRefs(schema: unknown, options: NormalizeSchemaRefsOptions): unknown {
  const depth = options.depth ?? 0;
  if (depth > LOCAL_SCHEMA_REF_DEPTH_LIMIT) return true;
  if (Array.isArray(schema)) {
    return schema.map((item) => normalizeSchemaRefs(item, { ...options, depth: depth + 1 }));
  }
  if (!isRecord(schema)) return schema;

  const ref = typeof schema.$ref === 'string' ? schema.$ref : null;
  if (ref) {
    if (isLocalSchemaRef(ref)) {
      if (options.refStack?.includes(ref)) {
        return normalizeSchemaObjectWithoutRef(schema, options, depth);
      }
      const target = schemaNodeForLocalRef(options.rootSchema, ref);
      if (target !== undefined) {
        const resolved = normalizeSchemaRefs(target, {
          ...options,
          refStack: [...(options.refStack ?? []), ref],
          depth: depth + 1,
        });
        const siblings = normalizeSchemaObjectWithoutRef(schema, options, depth);
        if (Object.keys(siblings).length === 0) return resolved;
        if (isRecord(resolved)) return { ...resolved, ...siblings };
        return resolved === true ? siblings : resolved;
      }
    } else if (options.ignoreExternalRefs) {
      const siblings = normalizeSchemaObjectWithoutRef(schema, options, depth);
      return Object.keys(siblings).length > 0 ? siblings : true;
    }
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    normalized[key] = normalizeSchemaRefs(value, { ...options, depth: depth + 1 });
  }
  return normalized;
}

function normalizeSchemaObjectWithoutRef(
  schema: Record<string, unknown>,
  options: NormalizeSchemaRefsOptions,
  depth: number,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$ref') continue;
    normalized[key] = normalizeSchemaRefs(value, { ...options, depth: depth + 1 });
  }
  return normalized;
}

function schemaNodeForLocalRef(root: unknown, ref: string): unknown {
  if (ref === '#') return root;
  if (!ref.startsWith('#/')) return undefined;
  const segments = ref
    .slice(2)
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment).replace(/~1/g, '/').replace(/~0/g, '~');
      } catch {
        return segment.replace(/~1/g, '/').replace(/~0/g, '~');
      }
    });
  let current = root;
  for (const segment of segments) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
    } else if (isRecord(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function isLocalSchemaRef(ref: string): boolean {
  return ref === '#' || ref.startsWith('#/');
}

function schemaErrorToDiagnostic(error: ErrorObject, sourceMap: StructuredSourceMap | null): FormatDiagnostic {
  const path = pathForSchemaError(error);
  const keyword = normalizeKeyword(error.keyword);
  const target = schemaErrorTarget(error, sourceMap);
  return {
    severity: 'error',
    code: `json-schema-${keyword}`,
    message: schemaErrorMessage(error, path),
    source: 'json',
    category: 'schema',
    path: target.path,
    pointer: target.pointer,
    displayPath: target.displayPath,
    span: target.span,
    relatedSpans: target.relatedSpans,
    blocking: false,
  };
}

function schemaErrorTarget(
  error: ErrorObject,
  sourceMap: StructuredSourceMap | null,
): {
  path: StructuredPathSegment[];
  pointer: string;
  displayPath: string;
  span?: SourceSpan;
  relatedSpans?: SourceSpan[];
} {
  const targetPointer = targetPointerForSchemaError(error);
  const sourceNode = sourceMap?.nodesByPointer[targetPointer] ?? null;
  if (sourceNode) {
    const relatedSpans = relatedSpansForSchemaNode(sourceNode);
    return {
      path: sourceNode.path,
      pointer: sourceNode.pointer,
      displayPath: sourceNode.displayPath,
      span: primarySpanForSchemaError(error, sourceNode),
      relatedSpans: relatedSpans.length > 0 ? relatedSpans : undefined,
    };
  }

  const path = pathFromPointer(targetPointer);
  return {
    path,
    pointer: pointerFromPath(path),
    displayPath: displayPathFromPath(path),
  };
}

function targetPointerForSchemaError(error: ErrorObject): string {
  const instancePointer = error.instancePath || '';
  if (error.keyword === 'additionalProperties' && typeof error.params.additionalProperty === 'string') {
    return `${instancePointer}/${escapeJsonPointerSegment(error.params.additionalProperty)}`;
  }
  return instancePointer;
}

function primarySpanForSchemaError(error: ErrorObject, node: StructuredNodeRef): SourceSpan | undefined {
  if (error.keyword === 'additionalProperties') return node.span ?? node.valueSpan ?? undefined;
  return node.valueSpan ?? node.span ?? undefined;
}

function relatedSpansForSchemaNode(node: StructuredNodeRef): SourceSpan[] {
  return [node.keySpan, node.valueSpan]
    .filter((span): span is SourceSpan => Boolean(span));
}

function schemaErrorMessage(error: ErrorObject, path: string): string {
  switch (error.keyword) {
    case 'required': {
      const missing = typeof error.params.missingProperty === 'string'
        ? error.params.missingProperty
        : 'required field';
      return `Missing required field ${jsonPathForProperty(path, missing)}.`;
    }
    case 'type':
      return `Expected ${path} to be ${String(error.params.type)}.`;
    case 'enum':
      return `Value at ${path} must be one of ${formatEnumValues(error.params.allowedValues)}.`;
    case 'additionalProperties': {
      const property = typeof error.params.additionalProperty === 'string'
        ? error.params.additionalProperty
        : 'unknown';
      return `Unexpected field ${jsonPathForProperty(path, property)}.`;
    }
    default:
      return `Schema validation failed at ${path}: ${error.message ?? error.keyword}.`;
  }
}

function pathForSchemaError(error: ErrorObject): string {
  const basePath = jsonPointerToPath(error.instancePath || '');
  if (error.keyword === 'required' && typeof error.params.missingProperty === 'string') {
    return basePath;
  }
  return basePath;
}

function collectSchemaFields(schema: Record<string, unknown>, parentPath = '$'): JsonSchemaFieldSummary[] {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(stringArray(schema.required));
  const fields: JsonSchemaFieldSummary[] = [];
  for (const [key, child] of Object.entries(properties)) {
    if (!isRecord(child)) continue;
    const path = jsonPathForProperty(parentPath, key);
    const scalarDefault = scalarDefaultValue(child.default);
    const generated = generatedValueForSchema(child, path, 0, { allowTypeFallback: required.has(key) });
    fields.push({
      path,
      parentPath,
      key,
      type: schemaTypeLabel(child),
      required: required.has(key),
      description: stringValue(child.description),
      hasDefault: scalarDefault !== undefined,
      defaultValue: scalarDefault,
      generatedValue: generated.ok && generated.value.kind !== 'scalar' ? generated.value : undefined,
      generationUnsupportedReason: generated.ok ? undefined : generated.reason,
    });
    fields.push(...collectSchemaFields(child, path));
  }
  return fields;
}

function collectSchemaEnums(schema: Record<string, unknown>, parentPath = '$'): JsonSchemaEnumSummary[] {
  const enums: JsonSchemaEnumSummary[] = [];
  if (Array.isArray(schema.enum)) {
    enums.push({
      path: parentPath,
      values: schema.enum.slice(0, 12).map((value) => JSON.stringify(value) ?? String(value)),
      scalarValues: schema.enum
        .filter(isJsonSchemaScalarValue)
        .slice(0, 12),
    });
  }
  const properties = isRecord(schema.properties) ? schema.properties : {};
  for (const [key, child] of Object.entries(properties)) {
    if (isRecord(child)) enums.push(...collectSchemaEnums(child, jsonPathForProperty(parentPath, key)));
  }
  return enums;
}

function collectSchemaObjects(schema: Record<string, unknown>, parentPath = '$'): JsonSchemaObjectSummary[] {
  const objects: JsonSchemaObjectSummary[] = [];
  if (isObjectLikeSchema(schema)) {
    objects.push({
      path: parentPath,
      requiredFields: stringArray(schema.required).slice(0, SCHEMA_FIELD_LIMIT),
      additionalPropertiesAllowed: schema.additionalProperties !== false,
    });
  }
  const properties = isRecord(schema.properties) ? schema.properties : {};
  for (const [key, child] of Object.entries(properties)) {
    if (isRecord(child)) objects.push(...collectSchemaObjects(child, jsonPathForProperty(parentPath, key)));
  }
  return objects;
}

function scalarControlForField(
  summary: JsonSchemaSummary,
  field: JsonSchemaFieldSummary,
): JsonSchemaScalarControl {
  const enumSummary = summary.enumFields.find((candidate) => candidate.path === field.path);
  const enumValues = enumSummary?.scalarValues ?? [];
  const typeHints = scalarTypeHintsForField(field, enumValues);
  const defaultPlan = defaultValueForField(field, enumValues, typeHints);
  const canEditScalar = typeHints.length > 0 || enumValues.length > 0 || defaultPlan.defaultSource !== null;
  return {
    path: field.path,
    typeHints,
    enumValues,
    description: field.description,
    required: field.required,
    defaultValue: defaultPlan.defaultValue,
    defaultSource: defaultPlan.defaultSource,
    canEditScalar,
    unsupportedReason: canEditScalar
      ? undefined
      : 'Schema field does not declare a scalar type, scalar enum, or scalar default.',
  };
}

type GeneratedValuePlan =
  | { ok: true; value: JsonSchemaGeneratedValue }
  | { ok: false; reason: string };

interface GeneratedValueOptions {
  allowTypeFallback: boolean;
}

const GENERATED_SCHEMA_DEPTH_LIMIT = 4;
const GENERATED_ARRAY_ITEM_LIMIT = 3;

function generatedValueForSchema(
  schema: Record<string, unknown>,
  path: string,
  depth: number,
  options: GeneratedValueOptions,
): GeneratedValuePlan {
  if (depth > GENERATED_SCHEMA_DEPTH_LIMIT) {
    return { ok: false, reason: 'Nested schema default generation is limited to four levels.' };
  }
  const unsupportedFeature = unsupportedGenerationFeature(schema);
  if (unsupportedFeature) return { ok: false, reason: unsupportedFeature };

  if (Object.prototype.hasOwnProperty.call(schema, 'default')) {
    if (!isJsonSchemaGeneratedValueJson(schema.default)) {
      return { ok: false, reason: 'Schema default is not a finite JSON value.' };
    }
    const value = cloneGeneratedJsonValue(schema.default);
    if (!generatedValueMatchesDeclaredType(value, schema)) {
      return { ok: false, reason: 'Schema default does not match the declared schema type.' };
    }
    return {
      ok: true,
      value: {
        kind: generatedValueKind(value),
        source: 'schema-default',
        value,
        explanation: `Uses the explicit schema default for ${path}.`,
      },
    };
  }

  const containerKind = schemaContainerKind(schema);
  if (containerKind === 'object') return generatedObjectValueForSchema(schema, path, depth, options);
  if (containerKind === 'array') return generatedArrayValueForSchema(schema, path, depth, options);
  return generatedScalarValueForSchema(schema, path, options);
}

function generatedObjectValueForSchema(
  schema: Record<string, unknown>,
  path: string,
  depth: number,
  options: GeneratedValueOptions,
): GeneratedValuePlan {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = stringArray(schema.required);
  const generatedObject: { [key: string]: JsonSchemaGeneratedValueJson } = {};
  const generatedKeys: string[] = [];

  for (const key of required) {
    const child = properties[key];
    const childPath = jsonPathForProperty(path, key);
    if (!isRecord(child)) {
      return { ok: false, reason: `Required field ${childPath} is not described in schema properties.` };
    }
    const childPlan = generatedValueForSchema(child, childPath, depth + 1, { allowTypeFallback: true });
    if (!childPlan.ok) {
      return { ok: false, reason: `Required field ${childPath} cannot be generated. ${childPlan.reason}` };
    }
    generatedObject[key] = cloneGeneratedJsonValue(childPlan.value.value);
    generatedKeys.push(key);
  }

  if (schema.additionalProperties === false) {
    for (const [key, child] of Object.entries(properties)) {
      if (required.includes(key) || !isRecord(child)) continue;
      const childPath = jsonPathForProperty(path, key);
      const childPlan = generatedValueForSchema(child, childPath, depth + 1, { allowTypeFallback: false });
      if (childPlan.ok && childPlan.value.source === 'schema-default') {
        generatedObject[key] = cloneGeneratedJsonValue(childPlan.value.value);
        generatedKeys.push(key);
      }
    }
  }

  if (generatedKeys.length === 0) {
    return {
      ok: false,
      reason: schema.additionalProperties === false
        ? 'Closed object schema has no required fields or explicit child defaults to generate.'
        : 'Object schema needs an explicit default or required fields before ScieMD can generate it.',
    };
  }

  const source: JsonSchemaGeneratedValueSource = required.length > 0
    ? 'required-fields'
    : 'closed-object-defaults';
  return {
    ok: true,
    value: {
      kind: 'object',
      source,
      value: generatedObject,
      explanation: required.length > 0
        ? `Generates ${path} from required schema fields: ${generatedKeys.join(', ')}.`
        : `Generates ${path} from explicit defaults in a closed object schema: ${generatedKeys.join(', ')}.`,
    },
  };
}

function generatedArrayValueForSchema(
  schema: Record<string, unknown>,
  path: string,
  depth: number,
  options: GeneratedValueOptions,
): GeneratedValuePlan {
  const minItems = typeof schema.minItems === 'number' && Number.isInteger(schema.minItems) ? schema.minItems : null;
  const maxItems = typeof schema.maxItems === 'number' && Number.isInteger(schema.maxItems) ? schema.maxItems : null;
  if (minItems === null || maxItems === null || minItems !== maxItems || minItems < 1 || minItems > GENERATED_ARRAY_ITEM_LIMIT) {
    return {
      ok: false,
      reason: `Array schema needs an explicit default or matching minItems/maxItems from 1 to ${GENERATED_ARRAY_ITEM_LIMIT} with a deterministic item schema.`,
    };
  }

  const itemSchema = firstArrayItemSchema(schema);
  if (!itemSchema) {
    return { ok: false, reason: 'Array schema does not describe the initial item shape.' };
  }
  const itemPlan = generatedValueForSchema(itemSchema, `${path}[0]`, depth + 1, options);
  if (!itemPlan.ok) {
    return { ok: false, reason: `Array item ${path}[0] cannot be generated. ${itemPlan.reason}` };
  }
  const values = Array.from({ length: minItems }, () => cloneGeneratedJsonValue(itemPlan.value.value));
  return {
    ok: true,
    value: {
      kind: 'array',
      source: 'bounded-array-item',
      value: values,
      explanation: `Generates ${path} with ${minItems} ${minItems === 1 ? 'item' : 'items'} because minItems and maxItems are both ${minItems}.`,
    },
  };
}

function generatedScalarValueForSchema(
  schema: Record<string, unknown>,
  path: string,
  options: GeneratedValueOptions,
): GeneratedValuePlan {
  const enumValues = Array.isArray(schema.enum)
    ? schema.enum.filter(isJsonSchemaScalarValue).slice(0, 12)
    : [];
  const typeHints = scalarTypeHintsForSchema(schema, enumValues);
  const scalarDefault = scalarDefaultValue(schema.default);
  const field: JsonSchemaFieldSummary = {
    path,
    parentPath: '$',
    key: path,
    type: schemaTypeLabel(schema),
    required: true,
    description: stringValue(schema.description),
    hasDefault: scalarDefault !== undefined,
    defaultValue: scalarDefault,
  };
  const defaultPlan = defaultValueForField(field, enumValues, typeHints);
  if (!defaultPlan.defaultSource || defaultPlan.defaultValue === undefined) {
    return { ok: false, reason: 'Schema field does not declare a scalar type, scalar enum, or scalar default.' };
  }
  if (!options.allowTypeFallback && defaultPlan.defaultSource === 'type') {
    return { ok: false, reason: 'Optional scalar fields need an explicit default before ScieMD can generate them.' };
  }
  return {
    ok: true,
    value: {
      kind: 'scalar',
      source: defaultPlan.defaultSource,
      value: defaultPlan.defaultValue,
      explanation: `Generates ${path} from the schema ${defaultPlan.defaultSource.replace('-', ' ')}.`,
    },
  };
}

function scalarTypeHintsForField(
  field: JsonSchemaFieldSummary,
  enumValues: readonly JsonSchemaScalarValue[],
): JsonSchemaScalarType[] {
  const hints = new Set<JsonSchemaScalarType>();
  if (field.type) {
    for (const part of field.type.split('|').map((item) => item.trim())) {
      if (isJsonSchemaScalarType(part)) hints.add(part);
    }
  }
  for (const value of enumValues) {
    hints.add(jsonSchemaScalarValueType(value));
  }
  return Array.from(hints);
}

function scalarTypeHintsForSchema(
  schema: Record<string, unknown>,
  enumValues: readonly JsonSchemaScalarValue[],
): JsonSchemaScalarType[] {
  const hints = new Set<JsonSchemaScalarType>();
  const schemaTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
  for (const type of schemaTypes) {
    if (typeof type === 'string' && isJsonSchemaScalarType(type)) hints.add(type);
  }
  for (const value of enumValues) {
    hints.add(jsonSchemaScalarValueType(value));
  }
  return Array.from(hints);
}

function unsupportedGenerationFeature(schema: Record<string, unknown>): string | null {
  if (typeof schema.$ref === 'string' && /^https?:\/\//i.test(schema.$ref)) {
    return 'Remote $ref schemas are not fetched for visual default generation.';
  }
  if (typeof schema.$ref === 'string') {
    return 'Schema $ref expansion is not supported for visual default generation.';
  }
  if (Array.isArray(schema.oneOf)) return 'Ambiguous oneOf schemas need a user choice before ScieMD can generate a value.';
  if (Array.isArray(schema.anyOf)) return 'Ambiguous anyOf schemas need a user choice before ScieMD can generate a value.';
  if (Array.isArray(schema.allOf)) return 'Composed allOf schemas are not expanded for visual default generation.';
  if (isRecord(schema.patternProperties)) return 'Pattern properties are too broad for deterministic visual default generation.';
  if (schema.if || schema.then || schema.else) return 'Conditional schemas are not generated automatically.';
  return null;
}

function schemaContainerKind(schema: Record<string, unknown>): 'object' | 'array' | null {
  if (schemaTypeIncludes(schema, 'object') || isObjectLikeSchema(schema)) return 'object';
  if (schemaTypeIncludes(schema, 'array') || Array.isArray(schema.prefixItems) || Object.prototype.hasOwnProperty.call(schema, 'items')) {
    return 'array';
  }
  return null;
}

function firstArrayItemSchema(schema: Record<string, unknown>): Record<string, unknown> | null {
  if (Array.isArray(schema.prefixItems) && isRecord(schema.prefixItems[0])) return schema.prefixItems[0];
  return isRecord(schema.items) ? schema.items : null;
}

function schemaTypeIncludes(schema: Record<string, unknown>, type: string): boolean {
  return schema.type === type || (Array.isArray(schema.type) && schema.type.includes(type));
}

function generatedValueMatchesDeclaredType(
  value: JsonSchemaGeneratedValueJson,
  schema: Record<string, unknown>,
): boolean {
  const schemaTypes = Array.isArray(schema.type)
    ? schema.type.filter((type): type is string => typeof type === 'string')
    : typeof schema.type === 'string'
      ? [schema.type]
      : [];
  if (schemaTypes.length === 0) return true;
  return schemaTypes.some((type) => {
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') return isRecord(value);
    if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
    if (type === 'number') return typeof value === 'number';
    if (type === 'string') return typeof value === 'string';
    if (type === 'boolean') return typeof value === 'boolean';
    if (type === 'null') return value === null;
    return false;
  });
}

function generatedValueKind(value: JsonSchemaGeneratedValueJson): JsonSchemaGeneratedValueKind {
  if (Array.isArray(value)) return 'array';
  if (isRecord(value)) return 'object';
  return 'scalar';
}

function cloneGeneratedJsonValue(value: JsonSchemaGeneratedValueJson): JsonSchemaGeneratedValueJson {
  if (Array.isArray(value)) return value.map((item) => cloneGeneratedJsonValue(item));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneGeneratedJsonValue(child as JsonSchemaGeneratedValueJson)]),
    );
  }
  return value;
}

function defaultValueForField(
  field: JsonSchemaFieldSummary,
  enumValues: readonly JsonSchemaScalarValue[],
  typeHints: readonly JsonSchemaScalarType[],
): { defaultValue?: JsonSchemaScalarValue; defaultSource: JsonSchemaDefaultSource | null } {
  const baseControl: JsonSchemaScalarControl = {
    path: field.path,
    typeHints: [...typeHints],
    enumValues: [...enumValues],
    description: field.description,
    required: field.required,
    defaultSource: null,
    canEditScalar: true,
  };
  if (field.hasDefault && field.defaultValue !== undefined && jsonSchemaScalarValueMatchesControl(field.defaultValue, baseControl)) {
    return { defaultValue: field.defaultValue, defaultSource: 'schema-default' };
  }
  if (enumValues.length > 0) return { defaultValue: enumValues[0], defaultSource: 'enum' };
  const preferredType = typeHints.find((type) => type !== 'null') ?? typeHints[0];
  if (preferredType) return { defaultValue: defaultValueForScalarType(preferredType), defaultSource: 'type' };
  return { defaultSource: null };
}

function defaultValueForScalarType(type: JsonSchemaScalarType): JsonSchemaScalarValue {
  switch (type) {
    case 'string':
      return '';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'null':
      return null;
  }
}

function scalarValueMatchesType(value: JsonSchemaScalarValue, type: JsonSchemaScalarType): boolean {
  switch (type) {
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number';
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
  }
}

function scalarValuesEqual(left: JsonSchemaScalarValue, right: JsonSchemaScalarValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isObjectLikeSchema(schema: Record<string, unknown>): boolean {
  return schema.type === 'object'
    || isRecord(schema.properties)
    || Array.isArray(schema.required)
    || Object.prototype.hasOwnProperty.call(schema, 'additionalProperties');
}

function isJsonSchemaScalarType(value: string): value is JsonSchemaScalarType {
  return value === 'string'
    || value === 'number'
    || value === 'integer'
    || value === 'boolean'
    || value === 'null';
}

function scalarDefaultValue(value: unknown): JsonSchemaScalarValue | undefined {
  if (!isJsonSchemaScalarValue(value)) return undefined;
  if (typeof value === 'number' && !Number.isFinite(value)) return undefined;
  return value;
}

function isJsonSchemaScalarValue(value: unknown): value is JsonSchemaScalarValue {
  return value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || typeof value === 'number';
}

function isJsonSchemaGeneratedValueJson(
  value: unknown,
  seen = new Set<object>(),
): value is JsonSchemaGeneratedValueJson {
  if (isJsonSchemaScalarValue(value)) return typeof value !== 'number' || Number.isFinite(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    return value.every((item) => isJsonSchemaGeneratedValueJson(item, seen));
  }
  if (isRecord(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    return Object.values(value).every((child) => isJsonSchemaGeneratedValueJson(child, seen));
  }
  return false;
}

function inferArrayObjectFields(values: unknown[]): ObservedJsonFieldSummary[] {
  const objectValues = values.filter(isRecord);
  const counts = new Map<string, { present: number; types: Set<string> }>();
  for (const item of objectValues) {
    for (const [key, child] of Object.entries(item)) {
      const summary = counts.get(key) ?? { present: 0, types: new Set<string>() };
      summary.present += 1;
      summary.types.add(jsonValueType(child));
      counts.set(key, summary);
    }
  }
  return Array.from(counts.entries())
    .map(([key, summary]) => ({
      path: `$[].${key}`,
      types: Array.from(summary.types).sort(),
      presentCount: summary.present,
      optional: summary.present < objectValues.length,
    }))
    .sort((left, right) => right.presentCount - left.presentCount || left.path.localeCompare(right.path))
    .slice(0, OBSERVED_FIELD_LIMIT);
}

function summarizeSchemaSource(source: JsonSchemaSource): JsonSchemaSourceSummary {
  return {
    kind: source.kind,
    path: source.path,
    label: source.label ?? (source.kind === 'explicit' ? 'Selected schema' : 'Sibling schema'),
  };
}

function jsonPointerToPath(pointer: string): string {
  if (!pointer) return '$';
  return pointer.split('/').slice(1).reduce((path, segment) => {
    const decoded = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    return /^\d+$/.test(decoded) ? `${path}[${decoded}]` : jsonPathForProperty(path, decoded);
  }, '$');
}

function jsonPathForProperty(parentPath: string, property: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(property)
    ? `${parentPath}.${property}`
    : `${parentPath}[${JSON.stringify(property)}]`;
}

function escapeJsonPointerSegment(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function formatEnumValues(schema: unknown): string {
  return Array.isArray(schema)
    ? schema.map((value) => JSON.stringify(value)).join(', ')
    : 'the allowed values';
}

function schemaTypeLabel(schema: Record<string, unknown>): string | null {
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.type)) return schema.type.map(String).join(' | ');
  if (Array.isArray(schema.enum)) return 'enum';
  if (schema.properties) return 'object';
  if (schema.items) return 'array';
  return null;
}

function jsonValueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function normalizeKeyword(keyword: string): string {
  return keyword
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'validation';
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown schema error.');
}
