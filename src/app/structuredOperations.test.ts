import { describe, expect, it } from 'vitest';
import { createJsonContent, parseJsonDocument } from '@sciemd/core';
import { sourceSelectionForStructuredNode } from './structuredOperations';
import { structuredOperationsForTarget } from './structuredOperationRegistry';

describe('desktop structured operation bridge', () => {
  it('maps a structured source node to a source editor selection request', () => {
    const source = '{\n  "sample": {\n    "name": "Alpha"\n  }\n}\n';
    const parsed = parseJsonDocument(createJsonContent(source)).parsed;
    const node = parsed?.sourceMap.nodesByDisplayPath['$.sample.name'];

    expect(sourceSelectionForStructuredNode(node)).toMatchObject({
      from: source.indexOf('"Alpha"'),
      to: source.indexOf('"Alpha"') + '"Alpha"'.length,
      line: 3,
      column: 13,
      displayPath: '$.sample.name',
      label: 'Reveal $.sample.name in source',
    });
  });
});

describe('structured operation registry', () => {
  it('declares node copy, source reveal, edit, add, and destructive operations', () => {
    const operations = structuredOperationsForTarget({
      kind: 'node',
      editActions: ['replaceScalar', 'addObjectField', 'deleteObjectField'],
      canRevealSource: true,
      hasChildren: true,
      expanded: false,
    });

    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'replaceScalar', label: 'Edit value', requiresReview: true, sourcePreserving: true }),
      expect.objectContaining({ id: 'copyPath', label: 'Copy path' }),
      expect.objectContaining({ id: 'revealSource', label: 'Reveal in source' }),
      expect.objectContaining({ id: 'addObjectField', label: 'Add field' }),
      expect.objectContaining({ id: 'deleteObjectField', destructive: true }),
      expect.objectContaining({ id: 'expandNode', label: 'Expand' }),
    ]));
  });

  it('reports record edit availability consistently for invalid JSONL lines', () => {
    const operations = structuredOperationsForTarget({
      kind: 'jsonl-record',
      valid: false,
      invalidReason: 'Expected a JSON value.',
      canEditRecords: true,
    });

    expect(operations).toContainEqual(expect.objectContaining({
      id: 'copyLine',
      disabled: false,
    }));
    expect(operations).toContainEqual(expect.objectContaining({
      id: 'copyRecordJson',
      disabled: true,
      disabledReason: 'Expected a JSON value.',
    }));
    expect(operations).toContainEqual(expect.objectContaining({
      id: 'recordActionsUnavailable',
      disabled: true,
      disabledReason: 'Expected a JSON value.',
    }));
    expect(operations.some((operation) => operation.id === 'replaceRecord')).toBe(false);
  });

  it('keeps tabular and source operations disabled with explicit reasons', () => {
    expect(structuredOperationsForTarget({
      kind: 'tabular-table',
      appendAvailable: false,
      appendDisabledReason: 'Preview is truncated.',
      canConvert: false,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'addRow', disabled: true, disabledReason: 'Preview is truncated.' }),
      expect.objectContaining({ id: 'convertTable', disabled: true }),
    ]));

    expect(structuredOperationsForTarget({
      kind: 'source',
      selection: false,
      sameLine: true,
      canCopyLine: false,
      canSwitchToVisual: true,
      hasDiagnostics: true,
      contextOperations: ['copyText', 'copyLine', 'copyDiagnostics', 'selectLine', 'switchToVisual', 'validateSelection', 'validateClipboard', 'convertSelection'],
      canValidateSelection: false,
      canValidateClipboard: true,
      canConvertSelection: false,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'copyLine', disabled: true, disabledReason: 'This line is empty.' }),
      expect.objectContaining({ id: 'selectLine', disabled: false }),
      expect.objectContaining({ id: 'switchToVisual', disabled: false }),
      expect.objectContaining({ id: 'copyDiagnostics', disabled: false }),
      expect.objectContaining({ id: 'validateSelection', disabled: true }),
      expect.objectContaining({ id: 'validateClipboard', disabled: false }),
      expect.objectContaining({ id: 'convertSelection', disabled: true }),
    ]));
  });

  it('declares discoverable structured context operations for menus and inspectors', () => {
    const operations = structuredOperationsForTarget({
      kind: 'structured-context',
      canCopyStructuredContext: true,
      canCopySelectedPathContext: true,
      canCopySchemaAwareJsonContext: true,
      canCopyTableSample: false,
      canCopyParserDiagnostics: true,
      canCopyRedactedPreview: true,
      canValidateClipboard: true,
    });

    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'copyStructuredContext', label: 'Copy structured context', disabled: false }),
      expect.objectContaining({ id: 'copySelectedPathContext', label: 'Copy selected path context', disabled: false }),
      expect.objectContaining({ id: 'copySchemaAwareJsonContext', label: 'Copy schema-aware JSON context', disabled: false }),
      expect.objectContaining({ id: 'copyTableSample', label: 'Copy table sample', disabled: true }),
      expect.objectContaining({ id: 'copyParserDiagnostics', label: 'Copy parser diagnostics', disabled: false }),
      expect.objectContaining({ id: 'validateClipboard', label: 'Validate structured clipboard', disabled: false }),
    ]));
  });
});
