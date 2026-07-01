import type { SourceEditorContextOperation } from '@sciemd/core';

export type StructuredOperationIcon =
  | 'copy'
  | 'source'
  | 'edit'
  | 'add'
  | 'delete'
  | 'code'
  | 'expand'
  | 'collapse'
  | 'select'
  | 'warning';

export type StructuredOperationId =
  | 'copyMenu'
  | 'copyPath'
  | 'copyJson'
  | 'copyText'
  | 'copyLine'
  | 'copyRecordJson'
  | 'copyCell'
  | 'copyRow'
  | 'copyTable'
  | 'copyColumnName'
  | 'copyVisibleColumnValues'
  | 'copyDiagnostics'
  | 'copyStructuredContext'
  | 'copySelectedPathContext'
  | 'copySchemaAwareJsonContext'
  | 'copyTableSample'
  | 'copyParserDiagnostics'
  | 'copyRedactedPreview'
  | 'revealSource'
  | 'selectLine'
  | 'switchToVisual'
  | 'validateSelection'
  | 'validateClipboard'
  | 'convertSelection'
  | 'replaceScalar'
  | 'renameObjectKey'
  | 'addObjectField'
  | 'addRequiredField'
  | 'deleteObjectField'
  | 'addArrayItem'
  | 'deleteArrayItem'
  | 'editCell'
  | 'replaceRecord'
  | 'duplicateRecord'
  | 'deleteRecord'
  | 'appendRecord'
  | 'addRow'
  | 'convertJsonl'
  | 'convertTable'
  | 'expandNode'
  | 'collapseNode'
  | 'visualEditsUnavailable'
  | 'recordActionsUnavailable';

export type StructuredOperationTarget =
  | {
    kind: 'node';
    editActions: readonly StructuredOperationId[];
    editDisabledReason?: string | null;
    canRevealSource: boolean;
    hasChildren: boolean;
    expanded: boolean;
  }
  | {
    kind: 'json-array-cell';
    editable: boolean;
    editConnected: boolean;
    editDisabledReason?: string | null;
    canRevealSource: boolean;
  }
  | {
    kind: 'json-array-row';
    canRevealSource: boolean;
  }
  | {
    kind: 'json-array-surface';
  }
  | {
    kind: 'jsonl-record';
    valid: boolean;
    invalidReason?: string | null;
    canEditRecords: boolean;
  }
  | {
    kind: 'jsonl-header';
    canEditRecords: boolean;
    canConvert: boolean;
  }
  | {
    kind: 'tabular-cell';
    editsAvailable: boolean;
    editDisabledReason?: string | null;
  }
  | {
    kind: 'tabular-header';
  }
  | {
    kind: 'tabular-table';
    appendAvailable: boolean;
    appendDisabledReason?: string | null;
    canConvert: boolean;
  }
  | {
    kind: 'source';
    selection: boolean;
    sameLine: boolean;
    canCopyLine: boolean;
    canSwitchToVisual: boolean;
    hasDiagnostics: boolean;
    contextOperations: readonly SourceEditorContextOperation[];
    canValidateSelection: boolean;
    canValidateClipboard: boolean;
    canConvertSelection: boolean;
    validateSelectionDisabledReason?: string;
    validateClipboardDisabledReason?: string;
    convertSelectionDisabledReason?: string;
  }
  | {
    kind: 'diagnostic';
    canRevealSource: boolean;
  }
  | {
    kind: 'structured-context';
    canCopyStructuredContext: boolean;
    canCopySelectedPathContext: boolean;
    canCopySchemaAwareJsonContext: boolean;
    canCopyTableSample: boolean;
    canCopyParserDiagnostics: boolean;
    canCopyRedactedPreview: boolean;
    canValidateClipboard: boolean;
  };

export interface StructuredOperationSection {
  id: string;
  label?: string;
  items: StructuredOperationItem[];
}

