import { useState } from 'react';
import type { MouseEventHandler, ReactNode } from 'react';
import {
  BookOpen,
  Bug,
  Check,
  Code,
  Command,
  Copy,
  ExternalLink,
  File,
  FilePlus2,
  FileText,
  FolderOpen,
  Focus,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  HelpCircle,
  Image,
  Keyboard,
  Link,
  ListTree,
  Minus,
  Monitor,
  Moon,
  PanelRight,
  Palette,
  Printer,
  Redo2,
  Save,
  SaveAll,
  Search,
  Settings,
  Slash,
  Square,
  Sun,
  Sunset,
  TableProperties,
  Undo2,
  Wrench,
  X,
} from 'lucide-react';
import type { EditorMode } from '../app/documentState';
import { basename, UNTITLED_NAME } from '../app/documentState';
import { getKeyboardShortcutDisplay } from '../app/keyboardShortcuts';
import type { SidebarView, ThemeMode } from '../services/settingsService';
import { VISUAL_STYLE_OPTIONS } from '../services/visualStyleService';
import type { VisualStyleId } from '../services/visualStyleService';
import type { ExportFormat } from '../export/exportTypes';
import type { RecentFilePreview } from '../markdown/documentIntelligence';
import type { SemanticBlockType } from '../markdown/semanticBlocks';

export type AppTopbarMenuId =
  | 'file'
  | 'edit'
  | 'view'
  | 'insert'
  | 'format'
  | 'references'
  | 'review'
  | 'tools'
  | 'help'
  | 'visual-style'
  | 'theme';

type InlineFormat = 'bold' | 'italic' | 'code';

interface AppTopbarProps {
  mode: EditorMode;
  activeMenu: AppTopbarMenuId | null;
  filePath: string | null;
  dirty: boolean;
  outlineOpen: boolean;
  inspectorOpen: boolean;
  focusMode: boolean;
  themeMode: ThemeMode;
  currentVisualStyle: {
    label: string;
    shortLabel: string;
  };
  selectedVisualStyle: VisualStyleId;
  recentFiles: RecentFilePreview[];
  hasPasteReview: boolean;
  onToggleMenu: (menu: AppTopbarMenuId) => void;
  onCloseMenus: () => void;
  onNew: () => void;
  onOpen: () => void;
  onOpenFolder: () => void;
  onOpenRecent: (path: string) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onFind: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopyRichText: () => void;
  onApplyScientificTypography: () => void;
  onInsertMarkdown: (markdown: string) => void;
  onInsertImage: () => void;
  onInsertLink: () => void;
  onInsertCitation: () => void;
  onInsertVariable: () => void;
  onInsertMermaid: () => void;
  onInsertSvgFigure: () => void;
  onInsertSemanticBlock: (type: SemanticBlockType) => void;
  onInsertProtectedBlock: () => void;
  onInsertEditorComment: () => void;
  onInsertHumanEditorComment: () => void;
  onInsertTargetedInstruction: () => void;
  onInsertVariantGroup: () => void;
  onInsertReferencesDirective: () => void;
  onReloadBibliography: () => void;
  onSyncBibliography: () => void;
  onCopyScieMDLlmSkill: () => void;
  onGenerateScieMDLlmSkill: () => void;
  onGenerateSubmissionReadiness: () => void;
  onOpenPasteReview: () => void;
  onOpenExportDialog: (format: ExportFormat) => void;
  onPrintPreview: () => void;
  onShowExportLog: () => void;
  onOpenTutorial: () => void;
  onOpenFullTutorial: () => void;
  onShowShortcuts: () => void;
  onOpenTemplates: () => void;
  onCheckTools: () => void;
  onSetInkscapePath: () => void;
  onOpenSettings: () => void;
  onShowAbout: () => void;
  onOpenGithub: () => void;
  onReportBug: () => void;
  onOpenCommandPalette: () => void;
  onOpenSlashMenu: () => void;
  onModeChange: (mode: EditorMode) => void;
  onSetVisualStyle: (style: VisualStyleId) => void;
  onSetThemeMode: (themeMode: ThemeMode) => void;
  onIncreaseFont: () => void;
  onDecreaseFont: () => void;
  onResetFont: () => void;
  onFormatHeading: (level: 1 | 2 | 3 | 4 | 5 | 6) => void;
  onFormatInline: (format: InlineFormat) => void;
  onToggleOutline: () => void;
  onSidebarView: (view: SidebarView) => void;
  onToggleInspector: () => void;
  onToggleFocusMode: () => void;
  onWindowMinimize: () => void;
  onWindowMaximize: () => void;
  onWindowClose: () => void;
  onTitlebarMouseDown: MouseEventHandler<HTMLElement>;
  onTitlebarDoubleClick: MouseEventHandler<HTMLElement>;
}

