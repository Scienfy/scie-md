import type { FormatDiagnostic } from '../documentFormat.js';
import { createJsonlContent, parseJsonlDocument, splitJsonlSourceLines } from './parseJsonlDocument.js';
import type { ParsedJsonlDocument } from './parseJsonlDocument.js';

export interface JsonlTextEdit {
  offset: number;
  length: number;
  content: string;
}

export interface JsonlEditPlan {
  edits: JsonlTextEdit[];
  unsupportedReason?: string;
}

export type JsonlVisualEditIntent =
  | {
    kind: 'appendRecord';
    value: unknown;
    expectedSourceHash?: string;
  }
  | {
    kind: 'duplicateRecord';
    lineNumber: number;
    expectedOffset?: number;
    expectedLength?: number;
    expectedLineText?: string;
    expectedSourceHash?: string;
  }
  | {
    kind: 'deleteRecord';
    lineNumber: number;
    expectedOffset?: number;
    expectedLength?: number;
    expectedLineText?: string;
    expectedSourceHash?: string;
  }
  | {
    kind: 'replaceRecord';
    lineNumber: number;
    value: unknown;
    expectedOffset?: number;
    expectedLength?: number;
    expectedLineText?: string;
    expectedSourceHash?: string;
  };

export interface JsonlVisualEditPlan {
  ok: boolean;
  edits: JsonlTextEdit[];
  diagnostics: FormatDiagnostic[];
  previewLabel: string;
  nextSource?: string;
  unsupportedReason?: string;
}

export interface JsonlConversionResult {
  ok: boolean;
  content: string;
  diagnostics: string[];
}

export function applyJsonlEdits(source: string, edits: readonly JsonlTextEdit[]): string {
  return [...edits]
    .sort((left, right) => right.offset - left.offset)
    .reduce((current, edit) => (
      `${current.slice(0, edit.offset)}${edit.content}${current.slice(edit.offset + edit.length)}`
    ), source);
}

export function jsonlSourceHash(source: string): string {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(hash ^ source.charCodeAt(index), 16777619) >>> 0;
  }
  return `${source.length.toString(36)}:${hash.toString(36)}`;
}

export function planJsonlVisualEdit(source: string, intent: JsonlVisualEditIntent): JsonlVisualEditPlan {
  if (intent.expectedSourceHash && intent.expectedSourceHash !== jsonlSourceHash(source)) {
    return unsupportedVisualEdit(
      'jsonl-edit-stale-source',
      'JSONL source changed before this record edit could be applied. Refresh the record list and try again.',
      intentLineNumber(intent),
    );
  }

  const before = parseJsonlDocument(createJsonlContent(source));
  if (!before.parsed) {
    return unsupportedVisualEdit('jsonl-edit-unavailable', 'JSONL records could not be parsed for visual editing.', intentLineNumber(intent));
  }

  const spanCheck = assertExpectedLineSpan(source, intent);
  if (!spanCheck.ok) return spanCheck.plan;

  const targetCheck = assertEditableTarget(before.parsed.lines, intent);
  if (!targetCheck.ok) return targetCheck.plan;

  const editPlan = jsonlEditPlanForIntent(source, intent);
  if (editPlan.unsupportedReason) {
    return unsupportedVisualEdit('jsonl-edit-unsupported', editPlan.unsupportedReason, intentLineNumber(intent));
  }

  const nextSource = applyJsonlEdits(source, editPlan.edits);
  const after = parseJsonlDocument(createJsonlContent(nextSource));
  if (!after.parsed) {
    return unsupportedVisualEdit(
      'jsonl-edit-invalid-result',
      'The JSONL edit was rejected because the resulting record list could not be parsed.',
      intentLineNumber(intent),
    );
  }
  if (after.parsed.invalidLineCount > before.parsed.invalidLineCount) {
    const diagnostic = firstNewInvalidLine(after.diagnostics, before.diagnostics);
    return unsupportedVisualEdit(
      'jsonl-edit-invalid-result',
      diagnostic?.message
        ? `The JSONL edit was rejected because it would create an invalid line. ${diagnostic.message}`
        : 'The JSONL edit was rejected because it would create an invalid line.',
      diagnostic?.line ?? intentLineNumber(intent),
    );
  }

  return {
    ok: true,
    edits: editPlan.edits,
    diagnostics: [],
    previewLabel: previewLabelForIntent(intent, editPlan.edits.length),
    nextSource,
  };
}

