import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from 'react';
import { ChevronRight, Copy, FileCode2, ListTree, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  createJsonRawNumberToken,
  jsonSourceHash,
  jsonSchemaObjectControlForPath,
  jsonSchemaScalarControlForPath,
  pointerFromPath,
  type FormatDiagnostic,
  type JsonEditableScalarValue,
  type JsonEditableValue,
  type JsonSchemaGeneratedValue,
  type JsonSchemaObjectFieldSuggestion,
  type JsonSchemaScalarControl,
  type JsonSchemaScalarType,
  type JsonSchemaScalarValue,
  type JsonSchemaSummary,
  type JsonSchemaValidationResult,
  type JsonVisualEditIntent,
  type SourceSpan,
  type StructuredJsonPreview,
  type StructuredNodeRef,
  type StructuredPathSegment,
  type StructuredSourceMap,
} from '@sciemd/core';
import { DialogActions } from './DialogActions';
import { ModalShell } from './ModalShell';
import { ContextMenuCard, type ContextMenuSection } from './ContextMenuCard';
import { contextMenuPositionFromElement, isKeyboardContextMenuEvent, writeContextMenuClipboardText } from './contextMenuUtils';
import { structuredOperationSectionsForTarget, structuredOperationsForTarget } from '../app/structuredOperationRegistry';
import { structuredOperationSectionsToContextMenuSections } from './structuredOperationMenu';

export interface JsonTreeViewProps {
  value: unknown;
  label?: string;
  sourceMap?: StructuredSourceMap | null;
  sourceText?: string;
  schemaValidation?: JsonSchemaValidationResult | null;
  preservationWarnings?: FormatDiagnostic[];
  jsonPreview?: StructuredJsonPreview | null;
  editable?: boolean;
  selectedPath?: string | null;
  onSelectedPathChange?: (path: string) => void;
  onEditIntent?: (intent: JsonVisualEditIntent) => void;
  onRevealSource?: (node: StructuredNodeRef) => void;
  onUnsupportedEdit?: (message: string) => void;
}

export interface JsonTreeNodeModel {
  key: string;
  path: string;
  pointer: string;
  pathSegments: StructuredPathSegment[];
  type: JsonValueType;
  value: unknown;
  depth: number;
  sourceRef: StructuredNodeRef | null;
  span: SourceSpan | null;
  valueSpan: SourceSpan | null;
  keySpan: SourceSpan | null;
  editable: boolean;
  lossy: boolean;
  unsupportedReason?: string;
  children: JsonTreeNodeModel[];
}

export type JsonValueType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
type JsonTreeEditAction =
  | 'replaceScalar'
  | 'renameObjectKey'
  | 'addObjectField'
  | 'addRequiredField'
  | 'deleteObjectField'
  | 'addArrayItem'
  | 'deleteArrayItem';

interface JsonTreeEditDialogState {
  action: JsonTreeEditAction;
  node: JsonTreeNodeModel;
  arrayInsertIndex?: number;
}

interface JsonTreeActionToolbarState {
  nodePath: string;
  position: JsonTreeToolbarPosition;
}

interface JsonTreeContextMenuState {
  nodePath: string;
  position: {
    x: number;
    y: number;
  };
  restoreFocusTo?: HTMLElement | null;
}

interface JsonTreeToolbarPosition {
  top: number;
  left: number;
}

interface JsonTreeInlineEditState {
  nodePath: string;
  draft: ScalarDraft;
  enumOptionTexts: string[];
  error: string | null;
}

const JSON_TREE_ACTION_TOOLBAR_WIDTH = 420;

