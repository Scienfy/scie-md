import { useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Code2, Eye, FileJson2, LockKeyhole, MapPinned } from 'lucide-react';
import {
  createStructuredPreviewModel as createCoreStructuredPreviewModel,
  formatBytes,
  isStructuredPreviewFormat,
  type DocumentFormat,
  type FormatDiagnostic,
  type StructuredPreviewFormat,
  type StructuredPreviewModel,
} from '@sciemd/core';
import type { ScieMDDocumentSnapshot } from '../shared/webviewProtocol';
import { VscodeWorkbenchShell } from './VscodeWorkbenchShell';

export type StructuredPreviewMode = 'tree' | 'source';

interface StructuredPreviewWorkbenchProps {
  snapshot: ScieMDDocumentSnapshot;
  status: string;
  mode: StructuredPreviewMode;
  onSelectTree: () => void;
  onSelectSource: () => void;
}

const TREE_NODE_LIMIT = 500;
const TREE_CHILD_PREVIEW_LIMIT = 120;

export function StructuredPreviewWorkbench({
  snapshot,
  status,
  mode,
  onSelectTree,
  onSelectSource,
}: StructuredPreviewWorkbenchProps) {
  const model = useMemo(() => createStructuredPreviewModel(snapshot), [snapshot]);
  const errorCount = model.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  const warningCount = model.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;
  const dirty = snapshot.isDirty;

  return (
    <VscodeWorkbenchShell
      editorMode={mode === 'tree' ? 'visual' : 'source'}
      topbar={(
        <header className="vscode-scie-topbar vscode-scie-structured-topbar">
          <div className="vscode-scie-identity">
            <span className="vscode-scie-structured-mark" aria-hidden="true"><FileJson2 size={17} /></span>
            <div className="vscode-scie-title">
              <strong>ScieMD</strong>
              <span title={snapshot.fileName}>{snapshot.fileName}</span>
            </div>
          </div>
          <div className="vscode-scie-topbar-controls">
            <div className="vscode-scie-mode-toggle" role="tablist" aria-label="Structured preview mode">
              <button
                type="button"
                className={mode === 'tree' ? 'selected' : ''}
                aria-selected={mode === 'tree'}
                role="tab"
                onClick={onSelectTree}
                title="Tree"
              >
                <Eye size={15} />
                <span>Tree</span>
              </button>
              <button
                type="button"
                className={mode === 'source' ? 'selected' : ''}
                aria-selected={mode === 'source'}
                role="tab"
                onClick={onSelectSource}
                title="Source"
              >
                <Code2 size={15} />
                <span>Source</span>
              </button>
            </div>
            <span className={`vscode-scie-status ${dirty ? 'dirty' : ''}`}>{status}</span>
          </div>
        </header>
      )}
      readonlyBanner={<div className="vscode-scie-banner" role="status">{snapshot.readonlyReason}</div>}
      toolbar={(
        <div className="vscode-scie-toolbar vscode-scie-structured-toolbar">
          <div className="vscode-scie-structured-summary" aria-label="Structured document summary">
            <span>{model.label}</span>
            {model.metrics.map((metric) => (
              <span key={metric.label}>{metric.value} {metric.label}</span>
            ))}
          </div>
          <div className="vscode-scie-structured-diagnostic-pill" data-tone={errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : 'ok'}>
            {errorCount > 0 ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
            <span>{diagnosticSummary(errorCount, warningCount)}</span>
          </div>
        </div>
      )}
      editorStage={(
        <main className="vscode-scie-editor-stage vscode-scie-structured-stage" data-testid="structured-preview-stage">
          <StructuredOperationSummary model={model} />
          <StructuredDiagnostics diagnostics={model.diagnostics} />
          {mode === 'source' ? (
            <pre className="vscode-scie-structured-source" data-testid="structured-source-preview">{model.sourceText}</pre>
          ) : snapshot.sourceTextTruncated ? (
            <section className="vscode-scie-structured-empty" data-testid="structured-tree-preview">
              <strong>Tree unavailable</strong>
              <span>ScieMD is showing a source excerpt because this file is above the VS Code structured preview message budget.</span>
            </section>
          ) : (
            <StructuredValueTree value={model.value} diagnostics={model.diagnostics} />
          )}
        </main>
      )}
    />
  );
}

export function isStructuredPreviewWebviewFormat(format: DocumentFormat | null | undefined): format is StructuredPreviewFormat {
  return isStructuredPreviewFormat(format);
}

export function createStructuredPreviewModel(snapshot: ScieMDDocumentSnapshot): StructuredPreviewModel {
  const format = isStructuredPreviewWebviewFormat(snapshot.format) ? snapshot.format : 'json';
  if (snapshot.sourceTextTruncated) {
    return createTruncatedStructuredPreviewModel(format, snapshot);
  }
  return createCoreStructuredPreviewModel({
    format,
    text: snapshot.text,
    path: snapshot.uri,
  });
}

function createTruncatedStructuredPreviewModel(
  format: StructuredPreviewFormat,
  snapshot: ScieMDDocumentSnapshot,
): StructuredPreviewModel {
  const label = structuredFormatLabel(format);
  const totalBytes = snapshot.sourceTotalBytes ?? snapshot.text.length;
  const limitBytes = snapshot.sourceLimitBytes ?? snapshot.text.length;
  const reason = `${label} preview is source-only because VS Code received a ${formatBytes(limitBytes)} source excerpt from a ${formatBytes(totalBytes)} file.`;
  return {
    format,
    label,
    value: null,
    sourceText: snapshot.text,
    diagnostics: [{
      severity: 'warning',
      code: `${format}-vscode-source-excerpt`,
      message: reason,
      source: format,
    }],
    metrics: [{ label: 'root', value: 'source-excerpt' }],
    editPolicy: {
      previewReadonly: true,
      canApplyClipboardReplace: false,
      clipboardReplaceRequiresOptIn: false,
      reason,
    },
    operations: [],
    sourceReveal: {
      available: false,
      strategy: 'none',
      mappedNodeCount: 0,
      totalNodeCount: 0,
      sampleTargets: [],
      reason,
    },
  };
}

function structuredFormatLabel(format: StructuredPreviewFormat): string {
  if (format === 'jsonl') return 'JSON Lines';
  return format.toUpperCase();
}

function StructuredOperationSummary({ model }: { model: StructuredPreviewModel }) {
  const clipboardOperation = model.operations.find((operation) => operation.id === 'applyClipboardReplace');
  const sourceRevealTone = model.sourceReveal.available ? 'available' : 'readonly';
  const clipboardTone = clipboardOperation?.enabled ? 'available' : 'readonly';
  return (
    <section className="vscode-scie-structured-operations" data-testid="structured-operation-summary" aria-label="Structured operation availability">
      <div className="vscode-scie-structured-operation" data-tone={sourceRevealTone}>
        <MapPinned size={15} />
        <div>
          <strong>Source reveal</strong>
          <span>{sourceRevealLabel(model.sourceReveal)}</span>
        </div>
      </div>
      {clipboardOperation ? (
        <div className="vscode-scie-structured-operation" data-tone={clipboardTone}>
          {clipboardOperation.enabled ? <ClipboardCheck size={15} /> : <LockKeyhole size={15} />}
          <div>
            <strong>{clipboardOperation.label}</strong>
            <span>{clipboardOperation.enabled ? clipboardOperationLabel(model) : clipboardOperation.disabledReason}</span>
          </div>
          {clipboardOperation.requiresOptIn ? <small>Opt-in</small> : null}
        </div>
      ) : null}
    </section>
  );
}

function StructuredDiagnostics({ diagnostics }: { diagnostics: FormatDiagnostic[] }) {
  if (diagnostics.length === 0) {
    return (
      <section className="vscode-scie-structured-diagnostics ok" aria-label="Structured diagnostics">
        <CheckCircle2 size={15} />
        <span>No parser diagnostics.</span>
      </section>
    );
  }

  return (
    <section className="vscode-scie-structured-diagnostics" aria-label="Structured diagnostics">
      {diagnostics.slice(0, 12).map((diagnostic, index) => (
        <div key={`${diagnostic.code}-${diagnostic.line ?? 'x'}-${index}`} className={`vscode-scie-structured-diagnostic ${diagnostic.severity}`}>
          <strong>{diagnostic.severity}</strong>
          <span>{diagnostic.message}</span>
          <small>{diagnosticLocation(diagnostic)}</small>
        </div>
      ))}
      {diagnostics.length > 12 ? <small>{diagnostics.length - 12} more diagnostics.</small> : null}
    </section>
  );
}

function StructuredValueTree({ value, diagnostics }: { value: unknown; diagnostics: FormatDiagnostic[] }) {
  const hasParseError = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  if (hasParseError && value === null) {
    return (
      <section className="vscode-scie-structured-empty" data-testid="structured-tree-preview">
        <strong>Tree unavailable</strong>
        <span>Parser errors must be fixed before ScieMD can build the read-only tree.</span>
      </section>
    );
  }

  const budget = { remaining: TREE_NODE_LIMIT };
  return (
    <section className="vscode-scie-structured-tree" data-testid="structured-tree-preview" aria-label="Read-only structured tree">
      <TreeNode name="$" value={value} depth={0} budget={budget} />
      {budget.remaining <= 0 ? <div className="vscode-scie-structured-limit">Tree preview truncated at {TREE_NODE_LIMIT} nodes.</div> : null}
    </section>
  );
}

function TreeNode({
  name,
  value,
  depth,
  budget,
}: {
  name: string;
  value: unknown;
  depth: number;
  budget: { remaining: number };
}) {
  if (budget.remaining <= 0) return null;
  budget.remaining -= 1;
  const type = valueType(value);
  const scalar = type !== 'object' && type !== 'array';
  if (scalar) {
    return (
      <div className="vscode-scie-tree-row scalar" style={{ '--tree-depth': depth } as CSSProperties}>
        <span className="vscode-scie-tree-key">{name}</span>
        <span className="vscode-scie-tree-type">{type}</span>
        <code>{scalarValue(value)}</code>
      </div>
    );
  }

  const children = Array.isArray(value)
    ? value.map((child, index) => [`[${index}]`, child] as const)
    : Object.entries(value as Record<string, unknown>);
  const visibleChildren = children.slice(0, TREE_CHILD_PREVIEW_LIMIT);

  return (
    <details className="vscode-scie-tree-node" open={depth < 2} style={{ '--tree-depth': depth } as CSSProperties}>
      <summary>
        <span className="vscode-scie-tree-key">{name}</span>
        <span className="vscode-scie-tree-type">{type}</span>
        <small>{children.length} item{children.length === 1 ? '' : 's'}</small>
      </summary>
      <div className="vscode-scie-tree-children">
        {visibleChildren.map(([childName, childValue]) => (
          <TreeNode key={`${depth}-${childName}`} name={childName} value={childValue} depth={depth + 1} budget={budget} />
        ))}
        {children.length > visibleChildren.length ? (
          <div className="vscode-scie-tree-row" style={{ '--tree-depth': depth + 1 } as CSSProperties}>
            <span className="vscode-scie-tree-key">...</span>
            <span>{children.length - visibleChildren.length} more items</span>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function sourceRevealLabel(sourceReveal: StructuredPreviewModel['sourceReveal']): string {
  if (!sourceReveal.available) return sourceReveal.reason;
  const sample = sourceReveal.sampleTargets[0];
  const sampleLabel = sample ? ` First mapped item: ${sample.displayPath} at ${sample.line}:${sample.column}.` : '';
  return `${sourceReveal.reason}${sampleLabel}`;
}

function clipboardOperationLabel(model: StructuredPreviewModel): string {
  const command = model.editPolicy.clipboardReplaceCommandId;
  const commandLabel = command ? ` via ${command}` : '';
  return `${model.label} document replacement is available${commandLabel}; the preview itself remains read-only.`;
}

function diagnosticSummary(errorCount: number, warningCount: number): string {
  if (errorCount > 0) return `${errorCount} error${errorCount === 1 ? '' : 's'}`;
  if (warningCount > 0) return `${warningCount} warning${warningCount === 1 ? '' : 's'}`;
  return 'No errors';
}

function diagnosticLocation(diagnostic: FormatDiagnostic): string {
  if (diagnostic.line && diagnostic.column) return `${diagnostic.code} at ${diagnostic.line}:${diagnostic.column}`;
  if (diagnostic.line) return `${diagnostic.code} at line ${diagnostic.line}`;
  return diagnostic.code;
}

function valueType(value: unknown): 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  return 'boolean';
}

function scalarValue(value: unknown): ReactNode {
  if (typeof value === 'string') return JSON.stringify(value.length > 180 ? `${value.slice(0, 177)}...` : value);
  if (value === null || value === undefined) return 'null';
  return String(value);
}