const menuLabels: Array<{ id: AppTopbarMenuId; label: string }> = [
  { id: 'file', label: 'File' },
  { id: 'edit', label: 'Edit' },
  { id: 'view', label: 'View' },
  { id: 'insert', label: 'Insert' },
  { id: 'format', label: 'Format' },
  { id: 'references', label: 'References' },
  { id: 'review', label: 'LLM' },
  { id: 'tools', label: 'Tools' },
  { id: 'help', label: 'Help' },
];

const themeOptions: Array<{ id: ThemeMode; label: string; icon: typeof Monitor }> = [
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'sepia', label: 'Sepia', icon: Sunset },
];

const semanticBlocks: Array<{ id: SemanticBlockType; label: string }> = [
  { id: 'figure', label: 'Figure' },
  { id: 'note', label: 'Note' },
  { id: 'callout', label: 'Callout' },
  { id: 'tip', label: 'Tip' },
  { id: 'important', label: 'Important' },
  { id: 'warning', label: 'Warning' },
  { id: 'result', label: 'Result' },
];

const headingOptions = [
  { level: 1, label: 'Heading 1', icon: Heading1 },
  { level: 2, label: 'Heading 2', icon: Heading2 },
  { level: 3, label: 'Heading 3', icon: Heading3 },
  { level: 4, label: 'Heading 4', icon: Heading4 },
  { level: 5, label: 'Heading 5', icon: Heading5 },
  { level: 6, label: 'Heading 6', icon: Heading6 },
] as const;

