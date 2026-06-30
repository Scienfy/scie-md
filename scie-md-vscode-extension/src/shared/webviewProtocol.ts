export interface ScieMDDocumentSnapshot {
  uri: string;
  fileName: string;
  text: string;
  version: number;
  isDirty: boolean;
  isReadonly?: boolean;
  readonlyReason?: string;
}

export type DocumentUpdateReason = 'initial' | 'changed' | 'saved';
export type OperationResultKind = 'applied' | 'noop' | 'skipped' | 'failed' | 'readonly' | 'saved' | 'command';

interface PanelMessageIdentity {
  panelId?: string;
  editChainId?: string;
}

export type ExtensionToWebviewMessage =
  | {
      type: 'documentUpdate';
      panelId: string;
      reason: DocumentUpdateReason;
      snapshot: ScieMDDocumentSnapshot;
      sourceEditId?: string | null;
    }
  | {
      type: 'operationResult';
      id?: string;
      panelId?: string;
      editChainId?: string;
      ok: boolean;
      result: OperationResultKind;
      message: string;
    };

export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | ({ type: 'replaceDocument'; text: string; editId: string; baseText?: string; baseVersion?: number; rejectedHunkIds?: string[] } & PanelMessageIdentity)
  | {
      type: 'save';
      pendingText?: string;
      editId?: string;
      baseText?: string;
      baseVersion?: number;
      rejectedHunkIds?: string[];
    } & PanelMessageIdentity
  | {
      type: 'undo';
      pendingText?: string;
      editId?: string;
      baseText?: string;
      baseVersion?: number;
      rejectedHunkIds?: string[];
    } & PanelMessageIdentity
  | {
      type: 'redo';
      pendingText?: string;
      editId?: string;
      baseText?: string;
      baseVersion?: number;
      rejectedHunkIds?: string[];
    } & PanelMessageIdentity
  | { type: 'copyLlmSkill' }
  | { type: 'generateLlmSkillFile' }
  | { type: 'copyText'; text: string; label?: string }
  | { type: 'showMessage'; severity: 'info' | 'warning' | 'error'; message: string };

export interface InvalidWebviewToExtensionMessage {
  id?: string;
  panelId?: string;
  editChainId?: string;
  reason: string;
}

export type WebviewToExtensionMessageValidation =
  | { ok: true; message: WebviewToExtensionMessage }
  | { ok: false; invalid: InvalidWebviewToExtensionMessage };

type WebviewMessageRecord = Record<string, unknown>;

type FieldResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

const MESSAGE_TYPES = new Set<WebviewToExtensionMessage['type']>([
  'ready',
  'replaceDocument',
  'save',
  'undo',
  'redo',
  'copyLlmSkill',
  'generateLlmSkillFile',
  'copyText',
  'showMessage',
]);

const MESSAGE_SEVERITIES = new Set(['info', 'warning', 'error']);

export function validateWebviewToExtensionMessage(candidate: unknown): WebviewToExtensionMessageValidation {
  if (!isRecord(candidate)) {
    return invalidWebviewMessage(candidate, 'message must be an object.');
  }

  const rawType = candidate.type;
  if (typeof rawType !== 'string' || rawType.trim() === '') {
    return invalidWebviewMessage(candidate, 'message.type must be a non-empty string.');
  }
  if (!MESSAGE_TYPES.has(rawType as WebviewToExtensionMessage['type'])) {
    return invalidWebviewMessage(candidate, `unsupported message.type "${rawType}".`);
  }

  switch (rawType) {
    case 'ready':
    case 'copyLlmSkill':
    case 'generateLlmSkillFile':
      return { ok: true, message: { type: rawType } };
    case 'replaceDocument':
      return validateReplaceDocumentMessage(candidate);
    case 'save':
    case 'undo':
    case 'redo':
      return validateDocumentCommandMessage(candidate, rawType);
    case 'copyText':
      return validateCopyTextMessage(candidate);
    case 'showMessage':
      return validateShowMessage(candidate);
  }

  return invalidWebviewMessage(candidate, `unsupported message.type "${rawType}".`);
}

