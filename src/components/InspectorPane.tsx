import { memo, useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Clipboard, FileCheck2, FileText, GitCompareArrows, Sparkles, X } from 'lucide-react';
import type { AutosaveStatus, EditorMode, FileMetadata } from '../app/documentState';
import type { StructuredEditJournalEntry } from '../app/structuredEditJournal';
import type { ParsedScienfyDocument } from '@sciemd/core';
import type { FormatDiagnostic } from '@sciemd/core';
import type { AuthorshipMark } from '../markdown/authorship';
import type { DocumentInsights, RecentFilePreview } from '../markdown/documentIntelligence';
import type { ManuscriptReadiness } from '../markdown/manuscriptReadiness';
import type { ValidationIssue } from '../markdown/markdownValidation';
import type { EditorComment } from '@sciemd/core';
import type { ProtectedBlock } from '@sciemd/core';
import type { TargetedInstruction } from '@sciemd/core';
import type { VariantGroup } from '@sciemd/core';
import type { DocumentType } from '../services/settingsService';
import type { VisualStyleId } from '../services/visualStyleService';
import { MARKDOWN_UI_CAPABILITIES, type FormatUiCapabilities } from '../app/formatCapabilities';
import type { JsonDocumentAnalysis, JsonlDocumentAnalysis, StructuredDocumentAnalysis, TabularDocumentAnalysis } from '../app/formatDiagnostics';
import { structuredOperationsForTarget, structuredOperationSectionsForTarget, type StructuredOperationId } from '../app/structuredOperationRegistry';
import { JsonHealthPanel } from './JsonHealthPanel';
import { LocalPanelErrorBoundary } from './LocalPanelErrorBoundary';
import { ContextMenuCard, type ContextMenuSection } from './ContextMenuCard';
import { structuredOperationSectionsToContextMenuSections } from './structuredOperationMenu';
import {
  copyContextMenuItem,
  copyContextMenuSection,
  openContextMenuFromEvent,
  openContextMenuFromKeyboard,
  writeContextMenuClipboardText,
  type ContextMenuCopyFeedback,
  type ContextMenuOpenState,
} from './contextMenuUtils';

export interface InspectorPaneData {
  formatCapabilities?: FormatUiCapabilities;
  filePath: string | null;
  mode: EditorMode;
  metadata: FileMetadata;
  validationIssues: ValidationIssue[];
  jsonAnalysis?: JsonDocumentAnalysis | null;
  jsonlAnalysis?: JsonlDocumentAnalysis | null;
  jsonSchemaLoading?: boolean;
  jsonSchemaError?: string | null;
  structuredAnalysis?: StructuredDocumentAnalysis | null;
  tabularAnalysis?: TabularDocumentAnalysis | null;
  structuredEditJournal?: StructuredEditJournalEntry[];
  selectedJsonPath?: string | null;
  structuredContextAvailable?: boolean;
  structuredTableSampleAvailable?: boolean;
  structuredPasteBackValidationAvailable?: boolean;
  insights: DocumentInsights;
  recentPreviews: RecentFilePreview[];
  authorshipMarks: AuthorshipMark[];
  authorshipVisible: boolean;
  missingImageCount: number;
  autosaveStatus: AutosaveStatus;
  autosavePauseReason?: string | null;
  protectedBlocks: ProtectedBlock[];
  editorComments: EditorComment[];
  targetedInstructions: TargetedInstruction[];
  variantGroups: VariantGroup[];
  visualStyle: VisualStyleId;
  visualStyleLabel: string;
  documentType: DocumentType;
  hasPasteReview: boolean;
  layerTwoDocument: ParsedScienfyDocument;
  manuscriptReadiness: ManuscriptReadiness;
  bibliographyLoading: boolean;
  inkscapePath: string | null;
}

export interface InspectorPaneActions {
  onClose: () => void;
  onOpenPasteReview: () => void;
  onGenerateSubmissionReadiness: () => void;
  onToggleAuthorship: () => void;
  onOpenRecent: (path: string) => void;
  onReloadBibliography: () => void;
  onCheckInkscape: () => void;
  onSetInkscapePath: () => void;
  onJumpToLine: (line: number) => void;
  onSelectJsonSchema: () => void;
  onClearJsonSchema: () => void;
  onSelectJsonPath?: (path: string) => void;
  onCopyStructuredContext?: () => void;
  onCopySelectedStructureContext?: () => void;
  onCopySchemaAwareJsonContext?: () => void;
  onCopyStructuredTableSample?: () => void;
  onCopyParserDiagnostics?: () => void;
  onCopyRedactedStructuredPreview?: () => void;
  onValidateStructuredClipboard?: () => void;
  onCopyFeedback?: ContextMenuCopyFeedback;
}

interface InspectorPaneProps {
  open: boolean;
  focusSection?: 'readiness' | 'validation' | null;
  data: InspectorPaneData;
  actions: InspectorPaneActions;
}