export interface StructuredOperationItem {
  id: StructuredOperationId;
  label: string;
  icon: StructuredOperationIcon;
  shortcut?: string;
  disabled?: boolean;
  disabledReason?: string;
  destructive?: boolean;
  requiresReview?: boolean;
  sourcePreserving?: boolean;
  submenu?: StructuredOperationSection[];
}

export function structuredOperationSectionsForTarget(target: StructuredOperationTarget): StructuredOperationSection[] {
  switch (target.kind) {
    case 'node':
      return nodeOperationSections(target);
    case 'json-array-cell':
      return jsonArrayCellOperationSections(target);
    case 'json-array-row':
      return jsonArrayRowOperationSections(target);
    case 'json-array-surface':
      return [{ id: 'json-array-surface-actions', items: [copyTableOperation()] }];
    case 'jsonl-record':
      return jsonlRecordOperationSections(target);
    case 'jsonl-header':
      return jsonlHeaderOperationSections(target);
    case 'tabular-cell':
      return tabularCellOperationSections(target);
    case 'tabular-header':
      return tabularHeaderOperationSections();
    case 'tabular-table':
      return tabularTableOperationSections(target);
    case 'source':
      return sourceOperationSections(target);
    case 'diagnostic':
      return diagnosticOperationSections(target);
    case 'structured-context':
      return structuredContextOperationSections(target);
  }
}

export function structuredOperationsForTarget(target: StructuredOperationTarget): StructuredOperationItem[] {
  return flattenOperationSections(structuredOperationSectionsForTarget(target));
}

export function flattenOperationSections(sections: readonly StructuredOperationSection[]): StructuredOperationItem[] {
  return sections.flatMap((section) => section.items.flatMap((item) => (
    item.submenu ? [item, ...flattenOperationSections(item.submenu)] : [item]
  )));
}

function nodeOperationSections(target: Extract<StructuredOperationTarget, { kind: 'node' }>): StructuredOperationSection[] {
  const primaryActions = target.editActions.filter((action) => action === 'replaceScalar' || action === 'renameObjectKey');
  const addActions = target.editActions.filter((action) => action === 'addObjectField' || action === 'addRequiredField' || action === 'addArrayItem');
  const deleteActions = target.editActions.filter((action) => action === 'deleteObjectField' || action === 'deleteArrayItem');
  const primaryItems: StructuredOperationItem[] = [
    ...primaryActions.map((action) => jsonEditOperation(action)),
    operation('revealSource', 'Reveal in source', 'source', { disabled: !target.canRevealSource, disabledReason: 'This item does not have a source range.' }),
    ...(target.hasChildren ? [operation(target.expanded ? 'collapseNode' : 'expandNode', target.expanded ? 'Collapse' : 'Expand', target.expanded ? 'collapse' : 'expand')] : []),
  ].filter((item) => item.id !== 'revealSource' || target.canRevealSource);

  const sections: StructuredOperationSection[] = [];
  if (primaryItems.length > 0) sections.push({ id: 'primary', items: primaryItems });
  if (target.editDisabledReason && target.editActions.length === 0) {
    sections.push({
      id: 'edit-unavailable',
      items: [operation('visualEditsUnavailable', 'Visual edits unavailable', 'edit', {
        disabled: true,
        disabledReason: target.editDisabledReason,
      })],
    });
  }
  sections.push(copyMenuSection([
    operation('copyPath', 'Copy path', 'copy'),
    operation('copyJson', 'Copy JSON', 'copy'),
    operation('copyText', 'Copy text', 'copy'),
  ]));
  if (addActions.length > 0) {
    sections.push({
      id: 'add',
      items: [operation('addObjectField', 'Add', 'add', {
        submenu: [{ id: 'add-actions', items: addActions.map((action) => jsonEditOperation(action)) }],
      })],
    });
  }
  if (deleteActions.length > 0) {
    sections.push({
      id: 'destructive',
      items: deleteActions.map((action) => jsonEditOperation(action, { destructive: true })),
    });
  }
  return sections;
}