export function JsonTreeView({
  value,
  label = 'JSON tree',
  sourceMap = null,
  sourceText,
  schemaValidation = null,
  preservationWarnings = [],
  jsonPreview = null,
  editable = false,
  selectedPath,
  onSelectedPathChange,
  onEditIntent,
  onRevealSource,
  onUnsupportedEdit,
}: JsonTreeViewProps) {
  const root = useMemo(() => buildJsonTreeModel(value, sourceMap), [sourceMap, value]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => defaultExpandedPaths(root));
  const [editDialog, setEditDialog] = useState<JsonTreeEditDialogState | null>(null);
  const [inlineEdit, setInlineEdit] = useState<JsonTreeInlineEditState | null>(null);
  const [actionToolbar, setActionToolbar] = useState<JsonTreeActionToolbarState | null>(null);
  const [contextMenu, setContextMenu] = useState<JsonTreeContextMenuState | null>(null);
  const selectedNode = findJsonTreeNode(root, selectedPath ?? '$') ?? root;
  const resolvedSelectedPath = selectedNode.path;
  const actionToolbarNode = actionToolbar ? findJsonTreeNode(root, actionToolbar.nodePath) : null;
  const contextMenuNode = contextMenu ? findJsonTreeNode(root, contextMenu.nodePath) : null;
  const schemaSummary = schemaValidation?.status === 'schema-invalid'
    ? null
    : schemaValidation?.summary ?? null;
  const expectedSourceHash = useMemo(() => (
    sourceText === undefined ? undefined : jsonSourceHash(sourceText)
  ), [sourceText]);
  const nodeCanEditVisually = (node: JsonTreeNodeModel) => Boolean(
    editable
    && sourceMap?.format === 'json'
    && onEditIntent
    && node.sourceRef?.editable
    && !node.lossy,
  );
  const selectedEditActions = nodeCanEditVisually(selectedNode)
    ? jsonEditActionsForNode(selectedNode, sourceMap, schemaSummary)
    : [];
  const actionToolbarEditActions = actionToolbarNode && nodeCanEditVisually(actionToolbarNode)
    ? jsonEditActionsForNode(actionToolbarNode, sourceMap, schemaSummary)
    : [];
  const contextMenuEditActions = contextMenuNode && nodeCanEditVisually(contextMenuNode)
    ? jsonEditActionsForNode(contextMenuNode, sourceMap, schemaSummary)
    : [];

  useEffect(() => {
    if (!actionToolbar) return;
    if (!actionToolbarNode) {
      setActionToolbar(null);
      return;
    }

    const dismiss = () => setActionToolbar(null);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.json-tree-floating-toolbar')) return;
      if (target?.closest('.json-tree-select')) return;
      dismiss();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [actionToolbar, actionToolbarNode]);

  useEffect(() => {
    if (contextMenu && !contextMenuNode) setContextMenu(null);
  }, [contextMenu, contextMenuNode]);

  const handleSelectPath = (path: string) => {
    setActionToolbar(null);
    setContextMenu(null);
    onSelectedPathChange?.(path);
  };
  const handleOpenNodeActions = (node: JsonTreeNodeModel, event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    onSelectedPathChange?.(node.path);
    setContextMenu(null);
    setActionToolbar({
      nodePath: node.path,
      position: jsonTreeToolbarPositionForElement(event.currentTarget),
    });
  };
  const handleOpenNodeContextMenu = (node: JsonTreeNodeModel, event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onSelectedPathChange?.(node.path);
    setActionToolbar(null);
    setContextMenu({
      nodePath: node.path,
      position: {
        x: event.clientX,
        y: event.clientY,
      },
      restoreFocusTo: event.currentTarget,
    });
  };
  const handleOpenNodeKeyboardContextMenu = (node: JsonTreeNodeModel, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!isKeyboardContextMenuEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectedPathChange?.(node.path);
    setActionToolbar(null);
    setContextMenu({
      nodePath: node.path,
      position: contextMenuPositionFromElement(event.currentTarget),
      restoreFocusTo: event.currentTarget,
    });
  };
  const handleCopyNodeValue = (node: JsonTreeNodeModel, mode: 'path' | 'json' | 'text') => {
    const text = mode === 'path'
      ? node.path
      : jsonValueToClipboardText(node.value, mode);
    return writeClipboardText(text);
  };
  const handleRevealSource = (node: JsonTreeNodeModel) => {
    if (!node.sourceRef || !onRevealSource || !jsonTreeNodeHasSourceRange(node)) {
      onUnsupportedEdit?.('Source location is not available for this node.');
      return;
    }
    onSelectedPathChange?.(node.path);
    setActionToolbar(null);
    setContextMenu(null);
    onRevealSource(node.sourceRef);
  };
  const handleOpenEditAction = (action: JsonTreeEditAction, node: JsonTreeNodeModel = selectedNode) => {
    if (!nodeCanEditVisually(node)) {
      onUnsupportedEdit?.('JSON visual edits are not available for this node.');
      return;
    }
    setActionToolbar(null);
    setContextMenu(null);
    setEditDialog({
      action,
      node,
      arrayInsertIndex: node.type === 'array' ? node.children.length : undefined,
    });
  };
  const canInlineEditNode = (node: JsonTreeNodeModel) => {
    if (!nodeCanEditVisually(node) || !isScalarJsonNode(node) || node.type === 'null') return false;
    const scalarControl = jsonSchemaScalarControlForPath(schemaSummary, node.path);
    if (scalarControl?.unsupportedReason) return false;
    return jsonEditActionsForNode(node, sourceMap, schemaSummary).includes('replaceScalar');
  };
  const startInlineEdit = (node: JsonTreeNodeModel) => {
    if (!canInlineEditNode(node)) {
      handleOpenEditAction('replaceScalar', node);
      return;
    }
    const scalarControl = jsonSchemaScalarControlForPath(schemaSummary, node.path);
    const editState: JsonTreeEditDialogState = { action: 'replaceScalar', node };
    setActionToolbar(null);
    setContextMenu(null);
    setEditDialog(null);
    onSelectedPathChange?.(node.path);
    setInlineEdit({
      nodePath: node.path,
      draft: scalarDraftForDialogState(editState, scalarControl, null, sourceText),
      enumOptionTexts: scalarControl?.enumValues.map(serializeSchemaScalarValue) ?? [],
      error: null,
    });
  };
  const updateInlineDraft = (node: JsonTreeNodeModel, draft: ScalarDraft) => {
    setInlineEdit((current) => current?.nodePath === node.path ? { ...current, draft, error: null } : current);
  };
  const cancelInlineEdit = () => setInlineEdit(null);
  const commitInlineEdit = (node: JsonTreeNodeModel, draft: ScalarDraft) => {
    const scalarControl = jsonSchemaScalarControlForPath(schemaSummary, node.path);
    const result = createIntentFromDialogState({
      state: { action: 'replaceScalar', node },
      expectedSourceHash,
      scalarType: draft.type,
      scalarText: draft.text,
      booleanText: draft.booleanText,
      enumValueText: draft.enumValueText,
      enumValues: scalarControl?.enumValues ?? [],
      generatedValue: null,
      schemaUnsupportedReason: scalarControl?.unsupportedReason ?? null,
      fieldKey: '',
      arrayIndex: '0',
    });
    if (!result.ok) {
      setInlineEdit((current) => current?.nodePath === node.path ? { ...current, draft, error: result.error } : current);
      return;
    }
    setInlineEdit(null);
    onEditIntent?.(result.intent);
  };
  const handleSubmitEditIntent = (intent: JsonVisualEditIntent) => {
    onEditIntent?.(intent);
    setEditDialog(null);
  };
  const toggleExpanded = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };
  const contextMenuSections = contextMenuNode
    ? jsonTreeContextMenuSections({
      node: contextMenuNode,
      expanded: expandedPaths.has(contextMenuNode.path),
      editActions: contextMenuEditActions,
      disabledEditReason: jsonVisualEditDisabledReason(contextMenuNode, sourceMap),
      canRevealSource: Boolean(onRevealSource && contextMenuNode.sourceRef && jsonTreeNodeHasSourceRange(contextMenuNode)),
      onCopy: (mode) => handleCopyNodeValue(contextMenuNode, mode),
      onEdit: (action) => handleOpenEditAction(action, contextMenuNode),
      onRevealSource: () => handleRevealSource(contextMenuNode),
      onToggleExpanded: () => toggleExpanded(contextMenuNode.path),
    })
    : [];

  return (
    <section className="json-tree-view" aria-label={label}>
      <header className="json-tree-header">
        <div>
          <ListTree size={16} />
          <strong>{label}</strong>
          <span>{preservationWarnings.length > 0 ? `Read-only - ${preservationWarnings.length} preservation warning${preservationWarnings.length === 1 ? '' : 's'}` : 'Read-only'}</span>
        </div>
        <div className="json-tree-actions" role="toolbar" aria-label={`${label} copy actions`}>
          <JsonCopyButton label="Copy path" text={resolvedSelectedPath} />
          <JsonCopyButton label="Copy JSON" text={jsonValueToClipboardText(selectedNode.value, 'json')} />
          <JsonCopyButton label="Copy text" text={jsonValueToClipboardText(selectedNode.value, 'text')} />
          {jsonPreview && <JsonCopyButton label="Copy JSON preview" text={jsonPreview.content} />}
          {selectedEditActions.map((action) => (
            <JsonEditActionButton
              key={action}
              action={action}
              onClick={() => handleOpenEditAction(action)}
            />
          ))}
        </div>
      </header>
      {preservationWarnings.length > 0 && (
        <div className="json-tree-preservation-bar" aria-label="Preservation warnings">
          {preservationWarnings.slice(0, 5).map((warning) => (
            <span
              key={`${warning.code}:${warning.offset ?? warning.line ?? 0}`}
              title={warning.message}
            >
              {preservationWarningLabel(warning)}
            </span>
          ))}
          {preservationWarnings.length > 5 && <span>+{preservationWarnings.length - 5} more</span>}
        </div>
      )}
      <div className="json-tree-scroll" role="tree" aria-label={`${label} document tree`}>
        <JsonTreeNode
          node={root}
          expandedPaths={expandedPaths}
          selectedPath={resolvedSelectedPath}
          onSelectPath={handleSelectPath}
          onToggleExpanded={toggleExpanded}
          onOpenActions={handleOpenNodeActions}
          onOpenContextMenu={handleOpenNodeContextMenu}
          onOpenKeyboardContextMenu={handleOpenNodeKeyboardContextMenu}
          inlineEdit={inlineEdit}
          canInlineEditNode={canInlineEditNode}
          onStartInlineEdit={startInlineEdit}
          onInlineDraftChange={updateInlineDraft}
          onInlineCommit={commitInlineEdit}
          onInlineCancel={cancelInlineEdit}
        />
      </div>
      {contextMenu && contextMenuNode && (
        <ContextMenuCard
          ariaLabel={`Actions for ${contextMenuNode.path}`}
          sections={contextMenuSections}
          position={contextMenu.position}
          restoreFocusTo={contextMenu.restoreFocusTo}
          onClose={() => setContextMenu(null)}
        />
      )}
      {actionToolbar && actionToolbarNode && (
        <JsonTreeFloatingActionToolbar
          node={actionToolbarNode}
          position={actionToolbar.position}
          editActions={actionToolbarEditActions}
          canRevealSource={Boolean(structuredOperationsForTarget({
            kind: 'node',
            editActions: [],
            canRevealSource: Boolean(onRevealSource && actionToolbarNode.sourceRef && jsonTreeNodeHasSourceRange(actionToolbarNode)),
            hasChildren: actionToolbarNode.children.length > 0,
            expanded: expandedPaths.has(actionToolbarNode.path),
          }).find((operation) => operation.id === 'revealSource' && !operation.disabled))}
          onCopy={handleCopyNodeValue}
          onEdit={(action) => handleOpenEditAction(action, actionToolbarNode)}
          onRevealSource={() => handleRevealSource(actionToolbarNode)}
          onClose={() => setActionToolbar(null)}
        />
      )}
      <JsonTreeEditDialog
        state={editDialog}
        sourceText={sourceText}
        expectedSourceHash={expectedSourceHash}
        schemaSummary={schemaSummary}
        onCancel={() => setEditDialog(null)}
        onSubmit={handleSubmitEditIntent}
      />
    </section>
  );
}

