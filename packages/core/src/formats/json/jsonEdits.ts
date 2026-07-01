import { applyEdits, findNodeAtLocation, modify, parseTree } from 'jsonc-parser';
import type { Edit as JsoncEdit, FormattingOptions, JSONPath, ModificationOptions, Node as JsonNode, ParseError, ParseOptions } from 'jsonc-parser';
import type { FormatDiagnostic, StructuredPathSegment } from '../documentFormat.js';
import type { JsonSchemaValidationResult } from '../schema/jsonSchemaValidation.js';
import {
  validateJsonValueAgainstSchema,
  jsonSchemaObjectControlForPath,
  jsonSchemaScalarControlForPath,
  jsonSchemaScalarValueMatchesControl,
} from '../schema/jsonSchemaValidation.js';
import { displayPathFromPath, pointerFromPath } from '../structured/sourceMap.js';

const STRICT_JSON_PARSE_OPTIONS: ParseOptions = {
  allowEmptyContent: false,
  allowTrailingComma: false,
  disallowComments: true,
};

const DEFAULT_JSON_FORMATTING_OPTIONS: FormattingOptions = {
  insertSpaces: true,
  tabSize: 2,
  eol: '\n',
};

const JSON_NUMBER_TOKEN_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const RAW_JSON_SENTINEL_PREFIX = '__SCIE_MD_RAW_JSON_TOKEN__';

export type JsonEditPath = JSONPath;
export type JsonScalarValue = string | number | boolean | null;
export interface JsonRawNumberToken {
  kind: 'raw-json-number';
  raw: string;
}

export interface JsonRawValueToken {
  kind: 'raw-json-value';
  raw: string;
}

export type JsonEditableScalarValue = JsonScalarValue | JsonRawNumberToken;
export type JsonEditableValue =
  | JsonEditableScalarValue
  | JsonRawValueToken
  | { [key: string]: JsonEditableValue }
  | JsonEditableValue[];

export interface JsonTextEdit {
  offset: number;
  length: number;
  content: string;
}

export interface JsonEditPlan {
  edits: JsonTextEdit[];
  unsupportedReason?: string;
}

export interface JsonEditOptions {
  formattingOptions?: FormattingOptions;
  schemaValidation?: JsonSchemaValidationResult | null;
}

export type JsonVisualEditIntent =
  | {
    kind: 'replaceScalar';
    path: JsonEditPath;
    nextValue: JsonEditableScalarValue;
    expectedSourceHash?: string;
  }
  | {
    kind: 'renameObjectKey';
    path: JsonEditPath;
    newKey: string;
    expectedSourceHash?: string;
  }
  | {
    kind: 'addObjectField';
    path: JsonEditPath;
    key: string;
    value: JsonEditableValue;
    schemaGeneratedValueExplanation?: string;
    expectedSourceHash?: string;
  }
  | {
    kind: 'deleteObjectField';
    path: JsonEditPath;
    expectedSourceHash?: string;
  }
  | {
    kind: 'addArrayItem';
    path: JsonEditPath;
    index?: number;
    value: JsonEditableValue;
    schemaGeneratedValueExplanation?: string;
    expectedSourceHash?: string;
  }
  | {
    kind: 'deleteArrayItem';
    path: JsonEditPath;
    expectedSourceHash?: string;
  };

export interface JsonVisualEditPlan {
  ok: boolean;
  edits: JsonTextEdit[];
  diagnostics: FormatDiagnostic[];
  previewLabel: string;
  nextSource?: string;
  unsupportedReason?: string;
}

export interface JsonEditSourcePreviewRange {
  offset: number;
  length: number;
  endOffset: number;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  insertedLength: number;
  removedLength: number;
}

export interface JsonEditSourcePreview {
  previewLabel: string;
  riskLabel: string;
  editCount: number;
  range: JsonEditSourcePreviewRange;
  beforeSnippet: string;
  afterSnippet: string;
  beforeTruncated: boolean;
  afterTruncated: boolean;
}

export interface JsonEditSourcePreviewOptions {
  contextCharacters?: number;
  maxSnippetCharacters?: number;
}

export function applyJsonEdits(source: string, edits: readonly JsonTextEdit[]): string {
  return applyEdits(source, edits.map((edit) => ({ ...edit })));
}

export function jsonSourceHash(source: string): string {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(hash ^ source.charCodeAt(index), 16777619) >>> 0;
  }
  return `${source.length.toString(36)}:${hash.toString(36)}`;
}