function jsonArrayCellOperationSections(target: Extract<StructuredOperationTarget, { kind: 'json-array-cell' }>): StructuredOperationSection[] {
  const editDisabled = !target.editConnected || !target.editable;
  return [
    {
      id: 'json-cell-primary',
      items: [
        operation('editCell', 'Edit cell', 'edit', {
          disabled: editDisabled,
          disabledReason: editDisabled ? target.editDisabledReason ?? 'JSON table cell editing is unavailable.' : undefined,
          requiresReview: true,
          sourcePreserving: true,
        }),
        operation('revealSource', 'Reveal in source', 'source', {
          disabled: !target.canRevealSource,
          disabledReason: 'Source location is not available for this cell.',
        }),
      ],
    },
    copyMenuSection([
      operation('copyCell', 'Copy cell', 'copy'),
      operation('copyRow', 'Copy row', 'copy'),
      operation('copyTable', 'Copy table preview', 'copy'),
    ], 'json-cell-copy'),
  ];
}

function jsonArrayRowOperationSections(target: Extract<StructuredOperationTarget, { kind: 'json-array-row' }>): StructuredOperationSection[] {
  return [
    {
      id: 'json-row-actions',
      items: [operation('revealSource', 'Reveal in source', 'source', {
        disabled: !target.canRevealSource,
        disabledReason: 'Source location is not available for this row.',
      })],
    },
    copyMenuSection([
      operation('copyRow', 'Copy row', 'copy'),
      operation('copyTable', 'Copy table preview', 'copy'),
    ], 'json-row-copy'),
  ];
}

function jsonlRecordOperationSections(target: Extract<StructuredOperationTarget, { kind: 'jsonl-record' }>): StructuredOperationSection[] {
  const sections = [
    copyMenuSection([
      operation('copyLine', 'Copy line', 'copy'),
      operation('copyRecordJson', 'Copy record JSON', 'copy', {
        disabled: !target.valid,
        disabledReason: target.invalidReason ?? 'Invalid JSONL lines do not have a parsed JSON value.',
      }),
    ]),
  ];
  if (!target.valid) {
    return [
      ...sections,
      {
        id: 'record-unavailable',
        items: [operation('recordActionsUnavailable', 'Record actions unavailable', 'warning', {
          disabled: true,
          disabledReason: target.invalidReason ?? 'Fix this line in source mode before using record actions.',
        })],
      },
    ];
  }
  return [
    {
      id: 'primary',
      items: [recordEditOperation('replaceRecord', 'Replace record', 'edit', target.canEditRecords)],
    },
    ...sections,
    {
      id: 'record-actions',
      items: [recordEditOperation('duplicateRecord', 'Duplicate record', 'copy', target.canEditRecords)],
    },
    {
      id: 'destructive',
      items: [recordEditOperation('deleteRecord', 'Delete record', 'delete', target.canEditRecords, true)],
    },
  ];
}

function jsonlHeaderOperationSections(target: Extract<StructuredOperationTarget, { kind: 'jsonl-header' }>): StructuredOperationSection[] {
  return [{
    id: 'jsonl-header-actions',
    items: [
      recordEditOperation('appendRecord', 'Append record', 'add', target.canEditRecords),
      operation('convertJsonl', 'Convert JSONL', 'code', {
        disabled: !target.canConvert,
        disabledReason: 'Source text is unavailable for conversion.',
      }),
    ],
  }];
}

function tabularCellOperationSections(target: Extract<StructuredOperationTarget, { kind: 'tabular-cell' }>): StructuredOperationSection[] {
  return [
    {
      id: 'cell-primary',
      items: [operation('editCell', 'Edit cell', 'edit', {
        disabled: !target.editsAvailable,
        disabledReason: target.editDisabledReason ?? 'Table cell editing is not available.',
        requiresReview: true,
        sourcePreserving: true,
      })],
    },
    copyMenuSection([
      operation('copyCell', 'Copy cell', 'copy'),
      operation('copyRow', 'Copy row', 'copy'),
    ], 'cell-copy'),
  ];
}