function JsonTreeNode({
  node,
  expandedPaths,
  selectedPath,
  onSelectPath,
  onToggleExpanded,
  onOpenActions,
  onOpenContextMenu,
  onOpenKeyboardContextMenu,
  inlineEdit,
  canInlineEditNode,
  onStartInlineEdit,
  onInlineDraftChange,
  onInlineCommit,
  onInlineCancel,
}: {
  node: JsonTreeNodeModel;
  expandedPaths: Set<string>;
  selectedPath: string;
  onSelectPath: (path: string) => void;
  onToggleExpanded: (path: string) => void;
  onOpenActions: (node: JsonTreeNodeModel, event: MouseEvent<HTMLButtonElement>) => void;
  onOpenContextMenu: (node: JsonTreeNodeModel, event: MouseEvent<HTMLButtonElement>) => void;
  onOpenKeyboardContextMenu: (node: JsonTreeNodeModel, event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  inlineEdit: JsonTreeInlineEditState | null;
  canInlineEditNode: (node: JsonTreeNodeModel) => boolean;
  onStartInlineEdit: (node: JsonTreeNodeModel) => void;
  onInlineDraftChange: (node: JsonTreeNodeModel, draft: ScalarDraft) => void;
  onInlineCommit: (node: JsonTreeNodeModel, draft: ScalarDraft) => void;
  onInlineCancel: () => void;
}) {
  const isContainer = node.children.length > 0;
  const expanded = expandedPaths.has(node.path);
  const editing = inlineEdit?.nodePath === node.path ? inlineEdit : null;
  return (
    <>
      <div
        className={`json-tree-item depth-${Math.min(node.depth, 8)} type-${node.type} ${isContainer ? 'has-children' : 'leaf'} ${selectedPath === node.path ? 'selected' : ''}`}
        role="treeitem"
        aria-level={node.depth + 1}
        aria-expanded={isContainer ? expanded : undefined}
        aria-selected={selectedPath === node.path}
        data-json-pointer={node.pointer}
        data-json-type={node.type}
        data-json-editable={node.editable ? 'true' : 'false'}
        data-json-lossy={node.lossy ? 'true' : 'false'}
      >
        <div className="json-tree-row" style={{ paddingLeft: `${node.depth * 18 + 8}px` }}>
          <span className="json-tree-toggle-slot">
            {isContainer && (
              <button
                type="button"
                className={`json-tree-toggle ${expanded ? 'expanded' : ''}`}
                aria-label={expanded ? `Collapse ${node.path}` : `Expand ${node.path}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleExpanded(node.path);
                }}
              >
                <ChevronRight size={14} />
              </button>
            )}
          </span>
          {editing ? (
            <div className="json-tree-select is-inline-edit">
              <span className="json-tree-key">{node.key}</span>
              <span className={`json-tree-type ${node.type}`}>{node.type}</span>
              <span className="json-tree-node-flags">
                {node.lossy && <span title={node.unsupportedReason ?? 'This node is a lossy read-only projection.'}>Lossy</span>}
              </span>
              <JsonTreeInlineScalarEditor
                node={node}
                draft={editing.draft}
                enumOptionTexts={editing.enumOptionTexts}
                error={editing.error}
                onDraftChange={(draft) => onInlineDraftChange(node, draft)}
                onCommit={(draft) => onInlineCommit(node, draft)}
                onCancel={onInlineCancel}
              />
            </div>
          ) : (
            <button
              type="button"
              className="json-tree-select"
              onClick={() => onSelectPath(node.path)}
              onDoubleClick={(event) => {
                if (canInlineEditNode(node)) {
                  event.preventDefault();
                  onStartInlineEdit(node);
                  return;
                }
                onOpenActions(node, event);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canInlineEditNode(node)) {
                  event.preventDefault();
                  onStartInlineEdit(node);
                  return;
                }
                onOpenKeyboardContextMenu(node, event);
              }}
              onContextMenu={(event) => onOpenContextMenu(node, event)}
            >
              <span className="json-tree-key">{node.key}</span>
              <span className={`json-tree-type ${node.type}`}>{node.type}</span>
              <span className="json-tree-node-flags">
                {node.lossy && <span title={node.unsupportedReason ?? 'This node is a lossy read-only projection.'}>Lossy</span>}
              </span>
              <span className="json-tree-preview">{jsonNodePreview(node)}</span>
            </button>
          )}
        </div>
      </div>
      {isContainer && expanded && (
        <div role="group">
          {node.children.map((child) => (
            <JsonTreeNode
              key={child.pointer}
              node={child}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              onSelectPath={onSelectPath}
              onToggleExpanded={onToggleExpanded}
              onOpenActions={onOpenActions}
              onOpenContextMenu={onOpenContextMenu}
              onOpenKeyboardContextMenu={onOpenKeyboardContextMenu}
              inlineEdit={inlineEdit}
              canInlineEditNode={canInlineEditNode}
              onStartInlineEdit={onStartInlineEdit}
              onInlineDraftChange={onInlineDraftChange}
              onInlineCommit={onInlineCommit}
              onInlineCancel={onInlineCancel}
            />
          ))}
        </div>
      )}
    </>
  );
}

function JsonTreeFloatingActionToolbar({
  node,
  position,
  editActions,
  canRevealSource,
  onCopy,
  onEdit,
  onRevealSource,
  onClose,
}: {
  node: JsonTreeNodeModel;
  position: JsonTreeToolbarPosition;
  editActions: JsonTreeEditAction[];
  canRevealSource: boolean;
  onCopy: (node: JsonTreeNodeModel, mode: 'path' | 'json' | 'text') => void;
  onEdit: (action: JsonTreeEditAction) => void;
  onRevealSource: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="floating-toolbar json-tree-floating-toolbar"
      role="toolbar"
      aria-label={`Actions for ${node.path}`}
      style={{ top: position.top, left: position.left }}
    >
      <button type="button" className="wide" aria-label="Copy path" title="Copy path" onMouseDown={(event) => event.preventDefault()} onClick={() => onCopy(node, 'path')}>
        <Copy size={15} />
        <span>Path</span>
      </button>
      <button type="button" className="wide" aria-label="Copy JSON" title="Copy JSON" onMouseDown={(event) => event.preventDefault()} onClick={() => onCopy(node, 'json')}>
        <Copy size={15} />
        <span>JSON</span>
      </button>
      <button type="button" className="wide" aria-label="Copy text" title="Copy text" onMouseDown={(event) => event.preventDefault()} onClick={() => onCopy(node, 'text')}>
        <Copy size={15} />
        <span>Text</span>
      </button>
      {canRevealSource && (
        <button type="button" className="wide" aria-label="Reveal in source" title="Reveal in source" onMouseDown={(event) => event.preventDefault()} onClick={onRevealSource}>
          <FileCode2 size={15} />
          <span>Source</span>
        </button>
      )}
      {editActions.length > 0 && <span className="json-tree-floating-divider" aria-hidden="true" />}
      {editActions.map((action) => (
        <JsonTreeFloatingEditButton
          key={action}
          action={action}
          onClick={() => onEdit(action)}
        />
      ))}
      <button type="button" aria-label="Close row actions" title="Close" onMouseDown={(event) => event.preventDefault()} onClick={onClose}>
        <X size={15} />
      </button>
    </div>
  );
}

function JsonTreeInlineScalarEditor({
  node,
  draft,
  enumOptionTexts,
  error,
  onDraftChange,
  onCommit,
  onCancel,
}: {
  node: JsonTreeNodeModel;
  draft: ScalarDraft;
  enumOptionTexts: readonly string[];
  error: string | null;
  onDraftChange: (draft: ScalarDraft) => void;
  onCommit: (draft: ScalarDraft) => void;
  onCancel: () => void;
}) {
  const cancelingRef = useRef(false);
  const commit = () => {
    if (cancelingRef.current) return;
    onCommit(draft);
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelingRef.current = true;
      onCancel();
    }
  };
  const commonProps = {
    autoFocus: true,
    className: error ? 'has-error' : '',
    'aria-label': `Inline edit ${node.path}`,
    onKeyDown: handleKeyDown,
    onBlur: commit,
  };

  return (
    <span className="json-tree-inline-editor">
      {enumOptionTexts.length > 0 ? (
        <select
          {...commonProps}
          value={draft.enumValueText}
          onChange={(event) => onDraftChange({ ...draft, enumValueText: event.target.value })}
        >
          {enumOptionTexts.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      ) : draft.type === 'boolean' ? (
        <select
          {...commonProps}
          value={draft.booleanText}
          onChange={(event) => onDraftChange({ ...draft, booleanText: event.target.value })}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <input
          {...commonProps}
          value={draft.text}
          inputMode={draft.type === 'number' ? 'decimal' : undefined}
          onChange={(event) => onDraftChange({ ...draft, text: event.target.value })}
        />
      )}
      {error && <small role="alert">{error}</small>}
    </span>
  );
}

function JsonTreeFloatingEditButton({
  action,
  onClick,
}: {
  action: JsonTreeEditAction;
  onClick: () => void;
}) {
  const Icon = action === 'deleteObjectField' || action === 'deleteArrayItem' ? Trash2 : action === 'replaceScalar' || action === 'renameObjectKey' ? Pencil : Plus;
  const label = jsonEditActionLabel(action);
  return (
    <button
      type="button"
      className={action.startsWith('delete') ? 'danger' : ''}
      aria-label={label}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <Icon size={15} />
    </button>
  );
}

function jsonTreeToolbarPositionForElement(element: HTMLElement): JsonTreeToolbarPosition {
  const rect = element.getBoundingClientRect();
  const maxLeft = Math.max(12, window.innerWidth - JSON_TREE_ACTION_TOOLBAR_WIDTH - 12);
  const targetLeft = rect.left + Math.min(rect.width, JSON_TREE_ACTION_TOOLBAR_WIDTH) / 2 - JSON_TREE_ACTION_TOOLBAR_WIDTH / 2;
  return {
    top: Math.max(56, rect.top - 48),
    left: Math.min(maxLeft, Math.max(12, targetLeft)),
  };
}

function jsonTreeContextMenuSections({
  node,
  expanded,
  editActions,
  disabledEditReason,
  canRevealSource,
  onCopy,
  onEdit,
  onRevealSource,
  onToggleExpanded,
}: {
  node: JsonTreeNodeModel;
  expanded: boolean;
  editActions: JsonTreeEditAction[];
  disabledEditReason: string | null;
  canRevealSource: boolean;
  onCopy: (mode: 'path' | 'json' | 'text') => Promise<void>;
  onEdit: (action: JsonTreeEditAction) => void;
  onRevealSource: () => void;
  onToggleExpanded: () => void;
}): ContextMenuSection[] {
  return structuredOperationSectionsToContextMenuSections(
    structuredOperationSectionsForTarget({
      kind: 'node',
      editActions,
      editDisabledReason: disabledEditReason,
      canRevealSource,
      hasChildren: node.children.length > 0,
      expanded,
    }),
    {
      copyPath: () => onCopy('path'),
      copyJson: () => onCopy('json'),
      copyText: () => onCopy('text'),
      revealSource: onRevealSource,
      expandNode: onToggleExpanded,
      collapseNode: onToggleExpanded,
      replaceScalar: () => onEdit('replaceScalar'),
      renameObjectKey: () => onEdit('renameObjectKey'),
      addObjectField: () => onEdit('addObjectField'),
      addRequiredField: () => onEdit('addRequiredField'),
      deleteObjectField: () => onEdit('deleteObjectField'),
      addArrayItem: () => onEdit('addArrayItem'),
      deleteArrayItem: () => onEdit('deleteArrayItem'),
    },
  );
}

function jsonTreeNodeHasSourceRange(node: JsonTreeNodeModel): boolean {
  return Boolean(node.sourceRef?.valueSpan ?? node.sourceRef?.span ?? node.sourceRef?.keySpan);
}

function jsonVisualEditDisabledReason(
  node: JsonTreeNodeModel,
  sourceMap: StructuredSourceMap | null,
): string | null {
  if (!sourceMap) return null;
  if (sourceMap.format !== 'json') {
    return `${sourceMap.format.toUpperCase()} is shown as a read-only JSON projection; switch to JSON source to edit visually.`;
  }
  if (node.lossy) {
    return node.unsupportedReason ?? 'This node is a lossy read-only projection.';
  }
  if (!node.sourceRef?.editable) {
    return 'This node does not map to an editable source range.';
  }
  return null;
}

function preservationWarningLabel(diagnostic: FormatDiagnostic): string {
  if (diagnostic.code.includes('comments')) return 'comments';
  if (diagnostic.code.includes('anchor')) return 'anchors';
  if (diagnostic.code.includes('alias')) return 'aliases';
  if (diagnostic.code.includes('tag')) return 'tags';
  if (diagnostic.code.includes('block-scalar')) return 'block scalars';
  if (diagnostic.code.includes('array-table')) return 'array tables';
  if (diagnostic.code.includes('dotted-key')) return 'dotted keys';
  if (diagnostic.code.includes('duplicate')) return 'duplicates';
  return diagnostic.category ?? 'preservation';
}

function JsonCopyButton({ label, text }: { label: string; text: string }) {
  return (
    <button
      type="button"
      className="json-tree-copy-button"
      onClick={() => void writeClipboardText(text)}
    >
      <Copy size={14} />
      <span>{label}</span>
    </button>
  );
}

function JsonEditActionButton({
  action,
  onClick,
}: {
  action: JsonTreeEditAction;
  onClick: () => void;
}) {
  const Icon = action === 'deleteObjectField' || action === 'deleteArrayItem' ? Trash2 : action === 'replaceScalar' || action === 'renameObjectKey' ? Pencil : Plus;
  return (
    <button
      type="button"
      className={`json-tree-edit-button ${action.startsWith('delete') ? 'danger' : ''}`}
      onClick={onClick}
    >
      <Icon size={14} />
      <span>{jsonEditActionLabel(action)}</span>
    </button>
  );
}

function JsonTreeEditDialog({
  state,
  sourceText,
  expectedSourceHash,
  schemaSummary,
  onCancel,
  onSubmit,
}: {
  state: JsonTreeEditDialogState | null;
  sourceText?: string;
  expectedSourceHash?: string;
  schemaSummary: JsonSchemaSummary | null;
  onCancel: () => void;
  onSubmit: (intent: JsonVisualEditIntent) => void;
}) {
  if (!state) return null;
  return (
    <JsonTreeEditDialogForm
      key={`${state.action}:${state.node.pointer}`}
      state={state}
      sourceText={sourceText}
      expectedSourceHash={expectedSourceHash}
      schemaSummary={schemaSummary}
      onCancel={onCancel}
      onSubmit={onSubmit}
    />
  );
}

function JsonTreeEditDialogForm({
  state,
  sourceText,
  expectedSourceHash,
  schemaSummary,
  onCancel,
  onSubmit,
}: {
  state: JsonTreeEditDialogState;
  sourceText?: string;
  expectedSourceHash?: string;
  schemaSummary: JsonSchemaSummary | null;
  onCancel: () => void;
  onSubmit: (intent: JsonVisualEditIntent) => void;
}) {
  const objectControl = state.node.type === 'object'
    ? jsonSchemaObjectControlForPath(schemaSummary, state.node.path, state.node.value)
    : null;
  const scalarControl = state.action === 'replaceScalar'
    ? jsonSchemaScalarControlForPath(schemaSummary, state.node.path)
    : null;
  const schemaFieldOptions = schemaFieldOptionsForAction(state.action, objectControl);
  const initialSchemaField = schemaFieldOptions.find(schemaFieldCanWrite) ?? schemaFieldOptions[0] ?? null;
  const shouldSelectInitialSchemaField = state.action === 'addRequiredField'
    || (state.action === 'addObjectField' && objectControl !== null && !objectControl.additionalPropertiesAllowed);
  const initialSelectedSchemaField = shouldSelectInitialSchemaField ? initialSchemaField : null;
  const initialDraft = scalarDraftForDialogState(state, scalarControl, initialSelectedSchemaField, sourceText);
  const [schemaFieldPath, setSchemaFieldPath] = useState(
    initialSelectedSchemaField?.path ?? '',
  );
  const [scalarType, setScalarType] = useState<JsonValueType>(initialDraft.type);
  const [scalarText, setScalarText] = useState(initialDraft.text);
  const [booleanText, setBooleanText] = useState(initialDraft.booleanText);
  const [enumValueText, setEnumValueText] = useState(initialDraft.enumValueText);
  const [fieldKey, setFieldKey] = useState(initialFieldKeyForDialog(state, initialSelectedSchemaField));
  const [arrayIndex, setArrayIndex] = useState(String(state.arrayInsertIndex ?? 0));
  const [error, setError] = useState<string | null>(null);
  const selectedSchemaField = schemaFieldOptions.find((field) => field.path === schemaFieldPath) ?? null;
  const selectedGeneratedValue = selectedSchemaField?.generatedValue ?? null;
  const selectedSchemaUnsupportedReason = selectedSchemaField && !schemaFieldCanWrite(selectedSchemaField)
    ? selectedSchemaField.unsupportedReason ?? 'Schema field cannot be generated safely.'
    : null;
  const fieldKeySchemaControl = state.action === 'addObjectField'
    ? objectControl?.fields.find((field) => field.key === fieldKey.trim() && !field.present) ?? null
    : null;
  const activeScalarControl = selectedSchemaField?.canEditScalar
    ? selectedSchemaField
    : fieldKeySchemaControl?.canEditScalar
      ? fieldKeySchemaControl
      : scalarControl;
  const needsScalarValue = (state.action === 'replaceScalar'
    || state.action === 'addObjectField'
    || state.action === 'addRequiredField'
    || state.action === 'addArrayItem')
    && !selectedGeneratedValue
    && !selectedSchemaUnsupportedReason;
  const needsFieldKey = state.action === 'renameObjectKey'
    || state.action === 'addObjectField'
    || state.action === 'addRequiredField';
  const needsArrayIndex = state.action === 'addArrayItem';
  const enumOptionTexts = useMemo(() => (
    activeScalarControl?.enumValues.map(serializeSchemaScalarValue) ?? []
  ), [activeScalarControl]);
  const scalarTypeOptions = useMemo(() => scalarTypeOptionsForControl(activeScalarControl), [activeScalarControl]);

  useEffect(() => {
    if (enumOptionTexts.length > 0 && !enumOptionTexts.includes(enumValueText)) {
      setEnumValueText(enumOptionTexts[0] ?? '');
    }
    if (scalarTypeOptions.length > 0 && !scalarTypeOptions.includes(scalarType)) {
      setScalarType(scalarTypeOptions[0]);
    }
  }, [enumOptionTexts, enumValueText, scalarType, scalarTypeOptions]);

  const submit = () => {
    const result = createIntentFromDialogState({
      state,
      expectedSourceHash,
      scalarType,
      scalarText,
      booleanText,
      enumValueText,
      enumValues: activeScalarControl?.enumValues ?? [],
      generatedValue: selectedGeneratedValue,
      schemaUnsupportedReason: selectedSchemaUnsupportedReason,
      fieldKey,
      arrayIndex,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSubmit(result.intent);
  };
  const applySchemaField = (path: string) => {
    setSchemaFieldPath(path);
    const field = schemaFieldOptions.find((option) => option.path === path);
    if (!field) return;
    setFieldKey(field.key);
    const nextDraft = scalarDraftForControl(field);
    setScalarType(nextDraft.type);
    setScalarText(nextDraft.text);
    setBooleanText(nextDraft.booleanText);
    setEnumValueText(nextDraft.enumValueText);
  };

  return (
    <ModalShell open titleId="json-tree-edit-title" className="json-tree-edit-dialog" onCancel={onCancel}>
      <header className="dialog-header">
        <h2 id="json-tree-edit-title">{jsonEditDialogTitle(state.action)}</h2>
      </header>
      <dl className="json-tree-edit-target">
        <div>
          <dt>Path</dt>
          <dd>{state.node.path}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{state.node.type}</dd>
        </div>
      </dl>
      {(state.action === 'addObjectField' || state.action === 'addRequiredField') && schemaFieldOptions.length > 0 && (
        <label className="json-tree-edit-field">
          <span>{state.action === 'addRequiredField' ? 'Required field' : 'Schema field'}</span>
          <select
            value={schemaFieldPath}
            onChange={(event) => applySchemaField(event.target.value)}
            autoFocus
          >
            {state.action === 'addObjectField' && (objectControl?.additionalPropertiesAllowed ?? true) && (
              <option value="">Custom field</option>
            )}
            {schemaFieldOptions.map((field) => (
              <option key={field.path} value={field.path} disabled={!schemaFieldCanWrite(field)}>
                {schemaFieldOptionLabel(field)}
              </option>
            ))}
          </select>
          {selectedSchemaField?.description && <small>{selectedSchemaField.description}</small>}
          {selectedSchemaUnsupportedReason && <small>{selectedSchemaUnsupportedReason}</small>}
        </label>
      )}
      {needsFieldKey && (
        <label className="json-tree-edit-field">
          <span>{state.action === 'renameObjectKey' ? 'Key' : 'New key'}</span>
          <input
            value={fieldKey}
            readOnly={state.action === 'addRequiredField'}
            onChange={(event) => {
              setFieldKey(event.target.value);
              if (state.action === 'addObjectField') setSchemaFieldPath('');
            }}
            autoFocus={!schemaFieldOptions.length}
          />
          {activeScalarControl?.description && !selectedSchemaField?.description && <small>{activeScalarControl.description}</small>}
        </label>
      )}
      {needsArrayIndex && (
        <label className="json-tree-edit-field">
          <span>Index</span>
          <input
            type="number"
            min={0}
            max={state.node.children.length}
            value={arrayIndex}
            onChange={(event) => setArrayIndex(event.target.value)}
          />
        </label>
      )}
      {selectedGeneratedValue && (
        <section className="json-tree-generated-value" aria-label="Generated schema value">
          <span>Generated value</span>
          <pre>{formatGeneratedValuePreview(selectedGeneratedValue)}</pre>
          <small>{selectedGeneratedValue.explanation}</small>
        </section>
      )}
      {needsScalarValue && (
        <fieldset className="json-tree-edit-fieldset">
          <legend>Value</legend>
          {enumOptionTexts.length > 0 ? (
            <label className="json-tree-edit-field">
              <span>Enum</span>
              <select
                value={enumValueText}
                onChange={(event) => setEnumValueText(event.target.value)}
                autoFocus={!needsFieldKey}
              >
                {enumOptionTexts.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="json-tree-edit-field">
                <span>Type</span>
                <select
                  value={scalarType}
                  onChange={(event) => setScalarType(event.target.value as JsonValueType)}
                  autoFocus={!needsFieldKey}
                >
                  {scalarTypeOptions.map((option) => (
                    <option key={option} value={option}>{jsonValueTypeLabel(option)}</option>
                  ))}
                </select>
              </label>
              {scalarType === 'boolean' ? (
                <label className="json-tree-edit-field">
                  <span>Boolean</span>
                  <select value={booleanText} onChange={(event) => setBooleanText(event.target.value)}>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                </label>
              ) : scalarType === 'null' ? null : (
                <label className="json-tree-edit-field">
                  <span>{scalarType === 'number' ? 'Number' : 'Text'}</span>
                  <input
                    value={scalarText}
                    onChange={(event) => setScalarText(event.target.value)}
                  />
                </label>
              )}
            </>
          )}
          {activeScalarControl?.unsupportedReason && <small>{activeScalarControl.unsupportedReason}</small>}
        </fieldset>
      )}
      {error && <p className="json-tree-edit-error">{error}</p>}
      <DialogActions>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className={state.action.startsWith('delete') ? 'danger' : 'primary'}
          disabled={Boolean(selectedSchemaUnsupportedReason)}
          onClick={submit}
        >
          {jsonEditSubmitLabel(state.action)}
        </button>
      </DialogActions>
    </ModalShell>
  );
}

function createIntentFromDialogState({
  state,
  expectedSourceHash,
  scalarType,
  scalarText,
  booleanText,
  enumValueText,
  enumValues,
  generatedValue,
  schemaUnsupportedReason,
  fieldKey,
  arrayIndex,
}: {
  state: JsonTreeEditDialogState;
  expectedSourceHash?: string;
  scalarType: JsonValueType;
  scalarText: string;
  booleanText: string;
  enumValueText: string;
  enumValues: readonly JsonSchemaScalarValue[];
  generatedValue: JsonSchemaGeneratedValue | null;
  schemaUnsupportedReason: string | null;
  fieldKey: string;
  arrayIndex: string;
}): { ok: true; intent: JsonVisualEditIntent } | { ok: false; error: string } {
  const trimmedKey = fieldKey.trim();
  if ((state.action === 'renameObjectKey' || state.action === 'addObjectField' || state.action === 'addRequiredField') && !trimmedKey) {
    return { ok: false, error: 'JSON object keys cannot be empty.' };
  }

  if (state.action === 'renameObjectKey') {
    return {
      ok: true,
      intent: { kind: state.action, path: state.node.pathSegments, newKey: trimmedKey, expectedSourceHash },
    };
  }
  if (state.action === 'deleteObjectField' || state.action === 'deleteArrayItem') {
    return {
      ok: true,
      intent: { kind: state.action, path: state.node.pathSegments, expectedSourceHash },
    };
  }

  if (schemaUnsupportedReason) return { ok: false, error: schemaUnsupportedReason };
  if (generatedValue && (state.action === 'addObjectField' || state.action === 'addRequiredField')) {
    return {
      ok: true,
      intent: {
        kind: 'addObjectField',
        path: state.node.pathSegments,
        key: trimmedKey,
        value: cloneJsonEditableValue(generatedValue.value),
        schemaGeneratedValueExplanation: generatedValue.explanation,
        expectedSourceHash,
      },
    };
  }

  const scalar = enumValues.length > 0
    ? parseEnumScalarDraft(enumValueText, enumValues)
    : parseScalarDraft(scalarType, scalarText, booleanText);
  if (!scalar.ok) return scalar;
  if (state.action === 'replaceScalar') {
    return {
      ok: true,
      intent: { kind: state.action, path: state.node.pathSegments, nextValue: scalar.value, expectedSourceHash },
    };
  }
  if (state.action === 'addObjectField' || state.action === 'addRequiredField') {
    return {
      ok: true,
      intent: { kind: 'addObjectField', path: state.node.pathSegments, key: trimmedKey, value: scalar.value, expectedSourceHash },
    };
  }

  const index = Number(arrayIndex);
  if (!Number.isInteger(index) || index < 0 || index > state.node.children.length) {
    return { ok: false, error: `Index must be between 0 and ${state.node.children.length}.` };
  }
  return {
    ok: true,
    intent: { kind: state.action, path: state.node.pathSegments, index, value: scalar.value, expectedSourceHash },
  };
}

function parseScalarDraft(
  scalarType: JsonValueType,
  scalarText: string,
  booleanText: string,
): { ok: true; value: JsonEditableScalarValue } | { ok: false; error: string } {
  if (scalarType === 'string') return { ok: true, value: scalarText };
  if (scalarType === 'boolean') return { ok: true, value: booleanText === 'true' };
  if (scalarType === 'null') return { ok: true, value: null };
  if (scalarType === 'number') {
    const trimmed = scalarText.trim();
    if (!trimmed) return { ok: false, error: 'Number value cannot be empty.' };
    const value = createJsonRawNumberToken(trimmed);
    if (!value) return { ok: false, error: 'Number value must be a valid JSON number.' };
    return { ok: true, value };
  }
  return { ok: false, error: 'Only JSON scalar values can be edited visually.' };
}

function parseEnumScalarDraft(
  enumValueText: string,
  enumValues: readonly JsonSchemaScalarValue[],
): { ok: true; value: JsonSchemaScalarValue } | { ok: false; error: string } {
  const value = enumValues.find((candidate) => serializeSchemaScalarValue(candidate) === enumValueText);
  return value === undefined
    ? { ok: false, error: 'Choose one of the schema enum values.' }
    : { ok: true, value };
}

function jsonEditActionsForNode(
  node: JsonTreeNodeModel,
  sourceMap: StructuredSourceMap | null,
  schemaSummary: JsonSchemaSummary | null,
): JsonTreeEditAction[] {
  const actions: JsonTreeEditAction[] = [];
  if (isScalarJsonNode(node)) actions.push('replaceScalar');
  if (isObjectFieldNode(node, sourceMap)) {
    actions.push('renameObjectKey', 'deleteObjectField');
  }
  if (node.type === 'object') {
    const objectControl = jsonSchemaObjectControlForPath(schemaSummary, node.path, node.value);
    if (objectControl?.missingRequiredFields.length) actions.push('addRequiredField');
    const hasSchemaField = objectControl?.fields.some((field) => !field.present) ?? false;
    if (!objectControl || objectControl.additionalPropertiesAllowed || hasSchemaField) actions.push('addObjectField');
  }
  if (node.type === 'array') actions.push('addArrayItem');
  if (isArrayItemNode(node, sourceMap)) actions.push('deleteArrayItem');
  return actions;
}

function isObjectFieldNode(node: JsonTreeNodeModel, sourceMap: StructuredSourceMap | null): boolean {
  const last = node.pathSegments.at(-1);
  if (typeof last !== 'string' || node.pathSegments.length === 0 || !node.keySpan) return false;
  const parent = parentSourceNode(node, sourceMap);
  return parent?.type === 'object';
}

function isArrayItemNode(node: JsonTreeNodeModel, sourceMap: StructuredSourceMap | null): boolean {
  const last = node.pathSegments.at(-1);
  if (typeof last !== 'number' || node.pathSegments.length === 0) return false;
  const parent = parentSourceNode(node, sourceMap);
  return parent?.type === 'array';
}

function parentSourceNode(
  node: JsonTreeNodeModel,
  sourceMap: StructuredSourceMap | null,
): StructuredNodeRef | null {
  if (!sourceMap || node.pathSegments.length === 0) return null;
  return sourceMap.nodesByPointer[pointerFromPath(node.pathSegments.slice(0, -1))] ?? null;
}

function isScalarJsonNode(node: JsonTreeNodeModel): boolean {
  return node.type === 'string'
    || node.type === 'number'
    || node.type === 'boolean'
    || node.type === 'null';
}

interface ScalarDraft {
  type: JsonValueType;
  text: string;
  booleanText: string;
  enumValueText: string;
}

function schemaFieldOptionsForAction(
  action: JsonTreeEditAction,
  objectControl: ReturnType<typeof jsonSchemaObjectControlForPath>,
): JsonSchemaObjectFieldSuggestion[] {
  if (!objectControl) return [];
  const fields = objectControl.fields.filter((field) => !field.present);
  return action === 'addRequiredField'
    ? fields.filter((field) => field.required)
    : action === 'addObjectField'
      ? fields
      : [];
}

function schemaFieldCanWrite(field: JsonSchemaObjectFieldSuggestion): boolean {
  return field.canEditScalar || Boolean(field.generatedValue);
}

function schemaFieldOptionLabel(field: JsonSchemaObjectFieldSuggestion): string {
  const status = field.required ? ' required' : '';
  const type = field.generatedValue
    ? `: generated ${field.generatedValue.kind}`
    : field.typeHints.length
      ? `: ${field.typeHints.join(' | ')}`
      : '';
  const unavailable = schemaFieldCanWrite(field) ? '' : ' unavailable';
  return `${field.key}${status}${type}${unavailable}`;
}

function formatGeneratedValuePreview(generatedValue: JsonSchemaGeneratedValue): string {
  return JSON.stringify(generatedValue.value, null, 2) ?? String(generatedValue.value);
}

function cloneJsonEditableValue(value: JsonEditableValue): JsonEditableValue {
  if (Array.isArray(value)) return value.map((item) => cloneJsonEditableValue(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneJsonEditableValue(child)]),
    );
  }
  return value;
}

function initialFieldKeyForDialog(
  state: JsonTreeEditDialogState,
  initialSchemaField: JsonSchemaObjectFieldSuggestion | null,
): string {
  if (state.action === 'renameObjectKey') return String(state.node.pathSegments.at(-1) ?? '');
  if (state.action === 'addRequiredField' || (state.action === 'addObjectField' && initialSchemaField)) {
    return initialSchemaField?.key ?? '';
  }
  return '';
}

function scalarDraftForDialogState(
  state: JsonTreeEditDialogState,
  scalarControl: JsonSchemaScalarControl | null,
  initialSchemaField: JsonSchemaObjectFieldSuggestion | null,
  sourceText?: string,
): ScalarDraft {
  if (state.action === 'addRequiredField' && initialSchemaField) return scalarDraftForControl(initialSchemaField);
  if (state.action === 'addObjectField' && initialSchemaField) return scalarDraftForControl(initialSchemaField);
  if (state.action === 'replaceScalar') {
    return scalarDraftFromValue(
      isJsonScalarValue(state.node.value) ? state.node.value : '',
      scalarControl,
      state.node.type === 'number' ? sourceTextForSpan(sourceText, state.node.valueSpan) : null,
    );
  }
  return scalarDraftFromValue('');
}

function scalarDraftForControl(control: JsonSchemaScalarControl): ScalarDraft {
  return scalarDraftFromValue(control.defaultValue ?? '', control);
}

function scalarDraftFromValue(
  value: JsonSchemaScalarValue,
  control: JsonSchemaScalarControl | null = null,
  rawNumberText: string | null = null,
): ScalarDraft {
  const enumValueText = control?.enumValues.length
    ? serializeSchemaScalarValue(enumValueForDraft(value, control.enumValues))
    : '';
  const type = jsonValueTypeForScalar(value, control);
  return {
    type,
    text: rawNumberText ?? (typeof value === 'number' || typeof value === 'string' ? String(value) : ''),
    booleanText: value === false ? 'false' : 'true',
    enumValueText,
  };
}

function sourceTextForSpan(sourceText: string | undefined, span: SourceSpan | null): string | null {
  if (!sourceText || !span) return null;
  return sourceText.slice(span.offset, span.offset + span.length);
}

function enumValueForDraft(
  value: JsonSchemaScalarValue,
  enumValues: readonly JsonSchemaScalarValue[],
): JsonSchemaScalarValue {
  return enumValues.find((candidate) => serializeSchemaScalarValue(candidate) === serializeSchemaScalarValue(value))
    ?? enumValues[0]
    ?? value;
}

function jsonValueTypeForScalar(
  value: JsonSchemaScalarValue,
  control: JsonSchemaScalarControl | null,
): JsonValueType {
  if (control?.typeHints.length) return jsonValueTypeForSchemaType(control.typeHints[0]);
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value === null) return 'null';
  return 'string';
}

function jsonValueTypeForSchemaType(type: JsonSchemaScalarType): JsonValueType {
  return type === 'integer' ? 'number' : type;
}

function scalarTypeOptionsForControl(control: JsonSchemaScalarControl | JsonSchemaObjectFieldSuggestion | null): JsonValueType[] {
  if (!control?.typeHints.length) return ['string', 'number', 'boolean', 'null'];
  const options = control.typeHints.map(jsonValueTypeForSchemaType);
  return Array.from(new Set(options));
}

function jsonValueTypeLabel(type: JsonValueType): string {
  if (type === 'string') return 'String';
  if (type === 'number') return 'Number';
  if (type === 'boolean') return 'Boolean';
  if (type === 'null') return 'Null';
  return type;
}

function serializeSchemaScalarValue(value: JsonSchemaScalarValue): string {
  return JSON.stringify(value) ?? String(value);
}

function isJsonScalarValue(value: unknown): value is JsonSchemaScalarValue {
  return value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean';
}

function jsonEditActionLabel(action: JsonTreeEditAction): string {
  switch (action) {
    case 'replaceScalar':
      return 'Edit value';
    case 'renameObjectKey':
      return 'Rename key';
    case 'addObjectField':
      return 'Add field';
    case 'addRequiredField':
      return 'Add required';
    case 'deleteObjectField':
      return 'Delete field';
    case 'addArrayItem':
      return 'Add item';
    case 'deleteArrayItem':
      return 'Delete item';
  }
}

function jsonEditDialogTitle(action: JsonTreeEditAction): string {
  switch (action) {
    case 'replaceScalar':
      return 'Edit JSON value';
    case 'renameObjectKey':
      return 'Rename JSON key';
    case 'addObjectField':
      return 'Add JSON field';
    case 'addRequiredField':
      return 'Add required JSON field';
    case 'deleteObjectField':
      return 'Delete JSON field';
    case 'addArrayItem':
      return 'Add JSON item';
    case 'deleteArrayItem':
      return 'Delete JSON item';
  }
}

function jsonEditSubmitLabel(action: JsonTreeEditAction): string {
  switch (action) {
    case 'replaceScalar':
      return 'Apply value';
    case 'renameObjectKey':
      return 'Rename';
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
  }
}

export function buildJsonTreeModel(value: unknown, sourceMap: StructuredSourceMap | null = null): JsonTreeNodeModel {
  return buildJsonNode({
    key: 'root',
    value,
    path: '$',
    pointer: '',
    pathSegments: [],
    depth: 0,
    sourceMap,
  });
}

export function findJsonTreeNode(root: JsonTreeNodeModel, path: string): JsonTreeNodeModel | null {
  if (root.path === path) return root;
  for (const child of root.children) {
    const found = findJsonTreeNode(child, path);
    if (found) return found;
  }
  return null;
}

export function jsonValueToClipboardText(value: unknown, mode: 'json' | 'text'): string {
  if (mode === 'json') return JSON.stringify(value, null, 2) ?? 'null';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2) ?? '';
}

export function jsonPathForProperty(parentPath: string, property: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(property)
    ? `${parentPath}.${property}`
    : `${parentPath}[${JSON.stringify(property)}]`;
}

export function jsonPathForIndex(parentPath: string, index: number): string {
  return `${parentPath}[${index}]`;
}

function buildJsonNode({
  key,
  value,
  path,
  pointer,
  pathSegments,
  depth,
  sourceMap,
}: {
  key: string;
  value: unknown;
  path: string;
  pointer: string;
  pathSegments: StructuredPathSegment[];
  depth: number;
  sourceMap: StructuredSourceMap | null;
}): JsonTreeNodeModel {
  const type = jsonValueType(value);
  const sourceRef = sourceMap?.nodesByPointer[pointer]
    ?? sourceMap?.nodesByDisplayPath[path]
    ?? null;
  const children: JsonTreeNodeModel[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const childPathSegments = [...pathSegments, index];
      children.push(buildJsonNode({
        key: `[${index}]`,
        value: item,
        path: jsonPathForIndex(path, index),
        pointer: `${pointer}/${index}`,
        pathSegments: childPathSegments,
        depth: depth + 1,
        sourceMap,
      }));
    });
  } else if (isJsonObject(value)) {
    for (const [property, childValue] of Object.entries(value)) {
      const childPathSegments = [...pathSegments, property];
      children.push(buildJsonNode({
        key: property,
        value: childValue,
        path: jsonPathForProperty(path, property),
        pointer: `${pointer}/${escapeJsonPointerSegment(property)}`,
        pathSegments: childPathSegments,
        depth: depth + 1,
        sourceMap,
      }));
    }
  }

  return {
    key,
    path,
    pointer,
    pathSegments: sourceRef?.path ?? pathSegments,
    type,
    value,
    depth,
    sourceRef,
    span: sourceRef?.span ?? null,
    valueSpan: sourceRef?.valueSpan ?? null,
    keySpan: sourceRef?.keySpan ?? null,
    editable: sourceRef?.editable ?? false,
    lossy: sourceRef?.lossy ?? false,
    unsupportedReason: sourceRef?.unsupportedReason,
    children,
  };
}

function defaultExpandedPaths(root: JsonTreeNodeModel): Set<string> {
  return root.children.length > 0 ? new Set<string>(['$']) : new Set<string>();
}

function jsonNodePreview(node: JsonTreeNodeModel): string {
  if (node.type === 'object') return `${node.children.length} ${node.children.length === 1 ? 'key' : 'keys'}`;
  if (node.type === 'array') return `${node.children.length} ${node.children.length === 1 ? 'item' : 'items'}`;
  if (node.type === 'string') return truncatePreview(String(node.value));
  if (node.type === 'null') return 'null';
  return String(node.value);
}

function truncatePreview(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function jsonValueType(value: unknown): JsonValueType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  return 'boolean';
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escapeJsonPointerSegment(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

async function writeClipboardText(text: string): Promise<void> {
  return writeContextMenuClipboardText(text, 'JSON tree value');
}
