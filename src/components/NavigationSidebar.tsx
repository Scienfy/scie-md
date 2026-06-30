import { memo, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { AlertTriangle, BookOpen, CheckCircle2, Database, FileText, Folder, FolderOpen, ListTree, PanelLeftClose, Text } from 'lucide-react';
import type { ParsedScienfyDocument } from '@sciemd/core';
import type { BibtexEntry } from '@sciemd/core';
import type { VariableDefinition } from '@sciemd/core';
import type { MarkdownHeading } from '@sciemd/core';
import type { FileExplorerEntry } from '../services/fileService';
import { SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from '../services/settingsService';
import type { SidebarView } from '../services/settingsService';
import { localImageDisplayUrl } from '../markdown/imagePaths';

const sidebarViews: SidebarView[] = ['files', 'outline', 'data', 'references'];

interface NavigationSidebarProps {
  view: SidebarView;
  width: number;
  outline: {
    headings: MarkdownHeading[];
    activeHeadingId?: string | null;
    onJump: (heading: MarkdownHeading) => void;
    onInsertHeading: () => void;
  };
  explorer: {
    path: string | null;
    entries: FileExplorerEntry[];
    selectedImage: string | null;
    loading: boolean;
    error: string | null;
    watcherMessage?: string | null;
    onChooseFolder: () => void;
    onOpenPath: (path: string) => void;
    onOpenEntry: (entry: FileExplorerEntry) => void;
  };
  layerTwoDocument: ParsedScienfyDocument;
  bibliographyLoading: boolean;
  onViewChange: (view: SidebarView) => void;
  onJumpToLine: (line: number) => void;
  onReloadBibliography: () => void;
  onManageCitations: () => void;
  onInsertVariable: () => void;
  onLinkVariableFile: () => void;
  onEditVariable: (originalName: string, nextName: string, value: string) => void;
  selectedVariableName?: string | null;
  onSelectVariable: (name: string, usage?: ParsedScienfyDocument['variables']['usages'][number]) => void;
  onResize: (width: number) => void;
  onResizeCommit: (width: number) => void;
  onClose: () => void;
}

export const NavigationSidebar = memo(function NavigationSidebar({
  view,
  width,
  outline,
  explorer,
  layerTwoDocument,
  bibliographyLoading,
  onViewChange,
  onJumpToLine,
  onReloadBibliography,
  onManageCitations,
  onInsertVariable,
  onLinkVariableFile,
  onEditVariable,
  selectedVariableName,
  onSelectVariable,
  onResize,
  onResizeCommit,
  onClose,
}: NavigationSidebarProps) {
  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = Math.max(0, sidebarViews.indexOf(view));
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? sidebarViews.length - 1
        : event.key === 'ArrowRight'
          ? (currentIndex + 1) % sidebarViews.length
          : (currentIndex - 1 + sidebarViews.length) % sidebarViews.length;
    const nextView = sidebarViews[nextIndex];
    onViewChange(nextView);
    window.requestAnimationFrame(() => {
      document.getElementById(`sidebar-tab-${nextView}`)?.focus();
    });
  };
  const resizeTo = (nextWidth: number) => {
    onResize(nextWidth);
    onResizeCommit(nextWidth);
  };
  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextWidth = event.key === 'Home'
      ? SIDEBAR_WIDTH_MIN
      : event.key === 'End'
        ? SIDEBAR_WIDTH_MAX
        : width + (event.key === 'ArrowRight' ? 16 : -16);
    resizeTo(nextWidth);
  };
  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    let latestWidth = width;
    document.documentElement.classList.add('resizing-navigation-sidebar');
    const handlePointerMove = (moveEvent: PointerEvent) => {
      latestWidth = startWidth + moveEvent.clientX - startX;
      onResize(latestWidth);
    };
    const cleanupResize = () => {
      document.documentElement.classList.remove('resizing-navigation-sidebar');
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('blur', handleWindowBlur);
    };
    const handlePointerUp = () => {
      cleanupResize();
      onResizeCommit(latestWidth);
    };
    const handlePointerCancel = () => {
      cleanupResize();
      onResizeCommit(latestWidth);
    };
    const handleWindowBlur = () => {
      cleanupResize();
      onResizeCommit(latestWidth);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('blur', handleWindowBlur);
  };

  return (
    <aside className="outline-sidebar navigation-sidebar" aria-label="Document navigation">
      <div className="navigation-sidebar-header">
        <strong>{sidebarViewLabel(view)}</strong>
        <button
          type="button"
          className="sidebar-close-button"
          aria-label="Close navigation sidebar"
          data-tooltip="Close navigation sidebar"
          onClick={onClose}
        >
          <PanelLeftClose size={16} />
        </button>
      </div>
      <div className="sidebar-tabs four icon-tabs" role="tablist" aria-label="Sidebar view" onKeyDown={handleTabKeyDown}>
        <button
          id="sidebar-tab-files"
          role="tab"
          aria-selected={view === 'files'}
          aria-controls="sidebar-panel-files"
          tabIndex={view === 'files' ? 0 : -1}
          className={view === 'files' ? 'selected' : ''}
          aria-label="Files"
          data-tooltip="Files"
          onClick={() => onViewChange('files')}
        >
          <Folder size={16} />
          <span>Files</span>
        </button>
        <button
          id="sidebar-tab-outline"
          role="tab"
          aria-selected={view === 'outline'}
          aria-controls="sidebar-panel-outline"
          tabIndex={view === 'outline' ? 0 : -1}
          className={view === 'outline' ? 'selected' : ''}
          aria-label="Outline"
          data-tooltip="Outline"
          onClick={() => onViewChange('outline')}
        >
          <ListTree size={16} />
          <span>Outline</span>
        </button>
        <button
          id="sidebar-tab-data"
          role="tab"
          aria-selected={view === 'data'}
          aria-controls="sidebar-panel-data"
          tabIndex={view === 'data' ? 0 : -1}
          className={view === 'data' ? 'selected' : ''}
          aria-label="Data"
          data-tooltip="Data"
          onClick={() => onViewChange('data')}
        >
          <Database size={16} />
          <span>Data</span>
        </button>
        <button
          id="sidebar-tab-references"
          role="tab"
          aria-selected={view === 'references'}
          aria-controls="sidebar-panel-references"
          tabIndex={view === 'references' ? 0 : -1}
          className={view === 'references' ? 'selected' : ''}
          aria-label="References"
          data-tooltip="References"
          onClick={() => onViewChange('references')}
        >
          <BookOpen size={16} />
          <span>Refs</span>
        </button>
      </div>

      <div
        id={`sidebar-panel-${view}`}
        className="navigation-sidebar-panel"
        role="tabpanel"
        aria-labelledby={`sidebar-tab-${view}`}
      >
        {view === 'files' ? (
          <ExplorerPanel
            explorerPath={explorer.path}
            explorerEntries={explorer.entries}
            explorerSelectedImage={explorer.selectedImage}
            explorerLoading={explorer.loading}
            explorerError={explorer.error}
            explorerWatcherMessage={explorer.watcherMessage}
            onChooseFolder={explorer.onChooseFolder}
            onOpenExplorerPath={explorer.onOpenPath}
            onOpenExplorerEntry={explorer.onOpenEntry}
          />
        ) : view === 'outline' ? (
          <OutlinePanel headings={outline.headings} activeHeadingId={outline.activeHeadingId} onJump={outline.onJump} onInsertHeading={outline.onInsertHeading} />
        ) : view === 'data' ? (
          <DataSourcesPanel
            layerTwoDocument={layerTwoDocument}
            onInsertVariable={onInsertVariable}
            onLinkVariableFile={onLinkVariableFile}
            onEditVariable={onEditVariable}
            selectedVariableName={selectedVariableName}
            onSelectVariable={onSelectVariable}
          />
        ) : view === 'references' ? (
          <ReferencesPanel
            layerTwoDocument={layerTwoDocument}
            bibliographyLoading={bibliographyLoading}
            onJumpToLine={onJumpToLine}
            onReloadBibliography={onReloadBibliography}
            onManageCitations={onManageCitations}
          />
        ) : null}
      </div>
      <div
        className="sidebar-resize-handle"
        role="separator"
        aria-label="Resize navigation sidebar"
        aria-orientation="vertical"
        aria-valuemin={SIDEBAR_WIDTH_MIN}
        aria-valuemax={SIDEBAR_WIDTH_MAX}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        onKeyDown={handleResizeKeyDown}
        onPointerDown={handleResizePointerDown}
      />
    </aside>
  );
});