export function appendJsonlRecord(source: string, value: unknown): JsonlEditPlan {
  const serialized = serializeJsonlRecord(value);
  if (!serialized.ok) return unsupported(serialized.reason);
  const separator = source.length === 0 || source.endsWith('\n') ? '' : '\n';
  return {
    edits: [{
      offset: source.length,
      length: 0,
      content: `${separator}${serialized.line}\n`,
    }],
  };
}

export function duplicateJsonlRecord(source: string, lineNumber: number): JsonlEditPlan {
  const line = lineByNumber(source, lineNumber);
  if (!line) return unsupported(`Line ${lineNumber} does not exist.`);
  if (line.content.trim().length === 0) return unsupported('Blank JSON Lines records cannot be duplicated.');
  const eol = line.eol || preferredEol(source);
  return {
    edits: [{
      offset: line.offset + line.content.length + line.eol.length,
      length: 0,
      content: `${line.content}${eol}`,
    }],
  };
}

export function deleteJsonlRecord(source: string, lineNumber: number): JsonlEditPlan {
  const lines = splitJsonlSourceLines(source);
  const line = lines.find((candidate) => candidate.line === lineNumber);
  if (!line) return unsupported(`Line ${lineNumber} does not exist.`);
  const length = line.content.length + line.eol.length;
  if (length > 0) {
    return { edits: [{ offset: line.offset, length, content: '' }] };
  }
  const previous = lines.at(-2);
  if (!previous) return { edits: [{ offset: line.offset, length: line.content.length, content: '' }] };
  return {
    edits: [{
      offset: previous.offset + previous.content.length,
      length: previous.eol.length + line.content.length,
      content: '',
    }],
  };
}

export function replaceJsonlRecord(source: string, lineNumber: number, value: unknown): JsonlEditPlan {
  const line = lineByNumber(source, lineNumber);
  if (!line) return unsupported(`Line ${lineNumber} does not exist.`);
  const serialized = serializeJsonlRecord(value);
  if (!serialized.ok) return unsupported(serialized.reason);
  return {
    edits: [{
      offset: line.offset,
      length: line.content.length,
      content: serialized.line,
    }],
  };
}

export function jsonArrayToJsonlPreview(jsonSource: string): JsonlConversionResult {
  try {
    const value = JSON.parse(jsonSource) as unknown;
    if (!Array.isArray(value)) {
      return { ok: false, content: '', diagnostics: ['JSON to JSONL conversion requires a top-level array.'] };
    }
    return {
      ok: true,
      content: `${value.map((item) => JSON.stringify(item)).join('\n')}\n`,
      diagnostics: [],
    };
  } catch (error) {
    return { ok: false, content: '', diagnostics: [error instanceof Error ? error.message : String(error)] };
  }
}