export function isValidJsonNumberToken(raw: string): boolean {
  return raw.length > 0 && raw === raw.trim() && JSON_NUMBER_TOKEN_PATTERN.test(raw);
}

export function createJsonRawNumberToken(raw: string): JsonRawNumberToken | null {
  const trimmed = raw.trim();
  return isValidJsonNumberToken(trimmed)
    ? { kind: 'raw-json-number', raw: trimmed }
    : null;
}

export function createJsonRawValueToken(raw: string): JsonRawValueToken | null {
  return isValidJsonRawValueSource(raw)
    ? { kind: 'raw-json-value', raw }
    : null;
}

export function planJsonVisualEdit(
  source: string,
  intent: JsonVisualEditIntent,
  options: JsonEditOptions = {},
): JsonVisualEditPlan {
  if (intent.expectedSourceHash && intent.expectedSourceHash !== jsonSourceHash(source)) {
    return unsupportedEditPlan(
      'json-edit-stale-source',
      'JSON source changed before this visual edit could be applied. Re-select the node and try again.',
      intent.path,
    );
  }

  const root = parseStrictJsonTree(source);
  if (!root.ok) return unsupportedEditPlan('json-edit-invalid-source', root.reason, intent.path);

  const duplicateKey = findDuplicateObjectKey(root.root, []);
  if (duplicateKey) {
    return unsupportedEditPlan(
      'json-edit-duplicate-keys',
      `Resolve duplicate key "${duplicateKey.key}" at ${displayPathFromPath(duplicateKey.path)} before using visual JSON edits.`,
      duplicateKey.path,
    );
  }

  const schemaConstraint = validateIntentAgainstSchema(source, intent, options.schemaValidation ?? null);
  if (!schemaConstraint.ok) {
    return unsupportedEditPlan(
      'json-edit-schema-constraint',
      schemaConstraint.reason,
      schemaConstraint.path,
    );
  }

  const helperPlan = planJsonEditForIntent(source, root.root, intent, options);
  if (helperPlan.unsupportedReason) {
    return unsupportedEditPlan('json-edit-unsupported', helperPlan.unsupportedReason, intent.path);
  }

  const nextSource = applyJsonEdits(source, helperPlan.edits);
  const nextRoot = parseStrictJsonTree(nextSource);
  if (!nextRoot.ok) {
    return unsupportedEditPlan(
      'json-edit-invalid-result',
      `The visual edit was rejected because the resulting JSON would not parse. ${nextRoot.reason}`,
      intent.path,
    );
  }
  const schemaResult = validateEditedJsonAgainstSchema(nextSource, options.schemaValidation ?? null);
  if (!schemaResult.ok) {
    return unsupportedEditPlan('json-edit-schema-result-invalid', schemaResult.reason, intent.path);
  }

  return {
    ok: true,
    edits: helperPlan.edits,
    diagnostics: [],
    previewLabel: previewLabelForIntent(intent, helperPlan.edits.length),
    nextSource,
  };
}

export function createJsonEditSourcePreview(
  source: string,
  plan: JsonVisualEditPlan,
  options: JsonEditSourcePreviewOptions = {},
): JsonEditSourcePreview | null {
  if (!plan.ok || plan.nextSource === undefined) return null;
  const contextCharacters = Math.max(0, options.contextCharacters ?? 120);
  const maxSnippetCharacters = Math.max(80, options.maxSnippetCharacters ?? 520);
  const range = sourcePreviewRange(source, plan.edits);
  const afterEndOffset = range.offset + range.insertedLength;
  const before = boundedSnippet(source, range.offset, range.endOffset, contextCharacters, maxSnippetCharacters);
  const after = boundedSnippet(plan.nextSource, range.offset, afterEndOffset, contextCharacters, maxSnippetCharacters);

  return {
    previewLabel: plan.previewLabel,
    riskLabel: sourcePreviewRiskLabel(range, plan.edits.length),
    editCount: plan.edits.length,
    range,
    beforeSnippet: before.text,
    afterSnippet: after.text,
    beforeTruncated: before.truncated,
    afterTruncated: after.truncated,
  };
}

export function replaceJsonScalarAtPath(
  source: string,
  path: JsonEditPath,
  nextValue: JsonEditableScalarValue,
): JsonEditPlan {
  const root = parseStrictJsonTree(source);
  if (!root.ok) return unsupported(root.reason);
  const node = findNodeAtLocation(root.root, path);
  if (!node) return unsupported(`No JSON value exists at ${formatPath(path)}.`);
  if (!isScalarNode(node)) return unsupported(`Only scalar JSON values can be replaced at ${formatPath(path)}.`);
  if (!isSerializableJsonEditableScalar(nextValue)) return unsupported('Only finite JSON scalar values can be written.');
  return {
    edits: [{
      offset: node.offset,
      length: node.length,
      content: serializeJsonEditableScalar(nextValue),
    }],
  };
}

