import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { AlertTriangle, BookOpen, CheckCircle2, Copy, Database, ExternalLink, FileText, Folder, FolderOpen, ListTree, MapPin, PanelLeftClose, Pencil, TableProperties, Text } from 'lucide-react';
import type { ParsedScienfyDocument } from '@sciemd/core';
import type { BibtexEntry } from '@sciemd/core';
import type { VariableDefinition } from '@sciemd/core';
import type { MarkdownHeading } from '@sciemd/core';
import type { FileExplorerEntry } from '../services/fileService';
import { SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from '../services/settingsService';
import type { SidebarView } from '../services/settingsService';
import { localImageDisplayUrl } from '../markdown/imagePaths';
import { MARKDOWN_UI_CAPABILITIES, type FormatUiCapabilities } from '../app/formatCapabilities';
import type {
  StructuredNavigationIndex,
  StructuredNavigationItem,
  StructuredNavigationTarget,
} from '../app/structuredNavigation';
import { ContextMenuCard, type ContextMenuSection } from './ContextMenuCard';
import {
  copyContextMenuItem,
  copyContextMenuSection,
  openContextMenuFromEvent,
  openContextMenuFromKeyboard,
  type ContextMenuCopyFeedback,
  type ContextMenuOpenState,
} from './contextMenuUtils';

const sidebarViews: SidebarView[] = ['files', 'outline', 'data', 'references'];

interface NavigationSidebarProps {
  view: SidebarView;
  width: number;
  formatCapabilities?: FormatUiCapabilities;
  outline: {
    headings: MarkdownHeading[];
    activeHeadingId?: string | null;
    onJump: (heading: MarkdownHeading) => void;
    onInsertHeading: () => void;
  };
  structuredNavigation?: {
    index: StructuredNavigationIndex | null;
    activeTargetKey?: string | null;
    onNavigate: (target: StructuredNavigationTarget) => void;
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
  onCopyFeedback?: ContextMenuCopyFeedback;
}

export const NavigationSidebar = memo(function NavigationSidebar({
  view,
  width,
  formatCapabilities = MARKDOWN_UI_CAPABILITIES,
  outline,
  structuredNavigation,
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
  onCopyFeedback,
}: NavigationSidebarProps) {
  const hasStructuredNavigation = Boolean(structuredNavigation?.index);
  const availableViews = useMemo(
    () => sidebarViews.filter((candidate) => sidebarViewAvailable(candidate, formatCapabilities, hasStructuredNavigation)),
    [formatCapabilities, hasStructuredNavigation],
  );
  const activeView = availableViews.includes(view) ? view : availableViews[0] ?? 'files';
  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = Math.max(0, availableViews.indexOf(activeView));
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? availableViews.length - 1
        : event.key === 'ArrowRight'
          ? (currentIndex + 1) % availableViews.length
          : (currentIndex - 1 + availableViews.length) % availableViews.length;
    const nextView = availableViews[nextIndex];
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
        <strong>{sidebarViewLabel(activeView, hasStructuredNavigation)}</strong>
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
        {availableViews.map((candidate) => (
          <button
            key={candidate}
            id={`sidebar-tab-${candidate}`}
            role="tab"
            aria-selected={activeView === candidate}
            aria-controls={`sidebar-panel-${candidate}`}
            tabIndex={activeView === candidate ? 0 : -1}
            className={activeView === candidate ? 'selected' : ''}
            aria-label={sidebarViewLabel(candidate, hasStructuredNavigation)}
            data-tooltip={sidebarViewLabel(candidate, hasStructuredNavigation)}
            onClick={() => onViewChange(candidate)}
          >
            {sidebarIcon(candidate)}
            <span>{sidebarTabLabel(candidate, hasStructuredNavigation)}</span>
          </button>
        ))}
      </div>

      <div
        id={`sidebar-panel-${activeView}`}
        className="navigation-sidebar-panel"
        role="tabpanel"
        aria-labelledby={`sidebar-tab-${activeView}`}
      >
        {activeView === 'files' ? (
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
            onCopyFeedback={onCopyFeedback}
          />
        ) : activeView === 'outline' && hasStructuredNavigation && structuredNavigation?.index ? (
          <StructuredNavigationPanel
            index={structuredNavigation.index}
            activeTargetKey={structuredNavigation.activeTargetKey}
            onNavigate={structuredNavigation.onNavigate}
            onCopyFeedback={onCopyFeedback}
          />
        ) : activeView === 'outline' ? (
          <OutlinePanel headings={outline.headings} activeHeadingId={outline.activeHeadingId} onJump={outline.onJump} onInsertHeading={outline.onInsertHeading} onCopyFeedback={onCopyFeedback} />
        ) : activeView === 'data' ? (
          <DataSourcesPanel
            layerTwoDocument={layerTwoDocument}
            onInsertVariable={onInsertVariable}
            onLinkVariableFile={onLinkVariableFile}
            onEditVariable={onEditVariable}
            selectedVariableName={selectedVariableName}
            onSelectVariable={onSelectVariable}
            onCopyFeedback={onCopyFeedback}
          />
        ) : activeView === 'references' ? (
          <ReferencesPanel
            layerTwoDocument={layerTwoDocument}
            bibliographyLoading={bibliographyLoading}
            onJumpToLine={onJumpToLine}
            onReloadBibliography={onReloadBibliography}
            onManageCitations={onManageCitations}
            onCopyFeedback={onCopyFeedback}
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

function sidebarViewLabel(view: SidebarView, hasStructuredNavigation = false): string {
  if (view === 'outline' && hasStructuredNavigation) return 'Structure';
  if (view === 'references') return 'References';
  return view[0].toUpperCase() + view.slice(1);
}

function sidebarTabLabel(view: SidebarView, hasStructuredNavigation = false): string {
  if (view === 'outline' && hasStructuredNavigation) return 'Struct';
  if (view === 'references') return 'Refs';
  return sidebarViewLabel(view, hasStructuredNavigation);
}

function sidebarIcon(view: SidebarView) {
  if (view === 'files') return <Folder size={16} />;
  if (view === 'outline') return <ListTree size={16} />;
  if (view === 'data') return <Database size={16} />;
  return <BookOpen size={16} />;
}

function sidebarViewAvailable(view: SidebarView, capabilities: FormatUiCapabilities, hasStructuredNavigation = false): boolean {
  if (view === 'files') return true;
  if (view === 'outline') return capabilities.canUseManuscriptReadiness || hasStructuredNavigation;
  if (view === 'data') return capabilities.canUseVariablesPanel;
  if (view === 'references') return capabilities.canUseCitations;
  return false;
}

function explorerEntryIcon(kind: FileExplorerEntry['kind']) {
  switch (kind) {
    case 'directory':
      return <Folder size={15} />;
    case 'markdown':
      return <FileText size={15} />;
    case 'json':
    case 'jsonl':
      return <Database size={15} />;
    case 'csv':
    case 'tsv':
      return <TableProperties size={15} />;
    case 'yaml':
    case 'toml':
    case 'xml':
    case 'plainText':
      return <Text size={15} />;
  }
}

function OutlinePanel({ headings, activeHeadingId, onJump, onInsertHeading, onCopyFeedback }: {
  headings: MarkdownHeading[];
  activeHeadingId?: string | null;
  onJump: (heading: MarkdownHeading) => void;
  onInsertHeading: () => void;
  onCopyFeedback?: ContextMenuCopyFeedback;
}) {
  const [contextMenu, setContextMenu] = useState<ContextMenuOpenState | null>(null);
  const headingMenuState = (heading: MarkdownHeading): Omit<ContextMenuOpenState, 'position'> => ({
      ariaLabel: `Actions for heading ${heading.text}`,
      sections: [
        {
          items: [
            {
              id: 'jump-heading',
              label: 'Jump to heading',
              icon: <MapPin size={16} />,
              onSelect: () => onJump(heading),
            },
          ],
        },
        copyContextMenuSection('copy-heading', 'Copy', <Copy size={16} />, [
          copyContextMenuItem({ id: 'copy-heading-text', label: 'Copy heading text', icon: <Copy size={16} />, text: heading.text, onCopyFeedback }),
          copyContextMenuItem({ id: 'copy-heading-line', label: 'Copy line number', icon: <Copy size={16} />, text: String(heading.line), onCopyFeedback }),
        ]),
      ],
    });
  const openHeadingMenu = (event: MouseEvent<HTMLElement>, heading: MarkdownHeading) => {
    openContextMenuFromEvent(event, setContextMenu, headingMenuState(heading));
  };
  const openHeadingKeyboardMenu = (event: KeyboardEvent<HTMLElement>, heading: MarkdownHeading) => {
    openContextMenuFromKeyboard(event, setContextMenu, headingMenuState(heading));
  };

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
              onKeyDown={(event) => openHeadingKeyboardMenu(event, heading)}
              onContextMenu={(event) => openHeadingMenu(event, heading)}
            >
              {heading.text}
            </button>
          ))}
        </nav>
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
    </>
  );
}

function StructuredNavigationPanel({
  index,
  activeTargetKey,
  onNavigate,
  onCopyFeedback,
}: {
  index: StructuredNavigationIndex;
  activeTargetKey?: string | null;
  onNavigate: (target: StructuredNavigationTarget) => void;
  onCopyFeedback?: ContextMenuCopyFeedback;
}) {
  const [query, setQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuOpenState | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = normalizedQuery
    ? index.items.filter((item) => item.searchText.includes(normalizedQuery))
    : index.items;
  const itemMenuState = (item: StructuredNavigationItem): Omit<ContextMenuOpenState, 'position'> => ({
    ariaLabel: `Actions for ${item.label}`,
    sections: [
      {
        items: [
          {
            id: 'jump-structured-item',
            label: 'Jump to item',
            icon: <MapPin size={16} />,
            onSelect: () => onNavigate(item.target),
          },
        ],
      },
      copyContextMenuSection('copy-structured-item', 'Copy', <Copy size={16} />, [
        copyContextMenuItem({
          id: 'copy-structured-path',
          label: 'Copy path',
          icon: <Copy size={16} />,
          text: item.target.path ?? item.target.sourceRange?.displayPath ?? item.label,
          onCopyFeedback,
        }),
        copyContextMenuItem({
          id: 'copy-structured-detail',
          label: 'Copy detail',
          icon: <Copy size={16} />,
          text: item.detail,
          onCopyFeedback,
        }),
      ]),
    ],
  });
  const openItemMenu = (event: MouseEvent<HTMLElement>, item: StructuredNavigationItem) => {
    openContextMenuFromEvent(event, setContextMenu, itemMenuState(item));
  };
  const openItemKeyboardMenu = (event: KeyboardEvent<HTMLElement>, item: StructuredNavigationItem) => {
    openContextMenuFromKeyboard(event, setContextMenu, itemMenuState(item));
  };

  return (
    <div className="structured-navigation-panel">
      <div className="outline-header">
        <ListTree size={16} />
        <span>{index.title}</span>
      </div>
      <div className="structured-navigation-summary">{index.summary}</div>
      <input
        className="structured-navigation-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter paths, rows, diagnostics"
        aria-label="Filter structure"
      />
      {visibleItems.length === 0 ? (
        <div className="sidebar-empty-state compact">
          <strong>No matching structure</strong>
          <span>Try a path, row number, column name, diagnostic code, or field label.</span>
        </div>
      ) : (
        <nav className="structured-navigation-list" aria-label={index.title}>
          {visibleItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`structured-navigation-item ${item.kind} level-${Math.min(6, item.level + 1)} ${activeTargetKey && activeTargetKey === targetKeyForItem(item) ? 'active' : ''} ${item.severity ?? ''}`}
              title={item.detail}
              onClick={() => onNavigate(item.target)}
              onKeyDown={(event) => openItemKeyboardMenu(event, item)}
              onContextMenu={(event) => openItemMenu(event, item)}
            >
              <span className="structured-navigation-kind">{structuredNavigationIcon(item)}</span>
              <span className="structured-navigation-label">{item.label}</span>
              <small>{item.detail}</small>
            </button>
          ))}
        </nav>
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
    </div>
  );
}

function targetKeyForItem(item: StructuredNavigationItem): string {
  const target = item.target;
  if (target.path) return `${target.format}:path:${target.path}`;
  if (target.line !== undefined) return `${target.format}:line:${target.line}`;
  if (target.rowIndex !== undefined && target.columnIndex !== undefined) return `${target.format}:cell:${target.rowIndex}:${target.columnIndex}`;
  if (target.rowIndex !== undefined) return `${target.format}:row:${target.rowIndex}`;
  if (target.columnIndex !== undefined) return `${target.format}:column:${target.columnIndex}`;
  return item.id;
}

function structuredNavigationIcon(item: StructuredNavigationItem) {
  if (item.kind === 'diagnostic') return <AlertTriangle size={14} />;
  if (item.kind === 'column' || item.kind === 'row' || item.kind === 'cell') return <TableProperties size={14} />;
  if (item.kind === 'record') return <Database size={14} />;
  return <ListTree size={14} />;
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
  onCopyFeedback,
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
  onCopyFeedback?: ContextMenuCopyFeedback;
}) {
  const parentPath = explorerPath ? parentDirectory(explorerPath) : null;
  const [contextMenu, setContextMenu] = useState<ContextMenuOpenState | null>(null);
  const entryMenuState = (entry: FileExplorerEntry): Omit<ContextMenuOpenState, 'position'> => {
    const entryParentPath = parentDirectory(entry.path);
    const sections: ContextMenuSection[] = [
      {
        items: [
          {
            id: 'open-entry',
            label: entry.kind === 'directory' ? 'Open folder' : 'Open file',
            icon: entry.kind === 'directory' ? <FolderOpen size={16} /> : <ExternalLink size={16} />,
            onSelect: () => onOpenExplorerEntry(entry),
          },
        ],
      },
      copyContextMenuSection('copy-entry', 'Copy', <Copy size={16} />, [
        copyContextMenuItem({ id: 'copy-entry-path', label: 'Copy path', icon: <Copy size={16} />, text: entry.path, onCopyFeedback }),
        copyContextMenuItem({ id: 'copy-entry-filename', label: 'Copy filename', icon: <Copy size={16} />, text: entry.name, onCopyFeedback }),
      ]),
    ];
    if (entryParentPath) {
      sections.push({
        items: [
          {
            id: 'open-entry-parent',
            label: 'Open parent folder',
            icon: <FolderOpen size={16} />,
            onSelect: () => onOpenExplorerPath(entryParentPath),
          },
        ],
      });
    }

    return {
      ariaLabel: `Actions for ${entry.name}`,
      sections,
    };
  };
  const openEntryMenu = (event: MouseEvent<HTMLElement>, entry: FileExplorerEntry) => {
    openContextMenuFromEvent(event, setContextMenu, entryMenuState(entry));
  };
  const openEntryKeyboardMenu = (event: KeyboardEvent<HTMLElement>, entry: FileExplorerEntry) => {
    openContextMenuFromKeyboard(event, setContextMenu, entryMenuState(entry));
  };
  const explorerPathMenuState = (path: string): Omit<ContextMenuOpenState, 'position'> => {
    const pathParent = parentDirectory(path);
    const sections: ContextMenuSection[] = [
      copyContextMenuSection('copy-explorer-path', 'Copy', <Copy size={16} />, [
        copyContextMenuItem({ id: 'copy-folder-path', label: 'Copy folder path', icon: <Copy size={16} />, text: path, onCopyFeedback }),
        copyContextMenuItem({ id: 'copy-folder-name', label: 'Copy folder name', icon: <Copy size={16} />, text: fileName(path), onCopyFeedback }),
      ]),
    ];
    if (pathParent) {
      sections.unshift({
        items: [
          {
            id: 'open-folder-parent',
            label: 'Open parent folder',
            icon: <FolderOpen size={16} />,
            onSelect: () => onOpenExplorerPath(pathParent),
          },
        ],
      });
    }
    return {
      ariaLabel: `Actions for folder ${fileName(path)}`,
      sections,
    };
  };
  const imagePreviewMenuState = (path: string): Omit<ContextMenuOpenState, 'position'> => {
    const imageParent = parentDirectory(path);
    const sections: ContextMenuSection[] = [
      copyContextMenuSection('copy-image-preview', 'Copy', <Copy size={16} />, [
        copyContextMenuItem({ id: 'copy-image-path', label: 'Copy image path', icon: <Copy size={16} />, text: path, onCopyFeedback }),
        copyContextMenuItem({ id: 'copy-image-filename', label: 'Copy filename', icon: <Copy size={16} />, text: fileName(path), onCopyFeedback }),
      ]),
    ];
    if (imageParent) {
      sections.unshift({
        items: [
          {
            id: 'open-image-parent',
            label: 'Open parent folder',
            icon: <FolderOpen size={16} />,
            onSelect: () => onOpenExplorerPath(imageParent),
          },
        ],
      });
    }
    return {
      ariaLabel: `Actions for image ${fileName(path)}`,
      sections,
    };
  };
  const openExplorerPathMenu = (event: MouseEvent<HTMLElement>) => {
    if (!explorerPath) return;
    openContextMenuFromEvent(event, setContextMenu, explorerPathMenuState(explorerPath));
  };
  const openExplorerPathKeyboardMenu = (event: KeyboardEvent<HTMLElement>) => {
    if (!explorerPath) return;
    openContextMenuFromKeyboard(event, setContextMenu, explorerPathMenuState(explorerPath));
  };
  const openImagePreviewMenu = (event: MouseEvent<HTMLElement>) => {
    if (!explorerSelectedImage) return;
    openContextMenuFromEvent(event, setContextMenu, imagePreviewMenuState(explorerSelectedImage));
  };
  const openImagePreviewKeyboardMenu = (event: KeyboardEvent<HTMLElement>) => {
    if (!explorerSelectedImage) return;
    openContextMenuFromKeyboard(event, setContextMenu, imagePreviewMenuState(explorerSelectedImage));
  };

  return (
    <div className="explorer-panel">
      <div className="explorer-actions">
        <button onClick={onChooseFolder}><FolderOpen size={15} />Choose folder</button>
        <button disabled={!parentPath} onClick={() => parentPath && onOpenExplorerPath(parentPath)}>Up</button>
      </div>
      <div
        className="explorer-path"
        title={explorerPath ?? ''}
        tabIndex={explorerPath ? 0 : undefined}
        aria-label={explorerPath ? `Current folder ${explorerPath}` : undefined}
        onKeyDown={openExplorerPathKeyboardMenu}
        onContextMenu={openExplorerPathMenu}
      >
        {explorerPath ?? 'Choose a folder to browse readable documents.'}
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
              onKeyDown={(event) => openEntryKeyboardMenu(event, entry)}
              onContextMenu={(event) => openEntryMenu(event, entry)}
            >
              {explorerEntryIcon(entry.kind)}
              <span>{entry.name}</span>
            </button>
          ))}
        </div>
      )}
      {explorerSelectedImage && (
        <div
          className="explorer-image-preview"
          tabIndex={0}
          aria-label={`Selected image ${fileName(explorerSelectedImage)}`}
          onKeyDown={openImagePreviewKeyboardMenu}
          onContextMenu={openImagePreviewMenu}
        >
          <img src={localImageDisplayUrl(explorerSelectedImage)} alt={fileName(explorerSelectedImage)} />
          <span>{fileName(explorerSelectedImage)}</span>
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
    </div>
  );
}