function tabularHeaderOperationSections(): StructuredOperationSection[] {
  return [copyMenuSection([
    operation('copyColumnName', 'Copy column name', 'copy'),
    operation('copyVisibleColumnValues', 'Copy visible column values', 'copy'),
  ], 'header-copy')];
}

function tabularTableOperationSections(target: Extract<StructuredOperationTarget, { kind: 'tabular-table' }>): StructuredOperationSection[] {
  return [{
    id: 'table-actions',
    items: [
      operation('addRow', 'Add row', 'add', {
        disabled: !target.appendAvailable,
        disabledReason: target.appendDisabledReason ?? 'Table row append is not available.',
        requiresReview: true,
        sourcePreserving: true,
      }),
      operation('convertTable', 'Convert table', 'code', {
        disabled: !target.canConvert,
        disabledReason: 'Copy/export handler is not available for table conversion.',
      }),
    ],
  }];
}

function sourceOperationSections(target: Extract<StructuredOperationTarget, { kind: 'source' }>): StructuredOperationSection[] {
  const sourceChecks: StructuredOperationItem[] = [];
  if (target.contextOperations.includes('validateSelection')) {
    sourceChecks.push(operation('validateSelection', 'Validate selection', 'warning', {
      disabled: !target.canValidateSelection,
      disabledReason: target.validateSelectionDisabledReason ?? 'Select source text before validating a fragment.',
    }));
  }
  if (target.contextOperations.includes('validateClipboard')) {
    sourceChecks.push(operation('validateClipboard', 'Validate clipboard', 'warning', {
      disabled: !target.canValidateClipboard,
      disabledReason: target.validateClipboardDisabledReason ?? 'Clipboard validation is unavailable in this window.',
    }));
  }
  if (target.contextOperations.includes('convertSelection')) {
    sourceChecks.push(operation('convertSelection', 'Convert selection to JSON', 'code', {
      disabled: !target.canConvertSelection,
      disabledReason: target.convertSelectionDisabledReason ?? 'Select delimited source text before converting.',
    }));
  }
  return [
    copyMenuSection([
      ...(target.selection ? [operation('copyText', 'Copy selection', 'copy')] : []),
      operation('copyLine', target.sameLine ? 'Copy line' : 'Copy selected lines', 'copy', {
        disabled: !target.canCopyLine,
        disabledReason: 'This line is empty.',
      }),
      ...(target.hasDiagnostics ? [operation('copyDiagnostics', target.sameLine ? 'Copy line diagnostic' : 'Copy line diagnostics', 'warning')] : []),
    ], 'source-copy'),
    {
      id: 'source-navigation',
      items: [
        operation('selectLine', target.sameLine ? 'Select line' : 'Select selected lines', 'select'),
        operation('switchToVisual', 'Switch to visual editor', 'source', {
          disabled: !target.canSwitchToVisual,
          disabledReason: 'Visual mode is unavailable for this document state.',
        }),
      ].filter((item) => item.id !== 'switchToVisual' || target.canSwitchToVisual),
    },
    ...(sourceChecks.length > 0 ? [{
      id: 'source-checks',
      label: 'Source checks',
      items: sourceChecks,
    }] : []),
  ];
}

function diagnosticOperationSections(target: Extract<StructuredOperationTarget, { kind: 'diagnostic' }>): StructuredOperationSection[] {
  return [{
    id: 'diagnostic-actions',
    items: [
      operation('revealSource', 'Jump to line', 'source', {
        disabled: !target.canRevealSource,
        disabledReason: 'This diagnostic does not have a source location.',
      }),
      operation('copyDiagnostics', 'Copy issue', 'copy'),
    ],
  }];
}