export function renameJsonObjectKey(
  source: string,
  objectPath: JsonEditPath,
  oldKey: string,
  newKey: string,
): JsonEditPlan {
  if (!newKey) return unsupported('JSON object keys cannot be empty in visual edit mode.');
  if (oldKey === newKey) return { edits: [] };
  const root = parseStrictJsonTree(source);
  if (!root.ok) return unsupported(root.reason);
  const objectNode = findNodeAtLocation(root.root, objectPath);
  if (!objectNode || objectNode.type !== 'object') return unsupported(`Expected a JSON object at ${formatPath(objectPath)}.`);
  const existingKeys = objectPropertyKeys(objectNode);
  if (existingKeys.filter((key) => key === oldKey).length !== 1) {
    return unsupported(`Key "${oldKey}" is missing or duplicated at ${formatPath(objectPath)}.`);
  }
  if (existingKeys.includes(newKey)) return unsupported(`Key "${newKey}" already exists at ${formatPath(objectPath)}.`);
  const propertyNode = objectNode.children?.find((child) => child.type === 'property' && child.children?.[0]?.value === oldKey);
  const keyNode = propertyNode?.children?.[0];
  if (!keyNode) return unsupported(`Key "${oldKey}" could not be located at ${formatPath(objectPath)}.`);
  return {
    edits: [{
      offset: keyNode.offset,
      length: keyNode.length,
      content: JSON.stringify(newKey),
    }],
  };
}

export function addJsonObjectField(
  source: string,
  objectPath: JsonEditPath,
  key: string,
  value: JsonEditableValue,
  options: JsonEditOptions = {},
): JsonEditPlan {
  if (!key) return unsupported('JSON object keys cannot be empty in visual edit mode.');
  if (!isSerializableJsonEditableValue(value)) return unsupported('Only finite JSON-compatible values can be added in visual edit mode.');
  const root = parseStrictJsonTree(source);
  if (!root.ok) return unsupported(root.reason);
  const objectNode = findNodeAtLocation(root.root, objectPath);
  if (!objectNode || objectNode.type !== 'object') return unsupported(`Expected a JSON object at ${formatPath(objectPath)}.`);
  if (objectPropertyKeys(objectNode).includes(key)) return unsupported(`Key "${key}" already exists at ${formatPath(objectPath)}.`);
  const preparedValue = createJsoncValueWithRawTokenSentinels(value);
  return {
    edits: toJsonTextEditsPreservingRawTokens(modify(source, [...objectPath, key], preparedValue.value, {
      formattingOptions: options.formattingOptions ?? formattingOptionsForSource(source),
    }), preparedValue.sentinels),
  };
}

export function insertJsonArrayItem(
  source: string,
  arrayPath: JsonEditPath,
  index: number,
  value: JsonEditableValue,
  options: JsonEditOptions = {},
): JsonEditPlan {
  if (!Number.isInteger(index) || index < 0) return unsupported('Array insertion index must be a non-negative integer.');
  if (!isSerializableJsonEditableValue(value)) return unsupported('Only finite JSON-compatible values can be added to arrays in visual edit mode.');
  const root = parseStrictJsonTree(source);
  if (!root.ok) return unsupported(root.reason);
  const arrayNode = findNodeAtLocation(root.root, arrayPath);
  if (!arrayNode || arrayNode.type !== 'array') return unsupported(`Expected a JSON array at ${formatPath(arrayPath)}.`);
  const length = arrayNode.children?.length ?? 0;
  if (index > length) return unsupported(`Array insertion index ${index} is outside ${formatPath(arrayPath)}.`);
  const preparedValue = createJsoncValueWithRawTokenSentinels(value);
  return {
    edits: toJsonTextEditsPreservingRawTokens(modify(source, [...arrayPath, index], preparedValue.value, {
      formattingOptions: options.formattingOptions ?? formattingOptionsForSource(source),
      isArrayInsertion: true,
    }), preparedValue.sentinels),
  };
}