function validateReplaceDocumentMessage(candidate: WebviewMessageRecord): WebviewToExtensionMessageValidation {
  const identity = readPanelIdentity(candidate, 'replaceDocument');
  if (!identity.ok) return invalidWebviewMessage(candidate, identity.reason);

  const text = readRequiredString(candidate, 'text', 'replaceDocument');
  if (!text.ok) return invalidWebviewMessage(candidate, text.reason);
  const editId = readRequiredNonEmptyString(candidate, 'editId', 'replaceDocument');
  if (!editId.ok) return invalidWebviewMessage(candidate, editId.reason);
  const baseText = readOptionalString(candidate, 'baseText', 'replaceDocument');
  if (!baseText.ok) return invalidWebviewMessage(candidate, baseText.reason);
  const baseVersion = readOptionalFiniteNumber(candidate, 'baseVersion', 'replaceDocument');
  if (!baseVersion.ok) return invalidWebviewMessage(candidate, baseVersion.reason);
  const rejectedHunkIds = readOptionalStringArray(candidate, 'rejectedHunkIds', 'replaceDocument');
  if (!rejectedHunkIds.ok) return invalidWebviewMessage(candidate, rejectedHunkIds.reason);

  return {
    ok: true,
    message: {
      type: 'replaceDocument',
      ...identity.value,
      text: text.value,
      editId: editId.value,
      ...(baseText.value === undefined ? {} : { baseText: baseText.value }),
      ...(baseVersion.value === undefined ? {} : { baseVersion: baseVersion.value }),
      ...(rejectedHunkIds.value === undefined ? {} : { rejectedHunkIds: rejectedHunkIds.value }),
    },
  };
}

function validateDocumentCommandMessage(
  candidate: WebviewMessageRecord,
  type: 'save' | 'undo' | 'redo',
): WebviewToExtensionMessageValidation {
  const identity = readPanelIdentity(candidate, type);
  if (!identity.ok) return invalidWebviewMessage(candidate, identity.reason);

  const pendingText = readOptionalString(candidate, 'pendingText', type);
  if (!pendingText.ok) return invalidWebviewMessage(candidate, pendingText.reason);
  const editId = readOptionalNonEmptyString(candidate, 'editId', type);
  if (!editId.ok) return invalidWebviewMessage(candidate, editId.reason);
  const baseText = readOptionalString(candidate, 'baseText', type);
  if (!baseText.ok) return invalidWebviewMessage(candidate, baseText.reason);
  const baseVersion = readOptionalFiniteNumber(candidate, 'baseVersion', type);
  if (!baseVersion.ok) return invalidWebviewMessage(candidate, baseVersion.reason);
  const rejectedHunkIds = readOptionalStringArray(candidate, 'rejectedHunkIds', type);
  if (!rejectedHunkIds.ok) return invalidWebviewMessage(candidate, rejectedHunkIds.reason);

  const hasPendingEditPayload = pendingText.value !== undefined
    || editId.value !== undefined
    || baseText.value !== undefined
    || baseVersion.value !== undefined
    || rejectedHunkIds.value !== undefined;
  if (hasPendingEditPayload && pendingText.value === undefined) {
    return invalidWebviewMessage(candidate, `${type}.pendingText is required when pending edit fields are present.`);
  }
  if (hasPendingEditPayload && editId.value === undefined) {
    return invalidWebviewMessage(candidate, `${type}.editId is required when pending edit fields are present.`);
  }

  return {
    ok: true,
    message: {
      type,
      ...identity.value,
      ...(pendingText.value === undefined ? {} : { pendingText: pendingText.value }),
      ...(editId.value === undefined ? {} : { editId: editId.value }),
      ...(baseText.value === undefined ? {} : { baseText: baseText.value }),
      ...(baseVersion.value === undefined ? {} : { baseVersion: baseVersion.value }),
      ...(rejectedHunkIds.value === undefined ? {} : { rejectedHunkIds: rejectedHunkIds.value }),
    },
  };
}

function validateCopyTextMessage(candidate: WebviewMessageRecord): WebviewToExtensionMessageValidation {
  const text = readRequiredString(candidate, 'text', 'copyText');
  if (!text.ok) return invalidWebviewMessage(candidate, text.reason);
  const label = readOptionalString(candidate, 'label', 'copyText');
  if (!label.ok) return invalidWebviewMessage(candidate, label.reason);
  return {
    ok: true,
    message: {
      type: 'copyText',
      text: text.value,
      ...(label.value === undefined ? {} : { label: label.value }),
    },
  };
}