function sidebarViewLabel(view: SidebarView): string {
  if (view === 'references') return 'References';
  return view[0].toUpperCase() + view.slice(1);
}

function OutlinePanel({ headings, activeHeadingId, onJump, onInsertHeading }: {
  headings: MarkdownHeading[];
  activeHeadingId?: string | null;
  onJump: (heading: MarkdownHeading) => void;
  onInsertHeading: () => void;
}) {
  return (
    <>
      <div className="outline-header">
        <ListTree size={16} />
        <span>Outline</span>
      </div>
      {headings.length === 0 ? (
        <div className="sidebar-empty-state">
          <strong>No headings yet</strong>
          <span>Add a heading to build the document outline and enable section jumps.</span>
          <button type="button" onClick={onInsertHeading}>Add heading</button>
        </div>
      ) : (
        <nav>
          {headings.map((heading) => (
            <button
              key={`${heading.id}-${heading.line}`}
              className={`outline-item level-${heading.level} ${heading.id === activeHeadingId ? 'active' : ''}`}
              title={`${heading.text} (line ${heading.line})`}
              onClick={() => onJump(heading)}
            >
              {heading.text}
            </button>
          ))}
        </nav>
      )}
    </>
  );
}

function ExplorerPanel({
  explorerPath,
  explorerEntries,
  explorerSelectedImage,
  explorerLoading,
  explorerError,
  explorerWatcherMessage,
  onChooseFolder,
  onOpenExplorerPath,
  onOpenExplorerEntry,
}: {
  explorerPath: string | null;
  explorerEntries: FileExplorerEntry[];
  explorerSelectedImage: string | null;
  explorerLoading: boolean;
  explorerError: string | null;
  explorerWatcherMessage?: string | null;
  onChooseFolder: () => void;
  onOpenExplorerPath: (path: string) => void;
  onOpenExplorerEntry: (entry: FileExplorerEntry) => void;
}) {
  const parentPath = explorerPath ? parentDirectory(explorerPath) : null;

  return (
    <div className="explorer-panel">
      <div className="explorer-actions">
        <button onClick={onChooseFolder}><FolderOpen size={15} />Choose folder</button>
        <button disabled={!parentPath} onClick={() => parentPath && onOpenExplorerPath(parentPath)}>Up</button>
      </div>
      <div className="explorer-path" title={explorerPath ?? ''}>
        {explorerPath ?? 'Choose a folder to browse Markdown documents.'}
      </div>
      {explorerWatcherMessage && <p className="explorer-error explorer-status">{explorerWatcherMessage}</p>}
      {explorerError && <p className="explorer-error">{explorerError}</p>}
      {explorerLoading ? (
        <p className="outline-empty">Loading...</p>
      ) : explorerPath && explorerEntries.length === 0 ? (
        <p className="outline-empty">No readable files here</p>
      ) : (
        <div className="explorer-list">
          {explorerEntries.map((entry) => (
            <button
              key={entry.path}
              className={`explorer-item ${entry.kind}`}
              title={entry.path}
              onClick={() => onOpenExplorerEntry(entry)}
            >
              {entry.kind === 'directory' && <Folder size={15} />}
              {entry.kind === 'markdown' && <FileText size={15} />}
              <span>{entry.name}</span>
            </button>
          ))}
        </div>
      )}
      {explorerSelectedImage && (
        <div className="explorer-image-preview">
          <img src={localImageDisplayUrl(explorerSelectedImage)} alt={fileName(explorerSelectedImage)} />
          <span>{fileName(explorerSelectedImage)}</span>
        </div>
      )}
    </div>
  );
}