export function removeJsonArrayItem(
  source: string,
  arrayPath: JsonEditPath,
  index: number,
  options: JsonEditOptions = {},
): JsonEditPlan {
  if (!Number.isInteger(index) || index < 0) return unsupported('Array removal index must be a non-negative integer.');
  const root = parseStrictJsonTree(source);
  if (!root.ok) return unsupported(root.reason);
  const arrayNode = findNodeAtLocation(root.root, arrayPath);
  if (!arrayNode || arrayNode.type !== 'array') return unsupported(`Expected a JSON array at ${formatPath(arrayPath)}.`);
  const length = arrayNode.children?.length ?? 0;
  if (index >= length) return unsupported(`Array removal index ${index} is outside ${formatPath(arrayPath)}.`);
  return {
    edits: toJsonTextEdits(modify(source, [...arrayPath, index], undefined, {
      formattingOptions: options.formattingOptions ?? formattingOptionsForSource(source),
    })),
  };
}

export function deleteJsonObjectField(
  source: string,
  objectPath: JsonEditPath,
  key: string,
  options: JsonEditOptions = {},
): JsonEditPlan {
  if (!key) return unsupported('JSON object keys cannot be empty in visual edit mode.');
  const root = parseStrictJsonTree(source);
  if (!root.ok) return unsupported(root.reason);
  const objectNode = findNodeAtLocation(root.root, objectPath);
  if (!objectNode || objectNode.type !== 'object') return unsupported(`Expected a JSON object at ${formatPath(objectPath)}.`);
  const existingKeys = objectPropertyKeys(objectNode);
  if (existingKeys.filter((candidate) => candidate === key).length !== 1) {
    return unsupported(`Key "${key}" is missing or duplicated at ${formatPath(objectPath)}.`);
  }
  return {
    edits: toJsonTextEdits(modify(source, [...objectPath, key], undefined, {
      formattingOptions: options.formattingOptions ?? formattingOptionsForSource(source),
    })),
  };
}

export function jsonFormattingPolicyForSource(source: string): FormattingOptions {
  return formattingOptionsForSource(source);
}

export function replaceJsonValueAtPathWithRawSource(
  source: string,
  path: JsonEditPath,
  rawValueSource: string,
  options: ModificationOptions = {},
): JsonEditPlan {
  if (!isValidJsonRawValueSource(rawValueSource)) {
    return unsupported(`Raw JSON source for ${formatPath(path)} is not a complete strict JSON value.`);
  }
  const root = parseStrictJsonTree(source);
  if (!root.ok) return unsupported(root.reason);
  try {
    const preparedValue = createJsoncValueWithRawTokenSentinels({ kind: 'raw-json-value', raw: rawValueSource });
    return {
      edits: toJsonTextEditsPreservingRawTokens(modify(
        source,
        path,
        preparedValue.value,
        options,
      ), preparedValue.sentinels),
    };
  } catch (error) {
    return unsupported(error instanceof Error ? error.message : `Could not write raw JSON value at ${formatPath(path)}.`);
  }
}

function planJsonEditForIntent(
  source: string,
  root: JsonNode,
  intent: JsonVisualEditIntent,
  options: JsonEditOptions,
): JsonEditPlan {
  switch (intent.kind) {
    case 'replaceScalar':
      return replaceJsonScalarAtPath(source, intent.path, intent.nextValue);
    case 'renameObjectKey': {
      const target = objectFieldTarget(intent.path);
      if (!target) return unsupported(`Expected an object field at ${formatPath(intent.path)}.`);
      return renameJsonObjectKey(source, target.objectPath, target.key, intent.newKey);
    }
    case 'addObjectField':
      return addJsonObjectField(source, intent.path, intent.key, intent.value, options);
    case 'deleteObjectField': {
      const target = objectFieldTarget(intent.path);
      if (!target) return unsupported(`Expected an object field at ${formatPath(intent.path)}.`);
      return deleteJsonObjectField(source, target.objectPath, target.key, options);
    }
    case 'addArrayItem': {
      const node = findNodeAtLocation(root, intent.path);
      const index = intent.index ?? (node?.type === 'array' ? node.children?.length ?? 0 : 0);
      return insertJsonArrayItem(source, intent.path, index, intent.value, options);
    }
    case 'deleteArrayItem': {
      const target = arrayItemTarget(intent.path);
      if (!target) return unsupported(`Expected an array item at ${formatPath(intent.path)}.`);
      return removeJsonArrayItem(source, target.arrayPath, target.index, options);
    }
  }
}