export const InspectorPane = memo(function InspectorPane({ open, focusSection, data, actions }: InspectorPaneProps) {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    readiness: false,
    ai: false,
    llm: false,
    paper: true,
    json: false,
    structuredContext: false,
    structured: false,
    structuredEdits: true,
    validation: false,
    metadata: true,
    recent: true,
  });

  useEffect(() => {
    setCollapsedSections((current) => ({
      ...current,
      ai: data.hasPasteReview ? false : current.ai,
      llm: data.protectedBlocks.length > 0 || data.editorComments.length > 0 || data.targetedInstructions.length > 0 || data.variantGroups.length > 0 ? false : current.llm,
      structuredEdits: (data.structuredEditJournal?.length ?? 0) > 0 ? false : current.structuredEdits,
      validation: data.validationIssues.length > 0 ? false : current.validation,
    }));
  }, [
    data.hasPasteReview,
    data.protectedBlocks.length,
    data.editorComments.length,
    data.targetedInstructions.length,
    data.variantGroups.length,
    data.structuredEditJournal?.length,
    data.validationIssues.length,
  ]);

  useEffect(() => {
    if (!open || !focusSection) return;
    setCollapsedSections((current) => ({ ...current, [focusSection]: false }));
    window.requestAnimationFrame(() => {
      const header = document.getElementById(`inspector-section-${focusSection}-header`);
      header?.scrollIntoView({ block: 'start' });
      header?.focus();
    });
  }, [focusSection, open]);

  if (!open) return null;

  const toggleSection = (id: string) => {
    setCollapsedSections((current) => ({ ...current, [id]: !current[id] }));
  };
  const capabilities = data.formatCapabilities ?? MARKDOWN_UI_CAPABILITIES;

  return (
    <aside className="inspector-pane" aria-label="Document inspector">
      <header className="inspector-header">
        <div>
          <strong>Review</strong>
          <span>{capabilities.canUseLLMMarkdownMarkers ? 'Readiness, LLM markers, document checks' : 'Structured checks, context, and file details'}</span>
        </div>
        <button aria-label="Close inspector" title="Close inspector" onClick={actions.onClose}><X size={15} /></button>
      </header>

      {capabilities.canUseManuscriptReadiness && (
        <InspectorSectionFrame id="readiness" title="Submission readiness" icon={<FileCheck2 size={15} />} collapsed={collapsedSections.readiness} onToggle={toggleSection}>
          <ManuscriptReadinessPanel data={data} actions={actions} />
        </InspectorSectionFrame>
      )}
      {capabilities.canUseLLMMarkdownMarkers && (
        <InspectorSectionFrame id="ai" title="LLM review" icon={<Sparkles size={15} />} collapsed={collapsedSections.ai} onToggle={toggleSection}>
          <AiPanel data={data} actions={actions} />
        </InspectorSectionFrame>
      )}
      {capabilities.canUseLLMMarkdownMarkers && (
        <InspectorSectionFrame id="llm" title="LLM markers" collapsed={collapsedSections.llm} onToggle={toggleSection}>
          <LlmControlsPanel data={data} actions={actions} />
        </InspectorSectionFrame>
      )}
      {capabilities.canUseManuscriptReadiness && (
        <InspectorSectionFrame id="paper" title="Document structure" collapsed={collapsedSections.paper} onToggle={toggleSection}>
          <PaperPanel data={data} actions={actions} />
        </InspectorSectionFrame>
      )}
      {hasStructuredContextPanel(data) && (
        <InspectorSectionFrame id="structuredContext" title="Structured context" icon={<Sparkles size={15} />} collapsed={collapsedSections.structuredContext} onToggle={toggleSection}>
          <StructuredContextPanel data={data} actions={actions} />
        </InspectorSectionFrame>
      )}
      {data.jsonAnalysis && (
        <InspectorSectionFrame id="json" title="JSON health" icon={<FileText size={15} />} collapsed={collapsedSections.json} onToggle={toggleSection}>
          <LocalPanelErrorBoundary label="JSON health" resetKey={`json-health:${data.filePath ?? 'untitled'}:${data.selectedJsonPath ?? '$'}:${data.jsonAnalysis.status}`}>
            <JsonHealthPanel
              analysis={data.jsonAnalysis ?? null}
              selectedPath={data.selectedJsonPath}
              schemaLoading={data.jsonSchemaLoading}
              schemaError={data.jsonSchemaError}
              onSelectSchema={actions.onSelectJsonSchema}
              onClearSchema={actions.onClearJsonSchema}
              onSelectedPathChange={actions.onSelectJsonPath}
            />
          </LocalPanelErrorBoundary>
        </InspectorSectionFrame>
      )}
      {data.structuredAnalysis && (
        <InspectorSectionFrame id="structured" title={`${structuredFormatLabel(data.structuredAnalysis.format)} structure`} icon={<FileText size={15} />} collapsed={collapsedSections.structured} onToggle={toggleSection}>
          <LocalPanelErrorBoundary label={`${structuredFormatLabel(data.structuredAnalysis.format)} structure`} resetKey={`structured-health:${data.filePath ?? 'untitled'}:${data.selectedJsonPath ?? '$'}:${data.structuredAnalysis.format}:${data.structuredAnalysis.status}`}>
            <StructuredHealthPanel analysis={data.structuredAnalysis} selectedPath={data.selectedJsonPath} onCopyFeedback={actions.onCopyFeedback} />
          </LocalPanelErrorBoundary>
        </InspectorSectionFrame>
      )}
      {(data.structuredEditJournal?.length ?? 0) > 0 && (
        <InspectorSectionFrame id="structuredEdits" title="Structured edits" icon={<GitCompareArrows size={15} />} collapsed={collapsedSections.structuredEdits} onToggle={toggleSection}>
          <StructuredEditJournalPanel entries={data.structuredEditJournal ?? []} onJumpToLine={actions.onJumpToLine} />
        </InspectorSectionFrame>
      )}
      <InspectorSectionFrame id="validation" title="Validation" icon={<AlertTriangle size={15} />} collapsed={collapsedSections.validation} onToggle={toggleSection}>
        <ValidationPanel issues={data.validationIssues} onJumpToLine={actions.onJumpToLine} onCopyFeedback={actions.onCopyFeedback} />
      </InspectorSectionFrame>
      <InspectorSectionFrame id="metadata" title="File details" icon={<FileText size={15} />} collapsed={collapsedSections.metadata} onToggle={toggleSection}>
        <MetadataPanel data={data} actions={actions} />
      </InspectorSectionFrame>
      <InspectorSectionFrame id="recent" title="Recent files" collapsed={collapsedSections.recent} onToggle={toggleSection}>
        <RecentPanel recentPreviews={data.recentPreviews} onOpenRecent={actions.onOpenRecent} onCopyFeedback={actions.onCopyFeedback} />
      </InspectorSectionFrame>
    </aside>
  );
});

