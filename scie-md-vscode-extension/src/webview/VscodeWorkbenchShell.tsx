import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Database,
  Minus,
  Code2,
  Eye,
  FilePenLine,
  Monitor,
  Moon,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Save as SaveIcon,
  MessageSquareText,
  Sun,
  Sunset,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { VariableDefinition, VariableUsage } from '@sciemd/core';
import { VISUAL_STYLE_OPTIONS } from '../scie-md/services/visualStyleService';
import type { VisualStyleId } from '../scie-md/services/visualStyleService';
import type { VscodeThemeMode } from './theme';

export type VscodeEditorMode = 'visual' | 'source';
export type VscodeChromeMenu = 'style' | 'theme' | null;

interface ChoiceMenuOption<T extends string> {
  id: T;
  label: string;
  shortLabel: string;
  detail: string;
  icon?: LucideIcon;
}

const THEME_MENU_OPTIONS: Array<ChoiceMenuOption<VscodeThemeMode>> = [
  { id: 'vscode', label: 'VS Code', shortLabel: 'VS Code', detail: 'Follow the active VS Code theme.', icon: Monitor },
  { id: 'light', label: 'Light', shortLabel: 'Light', detail: 'Use ScieMD light document colors.', icon: Sun },
  { id: 'dark', label: 'Dark', shortLabel: 'Dark', detail: 'Use ScieMD dark document colors.', icon: Moon },
  { id: 'sepia', label: 'Sepia', shortLabel: 'Sepia', detail: 'Use ScieMD warm sepia document colors.', icon: Sunset },
];

const STYLE_MENU_OPTIONS: Array<ChoiceMenuOption<VisualStyleId>> = VISUAL_STYLE_OPTIONS.map((style) => ({
  id: style.id,
  label: style.label,
  shortLabel: style.shortLabel,
  detail: style.detail,
  icon: Palette,
}));

interface VscodeWorkbenchShellProps {
  editorMode: VscodeEditorMode;
  topbar: ReactNode;
  toolbar: ReactNode;
  editorStage: ReactNode;
  dataSidebar?: ReactNode;
  dataSidebarOpen?: boolean;
  dataSidebarWidth?: number;
  readonlyBanner?: ReactNode;
  startupPanel?: ReactNode;
  reviewPanel?: ReactNode;
  toast?: ReactNode;
  modal?: ReactNode;
}

export function VscodeWorkbenchShell({
  editorMode,
  topbar,
  toolbar,
  editorStage,
  dataSidebar,
  dataSidebarOpen = false,
  dataSidebarWidth,
  readonlyBanner,
  startupPanel,
  reviewPanel,
  toast,
  modal,
}: VscodeWorkbenchShellProps) {
  const showDataSidebar = Boolean(dataSidebar && dataSidebarOpen);
  const contentStyle = dataSidebarWidth
    ? ({ '--vscode-scie-data-sidebar-width': `${dataSidebarWidth}px` } as CSSProperties)
    : undefined;

  return (
    <div className="vscode-scie-shell app-shell vscode-scie-workbench" data-editor-mode={editorMode}>
      {topbar}
      {readonlyBanner}
      {toolbar}
      <div className="vscode-scie-content" data-data-sidebar-open={showDataSidebar ? 'true' : 'false'} style={contentStyle}>
        {showDataSidebar ? dataSidebar : null}
        <div className="vscode-scie-main-column">
          {startupPanel}
          {reviewPanel}
          {editorStage}
        </div>
      </div>
      {toast}
      {modal}
    </div>
  );
}

interface VscodeTopbarProps {
  fileLabel: string;
  mode: VscodeEditorMode;
  visualStyle: VisualStyleId;
  themeMode: VscodeThemeMode;
  openMenu: VscodeChromeMenu;
  status: string;
  dirty: boolean;
  documentReadOnly: boolean;
  dataSidebarOpen: boolean;
  onSelectVisual: () => void;
  onSelectSource: () => void;
  onToggleDataSidebar: () => void;
  onOpenMenuChange: (menu: VscodeChromeMenu) => void;
  onSelectStyle: (style: VisualStyleId) => void;
  onSelectTheme: (themeMode: VscodeThemeMode) => void;
  onSave: () => void;
}