function validateIntentAgainstSchema(
  source: string,
  intent: JsonVisualEditIntent,
  schemaValidation: JsonSchemaValidationResult | null,
): { ok: true } | { ok: false; reason: string; path: StructuredPathSegment[] } {
  const summary = schemaValidation?.status === 'schema-invalid' ? null : schemaValidation?.summary;
  if (!summary) return { ok: true };

  const sourceValue = JSON.parse(source) as unknown;
  if (intent.kind === 'replaceScalar') {
    const control = jsonSchemaScalarControlForPath(summary, displayPathFromPath(intent.path));
    if (!control) return { ok: true };
    if (!control.canEditScalar) {
      return {
        ok: false,
        reason: control.unsupportedReason ?? `Schema does not describe ${displayPathFromPath(intent.path)} as a scalar value.`,
        path: intent.path,
      };
    }
    const schemaValue = schemaComparableScalarValue(intent.nextValue);
    if (schemaValue === undefined || !jsonSchemaScalarValueMatchesControl(schemaValue, control)) {
      return {
        ok: false,
        reason: schemaValueMismatchReason(displayPathFromPath(intent.path), intent.nextValue, control.enumValues),
        path: intent.path,
      };
    }
    return { ok: true };
  }

  if (intent.kind === 'addObjectField') {
    const objectPath = displayPathFromPath(intent.path);
    const objectValue = valueAtPath(sourceValue, intent.path);
    const objectControl = jsonSchemaObjectControlForPath(summary, objectPath, objectValue);
    if (!objectControl) return { ok: true };
    const field = objectControl.fields.find((candidate) => candidate.key === intent.key);
    const nextPath = [...intent.path, intent.key];
    if (!field) {
      if (!objectControl.additionalPropertiesAllowed) {
        return {
          ok: false,
          reason: `Schema does not allow additional field ${displayPathFromPath(nextPath)}.`,
          path: nextPath,
        };
      }
      return { ok: true };
    }
    if (field.canEditScalar) {
      if (!isJsonEditableScalarValue(intent.value)) {
        return {
          ok: false,
          reason: `Schema field ${field.path} expects a scalar value.`,
          path: nextPath,
        };
      }
      const schemaValue = schemaComparableScalarValue(intent.value);
      if (schemaValue === undefined || !jsonSchemaScalarValueMatchesControl(schemaValue, field)) {
        return {
          ok: false,
          reason: schemaValueMismatchReason(field.path, intent.value, field.enumValues),
          path: nextPath,
        };
      }
      return { ok: true };
    }
    if (field.generatedValue) {
      if (!jsonEditableValuesEqual(intent.value, field.generatedValue.value)) {
        return {
          ok: false,
          reason: `Schema field ${field.path} must use its generated ${field.generatedValue.kind} default.`,
          path: nextPath,
        };
      }
      return { ok: true };
    }
    return {
      ok: false,
      reason: field.unsupportedReason ?? `Schema field ${field.path} cannot be generated safely.`,
      path: nextPath,
    };
  }

  if (intent.kind === 'renameObjectKey') {
    const target = objectFieldTarget(intent.path);
    if (!target) return { ok: true };
    const objectValue = valueAtPath(sourceValue, target.objectPath);
    const objectControl = jsonSchemaObjectControlForPath(summary, displayPathFromPath(target.objectPath), objectValue);
    if (!objectControl) return { ok: true };
    const field = objectControl.fields.find((candidate) => candidate.key === intent.newKey);
    if (!field && !objectControl.additionalPropertiesAllowed) {
      return {
        ok: false,
        reason: `Schema does not allow additional field ${displayPathFromPath([...target.objectPath, intent.newKey])}.`,
        path: [...target.objectPath, intent.newKey],
      };
    }
    const currentValue = valueAtPath(sourceValue, intent.path);
    if (field?.canEditScalar) {
      if (isJsonScalarValue(currentValue) && !jsonSchemaScalarValueMatchesControl(currentValue, field)) {
        return {
          ok: false,
          reason: schemaValueMismatchReason(field.path, currentValue, field.enumValues),
          path: intent.path,
        };
      }
    } else if (field?.generatedValue && !jsonEditableValuesEqual(currentValue, field.generatedValue.value)) {
      return {
        ok: false,
        reason: `Schema field ${field.path} must use its generated ${field.generatedValue.kind} default.`,
        path: intent.path,
      };
    }
  }

  return { ok: true };
}