function ReferencesPanel({ layerTwoDocument, bibliographyLoading, onJumpToLine, onReloadBibliography, onManageCitations }: {
  layerTwoDocument: ParsedScienfyDocument;
  bibliographyLoading: boolean;
  onJumpToLine: (line: number) => void;
  onReloadBibliography: () => void;
  onManageCitations: () => void;
}) {
  const entryByKey = new Map(layerTwoDocument.citations.bibtexEntries.map((entry) => [entry.key, entry]));
  return (
    <div className="explorer-panel">
      <div className="outline-header">
        <BookOpen size={16} />
        <span>References</span>
      </div>
      <div className="explorer-actions">
        <button disabled={layerTwoDocument.citations.bibliographyFiles.length === 0 || bibliographyLoading} onClick={onReloadBibliography}>
          {bibliographyLoading ? 'Reloading...' : 'Reload .bib'}
        </button>
        <button onClick={onManageCitations}>Citation manager</button>
      </div>
      <div className="reference-group">
        <strong>Citations</strong>
        {layerTwoDocument.citations.usages.length === 0 ? (
          <div className="sidebar-empty-state compact">
            <span>No citations yet. Use the Citation toolbar button or type `[@` in Markdown.</span>
            <button type="button" onClick={onManageCitations}>Open citation manager</button>
          </div>
        ) : (
          layerTwoDocument.citations.usages.map((usage) => (
            <CitationButton
              key={`${usage.key}-${usage.line}`}
              citationKey={usage.key}
              line={usage.line}
              entry={entryByKey.get(usage.key)}
              missing={layerTwoDocument.citations.missingKeys.includes(usage.key)}
              hasBibliography={layerTwoDocument.citations.bibtexKeys.length > 0}
              onJumpToLine={onJumpToLine}
            />
          ))
        )}
      </div>
      <div className="reference-group">
        <strong>Bibliography</strong>
        {layerTwoDocument.citations.bibliographyFiles.length === 0 ? (
          <div className="sidebar-empty-state compact">
            <span>Configure a `.bib` file here so citations can be verified and exported.</span>
            <button type="button" onClick={onManageCitations}>Configure bibliography</button>
          </div>
        ) : (
          layerTwoDocument.citations.bibliographyFiles.map((file) => (
            <button
              key={file}
              className="explorer-item text"
              title={file}
            >
              <BookOpen size={15} />
              <span>{file}</span>
            </button>
          ))
        )}
        {layerTwoDocument.citations.bibtexEntries.length > 0 && (
          <div className="citation-entry-mini-list">
            {layerTwoDocument.citations.bibtexEntries.slice(0, 12).map((entry) => (
              <button
                key={entry.key}
                className="citation-entry-mini"
                title={citationTooltip(entry)}
                onClick={onManageCitations}
              >
                <span>@{entry.key}</span>
                <small>{compactCitationTitle(entry)}</small>
              </button>
            ))}
            {layerTwoDocument.citations.bibtexEntries.length > 12 && (
              <small className="data-source-more">+{layerTwoDocument.citations.bibtexEntries.length - 12} more entr{layerTwoDocument.citations.bibtexEntries.length - 12 === 1 ? 'y' : 'ies'}</small>
            )}
          </div>
        )}
      </div>
      <div className="reference-group">
        <strong>Labels</strong>
        {layerTwoDocument.references.labels.length === 0 ? (
          <p className="outline-empty">No labels</p>
        ) : (
          layerTwoDocument.references.labels.map((label) => (
            <button
              key={`${label.id}-${label.line}`}
              className="explorer-item markdown"
              title={`Line ${label.line}`}
              onClick={() => onJumpToLine(label.line)}
            >
              <FileText size={15} />
              <span>{label.id}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function CitationButton({ citationKey, line, entry, missing, hasBibliography, onJumpToLine }: {
  citationKey: string;
  line: number;
  entry?: BibtexEntry;
  missing: boolean;
  hasBibliography: boolean;
  onJumpToLine: (line: number) => void;
}) {
  const title = entry
    ? citationTooltip(entry)
    : missing
      ? `Missing citation @${citationKey}. Add it to the loaded .bib file.`
      : hasBibliography
        ? `Citation @${citationKey}`
        : `Unverified citation @${citationKey}. Configure bibliography in front matter.`;
  return (
    <button
      className={`explorer-item citation-item ${missing ? 'missing' : entry ? 'verified' : 'unverified'}`}
      title={title}
      onClick={() => onJumpToLine(line)}
    >
      {missing ? <AlertTriangle size={15} /> : entry ? <CheckCircle2 size={15} /> : <Text size={15} />}
      <span>@{citationKey}</span>
    </button>
  );
}

function DataSourcesPanel({ layerTwoDocument, onInsertVariable, onLinkVariableFile, onEditVariable, selectedVariableName, onSelectVariable }: {
  layerTwoDocument: ParsedScienfyDocument;
  onInsertVariable: () => void;
  onLinkVariableFile: () => void;
  onEditVariable: (originalName: string, nextName: string, value: string) => void;
  selectedVariableName?: string | null;
  onSelectVariable: (name: string, usage?: ParsedScienfyDocument['variables']['usages'][number]) => void;
}) {
  const missingUsages = layerTwoDocument.variables.usages.filter((usage) => (
    layerTwoDocument.variables.missingVariables.includes(usage.name)
  ));
  const variableRows = useMemo(
    () => createVariableRows(layerTwoDocument.variables.definitions, layerTwoDocument.variables.usages),
    [layerTwoDocument.variables.definitions, layerTwoDocument.variables.usages],
  );
  const selectedName = selectedVariableName && variableRows.some((row) => row.name === selectedVariableName)
    ? selectedVariableName
    : variableRows[0]?.name ?? null;
  const selectedUsages = selectedName
    ? layerTwoDocument.variables.usages.filter((usage) => usage.name === selectedName)
    : [];

  return (
    <div className="explorer-panel data-panel">
      <div className="outline-header">
        <Database size={16} />
        <span>Data sources</span>
      </div>
      <div className="explorer-actions">
        <button onClick={onInsertVariable}>Add variable</button>
        <button onClick={onLinkVariableFile}>Link data file</button>
      </div>
      {layerTwoDocument.variableFiles.length === 0 && layerTwoDocument.variables.definitions.length === 0 ? (
        <div className="sidebar-empty-state">
          <strong>No data variables yet</strong>
          <span>Add a front matter variable or link a JSON/CSV file, then use placeholders like {`{{ cohort_n }}`} in the text.</span>
          <div className="sidebar-empty-actions">
            <button type="button" onClick={onInsertVariable}>Add variable</button>
            <button type="button" onClick={onLinkVariableFile}>Link data file</button>
          </div>
        </div>
      ) : (
        <section className="data-source-card variable-editor-card variable-index-card">
          <div className="variable-index-card-header">
            <div>
              <strong>Variables</strong>
              <span>{variableRows.length} defined or used in this document</span>
            </div>
          </div>
          <div className="variable-index-list" role="list">
            {variableRows.map((row) => (
              <VariableDefinitionEditor
                key={`${row.name}-${row.definition?.source ?? 'missing'}-${row.definition?.file ?? ''}-${row.definition?.value ?? ''}`}
                row={row}
                selected={row.name === selectedName}
                missing={layerTwoDocument.variables.missingVariables.includes(row.name)}
                onSelect={onSelectVariable}
                onSave={onEditVariable}
              />
            ))}
          </div>
          {selectedName && (
            <div className="variable-selected-usage">
              <strong>{`{{ ${selectedName} }}`}</strong>
              {selectedUsages.length === 0 ? (
                <span>This variable is defined but is not used within the document.</span>
              ) : (
                <>
                  <span>{selectedUsages.length} use{selectedUsages.length === 1 ? '' : 's'} highlighted in the document.</span>
                  <div className="variable-usage-chips">
                    {selectedUsages.slice(0, 12).map((usage, index) => (
                      <button
                        key={`${usage.name}-${usage.from}-${usage.to}`}
                        type="button"
                        onClick={() => onSelectVariable(usage.name, usage)}
                      >
                        Line {usage.line}{selectedUsages.length > 1 ? ` · ${index + 1}` : ''}
                      </button>
                    ))}
                    {selectedUsages.length > 12 && <small>+{selectedUsages.length - 12} more</small>}
                  </div>
                </>
              )}
            </div>
          )}
          {layerTwoDocument.variableFiles.length > 0 && (
            <p className="variable-source-note">
              Linked data: {layerTwoDocument.variableFiles.join(', ')}. Saving an external variable creates a front matter override.
            </p>
          )}
        </section>
      )}
      {missingUsages.length > 0 && (
        <div className="diff-protected-warning data-warning">
          <strong>{missingUsages.length} unresolved variable reference{missingUsages.length === 1 ? '' : 's'}.</strong>
          <span>Exports would show the raw placeholder. Add the variable to front matter or a linked JSON/CSV file.</span>
        </div>
      )}
    </div>
  );
}

interface VariableRowModel {
  name: string;
  definition: VariableDefinition | null;
  usageCount: number;
}

function VariableDefinitionEditor({ row, selected, missing, onSelect, onSave }: {
  row: VariableRowModel;
  selected: boolean;
  missing: boolean;
  onSelect: (name: string) => void;
  onSave: (originalName: string, nextName: string, value: string) => void;
}) {
  const definition = row.definition;
  const [name, setName] = useState(row.name);
  const [value, setValue] = useState(definition?.value ?? '');
  useEffect(() => {
    setName(row.name);
    setValue(definition?.value ?? '');
  }, [definition?.value, row.name]);
  const dirty = !definition || name.trim() !== definition.name || value.trim() !== definition.value;
  const valid = /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name.trim());
  const source = definition?.file ?? definition?.source ?? 'missing';
  const save = () => onSave(definition?.name ?? row.name, name.trim(), value.trim());
  const selectIfRowClick = (event: MouseEvent<HTMLDivElement>) => {
    if (isVariableEditorInteractiveTarget(event.target)) return;
    onSelect(row.name);
  };
  const selectIfRowKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (isVariableEditorInteractiveTarget(event.target)) return;
    event.preventDefault();
    onSelect(row.name);
  };
  return (
    <div
      className={`variable-editor-row ${selected ? 'selected' : ''} ${missing ? 'missing' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      title={row.usageCount > 0 ? `Highlight {{ ${row.name} }} in the document` : `{{ ${row.name} }} is not used in the document`}
      onClick={selectIfRowClick}
      onKeyDown={selectIfRowKey}
    >
      <input
        aria-label={`Variable name ${row.name}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <input
        aria-label={`Variable value ${row.name}`}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !dirty || !valid) return;
          event.preventDefault();
          save();
        }}
      />
      <button type="button" className="variable-usage-button" onClick={() => onSelect(row.name)}>
        {row.usageCount === 0 ? 'Unused' : `${row.usageCount} use${row.usageCount === 1 ? '' : 's'}`}
      </button>
      <button
        type="button"
        disabled={!dirty || !valid}
        title={definition?.source === 'external' ? 'Save as front matter override' : definition ? 'Save variable' : 'Define in front matter'}
        onClick={save}
      >
        {definition ? 'Save' : 'Define'}
      </button>
      <small>{source}</small>
    </div>
  );
}

function createVariableRows(definitions: VariableDefinition[], usages: ParsedScienfyDocument['variables']['usages']): VariableRowModel[] {
  const definitionsByName = uniqueVariables(definitions);
  const rows = new Map<string, VariableRowModel>();
  for (const definition of definitionsByName) {
    rows.set(definition.name, {
      name: definition.name,
      definition,
      usageCount: usages.filter((usage) => usage.name === definition.name).length,
    });
  }
  for (const usage of usages) {
    if (rows.has(usage.name)) continue;
    rows.set(usage.name, {
      name: usage.name,
      definition: null,
      usageCount: usages.filter((candidate) => candidate.name === usage.name).length,
    });
  }
  return Array.from(rows.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function uniqueVariables(definitions: VariableDefinition[]): VariableDefinition[] {
  const map = new Map<string, VariableDefinition>();
  for (const definition of definitions) {
    map.set(definition.name, definition);
  }
  return Array.from(map.values());
}

function isVariableEditorInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, button, textarea, select, a'));
}

function citationTooltip(entry: BibtexEntry): string {
  const title = cleanBibtexField(entry.fields.title) || entry.key;
  const authors = cleanBibtexField(entry.fields.author || entry.fields.editor || 'Unknown authors');
  const year = cleanBibtexField(entry.fields.year || 'n.d.');
  const venue = cleanBibtexField(entry.fields.journal || entry.fields.booktitle || entry.fields.publisher || '');
  const doi = cleanBibtexField(entry.fields.doi || '');
  return [
    `@${entry.key}`,
    title,
    `${authors} (${year})`,
    venue,
    doi ? `DOI: ${doi.replace(/^https?:\/\/doi\.org\//i, '')}` : '',
  ].filter(Boolean).join('\n');
}

function compactCitationTitle(entry: BibtexEntry): string {
  return cleanBibtexField(entry.fields.title || entry.fields.doi || entry.fields.url || entry.type || entry.key);
}

function cleanBibtexField(value: string): string {
  return value.replace(/[{}]/g, '').replace(/\\&/g, '&').replace(/\s+/g, ' ').trim();
}

function parentDirectory(path: string): string | null {
  const normalized = path.replace(/\\/g, '/');
  const trimmed = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  const index = trimmed.lastIndexOf('/');
  if (index <= 0) return null;
  const parent = trimmed.slice(0, index);
  return path.includes('\\') ? parent.replace(/\//g, '\\') : parent;
}

function fileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').at(-1) ?? path;
}