export function VscodeTopbar({
  fileLabel,
  mode,
  visualStyle,
  themeMode,
  openMenu,
  status,
  dirty,
  documentReadOnly,
  dataSidebarOpen,
  onSelectVisual,
  onSelectSource,
  onToggleDataSidebar,
  onOpenMenuChange,
  onSelectStyle,
  onSelectTheme,
  onSave,
}: VscodeTopbarProps) {
  const currentThemeOption = THEME_MENU_OPTIONS.find((option) => option.id === themeMode) ?? THEME_MENU_OPTIONS[0];

  return (
    <header className="vscode-scie-topbar">
      <div className="vscode-scie-identity">
        <ScieMDWebviewMark />
        <div className="vscode-scie-title">
          <strong>ScieMD</strong>
          <span title={fileLabel}>{fileLabel}</span>
        </div>
      </div>

      <div className="vscode-scie-topbar-controls">
        <div className="vscode-scie-mode-toggle" role="tablist" aria-label="Editor mode">
          <button
            type="button"
            className={mode === 'visual' ? 'selected' : ''}
            aria-selected={mode === 'visual'}
            role="tab"
            onClick={onSelectVisual}
            title="Visual"
          >
            <Eye size={15} />
            <span>Visual</span>
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

        <button
          type="button"
          className={`vscode-scie-data-toggle ${dataSidebarOpen ? 'selected' : ''}`}
          aria-pressed={dataSidebarOpen}
          aria-label={dataSidebarOpen ? 'Hide data sidebar' : 'Show data sidebar'}
          title={dataSidebarOpen ? 'Hide data sidebar' : 'Show data sidebar'}
          onClick={onToggleDataSidebar}
        >
          {dataSidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
          <span>Data</span>
        </button>

        <WebviewChoiceMenu
          id="visual-style-menu"
          label="Style"
          icon={Palette}
          options={STYLE_MENU_OPTIONS}
          selectedId={visualStyle}
          open={openMenu === 'style'}
          onOpenChange={(open) => onOpenMenuChange(open ? 'style' : null)}
          onSelect={onSelectStyle}
        />

        <WebviewChoiceMenu
          id="theme-menu"
          label="Theme"
          icon={currentThemeOption.icon ?? Monitor}
          options={THEME_MENU_OPTIONS}
          selectedId={themeMode}
          open={openMenu === 'theme'}
          onOpenChange={(open) => onOpenMenuChange(open ? 'theme' : null)}
          onSelect={onSelectTheme}
        />

        <button
          type="button"
          className="vscode-scie-save-button"
          onClick={onSave}
          disabled={documentReadOnly}
          aria-label="Save document"
          title={documentReadOnly ? 'The document is read-only.' : 'Save document'}
        >
          <SaveIcon size={15} />
          <span>Save</span>
        </button>

        <span className={`vscode-scie-status ${dirty ? 'dirty' : ''}`}>{status}</span>
      </div>
    </header>
  );
}

interface VscodeDataSidebarProps {
  variableDefinitions: VariableDefinition[];
  variableUsages: VariableUsage[];
  missingVariables: string[];
  selectedVariableName: string | null;
  documentReadOnly: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  widthStep: number;
  onInsertVariable: () => void;
  onEditVariable: (originalName: string, nextName: string, value: string) => void;
  onSelectVariable: (name: string, usage?: VariableUsage) => void;
  onClose: () => void;
  onWidthChange: (width: number) => void;
}

export function VscodeDataSidebar({
  variableDefinitions,
  variableUsages,
  missingVariables,
  selectedVariableName,
  documentReadOnly,
  width,
  minWidth,
  maxWidth,
  widthStep,
  onInsertVariable,
  onEditVariable,
  onSelectVariable,
  onClose,
  onWidthChange,
}: VscodeDataSidebarProps) {
  const canNarrow = width > minWidth;
  const canWiden = width < maxWidth;
  const variableRows = useMemo(
    () => createVariableRows(variableDefinitions, variableUsages),
    [variableDefinitions, variableUsages],
  );
  const selectedName = selectedVariableName && variableRows.some((row) => row.name === selectedVariableName)
    ? selectedVariableName
    : variableRows[0]?.name ?? null;
  const selectedUsages = selectedName
    ? variableUsages.filter((usage) => usage.name === selectedName)
    : [];
  const missingUsages = variableUsages.filter((usage) => missingVariables.includes(usage.name));

  return (
    <aside className="vscode-scie-data-sidebar" aria-label="Document data" style={{ '--vscode-scie-data-sidebar-width': `${width}px` } as CSSProperties}>
      <header className="vscode-scie-data-header">
        <span className="vscode-scie-data-icon" aria-hidden="true">
          <Database size={16} />
        </span>
        <div className="vscode-scie-data-title">
          <strong>Data</strong>
          <span>{variableRows.length === 1 ? '1 variable' : `${variableRows.length} variables`}</span>
        </div>
        <div className="vscode-scie-data-actions">
          <button
            type="button"
            aria-label="Narrow data sidebar"
            title="Narrow data sidebar"
            disabled={!canNarrow}
            onClick={() => onWidthChange(Math.max(minWidth, width - widthStep))}
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            aria-label="Widen data sidebar"
            title="Widen data sidebar"
            disabled={!canWiden}
            onClick={() => onWidthChange(Math.min(maxWidth, width + widthStep))}
          >
            <Plus size={14} />
          </button>
          <button type="button" aria-label="Close data sidebar" title="Close data sidebar" onClick={onClose}>
            <PanelLeftClose size={14} />
          </button>
        </div>
      </header>

      <div className="vscode-scie-data-body">
        <div className="vscode-scie-data-command-row">
          <button type="button" onClick={onInsertVariable} disabled={documentReadOnly}>
            Insert variable
          </button>
          <button type="button" disabled title="External data-file linking is available in the desktop app.">
            Link data file
          </button>
        </div>

        {variableRows.length === 0 ? (
          <div className="vscode-scie-data-empty">
            <strong>No data variables yet</strong>
            <span>Add a front matter variable, then use placeholders like {`{{ cohort_n }}`} in the document.</span>
            <button type="button" onClick={onInsertVariable} disabled={documentReadOnly}>Insert variable</button>
          </div>
        ) : (
          <section className="vscode-scie-variable-card" aria-label="Variables">
            <div className="vscode-scie-variable-card-header">
              <div>
                <strong>Variables</strong>
                <span>{variableUsages.length} document use{variableUsages.length === 1 ? '' : 's'}</span>
              </div>
            </div>
            <div className="vscode-scie-variable-list" role="list">
              {variableRows.map((row) => (
                <VscodeVariableDefinitionEditor
                  key={`${row.name}-${row.definition?.source ?? 'missing'}-${row.definition?.file ?? ''}-${row.definition?.value ?? ''}`}
                  row={row}
                  selected={row.name === selectedName}
                  missing={missingVariables.includes(row.name)}
                  documentReadOnly={documentReadOnly}
                  onSelect={onSelectVariable}
                  onSave={onEditVariable}
                />
              ))}
            </div>
            {selectedName ? (
              <div className="vscode-scie-variable-selected-usage">
                <strong>{`{{ ${selectedName} }}`}</strong>
                {selectedUsages.length === 0 ? (
                  <span>This variable is defined but is not used in the document.</span>
                ) : (
                  <>
                    <span>{selectedUsages.length} use{selectedUsages.length === 1 ? '' : 's'} in the document.</span>
                    <div className="vscode-scie-variable-usage-chips">
                      {selectedUsages.slice(0, 12).map((usage, index) => (
                        <button
                          key={`${usage.name}-${usage.from}-${usage.to}`}
                          type="button"
                          onClick={() => onSelectVariable(usage.name, usage)}
                        >
                          Line {usage.line}{selectedUsages.length > 1 ? ` - ${index + 1}` : ''}
                        </button>
                      ))}
                      {selectedUsages.length > 12 ? <small>+{selectedUsages.length - 12} more</small> : null}
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </section>
        )}

        {missingUsages.length > 0 ? (
          <div className="vscode-scie-data-warning">
            <AlertTriangle size={15} />
            <div>
              <strong>{missingUsages.length} unresolved variable reference{missingUsages.length === 1 ? '' : 's'}</strong>
              <span>Define each missing variable before export so placeholders are not left raw.</span>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

interface VariableRowModel {
  name: string;
  definition: VariableDefinition | null;
  usageCount: number;
}

function VscodeVariableDefinitionEditor({
  row,
  selected,
  missing,
  documentReadOnly,
  onSelect,
  onSave,
}: {
  row: VariableRowModel;
  selected: boolean;
  missing: boolean;
  documentReadOnly: boolean;
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

  const trimmedName = name.trim();
  const trimmedValue = value.trim();
  const dirty = !definition || trimmedName !== definition.name || trimmedValue !== definition.value;
  const valid = VARIABLE_NAME_PATTERN_FOR_EDITOR.test(trimmedName);
  const source = definition?.file ?? definition?.source ?? 'missing';
  const save = () => onSave(definition?.name ?? row.name, trimmedName, trimmedValue);
  const selectIfRowClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (isVariableEditorInteractiveTarget(event.target)) return;
    onSelect(row.name);
  };
  const selectIfRowKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (isVariableEditorInteractiveTarget(event.target)) return;
    event.preventDefault();
    onSelect(row.name);
  };

  return (
    <div
      className={`vscode-scie-variable-row ${selected ? 'selected' : ''} ${missing ? 'missing' : ''}`}
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
        disabled={documentReadOnly}
        onChange={(event) => setName(event.target.value)}
      />
      <input
        aria-label={`Variable value ${row.name}`}
        value={value}
        disabled={documentReadOnly}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !dirty || !valid || documentReadOnly) return;
          event.preventDefault();
          save();
        }}
      />
      <button type="button" className="vscode-scie-variable-usage-button" onClick={() => onSelect(row.name)}>
        {row.usageCount === 0 ? 'Unused' : `${row.usageCount} use${row.usageCount === 1 ? '' : 's'}`}
      </button>
      <button
        type="button"
        disabled={!dirty || !valid || documentReadOnly}
        title={definition?.source === 'external' ? 'Save as front matter override' : definition ? 'Save variable' : 'Define in front matter'}
        onClick={save}
      >
        {definition ? 'Save' : 'Define'}
      </button>
      <small>{source}</small>
    </div>
  );
}

function createVariableRows(definitions: VariableDefinition[], usages: VariableUsage[]): VariableRowModel[] {
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

const VARIABLE_NAME_PATTERN_FOR_EDITOR = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

interface VscodeMarkdownToolbarProps {
  documentReadOnly: boolean;
  noteCount: number;
  variableCount: number;
  variantCount: number;
  onInsertNote: () => void;
  onInsertVersion: () => void;
}

export function VscodeMarkdownToolbar({
  documentReadOnly,
  noteCount,
  variableCount,
  variantCount,
  onInsertNote,
  onInsertVersion,
}: VscodeMarkdownToolbarProps) {
  return (
    <div className="vscode-scie-toolbar">
      <div className="vscode-scie-command-strip" role="toolbar" aria-label="Insert ScieMD controls">
        <ToolbarActionButton
          icon={MessageSquareText}
          label="Insert note"
          shortLabel="Insert note"
          detail="Insert a document note."
          disabled={documentReadOnly}
          onClick={onInsertNote}
        />
        <ToolbarActionButton
          icon={FilePenLine}
          label="Insert version"
          shortLabel="Insert version"
          detail="Insert a version-choice block."
          disabled={documentReadOnly}
          onClick={onInsertVersion}
        />
      </div>
      <VscodeStatusStrip noteCount={noteCount} variableCount={variableCount} variantCount={variantCount} />
    </div>
  );
}

interface VscodeStatusStripProps {
  noteCount: number;
  variableCount: number;
  variantCount: number;
}

export function VscodeStatusStrip({ noteCount, variableCount, variantCount }: VscodeStatusStripProps) {
  return (
    <div className="vscode-scie-metrics" aria-label="Document summary">
      <span>{noteCount} notes</span>
      <span>{variableCount} variables</span>
      <span>{variantCount} versions</span>
    </div>
  );
}

interface VscodeEditorStageProps {
  mode: VscodeEditorMode;
  visualEditor: ReactNode;
  sourceEditor: ReactNode;
  quickOutline?: ReactNode;
}

export function VscodeEditorStage({ mode, visualEditor, sourceEditor, quickOutline }: VscodeEditorStageProps) {
  return (
    <main className="vscode-scie-editor-stage editor-stage" data-testid="vscode-editor-stage">
      {quickOutline ? <div className="vscode-scie-quick-outline-slot">{quickOutline}</div> : null}
      {mode === 'visual' ? visualEditor : sourceEditor}
    </main>
  );
}

export function VscodeReadOnlyBanner({ reason }: { reason?: string }) {
  return (
    <div className="vscode-scie-banner" role="status">
      {reason ?? 'This document is read-only.'}
    </div>
  );
}

export function VscodeStartupPanel() {
  return (
    <section className="startup-panel" role="status">
      <strong>Waiting for Markdown document from VS Code</strong>
      <span>The ScieMD webview has mounted and asked the extension host for the active file.</span>
    </section>
  );
}

export function VscodeToast({ toast }: { toast: { text: string; tone: string } }) {
  return <div className={`vscode-scie-toast ${toast.tone}`}>{toast.text}</div>;
}

interface WebviewChoiceMenuProps<T extends string> {
  id: string;
  label: string;
  icon: LucideIcon;
  options: Array<ChoiceMenuOption<T>>;
  selectedId: T;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: T) => void;
}

function WebviewChoiceMenu<T extends string>({
  id,
  label,
  icon,
  options,
  selectedId,
  open,
  onOpenChange,
  onSelect,
}: WebviewChoiceMenuProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.id === selectedId) ?? options[0];
  const ButtonIcon = selected.icon ?? icon;

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onOpenChange(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onOpenChange, open]);

  return (
    <div className="vscode-scie-choice" ref={rootRef}>
      <button
        type="button"
        className="vscode-scie-choice-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${label}: ${selected.label}`}
        title={selected.detail}
        onClick={() => onOpenChange(!open)}
      >
        <ButtonIcon size={15} />
        <span className="vscode-scie-choice-kind">{label}</span>
        <span className="vscode-scie-choice-value">{selected.shortLabel}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      {open && (
        <div id={id} className="vscode-scie-choice-menu" role="menu" aria-label={`${label} options`}>
          {options.map((option) => {
            const OptionIcon = option.icon;
            const selectedOption = option.id === selectedId;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={selectedOption}
                className={selectedOption ? 'selected' : ''}
                onClick={() => {
                  onSelect(option.id);
                  onOpenChange(false);
                }}
              >
                {OptionIcon ? <OptionIcon size={15} /> : <span className="vscode-scie-choice-dot" aria-hidden="true" />}
                <span className="vscode-scie-choice-copy">
                  <span>{option.label}</span>
                  <small>{option.detail}</small>
                </span>
                {selectedOption && <Check size={15} className="vscode-scie-choice-check" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ToolbarActionButtonProps {
  icon: LucideIcon;
  label: string;
  shortLabel: string;
  detail: string;
  disabled: boolean;
  onClick: () => void;
}

function ToolbarActionButton({ icon: Icon, label, shortLabel, detail, disabled, onClick }: ToolbarActionButtonProps) {
  return (
    <button
      type="button"
      className="vscode-scie-tool-button"
      aria-label={label}
      title={detail}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={15} />
      <span>{shortLabel}</span>
    </button>
  );
}

function ScieMDWebviewMark() {
  const rootRef = useRef<HTMLButtonElement>(null);

  const react = () => {
    const root = rootRef.current;
    if (!root) return;
    root.classList.remove('is-reacting');
    window.requestAnimationFrame(() => {
      root.classList.add('is-reacting');
      window.setTimeout(() => root.classList.remove('is-reacting'), 760);
    });
  };

  return (
    <button
      type="button"
      ref={rootRef}
      className="vscode-scie-logo"
      aria-label="ScieMD mark"
      onClick={react}
    >
      <span className="vscode-scie-logo-circle left" aria-hidden="true" />
      <span className="vscode-scie-logo-circle right" aria-hidden="true" />
    </button>
  );
}