export function AppTopbar({
  mode,
  activeMenu,
  filePath,
  dirty,
  outlineOpen,
  inspectorOpen,
  focusMode,
  themeMode,
  currentVisualStyle,
  selectedVisualStyle,
  recentFiles,
  hasPasteReview,
  onToggleMenu,
  onCloseMenus,
  onNew,
  onOpen,
  onOpenFolder,
  onOpenRecent,
  onSave,
  onSaveAs,
  onFind,
  onUndo,
  onRedo,
  onCopyRichText,
  onApplyScientificTypography,
  onInsertMarkdown,
  onInsertImage,
  onInsertLink,
  onInsertCitation,
  onInsertVariable,
  onInsertMermaid,
  onInsertSvgFigure,
  onInsertSemanticBlock,
  onInsertProtectedBlock,
  onInsertEditorComment,
  onInsertHumanEditorComment,
  onInsertTargetedInstruction,
  onInsertVariantGroup,
  onInsertReferencesDirective,
  onReloadBibliography,
  onSyncBibliography,
  onCopyScieMDLlmSkill,
  onGenerateScieMDLlmSkill,
  onGenerateSubmissionReadiness,
  onOpenPasteReview,
  onOpenExportDialog,
  onPrintPreview,
  onShowExportLog,
  onOpenTutorial,
  onOpenFullTutorial,
  onShowShortcuts,
  onOpenTemplates,
  onCheckTools,
  onSetInkscapePath,
  onOpenSettings,
  onShowAbout,
  onOpenGithub,
  onReportBug,
  onOpenCommandPalette,
  onOpenSlashMenu,
  onModeChange,
  onSetVisualStyle,
  onSetThemeMode,
  onIncreaseFont,
  onDecreaseFont,
  onResetFont,
  onFormatHeading,
  onFormatInline,
  onToggleOutline,
  onSidebarView,
  onToggleInspector,
  onToggleFocusMode,
  onWindowMinimize,
  onWindowMaximize,
  onWindowClose,
  onTitlebarMouseDown,
  onTitlebarDoubleClick,
}: AppTopbarProps) {
  const stopTitlebarInteraction: MouseEventHandler<HTMLElement> = (event) => {
    event.stopPropagation();
  };
  const runMenuAction = (action: () => void) => {
    onCloseMenus();
    action();
  };

  return (
    <header className="topbar" role="banner" onMouseDown={onTitlebarMouseDown} onDoubleClick={onTitlebarDoubleClick}>
      <div className="topbar-left app-topbar-leading" onMouseDown={stopTitlebarInteraction} onDoubleClick={stopTitlebarInteraction}>
        <ScieMDBrandMark />
        <nav className="app-menubar" aria-label="Application menu">
          {menuLabels.map((menu) => (
            <div key={menu.id} className="app-menu-button">
              <button
                type="button"
                className="app-menu-trigger"
                aria-haspopup="true"
                aria-expanded={activeMenu === menu.id}
                aria-controls={`app-menu-${menu.id}`}
                onClick={() => onToggleMenu(menu.id)}
              >
                {menu.label}
              </button>
              {activeMenu === menu.id && (
                <div id={`app-menu-${menu.id}`} className={`app-menu-panel app-menu-${menu.id}`} role="menu" aria-label={`${menu.label} menu`}>
                  {renderMenu(menu.id, {
                    mode,
                    outlineOpen,
                    inspectorOpen,
                    focusMode,
                    themeMode,
                    selectedVisualStyle,
                    recentFiles,
                    hasPasteReview,
                    runMenuAction,
                    onNew,
                    onOpen,
                    onOpenFolder,
                    onOpenRecent,
                    onSave,
                    onSaveAs,
                    onFind,
                    onUndo,
                    onRedo,
                    onCopyRichText,
                    onApplyScientificTypography,
                    onInsertMarkdown,
                    onInsertImage,
                    onInsertLink,
                    onInsertCitation,
                    onInsertVariable,
                    onInsertMermaid,
                    onInsertSvgFigure,
                    onInsertSemanticBlock,
                    onInsertProtectedBlock,
                    onInsertEditorComment,
                    onInsertHumanEditorComment,
                    onInsertTargetedInstruction,
                    onInsertVariantGroup,
                    onInsertReferencesDirective,
                    onReloadBibliography,
                    onSyncBibliography,
                    onCopyScieMDLlmSkill,
                    onGenerateScieMDLlmSkill,
                    onGenerateSubmissionReadiness,
                    onOpenPasteReview,
                    onOpenExportDialog,
                    onPrintPreview,
                    onShowExportLog,
                    onOpenTutorial,
                    onOpenFullTutorial,
                    onShowShortcuts,
                    onOpenTemplates,
                    onCheckTools,
                    onSetInkscapePath,
                    onOpenSettings,
                    onShowAbout,
                    onOpenGithub,
                    onReportBug,
                    onOpenCommandPalette,
                    onModeChange,
                    onSetVisualStyle,
                    onSetThemeMode,
                    onIncreaseFont,
                    onDecreaseFont,
                    onResetFont,
                    onFormatHeading,
                    onFormatInline,
                    onToggleOutline,
                    onSidebarView,
                    onToggleInspector,
                    onToggleFocusMode,
                  })}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="quick-toolbar" role="toolbar" aria-label="Quick actions">
          <button aria-label="Insert menu" title="Insert menu (/)" onClick={onOpenSlashMenu}><Slash size={17} /></button>
          <button aria-label="Find and Replace" title="Find and Replace" onClick={onFind}><Search size={17} /></button>
          <button aria-label="Command Palette" title="Command Palette" onClick={onOpenCommandPalette}><Command size={17} />K</button>
        </div>
      </div>

      <div className="document-title" title={filePath ?? UNTITLED_NAME}>{dirty ? '* ' : ''}{basename(filePath)}</div>

      <div className="topbar-right" role="group" aria-label="View controls">
        <div className={`editor-mode-toggle mode-${mode}`} data-mode={mode} role="group" aria-label="Editor mode">
          <button aria-pressed={mode === 'visual'} className={mode === 'visual' ? 'selected' : ''} onClick={() => onModeChange('visual')}>Visual</button>
          <button aria-pressed={mode === 'source'} className={mode === 'source' ? 'selected' : ''} onClick={() => onModeChange('source')}>Source</button>
        </div>
        <div className="topbar-popover-anchor">
          <button
            className="topbar-view-button"
            aria-label={`Visual style: ${currentVisualStyle.label}`}
            title={`Visual style: ${currentVisualStyle.label}`}
            aria-haspopup="menu"
            aria-expanded={activeMenu === 'visual-style'}
            aria-controls="topbar-visual-style-menu"
            onClick={() => onToggleMenu('visual-style')}
          >
            <Palette size={16} />
            <span>{currentVisualStyle.shortLabel}</span>
          </button>
          {activeMenu === 'visual-style' && (
            <div id="topbar-visual-style-menu" className="app-menu-panel topbar-choice-menu topbar-style-menu" role="menu" aria-label="Visual style presets">
              {VISUAL_STYLE_OPTIONS.map((style) => (
                <MenuItem
                  key={style.id}
                  checked={selectedVisualStyle === style.id}
                  role="menuitemradio"
                  onSelect={() => runMenuAction(() => onSetVisualStyle(style.id))}
                >
                  <span className="style-menu-copy">
                    <span>{style.label}</span>
                    <small>{style.detail}</small>
                  </span>
                </MenuItem>
              ))}
            </div>
          )}
        </div>
        <div className="topbar-popover-anchor">
          <button
            className="topbar-icon-button"
            aria-label={`Theme: ${themeMode}`}
            title={`Theme: ${themeMode}`}
            aria-haspopup="menu"
            aria-expanded={activeMenu === 'theme'}
            aria-controls="topbar-theme-menu"
            onClick={() => onToggleMenu('theme')}
          >
            {themeMode === 'light' ? <Sun size={16} /> : themeMode === 'sepia' ? <Sunset size={16} /> : themeMode === 'system' ? <Monitor size={16} /> : <Moon size={16} />}
          </button>
          {activeMenu === 'theme' && (
            <div id="topbar-theme-menu" className="app-menu-panel topbar-choice-menu topbar-theme-menu" role="menu" aria-label="Theme options">
              {themeOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <MenuItem
                    key={option.id}
                    icon={<Icon size={15} />}
                    checked={themeMode === option.id}
                    role="menuitemradio"
                    onSelect={() => runMenuAction(() => onSetThemeMode(option.id))}
                  >
                    {option.label}
                  </MenuItem>
                );
              })}
            </div>
          )}
        </div>
        <button
          className="topbar-icon-button"
          aria-label="Toggle focus mode"
          aria-pressed={focusMode}
          title="Toggle focus mode"
          onClick={onToggleFocusMode}
        >
          <Focus size={16} />
        </button>
        <button
          className="topbar-icon-button"
          aria-label="Toggle navigation sidebar"
          aria-pressed={outlineOpen}
          title="Toggle navigation sidebar"
          onClick={onToggleOutline}
        >
          <ListTree size={16} />
        </button>
        <button
          className="topbar-icon-button"
          aria-label="Toggle inspector"
          aria-pressed={inspectorOpen}
          title="Toggle inspector"
          onClick={onToggleInspector}
        >
          <PanelRight size={16} />
        </button>
        <span
          className="window-controls"
          role="group"
          aria-label="Window controls"
          onMouseDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <button aria-label="Minimize window" title="Minimize" onClick={onWindowMinimize}><Minus size={15} /></button>
          <button aria-label="Maximize window" title="Maximize" onClick={onWindowMaximize}><Square size={13} /></button>
          <button aria-label="Close window" title="Close" onClick={onWindowClose}><X size={15} /></button>
        </span>
      </div>
    </header>
  );
}

function ScieMDBrandMark() {
  const [reacting, setReacting] = useState(false);
  const react = () => {
    setReacting(false);
    window.requestAnimationFrame(() => {
      setReacting(true);
      window.setTimeout(() => setReacting(false), 760);
    });
  };
  return (
    <button
      type="button"
      className={`app-brand-mark ${reacting ? 'is-reacting' : ''}`}
      aria-label="ScieMD mark"
      onClick={react}
    >
      <span className="app-brand-circle left" aria-hidden="true" />
      <span className="app-brand-circle right" aria-hidden="true" />
    </button>
  );
}

interface RenderMenuContext extends Omit<AppTopbarProps,
  | 'activeMenu'
  | 'currentVisualStyle'
  | 'dirty'
  | 'filePath'
  | 'onCloseMenus'
  | 'onTitlebarDoubleClick'
  | 'onTitlebarMouseDown'
  | 'onToggleMenu'
  | 'onWindowClose'
  | 'onWindowMaximize'
  | 'onWindowMinimize'
  | 'onOpenSlashMenu'
> {
  runMenuAction: (action: () => void) => void;
}

function renderMenu(menu: AppTopbarMenuId, context: RenderMenuContext): ReactNode {
  switch (menu) {
    case 'file':
      return <FileMenu {...context} />;
    case 'edit':
      return <EditMenu {...context} />;
    case 'view':
      return <ViewMenu {...context} />;
    case 'insert':
      return <InsertMenu {...context} />;
    case 'format':
      return <FormatMenu {...context} />;
    case 'references':
      return <ReferencesMenu {...context} />;
    case 'review':
      return <ReviewMenu {...context} />;
    case 'tools':
      return <ToolsMenu {...context} />;
    case 'help':
      return <HelpMenu {...context} />;
    default:
      return null;
  }
}

function FileMenu(context: RenderMenuContext) {
  return (
    <>
      <MenuItem icon={<FilePlus2 size={15} />} shortcut={getKeyboardShortcutDisplay('new')} onSelect={() => context.runMenuAction(context.onNew)}>New</MenuItem>
      <MenuItem icon={<FileText size={15} />} onSelect={() => context.runMenuAction(context.onOpenTemplates)}>New from Template...</MenuItem>
      <MenuItem icon={<FolderOpen size={15} />} shortcut={getKeyboardShortcutDisplay('open')} onSelect={() => context.runMenuAction(context.onOpen)}>Open...</MenuItem>
      <MenuItem icon={<FolderOpen size={15} />} onSelect={() => context.runMenuAction(context.onOpenFolder)}>Open Folder...</MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Save size={15} />} shortcut={getKeyboardShortcutDisplay('save')} onSelect={() => context.runMenuAction(context.onSave)}>Save</MenuItem>
      <MenuItem icon={<SaveAll size={15} />} shortcut={getKeyboardShortcutDisplay('saveAs')} onSelect={() => context.runMenuAction(context.onSaveAs)}>Save As...</MenuItem>
      <MenuSeparator />
      <MenuSection label="Export" />
      <MenuItem onSelect={() => context.runMenuAction(() => context.onOpenExportDialog('html'))}>Styled HTML...</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(() => context.onOpenExportDialog('pdf'))}>PDF...</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(() => context.onOpenExportDialog('docx'))}>Word DOCX...</MenuItem>
      <MenuSection label="Advanced formats" />
      {(['epub', 'latex', 'odt', 'jats', 'rst', 'asciidoc', 'docbook', 'plain'] as const).map((format) => (
        <MenuItem key={format} onSelect={() => context.runMenuAction(() => context.onOpenExportDialog(format))}>{exportFormatLabel(format)}</MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem icon={<Printer size={15} />} shortcut={getKeyboardShortcutDisplay('print')} onSelect={() => context.runMenuAction(context.onPrintPreview)}>Print Preview</MenuItem>
      <MenuSeparator />
      <MenuSection label="Open Recent" />
      {context.recentFiles.length === 0 ? (
        <p className="menu-empty">No recent files yet</p>
      ) : context.recentFiles.slice(0, 15).map((recent) => (
        <MenuItem
          key={recent.path}
          className="recent-menu-item"
          title={recent.path}
          onSelect={() => context.runMenuAction(() => context.onOpenRecent(recent.path))}
        >
          <span className="recent-menu-copy">
            <span>{recent.heading || recent.name}</span>
            <small>{recent.excerpt || recent.path}</small>
          </span>
        </MenuItem>
      ))}
    </>
  );
}

function EditMenu(context: RenderMenuContext) {
  return (
    <>
      <MenuItem icon={<Undo2 size={15} />} shortcut={getKeyboardShortcutDisplay('undo')} onSelect={() => context.runMenuAction(context.onUndo)}>Undo</MenuItem>
      <MenuItem icon={<Redo2 size={15} />} shortcut={getKeyboardShortcutDisplay('redo')} onSelect={() => context.runMenuAction(context.onRedo)}>Redo</MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Search size={15} />} shortcut={getKeyboardShortcutDisplay('find')} onSelect={() => context.runMenuAction(context.onFind)}>Find and Replace</MenuItem>
      <MenuItem icon={<Copy size={15} />} onSelect={() => context.runMenuAction(context.onCopyRichText)}>Copy as Rich Text</MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={() => context.runMenuAction(context.onApplyScientificTypography)}>Apply Scientific Typography</MenuItem>
    </>
  );
}

function ViewMenu(context: RenderMenuContext) {
  return (
    <>
      <MenuSection label="Editor" />
      <MenuItem checked={context.mode === 'visual'} role="menuitemradio" onSelect={() => context.runMenuAction(() => context.onModeChange('visual'))}>Visual Mode</MenuItem>
      <MenuItem checked={context.mode === 'source'} role="menuitemradio" onSelect={() => context.runMenuAction(() => context.onModeChange('source'))}>Source Mode</MenuItem>
      <MenuSeparator />
      <MenuItem checked={context.outlineOpen} role="menuitemcheckbox" onSelect={() => context.runMenuAction(context.onToggleOutline)}>Navigation Sidebar</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(() => context.onSidebarView('outline'))}>Sidebar: Outline</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(() => context.onSidebarView('references'))}>Sidebar: References</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(() => context.onSidebarView('data'))}>Sidebar: Data</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(() => context.onSidebarView('files'))}>Sidebar: Files</MenuItem>
      <MenuItem checked={context.inspectorOpen} role="menuitemcheckbox" onSelect={() => context.runMenuAction(context.onToggleInspector)}>Inspector</MenuItem>
      <MenuItem checked={context.focusMode} role="menuitemcheckbox" onSelect={() => context.runMenuAction(context.onToggleFocusMode)}>Focus Mode</MenuItem>
      <MenuSeparator />
      <MenuSection label="Theme" />
      {themeOptions.map((option) => {
        const Icon = option.icon;
        return (
          <MenuItem
            key={option.id}
            icon={<Icon size={15} />}
            checked={context.themeMode === option.id}
            role="menuitemradio"
            onSelect={() => context.runMenuAction(() => context.onSetThemeMode(option.id))}
          >
            {option.label}
          </MenuItem>
        );
      })}
      <MenuSection label="Visual style" />
      {VISUAL_STYLE_OPTIONS.map((style) => (
        <MenuItem
          key={style.id}
          checked={context.selectedVisualStyle === style.id}
          role="menuitemradio"
          onSelect={() => context.runMenuAction(() => context.onSetVisualStyle(style.id))}
        >
          <span className="style-menu-copy">
            <span>{style.label}</span>
            <small>{style.detail}</small>
          </span>
        </MenuItem>
      ))}
      <MenuSection label="Font size" />
      <MenuItem onSelect={() => context.runMenuAction(context.onIncreaseFont)}>Increase Font Size</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(context.onDecreaseFont)}>Decrease Font Size</MenuItem>
      <MenuItem shortcut={getKeyboardShortcutDisplay('resetFont')} onSelect={() => context.runMenuAction(context.onResetFont)}>Reset Font Size</MenuItem>
    </>
  );
}