function validateShowMessage(candidate: WebviewMessageRecord): WebviewToExtensionMessageValidation {
  const severity = readRequiredString(candidate, 'severity', 'showMessage');
  if (!severity.ok) return invalidWebviewMessage(candidate, severity.reason);
  if (!MESSAGE_SEVERITIES.has(severity.value)) {
    return invalidWebviewMessage(candidate, 'showMessage.severity must be "info", "warning", or "error".');
  }
  const message = readRequiredString(candidate, 'message', 'showMessage');
  if (!message.ok) return invalidWebviewMessage(candidate, message.reason);
  return {
    ok: true,
    message: {
      type: 'showMessage',
      severity: severity.value as 'info' | 'warning' | 'error',
      message: message.value,
    },
  };
}

function readPanelIdentity(candidate: WebviewMessageRecord, type: string): FieldResult<PanelMessageIdentity> {
  const panelId = readOptionalNonEmptyString(candidate, 'panelId', type);
  if (!panelId.ok) return panelId;
  const editChainId = readOptionalNonEmptyString(candidate, 'editChainId', type);
  if (!editChainId.ok) return editChainId;
  return {
    ok: true,
    value: {
      ...(panelId.value === undefined ? {} : { panelId: panelId.value }),
      ...(editChainId.value === undefined ? {} : { editChainId: editChainId.value }),
    },
  };
}

function readRequiredString(candidate: WebviewMessageRecord, field: string, type: string): FieldResult<string> {
  const value = candidate[field];
  if (typeof value !== 'string') return { ok: false, reason: `${type}.${field} must be a string.` };
  return { ok: true, value };
}

function readRequiredNonEmptyString(candidate: WebviewMessageRecord, field: string, type: string): FieldResult<string> {
  const value = readRequiredString(candidate, field, type);
  if (!value.ok) return value;
  if (value.value.trim() === '') return { ok: false, reason: `${type}.${field} must be a non-empty string.` };
  return value;
}

function readOptionalString(candidate: WebviewMessageRecord, field: string, type: string): FieldResult<string | undefined> {
  const value = candidate[field];
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'string') return { ok: false, reason: `${type}.${field} must be a string when provided.` };
  return { ok: true, value };
}

function readOptionalNonEmptyString(candidate: WebviewMessageRecord, field: string, type: string): FieldResult<string | undefined> {
  const value = readOptionalString(candidate, field, type);
  if (!value.ok) return value;
  if (value.value !== undefined && value.value.trim() === '') {
    return { ok: false, reason: `${type}.${field} must be a non-empty string when provided.` };
  }
  return value;
}

function readOptionalFiniteNumber(candidate: WebviewMessageRecord, field: string, type: string): FieldResult<number | undefined> {
  const value = candidate[field];
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, reason: `${type}.${field} must be a finite number when provided.` };
  }
  return { ok: true, value };
}

function readOptionalStringArray(candidate: WebviewMessageRecord, field: string, type: string): FieldResult<string[] | undefined> {
  const value = candidate[field];
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return { ok: false, reason: `${type}.${field} must be an array of strings when provided.` };
  }
  return { ok: true, value: [...value] };
}

function invalidWebviewMessage(candidate: unknown, reason: string): WebviewToExtensionMessageValidation {
  const record = isRecord(candidate) ? candidate : {};
  const editId = typeof record.editId === 'string' && record.editId.trim() !== '' ? record.editId : undefined;
  const id = typeof record.id === 'string' && record.id.trim() !== '' ? record.id : undefined;
  const resultId = editId ?? id;
  const panelId = typeof record.panelId === 'string' && record.panelId.trim() !== '' ? record.panelId : undefined;
  const editChainId = typeof record.editChainId === 'string' && record.editChainId.trim() !== '' ? record.editChainId : undefined;
  return {
    ok: false,
    invalid: {
      ...(resultId ? { id: resultId } : {}),
      ...(panelId ? { panelId } : {}),
      ...(editChainId ? { editChainId } : {}),
      reason,
    },
  };
}

function isRecord(value: unknown): value is WebviewMessageRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