function InspectorSectionFrame({
  id,
  title,
  icon,
  collapsed,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  icon?: ReactNode;
  collapsed: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <section id={`inspector-section-${id}`} className={`inspector-collapsible ${collapsed ? 'collapsed' : 'expanded'}`}>
      <button
        id={`inspector-section-${id}-header`}
        className="inspector-collapsible-header"
        type="button"
        aria-expanded={!collapsed}
        onClick={() => onToggle(id)}
      >
        <span>{icon}{title}</span>
        <ChevronRight size={15} />
      </button>
      <div className="inspector-collapsible-body" hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}

function ManuscriptReadinessPanel({ data, actions }: { data: InspectorPaneData; actions: InspectorPaneActions }) {
  const readiness = data.manuscriptReadiness;
  const openItems = readiness.items.filter((item) => item.severity !== 'pass');
  return (
    <section className={`inspector-section readiness-card ${readiness.status}`}>
      <h2><FileCheck2 size={15} />Submission readiness</h2>
      <div className="readiness-score-row">
        <strong>{readiness.score}</strong>
        <span>/100</span>
        <em>{readiness.summary}</em>
      </div>
      <div className="readiness-counts" aria-label="Submission readiness counts">
        <span>{readiness.counts.figures} figures</span>
        <span>{readiness.counts.tables} tables</span>
        <span>{readiness.counts.citations} citations</span>
        <span>{readiness.counts.labels} labels</span>
      </div>
      <div className="inspector-grid">
        <button onClick={actions.onGenerateSubmissionReadiness}><FileText size={14} />Checklist</button>
      </div>
      {openItems.length === 0 ? (
        <p className="readiness-pass"><CheckCircle2 size={14} />Ready for final human submission review.</p>
      ) : (
        <ul className="inspector-list readiness-list">
          {openItems.slice(0, 4).map((item) => (
            <li key={item.id} className={item.severity}>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AiPanel({ data, actions }: { data: InspectorPaneData; actions: InspectorPaneActions }) {
  return (
    <section className="inspector-section">
      <h2><Sparkles size={15} />LLM review</h2>
      <button className="inspector-action primary" disabled={!data.hasPasteReview} onClick={actions.onOpenPasteReview}>
        Review pasted changes
      </button>
      <label className="inspector-toggle">
        <input type="checkbox" checked={data.authorshipVisible} onChange={actions.onToggleAuthorship} />
        Session authorship shading
      </label>
      <p>{data.authorshipMarks.length} LLM paste mark{data.authorshipMarks.length === 1 ? '' : 's'} tracked in app state only.</p>
    </section>
  );
}

function LlmControlsPanel({ data, actions }: { data: InspectorPaneData; actions: InspectorPaneActions }) {
  return (
    <section className="inspector-section">
      <h2>LLM markers</h2>
      <dl className="metadata-list">
        <div><dt>Locked sections</dt><dd>{data.protectedBlocks.length}</dd></div>
        <div><dt>LLM notes</dt><dd>{data.editorComments.filter((comment) => comment.audience !== 'human').length}</dd></div>
        <div><dt>Human notes</dt><dd>{data.editorComments.filter((comment) => comment.audience === 'human').length}</dd></div>
        <div><dt>LLM instructions</dt><dd>{data.targetedInstructions.length}</dd></div>
        <div><dt>Versions</dt><dd>{data.variantGroups.length}</dd></div>
        <div><dt>Bibliography entries</dt><dd>{data.layerTwoDocument.citations.bibtexEntries.length}</dd></div>
      </dl>
      {data.protectedBlocks.length > 0 && (
        <ul className="inspector-list">
          {data.protectedBlocks.slice(0, 3).map((block) => (
            <li key={`${block.start}-${block.end}`}>
              <button type="button" className="inspector-list-action" onClick={() => actions.onJumpToLine(block.startLine)}>
                <strong>Locked lines {block.startLine}-{block.endLine}</strong>
                <span>{block.reason ?? 'No reason provided'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data.editorComments.length > 0 && (
        <ul className="inspector-list">
          {data.editorComments.slice(0, 3).map((comment) => (
            <li key={comment.id ?? `${comment.line}-${comment.body}`}>
              <button type="button" className="inspector-list-action" onClick={() => actions.onJumpToLine(comment.line)}>
                <strong>Line {comment.line} - {comment.audience === 'human' ? 'Note to Human' : 'Note to LLM'}</strong>
                <span>{comment.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data.targetedInstructions.length > 0 && (
        <ul className="inspector-list">
          {data.targetedInstructions.slice(0, 3).map((instruction) => (
            <li key={`${instruction.line}-${instruction.prompt}`}>
              <button type="button" className="inspector-list-action" onClick={() => actions.onJumpToLine(instruction.line)}>
                <strong>Line {instruction.line}{' -> '}{instruction.target}</strong>
                <span>{instruction.prompt}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PaperPanel({ data, actions }: { data: InspectorPaneData; actions: InspectorPaneActions }) {
  const document = data.layerTwoDocument;
  const variablesBySource = document.variables.definitions.reduce<Record<string, number>>((counts, definition) => {
    counts[definition.source] = (counts[definition.source] ?? 0) + 1;
    return counts;
  }, {});
  return (
    <section className="inspector-section">
      <h2>Document structure</h2>
      <dl className="metadata-list">
        <div><dt>Title</dt><dd>{document.title ?? data.insights.firstHeading ?? 'Untitled'}</dd></div>
        <div><dt>Front matter</dt><dd>{document.frontmatter.hasFrontmatter ? document.frontmatter.error ? 'invalid YAML' : 'present' : 'not present'}</dd></div>
        <div><dt>Bibliography</dt><dd>{document.bibliographyFiles.length > 0 ? document.bibliographyFiles.join(', ') : 'not configured'}</dd></div>
        <div><dt>Citations</dt><dd>{document.citations.usages.length}</dd></div>
        <div><dt>Labels</dt><dd>{document.references.labels.length}</dd></div>
        <div><dt>References</dt><dd>{document.references.usages.length}</dd></div>
        <div><dt>Variables</dt><dd>{document.variables.usages.length ? `${document.variables.usages.length} used / ${document.variables.definitions.length} defined` : `${document.variables.definitions.length} defined`}</dd></div>
        <div><dt>Variable files</dt><dd>{document.variableFiles.length ? document.variableFiles.join(', ') : 'not configured'}</dd></div>
        <div><dt>Semantic blocks</dt><dd>{document.directives.length}</dd></div>
        <div><dt>Versions</dt><dd>{data.variantGroups.length ? data.variantGroups.map((group) => `${group.id}:${group.active}`).join(', ') : 'none'}</dd></div>
      </dl>
      <div className="inspector-grid">
        <button disabled={document.bibliographyFiles.length === 0 || data.bibliographyLoading} onClick={actions.onReloadBibliography}>
          {data.bibliographyLoading ? 'Reloading .bib...' : 'Reload .bib'}
        </button>
      </div>
      {document.variables.definitions.length > 0 && (
        <p>
          Variables: {Object.entries(variablesBySource).map(([source, count]) => `${count} ${source}`).join(', ')}.
        </p>
      )}
      {document.variableFiles.length > 0 && (
        <p>Linked variable files refresh while this document is open.</p>
      )}
      {document.variables.missingVariables.length > 0 && (
        <ul className="inspector-list">
          {document.variables.missingVariables.slice(0, 5).map((name) => (
            <li key={name} className="warning">
              <button type="button" className="inspector-list-action" onClick={() => actions.onJumpToLine(firstVariableUsageLine(document, name))}>
                <strong>Missing variable</strong>
                <span>{`{{ ${name} }}`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StructuredContextPanel({ data, actions }: { data: InspectorPaneData; actions: InspectorPaneActions }) {
  const capabilities = data.formatCapabilities ?? MARKDOWN_UI_CAPABILITIES;
  const operations = structuredOperationsForTarget({
    kind: 'structured-context',
    canCopyStructuredContext: Boolean(data.structuredContextAvailable),
    canCopySelectedPathContext: Boolean(data.structuredContextAvailable),
    canCopySchemaAwareJsonContext: Boolean(data.structuredContextAvailable && capabilities.sourceLanguage === 'json'),
    canCopyTableSample: Boolean(data.structuredTableSampleAvailable),
    canCopyParserDiagnostics: Boolean(data.structuredPasteBackValidationAvailable),
    canCopyRedactedPreview: Boolean(data.structuredContextAvailable),
    canValidateClipboard: Boolean(data.structuredPasteBackValidationAvailable),
  }).filter((operation) => structuredContextOperationVisible(operation.id, capabilities));
  const handlers: Partial<Record<StructuredOperationId, () => void>> = {
    copyStructuredContext: actions.onCopyStructuredContext,
    copySelectedPathContext: actions.onCopySelectedStructureContext,
    copySchemaAwareJsonContext: actions.onCopySchemaAwareJsonContext,
    copyTableSample: actions.onCopyStructuredTableSample,
    copyParserDiagnostics: actions.onCopyParserDiagnostics,
    copyRedactedPreview: actions.onCopyRedactedStructuredPreview,
    validateClipboard: actions.onValidateStructuredClipboard,
  };

  return (
    <section className="inspector-section structured-context-panel">
      <h2><Sparkles size={15} />Structured context</h2>
      <p>Local copy/export only. ScieMD does not call an LLM or automatically redact sensitive data.</p>
      <div className="inspector-grid structured-context-actions">
        {operations.map((operation) => (
          <button
            key={operation.id}
            className="inspector-action"
            type="button"
            disabled={operation.disabled || !handlers[operation.id]}
            title={operation.disabledReason}
            onClick={() => handlers[operation.id]?.()}
          >
            {operation.icon === 'warning' ? <AlertTriangle size={14} /> : <Clipboard size={14} />}
            <span>{operation.label}</span>
          </button>
        ))}
      </div>
      {data.selectedJsonPath && (
        <p>Selected path: <code>{data.selectedJsonPath}</code></p>
      )}
    </section>
  );
}

function hasStructuredContextPanel(data: InspectorPaneData): boolean {
  const capabilities = data.formatCapabilities ?? MARKDOWN_UI_CAPABILITIES;
  return !capabilities.canUseLLMMarkdownMarkers && (
    capabilities.canUseStructuredVisualMode
    || capabilities.canUseRecordList
    || capabilities.canUseTablePreview
    || Boolean(data.structuredPasteBackValidationAvailable)
  );
}

function structuredContextOperationVisible(id: StructuredOperationId, capabilities: FormatUiCapabilities): boolean {
  if (id === 'copySchemaAwareJsonContext') return capabilities.sourceLanguage === 'json';
  if (id === 'copyTableSample') return capabilities.canUseTablePreview;
  if (id === 'copySelectedPathContext') return capabilities.canUseStructuredVisualMode || capabilities.canUseRecordList;
  return true;
}

function StructuredHealthPanel({
  analysis,
  selectedPath,
  onCopyFeedback,
}: {
  analysis: StructuredDocumentAnalysis;
  selectedPath?: string | null;
  onCopyFeedback?: ContextMenuCopyFeedback;
}) {
  const [contextMenu, setContextMenu] = useState<ContextMenuOpenState | null>(null);
  const parsed = analysis.parseResult.parsed;
  const stats = parsed?.stats ?? null;
  const preservation = parsed?.preservation ?? null;
  const jsonPreview = parsed?.jsonPreview ?? null;
  const warnings = analysis.parseResult.diagnostics.filter((diagnostic) => diagnostic.severity !== 'error');
  const warningMenuState = (diagnostic: FormatDiagnostic): Omit<ContextMenuOpenState, 'position'> => ({
    ariaLabel: `Actions for ${structuredFormatLabel(analysis.format)} warning`,
    sections: [
      copyContextMenuSection('copy-structured-warning', 'Copy', <Clipboard size={16} />, [
        copyContextMenuItem({
          id: 'copy-structured-warning',
          label: 'Copy warning',
          icon: <Clipboard size={16} />,
          text: formatStructuredDiagnostic(diagnostic),
          onCopyFeedback,
        }),
        copyContextMenuItem({
          id: 'copy-structured-warning-summary',
          label: 'Copy warnings summary',
          icon: <Clipboard size={16} />,
          text: formatStructuredDiagnosticSummary(warnings),
          onCopyFeedback,
        }),
      ]),
    ],
  });
  const blockerMenuState = (blocker: string): Omit<ContextMenuOpenState, 'position'> => ({
    ariaLabel: `Actions for ${structuredFormatLabel(analysis.format)} preservation blocker`,
    sections: [
      copyContextMenuSection('copy-structured-blocker', 'Copy', <Clipboard size={16} />, [
        copyContextMenuItem({
          id: 'copy-structured-blocker',
          label: 'Copy blocker',
          icon: <Clipboard size={16} />,
          text: `Preservation blocker - ${blocker}`,
          onCopyFeedback,
        }),
        copyContextMenuItem({
          id: 'copy-structured-blocker-summary',
          label: 'Copy blockers summary',
          icon: <Clipboard size={16} />,
          text: preservation?.blockers.length ? preservation.blockers.join('\n') : 'No preservation blockers.',
          onCopyFeedback,
        }),
      ]),
    ],
  });
  const jsonPreviewMenuState = (): Omit<ContextMenuOpenState, 'position'> => ({
    ariaLabel: `${structuredFormatLabel(analysis.format)} JSON preview actions`,
    sections: [
      copyContextMenuSection('copy-structured-json-preview', 'Copy', <Clipboard size={16} />, [
        copyContextMenuItem({
          id: 'copy-json-preview',
          label: 'Copy JSON preview',
          icon: <Clipboard size={16} />,
          text: jsonPreview?.content ?? '',
          disabled: !jsonPreview,
          disabledReason: jsonPreview ? undefined : 'No JSON preview is available.',
          onCopyFeedback,
        }),
      ]),
    ],
  });
  const openWarningMenu = (event: MouseEvent<HTMLElement>, diagnostic: FormatDiagnostic) => {
    openContextMenuFromEvent(event, setContextMenu, warningMenuState(diagnostic));
  };
  const openWarningKeyboardMenu = (event: KeyboardEvent<HTMLElement>, diagnostic: FormatDiagnostic) => {
    openContextMenuFromKeyboard(event, setContextMenu, warningMenuState(diagnostic));
  };
  const openBlockerMenu = (event: MouseEvent<HTMLElement>, blocker: string) => {
    openContextMenuFromEvent(event, setContextMenu, blockerMenuState(blocker));
  };
  const openBlockerKeyboardMenu = (event: KeyboardEvent<HTMLElement>, blocker: string) => {
    openContextMenuFromKeyboard(event, setContextMenu, blockerMenuState(blocker));
  };
  const openJsonPreviewMenu = (event: MouseEvent<HTMLElement>) => {
    openContextMenuFromEvent(event, setContextMenu, jsonPreviewMenuState());
  };
  const openJsonPreviewKeyboardMenu = (event: KeyboardEvent<HTMLElement>) => {
    openContextMenuFromKeyboard(event, setContextMenu, jsonPreviewMenuState());
  };
  return (
    <section className="inspector-section json-health-panel">
      <h2><FileText size={15} />{structuredFormatLabel(analysis.format)} structure</h2>
      <div className={`json-health-status ${analysis.status}`}>
        {analysis.status === 'valid' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
        <strong>{structuredStatusLabel(analysis)}</strong>
      </div>
      {stats && (
        <dl className="metadata-list json-health-grid">
          <div><dt>Top level</dt><dd>{stats.topLevelType}</dd></div>
          <div><dt>Nodes</dt><dd>{analysis.nodeCount.toLocaleString()}</dd></div>
          <div><dt>Objects</dt><dd>{stats.objectCount.toLocaleString()}</dd></div>
          <div><dt>Arrays</dt><dd>{stats.arrayCount.toLocaleString()}</dd></div>
          <div><dt>Scalars</dt><dd>{stats.scalarCount.toLocaleString()}</dd></div>
          <div><dt>Max depth</dt><dd>{stats.maxDepth.toLocaleString()}</dd></div>
          <div><dt>Selected</dt><dd title={selectedPath ?? '$'}>{selectedPath ?? '$'}</dd></div>
          <div><dt>Tree budget</dt><dd>{`${analysis.nodeCount.toLocaleString()} / ${analysis.treeBudget.toLocaleString()}`}</dd></div>
        </dl>
      )}
      {warnings.length > 0 && (
        <div className="json-health-subsection">
          <strong>Read-only warnings</strong>
          <ul className="inspector-list">
            {warnings.map((diagnostic) => (
              <li
                key={`${diagnostic.code}-${diagnostic.offset ?? diagnostic.message}`}
                className="warning"
                tabIndex={0}
                onKeyDown={(event) => openWarningKeyboardMenu(event, diagnostic)}
                onContextMenu={(event) => openWarningMenu(event, diagnostic)}
              >
                <span>{diagnostic.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {preservation && (
        <div className="json-health-subsection">
          <strong>Preservation decision</strong>
          <dl className="metadata-list json-health-grid">
            <div><dt>Visual writes</dt><dd>{preservation.visualWritesEnabled ? 'Enabled' : 'Disabled'}</dd></div>
            <div><dt>Decision</dt><dd>{preservation.decision}</dd></div>
            <div><dt>Source map</dt><dd>{preservation.sourceMapFeasibility}</dd></div>
            <div><dt>Span coverage</dt><dd>{preservation.nodeSpanCoverage}</dd></div>
            <div><dt>Libraries</dt><dd>{preservation.candidateLibraries.join(', ') || 'None'}</dd></div>
            <div><dt>Warnings</dt><dd>{preservation.warnings.length.toLocaleString()}</dd></div>
          </dl>
          {jsonPreview && (
            <button
              className="inspector-action"
              type="button"
              onClick={() => void writeContextMenuClipboardText(jsonPreview.content, 'JSON preview', undefined, onCopyFeedback)}
              onKeyDown={openJsonPreviewKeyboardMenu}
              onContextMenu={openJsonPreviewMenu}
            >
              <Clipboard size={14} />
              Copy JSON preview
            </button>
          )}
          <ul className="inspector-list">
            {preservation.blockers.map((blocker) => (
              <li
                key={blocker}
                className="warning"
                tabIndex={0}
                onKeyDown={(event) => openBlockerKeyboardMenu(event, blocker)}
                onContextMenu={(event) => openBlockerMenu(event, blocker)}
              >
                <span>{blocker}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {contextMenu && (
        <ContextMenuCard
          ariaLabel={contextMenu.ariaLabel}
          sections={contextMenu.sections}
          position={contextMenu.position}
          restoreFocusTo={contextMenu.restoreFocusTo}
          onClose={() => setContextMenu(null)}
        />
      )}
    </section>
  );
}

function StructuredEditJournalPanel({
  entries,
  onJumpToLine,
}: {
  entries: StructuredEditJournalEntry[];
  onJumpToLine: (line: number) => void;
}) {
  const latest = entries[0] ?? null;
  return (
    <section className="inspector-section">
      <h2><GitCompareArrows size={15} />Structured edits</h2>
      <dl className="metadata-list json-health-grid">
        <div><dt>Tracked</dt><dd>{entries.length.toLocaleString()}</dd></div>
        <div><dt>Latest</dt><dd>{latest ? latest.operationLabel : 'None'}</dd></div>
      </dl>
      <ul className="inspector-list">
        {entries.slice(0, 6).map((entry) => {
          const location = entry.line
            ? `Line ${entry.line}${entry.column ? `, column ${entry.column}` : ''}`
            : 'No source location';
          const body = (
            <>
              <strong>{entry.operationLabel}</strong>
              <span>{entry.targetLabel}</span>
              <small>{`${formatStructuredEditFormat(entry.format)} - ${entry.riskLabel} - ${location} - ${formatJournalTime(entry.appliedAt)}`}</small>
            </>
          );
          return (
            <li key={entry.id}>
              {entry.line ? (
                <button type="button" className="inspector-list-action" onClick={() => onJumpToLine(entry.line ?? 1)}>
                  {body}
                </button>
              ) : (
                <span className="inspector-list-action">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function formatStructuredEditFormat(format: StructuredEditJournalEntry['format']): string {
  if (format === 'json') return 'JSON';
  if (format === 'jsonl') return 'JSONL';
  if (format === 'csv') return 'CSV';
  return 'TSV';
}

function formatJournalTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function structuredFormatLabel(format: StructuredDocumentAnalysis['format']): string {
  if (format === 'yaml') return 'YAML';
  if (format === 'toml') return 'TOML';
  return 'XML';
}

function structuredStatusLabel(analysis: StructuredDocumentAnalysis): string {
  if (analysis.status === 'invalid') return `Invalid ${structuredFormatLabel(analysis.format)}`;
  if (analysis.status === 'too-large') return 'Source mode';
  return 'Tree ready';
}

function formatStructuredDiagnostic(diagnostic: FormatDiagnostic): string {
  const location = diagnostic.line
    ? `Line ${diagnostic.line}${diagnostic.column ? `, column ${diagnostic.column}` : ''}`
    : '';
  return [
    `${diagnostic.severity.toUpperCase()} ${diagnostic.code}`,
    location,
    diagnostic.message,
  ].filter(Boolean).join(' - ');
}

function formatStructuredDiagnosticSummary(diagnostics: FormatDiagnostic[]): string {
  if (diagnostics.length === 0) return 'No structured warnings.';
  return diagnostics.map((diagnostic) => formatStructuredDiagnostic(diagnostic)).join('\n');
}

function firstVariableUsageLine(document: ParsedScienfyDocument, name: string): number {
  return document.variables.usages.find((usage) => usage.name === name)?.line ?? 1;
}

function ValidationPanel({ issues, onJumpToLine, onCopyFeedback }: {
  issues: ValidationIssue[];
  onJumpToLine: (line: number) => void;
  onCopyFeedback?: ContextMenuCopyFeedback;
}) {
  const [contextMenu, setContextMenu] = useState<ContextMenuOpenState | null>(null);
  const issueMenuState = (issue: ValidationIssue): Omit<ContextMenuOpenState, 'position'> => {
    const line = lineFromValidationIssue(issue);
    const sections: ContextMenuSection[] = structuredOperationSectionsToContextMenuSections(
      structuredOperationSectionsForTarget({
        kind: 'diagnostic',
        canRevealSource: Boolean(line),
      }),
      {
        revealSource: () => {
          if (line) onJumpToLine(line);
        },
        copyDiagnostics: () => writeContextMenuClipboardText(formatValidationIssue(issue), 'Validation issue', undefined, onCopyFeedback),
      },
    );
    sections.push(copyContextMenuSection('copy-validation-summary', 'More copy options', <Clipboard size={16} />, [
      copyContextMenuItem({
        id: 'copy-validation-summary',
        label: 'Copy diagnostics summary',
        icon: <Clipboard size={16} />,
        text: formatValidationSummary(issues),
        onCopyFeedback,
      }),
    ]));

    return {
      ariaLabel: `Actions for ${issue.severity} validation issue`,
      sections,
    };
  };
  const openIssueMenu = (event: MouseEvent<HTMLElement>, issue: ValidationIssue) => {
    openContextMenuFromEvent(event, setContextMenu, issueMenuState(issue));
  };
  const openIssueKeyboardMenu = (event: KeyboardEvent<HTMLElement>, issue: ValidationIssue) => {
    openContextMenuFromKeyboard(event, setContextMenu, issueMenuState(issue));
  };

  return (
    <section className="inspector-section">
      <h2><AlertTriangle size={15} />Validation</h2>
      {issues.length === 0 ? (
        <p>No current validation warnings.</p>
      ) : (
        <ul className="inspector-list">
          {issues.map((issue) => (
            <li
              key={`${issue.code}-${issue.message}`}
              className={issue.severity}
              tabIndex={0}
              onKeyDown={(event) => openIssueKeyboardMenu(event, issue)}
              onContextMenu={(event) => openIssueMenu(event, issue)}
            >
              <strong>{issue.severity}</strong>
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
      {contextMenu && (
        <ContextMenuCard
          ariaLabel={contextMenu.ariaLabel}
          sections={contextMenu.sections}
          position={contextMenu.position}
          restoreFocusTo={contextMenu.restoreFocusTo}
          onClose={() => setContextMenu(null)}
        />
      )}
    </section>
  );
}

function lineFromValidationIssue(issue: ValidationIssue): number | null {
  const explicitLine = (issue as { line?: unknown }).line;
  if (typeof explicitLine === 'number' && Number.isFinite(explicitLine) && explicitLine > 0) {
    return Math.floor(explicitLine);
  }
  const match = issue.message.match(/\bline\s+(\d+)\b/i);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatValidationIssue(issue: ValidationIssue): string {
  const line = lineFromValidationIssue(issue);
  return [
    `${issue.severity.toUpperCase()} ${issue.code}`,
    line ? `Line ${line}` : '',
    issue.message,
  ].filter(Boolean).join(' - ');
}

function formatValidationSummary(issues: ValidationIssue[]): string {
  if (issues.length === 0) return 'No current validation warnings.';
  return issues.map((issue) => formatValidationIssue(issue)).join('\n');
}

function MetadataPanel({ data, actions }: { data: InspectorPaneData; actions: InspectorPaneActions }) {
  const [contextMenu, setContextMenu] = useState<ContextMenuOpenState | null>(null);
  const metadataPathMenuState = (label: string, path: string): Omit<ContextMenuOpenState, 'position'> => ({
    ariaLabel: `Actions for ${label.toLowerCase()}`,
    sections: [
      copyContextMenuSection(`copy-${label.toLowerCase().replace(/\s+/g, '-')}`, 'Copy', <Clipboard size={16} />, [
        copyContextMenuItem({
          id: 'copy-metadata-path',
          label: 'Copy path',
          icon: <Clipboard size={16} />,
          text: path,
          onCopyFeedback: actions.onCopyFeedback,
        }),
        copyContextMenuItem({
          id: 'copy-metadata-filename',
          label: 'Copy filename',
          icon: <Clipboard size={16} />,
          text: fileName(path),
          onCopyFeedback: actions.onCopyFeedback,
        }),
      ]),
    ],
  });
  const openMetadataPathMenu = (event: MouseEvent<HTMLElement>, label: string, path: string | null) => {
    if (!path) return;
    openContextMenuFromEvent(event, setContextMenu, metadataPathMenuState(label, path));
  };
  const openMetadataPathKeyboardMenu = (event: KeyboardEvent<HTMLElement>, label: string, path: string | null) => {
    if (!path) return;
    openContextMenuFromKeyboard(event, setContextMenu, metadataPathMenuState(label, path));
  };

  return (
    <section className="inspector-section">
      <h2><FileText size={15} />Document</h2>
      <dl className="metadata-list">
        <div>
          <dt>Path</dt>
          <dd
            title={data.filePath ?? 'Untitled'}
            tabIndex={data.filePath ? 0 : undefined}
            aria-label={data.filePath ? `File path ${data.filePath}` : undefined}
            onKeyDown={(event) => openMetadataPathKeyboardMenu(event, 'file path', data.filePath)}
            onContextMenu={(event) => openMetadataPathMenu(event, 'file path', data.filePath)}
          >
            {data.filePath ?? 'Untitled'}
          </dd>
        </div>
        <div><dt>Mode</dt><dd>{data.mode}</dd></div>
        <div>
          <dt>Save</dt>
          <dd title={data.autosavePauseReason ?? data.autosaveStatus}>
            {data.autosaveStatus === 'paused' && data.autosavePauseReason
              ? data.autosavePauseReason
              : data.autosaveStatus}
          </dd>
        </div>
        <div><dt>Type</dt><dd>{data.documentType.replace('-', ' ')}</dd></div>
        <div><dt>Style</dt><dd>{data.visualStyleLabel}</dd></div>
        <div><dt>Line endings</dt><dd>{data.metadata.hasMixedLineEndings ? 'mixed' : data.metadata.lineEnding}{data.metadata.hasBom ? ' + BOM' : ''}</dd></div>
        <div><dt>Images</dt><dd>{data.insights.imageReferences.length}{data.missingImageCount > 0 ? ` (${data.missingImageCount} missing)` : ''}</dd></div>
        <div><dt>Tables</dt><dd>{data.insights.tableCount}</dd></div>
        <div><dt>Code blocks</dt><dd>{data.insights.codeBlockCount}</dd></div>
        <div>
          <dt>Inkscape</dt>
          <dd
            title={data.inkscapePath ?? 'Auto-detect common install paths'}
            tabIndex={data.inkscapePath ? 0 : undefined}
            aria-label={data.inkscapePath ? `Inkscape path ${data.inkscapePath}` : undefined}
            onKeyDown={(event) => openMetadataPathKeyboardMenu(event, 'Inkscape path', data.inkscapePath)}
            onContextMenu={(event) => openMetadataPathMenu(event, 'Inkscape path', data.inkscapePath)}
          >
            {data.inkscapePath ?? 'auto-detect'}
          </dd>
        </div>
      </dl>
      <div className="inspector-grid">
        <button onClick={actions.onSetInkscapePath}>Set Inkscape path</button>
        <button onClick={actions.onCheckInkscape}>Check Inkscape</button>
      </div>
      {contextMenu && (
        <ContextMenuCard
          ariaLabel={contextMenu.ariaLabel}
          sections={contextMenu.sections}
          position={contextMenu.position}
          restoreFocusTo={contextMenu.restoreFocusTo}
          onClose={() => setContextMenu(null)}
        />
      )}
    </section>
  );
}

function RecentPanel({
  recentPreviews,
  onOpenRecent,
  onCopyFeedback,
}: {
  recentPreviews: RecentFilePreview[];
  onOpenRecent: (path: string) => void;
  onCopyFeedback?: ContextMenuCopyFeedback;
}) {
  const [contextMenu, setContextMenu] = useState<ContextMenuOpenState | null>(null);
  const recentPreviewMenuState = (preview: RecentFilePreview): Omit<ContextMenuOpenState, 'position'> => ({
    ariaLabel: `Actions for recent file ${preview.name}`,
    sections: [
      {
        items: [
          {
            id: 'open-recent-file',
            label: 'Open recent file',
            icon: <FileText size={16} />,
            onSelect: () => onOpenRecent(preview.path),
          },
        ],
      },
      copyContextMenuSection('copy-recent-file', 'Copy', <Clipboard size={16} />, [
        copyContextMenuItem({
          id: 'copy-recent-path',
          label: 'Copy path',
          icon: <Clipboard size={16} />,
          text: preview.path,
          onCopyFeedback,
        }),
        copyContextMenuItem({
          id: 'copy-recent-filename',
          label: 'Copy filename',
          icon: <Clipboard size={16} />,
          text: preview.name,
          onCopyFeedback,
        }),
        copyContextMenuItem({
          id: 'copy-recent-heading',
          label: 'Copy heading',
          icon: <Clipboard size={16} />,
          text: preview.heading,
          disabled: preview.heading.trim().length === 0,
          disabledReason: preview.heading.trim().length === 0 ? 'This recent file has no heading.' : undefined,
          onCopyFeedback,
        }),
        copyContextMenuItem({
          id: 'copy-recent-excerpt',
          label: 'Copy excerpt',
          icon: <Clipboard size={16} />,
          text: preview.excerpt,
          disabled: preview.excerpt.trim().length === 0,
          disabledReason: preview.excerpt.trim().length === 0 ? 'This recent file has no preview excerpt.' : undefined,
          onCopyFeedback,
        }),
      ]),
    ],
  });
  const openRecentMenu = (event: MouseEvent<HTMLElement>, preview: RecentFilePreview) => {
    openContextMenuFromEvent(event, setContextMenu, recentPreviewMenuState(preview));
  };
  const openRecentKeyboardMenu = (event: KeyboardEvent<HTMLElement>, preview: RecentFilePreview) => {
    openContextMenuFromKeyboard(event, setContextMenu, recentPreviewMenuState(preview));
  };

  return (
    <section className="inspector-section">
      <h2>Recent files</h2>
      {recentPreviews.length === 0 ? (
        <p>No recent files yet.</p>
      ) : (
        <div className="recent-preview-list">
          {recentPreviews.map((preview) => (
            <button
              key={preview.path}
              onClick={() => onOpenRecent(preview.path)}
              onKeyDown={(event) => openRecentKeyboardMenu(event, preview)}
              onContextMenu={(event) => openRecentMenu(event, preview)}
            >
              <strong>{preview.heading}</strong>
              <span>{preview.excerpt || preview.name}</span>
              <small>{preview.path}</small>
            </button>
          ))}
        </div>
      )}
      {contextMenu && (
        <ContextMenuCard
          ariaLabel={contextMenu.ariaLabel}
          sections={contextMenu.sections}
          position={contextMenu.position}
          restoreFocusTo={contextMenu.restoreFocusTo}
          onClose={() => setContextMenu(null)}
        />
      )}
    </section>
  );
}

function fileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').at(-1) ?? path;
}