function structuredContextOperationSections(target: Extract<StructuredOperationTarget, { kind: 'structured-context' }>): StructuredOperationSection[] {
  return [
    {
      id: 'structured-context-copy',
      label: 'Copy',
      items: [
        operation('copyStructuredContext', 'Copy structured context', 'copy', {
          disabled: !target.canCopyStructuredContext,
          disabledReason: 'Structured context is available after the current file parses successfully.',
        }),
        operation('copySelectedPathContext', 'Copy selected path context', 'copy', {
          disabled: !target.canCopySelectedPathContext,
          disabledReason: 'Select a structured path or use a format with path-aware visual projection.',
        }),
        operation('copySchemaAwareJsonContext', 'Copy schema-aware JSON context', 'copy', {
          disabled: !target.canCopySchemaAwareJsonContext,
          disabledReason: 'Schema-aware context is available for parsed JSON documents.',
        }),
        operation('copyTableSample', 'Copy table sample', 'copy', {
          disabled: !target.canCopyTableSample,
          disabledReason: 'Table samples are available for parsed CSV and TSV previews.',
        }),
        operation('copyParserDiagnostics', 'Copy parser diagnostics', 'warning', {
          disabled: !target.canCopyParserDiagnostics,
          disabledReason: 'Parser diagnostics are unavailable for this document.',
        }),
        operation('copyRedactedPreview', 'Copy redacted preview', 'copy', {
          disabled: !target.canCopyRedactedPreview,
          disabledReason: 'Redacted previews are available after the current structured file parses successfully.',
        }),
      ],
    },
    {
      id: 'structured-context-validate',
      label: 'Validate',
      items: [
        operation('validateClipboard', 'Validate structured clipboard', 'warning', {
          disabled: !target.canValidateClipboard,
          disabledReason: 'Clipboard validation is unavailable for this format.',
        }),
      ],
    },
  ];
}

function copyMenuSection(items: StructuredOperationItem[], id = 'copy'): StructuredOperationSection {
  return {
    id,
    items: [operation('copyMenu', 'Copy', 'copy', {
      submenu: [{ id: `${id}-values`, items }],
    })],
  };
}

function copyTableOperation(): StructuredOperationItem {
  return operation('copyTable', 'Copy table preview', 'copy');
}

function recordEditOperation(
  id: StructuredOperationId,
  label: string,
  icon: StructuredOperationIcon,
  enabled: boolean,
  destructive = false,
): StructuredOperationItem {
  return operation(id, label, icon, {
    disabled: !enabled,
    disabledReason: 'JSONL record editing is not available for this view.',
    destructive,
    requiresReview: true,
    sourcePreserving: true,
  });
}

function jsonEditOperation(id: StructuredOperationId, overrides: Partial<StructuredOperationItem> = {}): StructuredOperationItem {
  return operation(id, jsonEditOperationLabel(id), jsonEditOperationIcon(id), {
    requiresReview: true,
    sourcePreserving: true,
    destructive: id === 'deleteObjectField' || id === 'deleteArrayItem',
    ...overrides,
  });
}

function jsonEditOperationLabel(id: StructuredOperationId): string {
  switch (id) {
    case 'replaceScalar':
      return 'Edit value';
    case 'renameObjectKey':
      return 'Rename key';
    case 'addObjectField':
      return 'Add field';
    case 'addRequiredField':
      return 'Add required field';
    case 'deleteObjectField':
      return 'Delete field';
    case 'addArrayItem':
      return 'Add item';
    case 'deleteArrayItem':
      return 'Delete item';
    default:
      return id;
  }
}

function jsonEditOperationIcon(id: StructuredOperationId): StructuredOperationIcon {
  if (id === 'deleteObjectField' || id === 'deleteArrayItem') return 'delete';
  if (id === 'replaceScalar' || id === 'renameObjectKey') return 'edit';
  return 'add';
}

function operation(
  id: StructuredOperationId,
  label: string,
  icon: StructuredOperationIcon,
  options: Partial<Omit<StructuredOperationItem, 'id' | 'label' | 'icon'>> = {},
): StructuredOperationItem {
  const disabled = options.disabled ?? false;
  return {
    id,
    label,
    icon,
    ...options,
    disabled,
    disabledReason: disabled ? options.disabledReason : undefined,
  };
}