function InsertMenu(context: RenderMenuContext) {
  return (
    <>
      <MenuItem icon={<Link size={15} />} onSelect={() => context.runMenuAction(context.onInsertLink)}>Link...</MenuItem>
      <MenuItem icon={<Image size={15} />} onSelect={() => context.runMenuAction(context.onInsertImage)}>Image...</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(context.onInsertCitation)}>Citation...</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(context.onInsertReferencesDirective)}>Auto References Section</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(context.onInsertVariable)}>Variable...</MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={() => context.runMenuAction(context.onInsertMermaid)}>Mermaid Diagram</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(context.onInsertSvgFigure)}>SVG Figure</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(() => context.onInsertMarkdown('$$\nx^2\n$$\n\n'))}>Math Block</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(() => context.onInsertMarkdown('$x^2$'))}>Inline Math</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(() => context.onInsertMarkdown('[^1]\n\n[^1]: Footnote text\n'))}>Footnote</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(() => context.onInsertMarkdown('\n---\n\n'))}>Horizontal Rule</MenuItem>
      <MenuSeparator />
      <MenuSection label="Scientific blocks" />
      {semanticBlocks.map((block) => (
        <MenuItem key={block.id} onSelect={() => context.runMenuAction(() => context.onInsertSemanticBlock(block.id))}>{block.label}</MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem onSelect={() => context.runMenuAction(context.onInsertProtectedBlock)}>Locked Section</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(context.onInsertEditorComment)}>Note to LLM</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(context.onInsertHumanEditorComment)}>Note to Human</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(context.onInsertTargetedInstruction)}>LLM Instruction</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(context.onInsertVariantGroup)}>Version Group</MenuItem>
    </>
  );
}

