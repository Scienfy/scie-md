import type { ComponentProps } from 'react';
import { PanelLeftOpen } from 'lucide-react';
import { NavigationSidebar } from '../components/NavigationSidebar';

interface AppSidebarProps {
  open: boolean;
  view: ComponentProps<typeof NavigationSidebar>['view'];
  width: number;
  outline: ComponentProps<typeof NavigationSidebar>['outline'];
  explorer: ComponentProps<typeof NavigationSidebar>['explorer'];
  layerTwoDocument: ComponentProps<typeof NavigationSidebar>['layerTwoDocument'];
  bibliographyLoading: boolean;
  selectedVariableName?: string | null;
  onOpen: () => void;
  onViewChange: ComponentProps<typeof NavigationSidebar>['onViewChange'];
  onJumpToLine: ComponentProps<typeof NavigationSidebar>['onJumpToLine'];
  onReloadBibliography: ComponentProps<typeof NavigationSidebar>['onReloadBibliography'];
  onManageCitations: ComponentProps<typeof NavigationSidebar>['onManageCitations'];
  onInsertVariable: ComponentProps<typeof NavigationSidebar>['onInsertVariable'];
  onLinkVariableFile: ComponentProps<typeof NavigationSidebar>['onLinkVariableFile'];
  onEditVariable: ComponentProps<typeof NavigationSidebar>['onEditVariable'];
  onSelectVariable: ComponentProps<typeof NavigationSidebar>['onSelectVariable'];
  onResize: ComponentProps<typeof NavigationSidebar>['onResize'];
  onResizeCommit: ComponentProps<typeof NavigationSidebar>['onResizeCommit'];
  onClose: ComponentProps<typeof NavigationSidebar>['onClose'];
}

export function AppSidebar({
  open,
  view,
  width,
  outline,
  explorer,
  layerTwoDocument,
  bibliographyLoading,
  selectedVariableName,
  onOpen,
  onViewChange,
  onJumpToLine,
  onReloadBibliography,
  onManageCitations,
  onInsertVariable,
  onLinkVariableFile,
  onEditVariable,
  onSelectVariable,
  onResize,
  onResizeCommit,
  onClose,
}: AppSidebarProps) {
  if (!open) {
    return (
      <button
        type="button"
        className="sidebar-open-button"
        aria-label="Open navigation sidebar"
        data-tooltip="Open navigation sidebar"
        onClick={onOpen}
      >
        <PanelLeftOpen size={17} />
      </button>
    );
  }

  return (
    <NavigationSidebar
      view={view}
      width={width}
      outline={outline}
      explorer={explorer}
      layerTwoDocument={layerTwoDocument}
      bibliographyLoading={bibliographyLoading}
      onViewChange={onViewChange}
      onJumpToLine={onJumpToLine}
      onReloadBibliography={onReloadBibliography}
      onManageCitations={onManageCitations}
      onInsertVariable={onInsertVariable}
      onLinkVariableFile={onLinkVariableFile}
      onEditVariable={onEditVariable}
      selectedVariableName={selectedVariableName}
      onSelectVariable={onSelectVariable}
      onResize={onResize}
      onResizeCommit={onResizeCommit}
      onClose={onClose}
    />
  );
}