function validateEditedJsonAgainstSchema(
  nextSource: string,
  schemaValidation: JsonSchemaValidationResult | null,
): { ok: true } | { ok: false; reason: string } {
  if (schemaValidation?.status !== 'valid' || !schemaValidation.schemaSource) return { ok: true };
  const result = validateJsonValueAgainstSchema(JSON.parse(nextSource), schemaValidation.schemaSource);
  if (result.status === 'valid') return { ok: true };
  if (result.status === 'schema-invalid') {
    return { ok: false, reason: 'JSON Schema could not be revalidated after the visual edit.' };
  }
  return {
    ok: false,
    reason: result.diagnostics[0]?.message ?? 'The visual edit would make the JSON invalid against the active schema.',
  };
}

function schemaValueMismatchReason(
  path: string,
  value: JsonEditableScalarValue,
  enumValues: readonly JsonScalarValue[],
): string {
  if (enumValues.length > 0) {
    return `Value ${formatScalarValue(value)} is not one of the schema enum options for ${path}.`;
  }
  return `Value ${formatScalarValue(value)} does not match the schema type for ${path}.`;
}

function valueAtPath(value: unknown, path: readonly StructuredPathSegment[]): unknown {
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === 'number') {
      current = current[segment];
    } else if (current !== null && typeof current === 'object' && !Array.isArray(current) && typeof segment === 'string') {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function isJsonScalarValue(value: unknown): value is JsonScalarValue {
  return value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || typeof value === 'number';
}

function isJsonEditableScalarValue(value: unknown): value is JsonEditableScalarValue {
  return isJsonScalarValue(value) || isJsonRawNumberToken(value);
}

function schemaComparableScalarValue(value: JsonEditableScalarValue): JsonScalarValue | undefined {
  if (isJsonRawNumberToken(value)) {
    const parsed = Number(value.raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return value;
}

function jsonEditableValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(jsonEditableValueForComparison(left)) === JSON.stringify(jsonEditableValueForComparison(right));
}

function formatScalarValue(value: JsonEditableScalarValue): string {
  if (isJsonRawNumberToken(value)) return value.raw;
  return JSON.stringify(value) ?? String(value);
}

function unsupportedEditPlan(
  code: string,
  reason: string,
  path: readonly StructuredPathSegment[] = [],
): JsonVisualEditPlan {
  return {
    ok: false,
    edits: [],
    diagnostics: [{
      severity: 'warning',
      code,
      message: reason,
      source: 'json',
      category: 'edit',
      path: [...path],
      pointer: pointerFromPath(path),
      displayPath: displayPathFromPath(path),
      blocking: true,
    }],
    previewLabel: 'JSON edit unavailable',
    unsupportedReason: reason,
  };
}

function previewLabelForIntent(intent: JsonVisualEditIntent, editCount: number): string {
  if (editCount === 0) return 'No JSON changes to apply.';
  switch (intent.kind) {
    case 'replaceScalar':
      return `Updated ${displayPathFromPath(intent.path)}.`;
    case 'renameObjectKey':
      return `Renamed ${displayPathFromPath(intent.path)}.`;
    case 'addObjectField':
      return `Added ${displayPathFromPath([...intent.path, intent.key])}.`;
    case 'deleteObjectField':
      return `Deleted ${displayPathFromPath(intent.path)}.`;
    case 'addArrayItem':
      return `Added item to ${displayPathFromPath(intent.path)}.`;
    case 'deleteArrayItem':
      return `Deleted ${displayPathFromPath(intent.path)}.`;
  }
}

function sourcePreviewRange(source: string, edits: readonly JsonTextEdit[]): JsonEditSourcePreviewRange {
  if (edits.length === 0) {
    const position = lineColumnForOffset(source, 0);
    return {
      offset: 0,
      length: 0,
      endOffset: 0,
      line: position.line,
      column: position.column,
      endLine: position.line,
      endColumn: position.column,
      insertedLength: 0,
      removedLength: 0,
    };
  }

  const offset = Math.min(...edits.map((edit) => edit.offset));
  const endOffset = Math.max(...edits.map((edit) => edit.offset + edit.length));
  const start = lineColumnForOffset(source, offset);
  const end = lineColumnForOffset(source, endOffset);
  return {
    offset,
    length: endOffset - offset,
    endOffset,
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
    insertedLength: edits.reduce((total, edit) => total + edit.content.length, 0),
    removedLength: edits.reduce((total, edit) => total + edit.length, 0),
  };
}

function sourcePreviewRiskLabel(range: JsonEditSourcePreviewRange, editCount: number): string {
  if (editCount === 0 || (range.insertedLength === 0 && range.removedLength === 0)) return 'No source change';
  if (editCount > 1) return 'Multiple source ranges';
  if (range.insertedLength > 240 || range.removedLength > 240) return 'Large source range';
  if (range.insertedLength > 0 && range.removedLength > 0) return 'Replace source range';
  if (range.insertedLength > 0) return 'Insert source range';
  return 'Delete source range';
}

function boundedSnippet(
  source: string,
  startOffset: number,
  endOffset: number,
  contextCharacters: number,
  maxSnippetCharacters: number,
): { text: string; truncated: boolean } {
  const snippetStart = Math.max(0, startOffset - contextCharacters);
  const snippetEnd = Math.min(source.length, endOffset + contextCharacters);
  const prefix = snippetStart > 0 ? '...\n' : '';
  const suffix = snippetEnd < source.length ? '\n...' : '';
  let text = `${prefix}${source.slice(snippetStart, snippetEnd)}${suffix}`;
  let truncated = snippetStart > 0 || snippetEnd < source.length;
  if (text.length <= maxSnippetCharacters) return { text, truncated };

  const headLength = Math.max(20, Math.floor((maxSnippetCharacters - 6) / 2));
  const tailLength = Math.max(20, maxSnippetCharacters - 6 - headLength);
  text = `${text.slice(0, headLength)}\n...\n${text.slice(Math.max(headLength, text.length - tailLength))}`;
  truncated = true;
  return { text, truncated };
}

function lineColumnForOffset(source: string, requestedOffset: number): { line: number; column: number } {
  const offset = Math.max(0, Math.min(requestedOffset, source.length));
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset; index += 1) {
    const char = source[index];
    if (char === '\r') {
      if (source[index + 1] === '\n') index += 1;
      line += 1;
      column = 1;
    } else if (char === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function parseStrictJsonTree(source: string): { ok: true; root: JsonNode } | { ok: false; reason: string } {
  const errors: ParseError[] = [];
  const root = parseTree(source, errors, STRICT_JSON_PARSE_OPTIONS);
  if (errors.length > 0 || !root) return { ok: false, reason: 'JSON source must be valid before visual edits are enabled.' };
  return { ok: true, root };
}

function isScalarNode(node: JsonNode): boolean {
  return node.type === 'string'
    || node.type === 'number'
    || node.type === 'boolean'
    || node.type === 'null';
}

function isSerializableJsonScalar(value: JsonScalarValue): boolean {
  return typeof value !== 'number' || Number.isFinite(value);
}

function isSerializableJsonEditableScalar(value: JsonEditableScalarValue): boolean {
  return isJsonRawNumberToken(value)
    ? isValidJsonNumberToken(value.raw)
    : isSerializableJsonScalar(value);
}

function isSerializableJsonEditableValue(
  value: unknown,
  seen = new Set<object>(),
): value is JsonEditableValue {
  if (isJsonRawNumberToken(value)) return isValidJsonNumberToken(value.raw);
  if (isJsonRawValueToken(value)) return isValidJsonRawValueSource(value.raw);
  if (isJsonScalarValue(value)) return isSerializableJsonScalar(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    return value.every((item) => isSerializableJsonEditableValue(item, seen));
  }
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return false;
    seen.add(value);
    return Object.values(value).every((child) => isSerializableJsonEditableValue(child, seen));
  }
  return false;
}

function serializeJsonEditableScalar(value: JsonEditableScalarValue): string {
  if (isJsonRawNumberToken(value)) return value.raw;
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function isJsonRawNumberToken(value: unknown): value is JsonRawNumberToken {
  return isRecord(value) && value.kind === 'raw-json-number' && typeof value.raw === 'string';
}

function isJsonRawValueToken(value: unknown): value is JsonRawValueToken {
  return isRecord(value) && value.kind === 'raw-json-value' && typeof value.raw === 'string';
}

function isValidJsonRawValueSource(rawValueSource: string): boolean {
  const errors: ParseError[] = [];
  const root = parseTree(rawValueSource, errors, STRICT_JSON_PARSE_OPTIONS);
  return errors.length === 0 && Boolean(root);
}

interface RawTokenSentinel {
  sentinel: string;
  raw: string;
}

function createJsoncValueWithRawTokenSentinels(value: JsonEditableValue): {
  value: unknown;
  sentinels: RawTokenSentinel[];
} {
  const sentinels: RawTokenSentinel[] = [];
  return {
    value: rawTokensToJsoncValue(value, sentinels),
    sentinels,
  };
}

function rawTokensToJsoncValue(
  value: JsonEditableValue,
  sentinels: RawTokenSentinel[] = [],
  seen = new Set<object>(),
): unknown {
  if (isJsonRawNumberToken(value) || isJsonRawValueToken(value)) {
    const sentinel = `${RAW_JSON_SENTINEL_PREFIX}${sentinels.length}_${Math.random().toString(36).slice(2)}`;
    sentinels.push({ sentinel, raw: value.raw });
    return sentinel;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return null;
    seen.add(value);
    return value.map((item) => rawTokensToJsoncValue(item, sentinels, seen));
  }
  if (isRecord(value)) {
    if (seen.has(value)) return null;
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, rawTokensToJsoncValue(child, sentinels, seen)]),
    );
  }
  return value;
}

function toJsonTextEditsPreservingRawTokens(
  edits: JsoncEdit[],
  sentinels: readonly RawTokenSentinel[],
): JsonTextEdit[] {
  return edits.map((edit) => {
    let content = edit.content;
    for (const { sentinel, raw } of sentinels) {
      content = content.split(JSON.stringify(sentinel)).join(raw);
    }
    return {
      offset: edit.offset,
      length: edit.length,
      content,
    };
  });
}

function jsonEditableValueForComparison(value: unknown): unknown {
  if (isJsonRawNumberToken(value)) return Number(value.raw);
  if (isJsonRawValueToken(value)) {
    const errors: ParseError[] = [];
    return parseTree(value.raw, errors, STRICT_JSON_PARSE_OPTIONS) && errors.length === 0
      ? JSON.parse(value.raw)
      : value.raw;
  }
  if (Array.isArray(value)) return value.map((child) => jsonEditableValueForComparison(child));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, jsonEditableValueForComparison(child)]),
    );
  }
  return value;
}