function FormatMenu(context: RenderMenuContext) {
  return (
    <>
      <MenuSection label="Headings" />
      {headingOptions.map((option) => {
        const Icon = option.icon;
        return (
          <MenuItem key={option.level} icon={<Icon size={15} />} onSelect={() => context.runMenuAction(() => context.onFormatHeading(option.level))}>
            {option.label}
          </MenuItem>
        );
      })}
      <MenuSeparator />
      <MenuItem icon={<Check size={15} />} onSelect={() => context.runMenuAction(() => context.onFormatInline('bold'))}>Bold</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(() => context.onFormatInline('italic'))}>Italic</MenuItem>
      <MenuItem icon={<Code size={15} />} onSelect={() => context.runMenuAction(() => context.onFormatInline('code'))}>Inline Code</MenuItem>
      <MenuSeparator />
      <MenuItem icon={<TableProperties size={15} />} onSelect={() => context.runMenuAction(() => context.onInsertMarkdown('| Column A | Column B |\n| --- | --- |\n|  |  |\n\n'))}>Table</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(() => context.onInsertMarkdown('> Quote\n\n'))}>Blockquote</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(context.onApplyScientificTypography)}>Apply Scientific Typography</MenuItem>
    </>
  );
}

function ReferencesMenu(context: RenderMenuContext) {
  return (
    <>
      <MenuItem onSelect={() => context.runMenuAction(context.onInsertCitation)}>Manage Citations...</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(context.onReloadBibliography)}>Reload Bibliography from Disk</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(context.onSyncBibliography)}>Sync Generated Bibliography</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(context.onInsertReferencesDirective)}>Insert References Section</MenuItem>
    </>
  );
}

