import { memo, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, FileCheck2, FileText, Sparkles, X } from 'lucide-react';
import type { AutosaveStatus, EditorMode, FileMetadata } from '../app/documentState';
import type { ParsedScienfyDocument } from '../domain/document/documentModel';
import type { AuthorshipMark } from '../markdown/authorship';
import type { DocumentInsights, RecentFilePreview } from '../markdown/documentIntelligence';
import type { ManuscriptReadiness } from '../markdown/manuscriptReadiness';
import type { ValidationIssue } from '../markdown/markdownValidation';
import type { EditorComment } from '../markdown/editorComments';
import type { ProtectedBlock } from '../markdown/protectedBlocks';
import type { TargetedInstruction } from '../markdown/targetedInstructions';
import type { VariantGroup } from '../markdown/variants';
import type { DocumentType } from '../services/settingsService';
import type { VisualStyleId } from '../services/visualStyleService';

export interface InspectorPaneData {
  filePath: string | null;
  mode: EditorMode;
  metadata: FileMetadata;
  validationIssues: ValidationIssue[];
  insights: DocumentInsights;
  recentPreviews: RecentFilePreview[];
  authorshipMarks: AuthorshipMark[];
  authorshipVisible: boolean;
  missingImageCount: number;
  autosaveStatus: AutosaveStatus;
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
    validation: false,
    metadata: true,
    recent: true,
  });

  useEffect(() => {
    setCollapsedSections((current) => ({
      ...current,
      ai: data.hasPasteReview ? false : current.ai,
      llm: data.protectedBlocks.length > 0 || data.editorComments.length > 0 || data.targetedInstructions.length > 0 || data.variantGroups.length > 0 ? false : current.llm,
      validation: data.validationIssues.length > 0 ? false : current.validation,
    }));
  }, [
    data.hasPasteReview,
    data.protectedBlocks.length,
    data.editorComments.length,
    data.targetedInstructions.length,
    data.variantGroups.length,
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

  return (
    <aside className="inspector-pane" aria-label="Document inspector">
      <header className="inspector-header">
        <div>
          <strong>Review</strong>
          <span>Readiness, LLM markers, document checks</span>
        </div>
        <button aria-label="Close inspector" title="Close inspector" onClick={actions.onClose}><X size={15} /></button>
      </header>

      <InspectorSectionFrame id="readiness" title="Submission readiness" icon={<FileCheck2 size={15} />} collapsed={collapsedSections.readiness} onToggle={toggleSection}>
        <ManuscriptReadinessPanel data={data} actions={actions} />
      </InspectorSectionFrame>
      <InspectorSectionFrame id="ai" title="LLM review" icon={<Sparkles size={15} />} collapsed={collapsedSections.ai} onToggle={toggleSection}>
        <AiPanel data={data} actions={actions} />
      </InspectorSectionFrame>
      <InspectorSectionFrame id="llm" title="LLM markers" collapsed={collapsedSections.llm} onToggle={toggleSection}>
        <LlmControlsPanel data={data} actions={actions} />
      </InspectorSectionFrame>
      <InspectorSectionFrame id="paper" title="Document structure" collapsed={collapsedSections.paper} onToggle={toggleSection}>
        <PaperPanel data={data} actions={actions} />
      </InspectorSectionFrame>
      <InspectorSectionFrame id="validation" title="Validation" icon={<AlertTriangle size={15} />} collapsed={collapsedSections.validation} onToggle={toggleSection}>
        <ValidationPanel issues={data.validationIssues} />
      </InspectorSectionFrame>
      <InspectorSectionFrame id="metadata" title="File details" icon={<FileText size={15} />} collapsed={collapsedSections.metadata} onToggle={toggleSection}>
        <MetadataPanel data={data} actions={actions} />
      </InspectorSectionFrame>
      <InspectorSectionFrame id="recent" title="Recent files" collapsed={collapsedSections.recent} onToggle={toggleSection}>
        <RecentPanel recentPreviews={data.recentPreviews} onOpenRecent={actions.onOpenRecent} />
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

function firstVariableUsageLine(document: ParsedScienfyDocument, name: string): number {
  return document.variables.usages.find((usage) => usage.name === name)?.line ?? 1;
}

function ValidationPanel({ issues }: { issues: ValidationIssue[] }) {
  return (
    <section className="inspector-section">
      <h2><AlertTriangle size={15} />Validation</h2>
      {issues.length === 0 ? (
        <p>No current validation warnings.</p>
      ) : (
        <ul className="inspector-list">
          {issues.map((issue) => (
            <li key={`${issue.code}-${issue.message}`} className={issue.severity}>
              <strong>{issue.severity}</strong>
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MetadataPanel({ data, actions }: { data: InspectorPaneData; actions: InspectorPaneActions }) {
  return (
    <section className="inspector-section">
      <h2><FileText size={15} />Document</h2>
      <dl className="metadata-list">
        <div><dt>Path</dt><dd title={data.filePath ?? 'Untitled'}>{data.filePath ?? 'Untitled'}</dd></div>
        <div><dt>Mode</dt><dd>{data.mode}</dd></div>
        <div><dt>Save</dt><dd>{data.autosaveStatus}</dd></div>
        <div><dt>Type</dt><dd>{data.documentType.replace('-', ' ')}</dd></div>
        <div><dt>Style</dt><dd>{data.visualStyleLabel}</dd></div>
        <div><dt>Line endings</dt><dd>{data.metadata.hasMixedLineEndings ? 'mixed' : data.metadata.lineEnding}{data.metadata.hasBom ? ' + BOM' : ''}</dd></div>
        <div><dt>Images</dt><dd>{data.insights.imageReferences.length}{data.missingImageCount > 0 ? ` (${data.missingImageCount} missing)` : ''}</dd></div>
        <div><dt>Tables</dt><dd>{data.insights.tableCount}</dd></div>
        <div><dt>Code blocks</dt><dd>{data.insights.codeBlockCount}</dd></div>
        <div><dt>Inkscape</dt><dd title={data.inkscapePath ?? 'Auto-detect common install paths'}>{data.inkscapePath ?? 'auto-detect'}</dd></div>
      </dl>
      <div className="inspector-grid">
        <button onClick={actions.onSetInkscapePath}>Set Inkscape path</button>
        <button onClick={actions.onCheckInkscape}>Check Inkscape</button>
      </div>
    </section>
  );
}

function RecentPanel({ recentPreviews, onOpenRecent }: { recentPreviews: RecentFilePreview[]; onOpenRecent: (path: string) => void }) {
  return (
    <section className="inspector-section">
      <h2>Recent files</h2>
      {recentPreviews.length === 0 ? (
        <p>No recent files yet.</p>
      ) : (
        <div className="recent-preview-list">
          {recentPreviews.map((preview) => (
            <button key={preview.path} onClick={() => onOpenRecent(preview.path)}>
              <strong>{preview.heading}</strong>
              <span>{preview.excerpt || preview.name}</span>
              <small>{preview.path}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