function objectPropertyKeys(node: JsonNode): string[] {
  return (node.children ?? [])
    .filter((child) => child.type === 'property')
    .map((property) => property.children?.[0]?.value)
    .filter((value): value is string => typeof value === 'string');
}

function objectFieldTarget(path: JsonEditPath): { objectPath: JsonEditPath; key: string } | null {
  const key = path[path.length - 1];
  if (typeof key !== 'string') return null;
  return {
    objectPath: path.slice(0, -1),
    key,
  };
}

function arrayItemTarget(path: JsonEditPath): { arrayPath: JsonEditPath; index: number } | null {
  const index = path[path.length - 1];
  if (typeof index !== 'number') return null;
  return {
    arrayPath: path.slice(0, -1),
    index,
  };
}

function findDuplicateObjectKey(
  node: JsonNode,
  path: StructuredPathSegment[],
): { key: string; path: StructuredPathSegment[] } | null {
  if (node.type === 'object') {
    const seen = new Set<string>();
    for (const property of node.children ?? []) {
      const keyNode = property.children?.[0];
      const valueNode = property.children?.[1];
      const key = typeof keyNode?.value === 'string' ? keyNode.value : null;
      if (!key || !valueNode) continue;
      const childPath = [...path, key];
      if (seen.has(key)) return { key, path: childPath };
      seen.add(key);
      const duplicate = findDuplicateObjectKey(valueNode, childPath);
      if (duplicate) return duplicate;
    }
    return null;
  }
  if (node.type === 'array') {
    for (const [index, child] of (node.children ?? []).entries()) {
      const duplicate = findDuplicateObjectKey(child, [...path, index]);
      if (duplicate) return duplicate;
    }
  }
  return null;
}

function formattingOptionsForSource(source: string): FormattingOptions {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const indent = firstIndent(source);
  return {
    ...DEFAULT_JSON_FORMATTING_OPTIONS,
    eol,
    insertSpaces: !indent.startsWith('\t'),
    tabSize: indent.startsWith('\t') ? 1 : Math.max(2, indent.length || 2),
  };
}

function firstIndent(source: string): string {
  const match = source.match(/(?:^|\r?\n)([ \t]+)"/);
  return match?.[1] ?? '';
}

function formatPath(path: JsonEditPath): string {
  if (path.length === 0) return '$';
  return path.reduce<string>((current, segment) => (
    typeof segment === 'number'
      ? `${current}[${segment}]`
      : /^[A-Za-z_$][\w$]*$/.test(segment)
        ? `${current}.${segment}`
        : `${current}[${JSON.stringify(segment)}]`
  ), '$');
}

function unsupported(reason: string): JsonEditPlan {
  return { edits: [], unsupportedReason: reason };
}

function toJsonTextEdits(edits: JsoncEdit[]): JsonTextEdit[] {
  return edits.map((edit) => ({
    offset: edit.offset,
    length: edit.length,
    content: edit.content,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