function ReviewMenu(context: RenderMenuContext) {
  return (
    <>
      <MenuItem disabled={!context.hasPasteReview} onSelect={() => context.runMenuAction(context.onOpenPasteReview)}>Review Pasted Changes</MenuItem>
      <MenuSeparator />
      <MenuSection label="LLM skill" />
      <MenuItem onSelect={() => context.runMenuAction(context.onCopyScieMDLlmSkill)}>Copy ScieMD LLM Skill</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(context.onGenerateScieMDLlmSkill)}>Generate LLM Skill File</MenuItem>
    </>
  );
}

function ToolsMenu(context: RenderMenuContext) {
  return (
    <>
      <MenuItem icon={<Command size={15} />} shortcut={getKeyboardShortcutDisplay('commandPalette')} onSelect={() => context.runMenuAction(context.onOpenCommandPalette)}>Command Palette</MenuItem>
      <MenuItem icon={<Settings size={15} />} onSelect={() => context.runMenuAction(context.onOpenSettings)}>Settings...</MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Wrench size={15} />} onSelect={() => context.runMenuAction(context.onCheckTools)}>Check External Tools</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(context.onSetInkscapePath)}>Set Inkscape Path...</MenuItem>
      <MenuItem onSelect={() => context.runMenuAction(context.onShowExportLog)}>Show Last Export Log</MenuItem>
    </>
  );
}

