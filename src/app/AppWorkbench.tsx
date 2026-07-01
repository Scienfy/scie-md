import { useMemo } from 'react';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { AmbientSuggestions } from '../components/AmbientSuggestions';
import { AppTopbar, type AppTopbarMenuId } from '../components/AppTopbar';
import { FindReplacePanel } from '../components/FindReplacePanel';
import { InspectorPane } from '../components/InspectorPane';
import { LocalPanelErrorBoundary } from '../components/LocalPanelErrorBoundary';
import { MarkdownToolbar } from '../components/MarkdownToolbar';
import { StatusBar } from '../components/StatusBar';
import { AppEditorStage } from './AppEditorStage';
import { AppSidebar } from './AppSidebar';
import { MARKDOWN_UI_CAPABILITIES, type FormatUiCapabilities } from './formatCapabilities';

type AppTopbarWorkbenchProps = Omit<ComponentProps<typeof AppTopbar>, 'activeMenu' | 'onToggleMenu' | 'onCloseMenus'>;

export interface AppWorkbenchProps {
  focusMode: boolean;
  skipToEditorLabel: string;
  activeTopbarMenu: AppTopbarMenuId | null;
  onToggleTopbarMenu: (menu: AppTopbarMenuId) => void;
  onCloseTopbarMenus: () => void;
  formatCapabilities?: FormatUiCapabilities;
  topbar: AppTopbarWorkbenchProps;
  toolbar: ComponentProps<typeof MarkdownToolbar>;
  findReplace: ComponentProps<typeof FindReplacePanel> | null;
  outlineOpen: boolean;
  inspectorOpen: boolean;
  sidebarWidth: number;
  sidebar: ComponentProps<typeof AppSidebar>;
  editorStage: ComponentProps<typeof AppEditorStage>;
  inspector: ComponentProps<typeof InspectorPane>;
  ambientSuggestions: ComponentProps<typeof AmbientSuggestions>;
  statusBar: ComponentProps<typeof StatusBar>;
  children?: ReactNode;
}

export function AppWorkbench({
  focusMode,
  skipToEditorLabel,
  activeTopbarMenu,
  onToggleTopbarMenu,
  onCloseTopbarMenus,
  formatCapabilities = MARKDOWN_UI_CAPABILITIES,
  topbar,
  toolbar,
  findReplace,
  outlineOpen,
  inspectorOpen,
  sidebarWidth,
  sidebar,
  editorStage,
  inspector,
  ambientSuggestions,
  statusBar,
  children,
}: AppWorkbenchProps) {
  const workbenchStyle = useMemo(() => ({
    '--outline-width': `${sidebarWidth}px`,
  }) as CSSProperties, [sidebarWidth]);

  return (
    <div className={`app-shell ${focusMode ? 'focus-mode' : ''}`}>
      <a className="skip-link" href="#editor-stage">{skipToEditorLabel}</a>
      <AppTopbar
        {...topbar}
        formatCapabilities={formatCapabilities}
        activeMenu={activeTopbarMenu}
        onToggleMenu={onToggleTopbarMenu}
        onCloseMenus={onCloseTopbarMenus}
      />
      {formatCapabilities.canUseMarkdownToolbar && <MarkdownToolbar {...toolbar} />}
      {findReplace && <FindReplacePanel {...findReplace} />}
      <div
        className={`workbench ${outlineOpen ? 'with-outline' : ''} ${inspectorOpen ? 'with-inspector' : ''}`}
        style={workbenchStyle}
      >
        <AppSidebar {...sidebar} />
        <AppEditorStage {...editorStage} />
        <LocalPanelErrorBoundary
          label="Inspector"
          resetKey={`inspector:${inspector.open ? 'open' : 'closed'}:${inspector.data.filePath ?? 'untitled'}:${inspector.data.mode}:${inspector.data.autosaveStatus}`}
        >
          <InspectorPane {...inspector} />
        </LocalPanelErrorBoundary>
      </div>
      <AmbientSuggestions {...ambientSuggestions} />
      <StatusBar {...statusBar} />
      {children}
    </div>
  );
}