export function jsonlToJsonArrayPreview(jsonlSource: string): JsonlConversionResult {
  const values: unknown[] = [];
  const diagnostics: string[] = [];
  for (const line of splitJsonlSourceLines(jsonlSource)) {
    if (line.content.trim().length === 0) {
      diagnostics.push(`Line ${line.line}: blank lines are not valid JSON Lines records.`);
      continue;
    }
    try {
      values.push(JSON.parse(line.content) as unknown);
    } catch (error) {
      diagnostics.push(`Line ${line.line}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (diagnostics.length > 0) return { ok: false, content: '', diagnostics };
  return { ok: true, content: `${JSON.stringify(values, null, 2)}\n`, diagnostics: [] };
}

function lineByNumber(source: string, lineNumber: number) {
  return splitJsonlSourceLines(source).find((line) => line.line === lineNumber);
}

function jsonlEditPlanForIntent(source: string, intent: JsonlVisualEditIntent): JsonlEditPlan {
  switch (intent.kind) {
    case 'appendRecord':
      return appendJsonlRecord(source, intent.value);
    case 'duplicateRecord':
      return duplicateJsonlRecord(source, intent.lineNumber);
    case 'deleteRecord':
      return deleteJsonlRecord(source, intent.lineNumber);
    case 'replaceRecord':
      return replaceJsonlRecord(source, intent.lineNumber, intent.value);
  }
}

function assertExpectedLineSpan(
  source: string,
  intent: JsonlVisualEditIntent,
): { ok: true } | { ok: false; plan: JsonlVisualEditPlan } {
  if (intent.kind === 'appendRecord') return { ok: true };
  const line = lineByNumber(source, intent.lineNumber);
  if (!line) {
    return {
      ok: false,
      plan: unsupportedVisualEdit('jsonl-edit-missing-line', `Line ${intent.lineNumber} no longer exists.`, intent.lineNumber),
    };
  }
  if (
    (intent.expectedOffset !== undefined && intent.expectedOffset !== line.offset)
    || (intent.expectedLength !== undefined && intent.expectedLength !== line.content.length)
    || (intent.expectedLineText !== undefined && intent.expectedLineText !== line.content)
  ) {
    return {
      ok: false,
      plan: unsupportedVisualEdit(
        'jsonl-edit-stale-line',
        `Line ${intent.lineNumber} changed before this record edit could be applied. Refresh the record list and try again.`,
        intent.lineNumber,
      ),
    };
  }
  return { ok: true };
}

function assertEditableTarget(
  previewLines: ParsedJsonlDocument['lines'],
  intent: JsonlVisualEditIntent,
): { ok: true } | { ok: false; plan: JsonlVisualEditPlan } {
  if (intent.kind === 'appendRecord') return { ok: true };
  const line = previewLines.find((candidate) => candidate.line === intent.lineNumber);
  if (!line) {
    return {
      ok: false,
      plan: unsupportedVisualEdit(
        'jsonl-edit-outside-preview',
        `Line ${intent.lineNumber} is outside the bounded visual preview. Use source mode for this record.`,
        intent.lineNumber,
      ),
    };
  }
  if (!line.valid) {
    return {
      ok: false,
      plan: unsupportedVisualEdit(
        'jsonl-edit-invalid-line',
        `Line ${intent.lineNumber} is invalid. Fix it in source mode before using record actions.`,
        intent.lineNumber,
      ),
    };
  }
  return { ok: true };
}

function firstNewInvalidLine(
  afterDiagnostics: readonly FormatDiagnostic[],
  beforeDiagnostics: readonly FormatDiagnostic[],
): FormatDiagnostic | undefined {
  const beforeKeys = new Set(beforeDiagnostics.map((diagnostic) => diagnosticKey(diagnostic)));
  return afterDiagnostics.find((diagnostic) => diagnostic.severity === 'error' && !beforeKeys.has(diagnosticKey(diagnostic)));
}

function diagnosticKey(diagnostic: FormatDiagnostic): string {
  return `${diagnostic.code}:${diagnostic.line ?? 0}:${diagnostic.column ?? 0}:${diagnostic.message}`;
}

function previewLabelForIntent(intent: JsonlVisualEditIntent, editCount: number): string {
  if (editCount === 0) return 'No JSONL changes to apply.';
  switch (intent.kind) {
    case 'appendRecord':
      return 'Appended JSONL record.';
    case 'duplicateRecord':
      return `Duplicated JSONL line ${intent.lineNumber}.`;
    case 'deleteRecord':
      return `Deleted JSONL line ${intent.lineNumber}.`;
    case 'replaceRecord':
      return `Replaced JSONL line ${intent.lineNumber}.`;
  }
}

function intentLineNumber(intent: JsonlVisualEditIntent): number | undefined {
  return intent.kind === 'appendRecord' ? undefined : intent.lineNumber;
}

function unsupportedVisualEdit(code: string, reason: string, line?: number): JsonlVisualEditPlan {
  return {
    ok: false,
    edits: [],
    diagnostics: [{
      severity: 'warning',
      code,
      message: reason,
      line,
      source: 'jsonl',
      category: 'edit',
      blocking: true,
    }],
    previewLabel: 'JSONL edit unavailable',
    unsupportedReason: reason,
  };
}

function preferredEol(source: string): string {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

function serializeJsonlRecord(value: unknown): { ok: true; line: string } | { ok: false; reason: string } {
  const line = JSON.stringify(value);
  if (line === undefined) return { ok: false, reason: 'Only JSON-serializable records can be written.' };
  if (line.includes('\n') || line.includes('\r')) return { ok: false, reason: 'JSON Lines records must serialize to one line.' };
  return { ok: true, line };
}

function unsupported(reason: string): JsonlEditPlan {
  return { edits: [], unsupportedReason: reason };
}
