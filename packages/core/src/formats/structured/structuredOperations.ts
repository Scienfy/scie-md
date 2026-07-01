import type { JsonVisualEditIntent } from '../json/jsonEdits.js';
import type { DocumentFormat, SourceSpan, StructuredNodeRef, StructuredPathSegment } from '../documentFormat.js';

export type StructuredClipboardOperationId = 'copyPath' | 'copyJson' | 'copyText';
export type StructuredNavigationOperationId = 'revealSource';
export type StructuredDocumentOperationId = 'applyClipboardReplace';
export type StructuredJsonEditOperationId = JsonVisualEditIntent['kind'];

export type StructuredOperationId =
  | StructuredClipboardOperationId
  | StructuredNavigationOperationId
  | StructuredDocumentOperationId
  | StructuredJsonEditOperationId;

export type StructuredOperationGroup = 'clipboard' | 'navigation' | 'document' | 'edit' | 'add' | 'delete';

export interface StructuredOperationMetadata {
  id: StructuredOperationId;
  label: string;
  group: StructuredOperationGroup;
  enabled: boolean;
  disabledReason?: string;
  destructive?: boolean;
  requiresReview?: boolean;
  requiresOptIn?: boolean;
  readonlyPreview?: boolean;
  shortcut?: string;
}

export interface StructuredOperationOptions {
  canCopy?: boolean;
  canRevealSource?: boolean;
  jsonEditOperations?: readonly StructuredJsonEditOperationId[];
}

export interface StructuredSourceRevealTarget {
  operationId: 'revealSource';
  format: DocumentFormat;
  path: StructuredPathSegment[];
  pointer: string;
  displayPath: string;
  span: SourceSpan;
  from: number;
  to: number;
  line: number;
  column: number;
  label: string;
}

export const STRUCTURED_CLIPBOARD_OPERATIONS: Record<StructuredClipboardOperationId, Omit<StructuredOperationMetadata, 'enabled' | 'disabledReason'>> = {
  copyPath: { id: 'copyPath', label: 'Copy path', group: 'clipboard' },
  copyJson: { id: 'copyJson', label: 'Copy JSON', group: 'clipboard' },
  copyText: { id: 'copyText', label: 'Copy text', group: 'clipboard' },
};

export const STRUCTURED_REVEAL_SOURCE_OPERATION: Omit<StructuredOperationMetadata, 'enabled' | 'disabledReason'> = {
  id: 'revealSource',
  label: 'Reveal in source',
  group: 'navigation',
};

export const STRUCTURED_DOCUMENT_OPERATIONS: Record<StructuredDocumentOperationId, Omit<StructuredOperationMetadata, 'enabled' | 'disabledReason'>> = {
  applyClipboardReplace: {
    id: 'applyClipboardReplace',
    label: 'Apply clipboard replacement',
    group: 'document',
    destructive: true,
    requiresReview: true,
    requiresOptIn: true,
    readonlyPreview: true,
  },
};

export const STRUCTURED_JSON_EDIT_OPERATIONS: Record<StructuredJsonEditOperationId, Omit<StructuredOperationMetadata, 'enabled' | 'disabledReason'>> = {
  replaceScalar: { id: 'replaceScalar', label: 'Edit value', group: 'edit', requiresReview: true },
  renameObjectKey: { id: 'renameObjectKey', label: 'Rename key', group: 'edit', requiresReview: true },
  addObjectField: { id: 'addObjectField', label: 'Add field', group: 'add', requiresReview: true },
  deleteObjectField: { id: 'deleteObjectField', label: 'Delete field', group: 'delete', destructive: true, requiresReview: true },
  addArrayItem: { id: 'addArrayItem', label: 'Add item', group: 'add', requiresReview: true },
  deleteArrayItem: { id: 'deleteArrayItem', label: 'Delete item', group: 'delete', destructive: true, requiresReview: true },
};

export function structuredSourceRevealTargetForNode(node: StructuredNodeRef | null | undefined): StructuredSourceRevealTarget | null {
  if (!node) return null;
  const span = preferredStructuredSourceSpan(node);
  if (!span) return null;
  return {
    operationId: 'revealSource',
    format: node.format,
    path: [...node.path],
    pointer: node.pointer,
    displayPath: node.displayPath,
    span,
    from: span.offset,
    to: span.offset + Math.max(1, span.length),
    line: span.line,
    column: span.column,
    label: `Reveal ${node.displayPath} in source`,
  };
}

export function preferredStructuredSourceSpan(node: StructuredNodeRef): SourceSpan | null {
  return node.valueSpan ?? node.span ?? node.keySpan ?? null;
}

export function structuredOperationsForNode(
  node: StructuredNodeRef | null | undefined,
  options: StructuredOperationOptions = {},
): StructuredOperationMetadata[] {
  const canCopy = options.canCopy ?? true;
  const canRevealSource = options.canRevealSource ?? true;
  const revealTarget = structuredSourceRevealTargetForNode(node);
  const operations: StructuredOperationMetadata[] = [
    operationWithAvailability(STRUCTURED_CLIPBOARD_OPERATIONS.copyPath, canCopy, 'Clipboard is not available.'),
    operationWithAvailability(STRUCTURED_CLIPBOARD_OPERATIONS.copyJson, canCopy, 'Clipboard is not available.'),
    operationWithAvailability(STRUCTURED_CLIPBOARD_OPERATIONS.copyText, canCopy, 'Clipboard is not available.'),
    operationWithAvailability(
      STRUCTURED_REVEAL_SOURCE_OPERATION,
      Boolean(canRevealSource && revealTarget),
      revealTarget ? 'Source reveal is not available here.' : 'This structured node does not have a source range.',
    ),
  ];

  for (const operationId of options.jsonEditOperations ?? []) {
    const metadata = STRUCTURED_JSON_EDIT_OPERATIONS[operationId];
    if (metadata) operations.push(operationWithAvailability(metadata, true));
  }

  return operations;
}

export function structuredOperationForNode(
  node: StructuredNodeRef | null | undefined,
  id: StructuredOperationId,
  options: StructuredOperationOptions = {},
): StructuredOperationMetadata | null {
  return structuredOperationsForNode(node, options).find((operation) => operation.id === id) ?? null;
}

export function structuredPreviewDocumentOperations(input: {
  canApplyClipboardReplace: boolean;
  disabledReason: string;
  requiresOptIn?: boolean;
}): StructuredOperationMetadata[] {
  return [
    operationWithAvailability(
      {
        ...STRUCTURED_DOCUMENT_OPERATIONS.applyClipboardReplace,
        requiresOptIn: input.requiresOptIn ?? STRUCTURED_DOCUMENT_OPERATIONS.applyClipboardReplace.requiresOptIn,
      },
      input.canApplyClipboardReplace,
      input.disabledReason,
    ),
  ];
}

function operationWithAvailability(
  operation: Omit<StructuredOperationMetadata, 'enabled' | 'disabledReason'>,
  enabled: boolean,
  disabledReason?: string,
): StructuredOperationMetadata {
  return enabled ? { ...operation, enabled: true } : { ...operation, enabled: false, disabledReason };
}