function ReferencesPanel({ layerTwoDocument, bibliographyLoading, onJumpToLine, onReloadBibliography, onManageCitations, onCopyFeedback }: {
  layerTwoDocument: ParsedScienfyDocument;
  bibliographyLoading: boolean;
  onJumpToLine: (line: number) => void;
  onReloadBibliography: () => void;
  onManageCitations: () => void;
  onCopyFeedback?: ContextMenuCopyFeedback;
}) {
  const entryByKey = new Map(layerTwoDocument.citations.bibtexEntries.map((entry) => [entry.key, entry]));
  const [contextMenu, setContextMenu] = useState<ContextMenuOpenState | null>(null);
  const citationMenuState = (citationKey: string, line: number, entry?: BibtexEntry): Omit<ContextMenuOpenState, 'position'> => ({
      ariaLabel: `Actions for citation ${citationKey}`,
      sections: [
        {
          items: [
            {
              id: 'jump-citation',
              label: 'Jump to citation line',
              icon: <MapPin size={16} />,
              onSelect: () => onJumpToLine(line),
            },
          ],
        },
        copyContextMenuSection('copy-citation', 'Copy', <Copy size={16} />, [
          copyContextMenuItem({ id: 'copy-citation-key', label: 'Copy citation key', icon: <Copy size={16} />, text: citationKey, onCopyFeedback }),
          copyContextMenuItem({
            id: 'copy-formatted-citation',
            label: 'Copy formatted citation',
            icon: <Copy size={16} />,
            text: entry ? citationTooltip(entry) : '',
            disabled: !entry,
            disabledReason: entry ? undefined : 'No loaded bibliography entry is available for this citation.',
            onCopyFeedback,
          }),
        ]),
      ],
    });
  const openCitationMenu = (event: MouseEvent<HTMLElement>, citationKey: string, line: number, entry?: BibtexEntry) => {
    openContextMenuFromEvent(event, setContextMenu, citationMenuState(citationKey, line, entry));
  };
  const openCitationKeyboardMenu = (event: KeyboardEvent<HTMLElement>, citationKey: string, line: number, entry?: BibtexEntry) => {
    openContextMenuFromKeyboard(event, setContextMenu, citationMenuState(citationKey, line, entry));
  };
  const bibEntryMenuState = (entry: BibtexEntry): Omit<ContextMenuOpenState, 'position'> => ({
      ariaLabel: `Actions for bibliography entry ${entry.key}`,
      sections: [
        {
          items: [
            {
              id: 'open-citation-manager',
              label: 'Open citation manager',
              icon: <BookOpen size={16} />,
              onSelect: onManageCitations,
            },
          ],
        },
        copyContextMenuSection('copy-bibliography-entry', 'Copy', <Copy size={16} />, [
          copyContextMenuItem({ id: 'copy-bibliography-key', label: 'Copy citation key', icon: <Copy size={16} />, text: entry.key, onCopyFeedback }),
          copyContextMenuItem({ id: 'copy-bibliography-formatted', label: 'Copy formatted citation', icon: <Copy size={16} />, text: citationTooltip(entry), onCopyFeedback }),
        ]),
      ],
    });
  const openBibEntryMenu = (event: MouseEvent<HTMLElement>, entry: BibtexEntry) => {
    openContextMenuFromEvent(event, setContextMenu, bibEntryMenuState(entry));
  };
  const openBibEntryKeyboardMenu = (event: KeyboardEvent<HTMLElement>, entry: BibtexEntry) => {
    openContextMenuFromKeyboard(event, setContextMenu, bibEntryMenuState(entry));
  };
  const bibliographyFileMenuState = (file: string): Omit<ContextMenuOpenState, 'position'> => ({
      ariaLabel: `Actions for bibliography file ${fileName(file)}`,
      sections: [
        copyContextMenuSection('copy-bibliography-file', 'Copy', <Copy size={16} />, [
          copyContextMenuItem({ id: 'copy-bibliography-path', label: 'Copy path', icon: <Copy size={16} />, text: file, onCopyFeedback }),
          copyContextMenuItem({ id: 'copy-bibliography-filename', label: 'Copy filename', icon: <Copy size={16} />, text: fileName(file), onCopyFeedback }),
        ]),
      ],
    });
  const openBibliographyFileMenu = (event: MouseEvent<HTMLElement>, file: string) => {
    openContextMenuFromEvent(event, setContextMenu, bibliographyFileMenuState(file));
  };
  const openBibliographyFileKeyboardMenu = (event: KeyboardEvent<HTMLElement>, file: string) => {
    openContextMenuFromKeyboard(event, setContextMenu, bibliographyFileMenuState(file));
  };
  const labelMenuState = (label: ParsedScienfyDocument['references']['labels'][number]): Omit<ContextMenuOpenState, 'position'> => ({
      ariaLabel: `Actions for label ${label.id}`,
      sections: [
        {
          items: [
            {
              id: 'jump-label',
              label: 'Jump to label line',
              icon: <MapPin size={16} />,
              onSelect: () => onJumpToLine(label.line),
            },
          ],
        },
        copyContextMenuSection('copy-label', 'Copy', <Copy size={16} />, [
          copyContextMenuItem({ id: 'copy-label-id', label: 'Copy label id', icon: <Copy size={16} />, text: label.id, onCopyFeedback }),
          copyContextMenuItem({ id: 'copy-label-line', label: 'Copy line number', icon: <Copy size={16} />, text: String(label.line), onCopyFeedback }),
        ]),
      ],
    });
  const openLabelMenu = (event: MouseEvent<HTMLElement>, label: ParsedScienfyDocument['references']['labels'][number]) => {
    openContextMenuFromEvent(event, setContextMenu, labelMenuState(label));
  };
  const openLabelKeyboardMenu = (event: KeyboardEvent<HTMLElement>, label: ParsedScienfyDocument['references']['labels'][number]) => {
    openContextMenuFromKeyboard(event, setContextMenu, labelMenuState(label));
  };

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
              onOpenContextMenu={(event) => openCitationMenu(event, usage.key, usage.line, entryByKey.get(usage.key))}
              onOpenKeyboardContextMenu={(event) => openCitationKeyboardMenu(event, usage.key, usage.line, entryByKey.get(usage.key))}
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
              onKeyDown={(event) => openBibliographyFileKeyboardMenu(event, file)}
              onContextMenu={(event) => openBibliographyFileMenu(event, file)}
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
                onKeyDown={(event) => openBibEntryKeyboardMenu(event, entry)}
                onContextMenu={(event) => openBibEntryMenu(event, entry)}
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
              onKeyDown={(event) => openLabelKeyboardMenu(event, label)}
              onContextMenu={(event) => openLabelMenu(event, label)}
            >
              <FileText size={15} />
              <span>{label.id}</span>
            </button>
          ))
        )}
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
    </div>
  );
}