function HelpMenu(context: RenderMenuContext) {
  return (
    <>
      <MenuItem icon={<BookOpen size={15} />} onSelect={() => context.runMenuAction(context.onOpenTutorial)}>Quick Tour</MenuItem>
      <MenuItem icon={<BookOpen size={15} />} onSelect={() => context.runMenuAction(context.onOpenFullTutorial)}>Full Tutorial</MenuItem>
      <MenuItem icon={<Keyboard size={15} />} shortcut={getKeyboardShortcutDisplay('shortcutSheet')} onSelect={() => context.runMenuAction(context.onShowShortcuts)}>Keyboard Shortcuts</MenuItem>
      <MenuSeparator />
      <MenuItem icon={<HelpCircle size={15} />} onSelect={() => context.runMenuAction(context.onShowAbout)}>About ScieMD</MenuItem>
      <MenuItem icon={<ExternalLink size={15} />} onSelect={() => context.runMenuAction(context.onOpenGithub)}>GitHub</MenuItem>
      <MenuItem icon={<Bug size={15} />} onSelect={() => context.runMenuAction(context.onReportBug)}>Report Bug</MenuItem>
    </>
  );
}

function MenuItem({
  children,
  icon,
  shortcut,
  checked,
  disabled,
  role = 'menuitem',
  className,
  title,
  onSelect,
}: {
  children: ReactNode;
  icon?: ReactNode;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  role?: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio';
  className?: string;
  title?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === 'menuitemcheckbox' || role === 'menuitemradio' ? Boolean(checked) : undefined}
      aria-pressed={role === 'menuitem' && checked !== undefined ? Boolean(checked) : undefined}
      className={[
        'app-menu-item',
        checked ? 'selected' : '',
        shortcut ? 'has-shortcut' : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
      disabled={disabled}
      title={title}
      onClick={onSelect}
    >
      <span className="app-menu-icon" aria-hidden="true">{checked ? <Check size={14} /> : icon}</span>
      <span className="app-menu-label">{children}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}

function MenuSection({ label }: { label: string }) {
  return <div className="menu-section-label" role="presentation">{label}</div>;
}

function MenuSeparator() {
  return <div className="app-menu-separator" role="separator" />;
}

function exportFormatLabel(format: Exclude<ExportFormat, 'html' | 'pdf' | 'docx'>): string {
  switch (format) {
    case 'epub':
      return 'EPUB...';
    case 'latex':
      return 'LaTeX...';
    case 'odt':
      return 'OpenDocument ODT...';
    case 'jats':
      return 'JATS XML...';
    case 'rst':
      return 'reStructuredText...';
    case 'asciidoc':
      return 'AsciiDoc...';
    case 'docbook':
      return 'DocBook XML...';
    case 'plain':
      return 'Plain Text...';
    default:
      return `${format}...`;
  }
}