function CitationButton({ citationKey, line, entry, missing, hasBibliography, onJumpToLine, onOpenContextMenu, onOpenKeyboardContextMenu }: {
  citationKey: string;
  line: number;
  entry?: BibtexEntry;
  missing: boolean;
  hasBibliography: boolean;
  onJumpToLine: (line: number) => void;
  onOpenContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onOpenKeyboardContextMenu: (event: KeyboardEvent<HTMLElement>) => void;
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
      onKeyDown={onOpenKeyboardContextMenu}
      onContextMenu={onOpenContextMenu}
    >
      {missing ? <AlertTriangle size={15} /> : entry ? <CheckCircle2 size={15} /> : <Text size={15} />}
      <span>@{citationKey}</span>
    </button>
  );
}

function DataSourcesPanel({ layerTwoDocument, onInsertVariable, onLinkVariableFile, onEditVariable, selectedVariableName, onSelectVariable, onCopyFeedback }: {
  layerTwoDocument: ParsedScienfyDocument;
  onInsertVariable: () => void;
  onLinkVariableFile: () => void;
  onEditVariable: (originalName: string, nextName: string, value: string) => void;
  selectedVariableName?: string | null;
  onSelectVariable: (name: string, usage?: ParsedScienfyDocument['variables']['usages'][number]) => void;
  onCopyFeedback?: ContextMenuCopyFeedback;
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
                onCopyFeedback={onCopyFeedback}
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

function VariableDefinitionEditor({ row, selected, missing, onSelect, onSave, onCopyFeedback }: {
  row: VariableRowModel;
  selected: boolean;
  missing: boolean;
  onSelect: (name: string) => void;
  onSave: (originalName: string, nextName: string, value: string) => void;
  onCopyFeedback?: ContextMenuCopyFeedback;
}) {
  const definition = row.definition;
  const [name, setName] = useState(row.name);
  const [value, setValue] = useState(definition?.value ?? '');
  const [contextMenu, setContextMenu] = useState<ContextMenuOpenState | null>(null);
  const valueInputRef = useRef<HTMLInputElement | null>(null);
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
    if (!isVariableEditorInteractiveTarget(event.target) && openVariableKeyboardMenu(event)) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (isVariableEditorInteractiveTarget(event.target)) return;
    event.preventDefault();
    onSelect(row.name);
  };
  const variableMenuState = (): Omit<ContextMenuOpenState, 'position'> => ({
      ariaLabel: `Actions for variable ${row.name}`,
      sections: [
        {
          items: [
            {
              id: 'edit-variable',
              label: 'Edit variable',
              icon: <Pencil size={16} />,
              onSelect: () => {
                onSelect(row.name);
                window.requestAnimationFrame(() => {
                  valueInputRef.current?.focus();
                  valueInputRef.current?.select();
                });
              },
            },
          ],
        },
        copyContextMenuSection('copy-variable', 'Copy', <Copy size={16} />, [
          copyContextMenuItem({ id: 'copy-variable-token', label: 'Copy variable token', icon: <Copy size={16} />, text: `{{ ${row.name} }}`, onCopyFeedback }),
          copyContextMenuItem({
            id: 'copy-variable-value',
            label: 'Copy value',
            icon: <Copy size={16} />,
            text: value,
            disabled: value.length === 0,
            disabledReason: value.length === 0 ? 'This variable has no value to copy.' : undefined,
            onCopyFeedback,
          }),
        ]),
      ],
    });
  const openVariableMenu = (event: MouseEvent<HTMLElement>) => {
    if (isVariableEditorInteractiveTarget(event.target)) return;
    openContextMenuFromEvent(event, setContextMenu, variableMenuState());
  };
  const openVariableKeyboardMenu = (event: KeyboardEvent<HTMLElement>) => (
    openContextMenuFromKeyboard(event, setContextMenu, variableMenuState())
  );
  return (
    <>
      <div
        className={`variable-editor-row ${selected ? 'selected' : ''} ${missing ? 'missing' : ''}`}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        title={row.usageCount > 0 ? `Highlight {{ ${row.name} }} in the document` : `{{ ${row.name} }} is not used in the document`}
        onClick={selectIfRowClick}
        onKeyDown={selectIfRowKey}
        onContextMenu={openVariableMenu}
      >
        <input
          aria-label={`Variable name ${row.name}`}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          ref={valueInputRef}
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
      {contextMenu && (
        <ContextMenuCard
          ariaLabel={contextMenu.ariaLabel}
          sections={contextMenu.sections}
          position={contextMenu.position}
          restoreFocusTo={contextMenu.restoreFocusTo}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
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
