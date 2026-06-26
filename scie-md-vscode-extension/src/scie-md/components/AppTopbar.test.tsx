import { act, type ComponentProps } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppTopbarMenuId as MenuId } from './AppTopbar';
import { AppTopbar } from './AppTopbar';
import type { RecentFilePreview } from '../markdown/documentIntelligence';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => undefined;

let container: HTMLDivElement;
let root: Root;

describe('AppTopbar menu architecture', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  it('keeps Help scoped to learning, support, and product information', () => {
    renderTopbar('help');

    expect(menuText()).toContain('Quick Tour');
    expect(menuText()).toContain('Full Tutorial');
    expect(menuText()).toContain('Keyboard Shortcuts');
    expect(menuText()).toContain('About ScieMD');
    expect(menuText()).not.toContain('Settings');
    expect(menuText()).not.toContain('Templates');
    expect(menuText()).not.toContain('Check External Tools');
  });

  it('places document lifecycle and export actions under File', () => {
    renderTopbar('file');

    const text = menuText();
    expect(text).toContain('New from Template');
    expect(text).toContain('Open Recent');
    expect(text).toContain('Styled HTML');
    expect(text).toContain('PDF');
    expect(text).toContain('Word DOCX');
    expect(text).toContain('Print Preview');
    expect(text.indexOf('Save')).toBeLessThan(text.indexOf('Open Recent'));
    expect(text.indexOf('Styled HTML')).toBeLessThan(text.indexOf('Open Recent'));
    expect(text.indexOf('Print Preview')).toBeLessThan(text.indexOf('Open Recent'));
  });

  it('places appearance controls under View and diagnostics under Tools', () => {
    renderTopbar('view');
    expect(menuText()).toContain('Visual Mode');
    expect(menuText()).toContain('Navigation Sidebar');
    expect(menuText()).toContain('Theme');
    expect(menuText()).toContain('Visual style');
    expect(menuText()).not.toContain('Adaptive');

    renderTopbar('tools');
    expect(menuText()).toContain('Settings');
    expect(menuText()).toContain('Check External Tools');
    expect(menuText()).toContain('Set Inkscape Path');
    expect(menuText()).toContain('Show Last Export Log');
  });

  it('keeps quick actions focused on insert, search, and command palette', () => {
    renderTopbar(null);

    const quickToolbar = container.querySelector('.quick-toolbar');
    expect(quickToolbar?.textContent).toBe('K');
    expect(quickToolbar?.querySelector('[aria-label="Insert menu"]')).not.toBeNull();
    expect(quickToolbar?.querySelector('[aria-label="Find and Replace"]')).not.toBeNull();
    expect(quickToolbar?.querySelector('[aria-label="Command Palette"]')).not.toBeNull();
    expect(quickToolbar?.querySelector('[title="New"]')).toBeNull();
    expect(quickToolbar?.querySelector('[title="Open"]')).toBeNull();
    expect(quickToolbar?.querySelector('[title="Save"]')).toBeNull();
    expect(quickToolbar?.querySelector('[aria-label="Undo"]')).toBeNull();
    expect(quickToolbar?.querySelector('[aria-label="Redo"]')).toBeNull();
  });

  it('opens focused style and theme pickers from the topbar controls', () => {
    renderTopbar('visual-style');
    expect(menuText()).toContain('Scientific Draft');
    expect(menuText()).toContain('Nature');
    expect(menuText()).not.toContain('Visual Mode');
    expect(menuText()).not.toContain('Theme');
    expect(menuText()).not.toContain('Navigation Sidebar');

    renderTopbar('theme');
    expect(menuText()).toContain('System');
    expect(menuText()).toContain('Light');
    expect(menuText()).toContain('Dark');
    expect(menuText()).toContain('Sepia');
    expect(menuText()).not.toContain('Visual style');
    expect(menuText()).not.toContain('Navigation Sidebar');
  });

  it('exposes note-driven LLM actions from the LLM menu', () => {
    renderTopbar('review');

    expect(menuText()).toContain('LLM skill');
    expect(menuText()).toContain('Copy ScieMD LLM Skill');
    expect(menuText()).toContain('Generate LLM Skill File');
    expect(menuText()).not.toContain('Generate Submission Readiness Report');
    expect(menuText()).not.toContain('Copy for LLM');
    expect(menuText()).not.toContain('Copy Current Section');
  });

  it('enables paste review only when pasted changes are available', () => {
    const onOpenPasteReview = vi.fn();
    renderTopbar('review', [], { hasPasteReview: false, onOpenPasteReview });

    const disabledReview = findMenuButton('Review Pasted Changes');
    expect(disabledReview?.disabled).toBe(true);

    act(() => {
      disabledReview?.click();
    });
    expect(onOpenPasteReview).not.toHaveBeenCalled();

    renderTopbar('review', [], { hasPasteReview: true, onOpenPasteReview });
    const enabledReview = findMenuButton('Review Pasted Changes');
    expect(enabledReview?.disabled).toBe(false);

    act(() => {
      enabledReview?.click();
    });
    expect(onOpenPasteReview).toHaveBeenCalledTimes(1);
  });

  it('labels the old review menu slot as LLM in the top bar', () => {
    renderTopbar(null);

    const labels = Array.from(container.querySelectorAll('.app-menu-trigger')).map((node) => node.textContent);
    expect(labels).toContain('LLM');
    expect(labels).not.toContain('Review');
  });

  it('marks only File, Edit, and View as core menus for narrow windows', () => {
    renderTopbar(null);

    const coreLabels = Array.from(container.querySelectorAll('.app-menu-button.is-core-menu .app-menu-trigger'))
      .map((node) => node.textContent);
    const secondaryLabels = Array.from(container.querySelectorAll('.app-menu-button.is-secondary-menu .app-menu-trigger'))
      .map((node) => node.textContent);

    expect(coreLabels).toEqual(['File', 'Edit', 'View']);
    expect(secondaryLabels).toEqual(['Insert', 'Format', 'References', 'LLM', 'Tools', 'Help']);
    expect(container.querySelector('.window-controls [aria-label="Close window"]')).not.toBeNull();
  });

  it('uses stable row classes for long shortcuts and recent file previews', () => {
    renderTopbar('tools');

    const commandPaletteRow = Array.from(container.querySelectorAll<HTMLButtonElement>('.app-menu-item'))
      .find((button) => button.textContent?.includes('Command Palette'));
    expect(commandPaletteRow?.classList.contains('has-shortcut')).toBe(true);
    expect(commandPaletteRow?.querySelector('kbd')?.textContent).toContain('Ctrl/Cmd+K');

    renderTopbar('file', [{
      path: 'C:\\papers\\coaxer-ultrasonic-spray-coating-long-manuscript-title.md',
      name: 'coaxer-ultrasonic-spray-coating-long-manuscript-title.md',
      heading: 'CoaXer: Automated Dual-Line Ultrasonic Spray-Coating for High-Throughput Thin-Film Fabrication',
      excerpt: 'Scalable thin-film fabrication methods are limited by manual workflow bottlenecks and fragmented process metadata.',
    }]);

    const recentRow = container.querySelector<HTMLButtonElement>('.recent-menu-item');
    expect(recentRow).not.toBeNull();
    expect(recentRow?.getAttribute('title')).toContain('coaxer-ultrasonic');
    expect(recentRow?.querySelector('.recent-menu-copy span')?.textContent).toContain('CoaXer');
    expect(recentRow?.querySelector('.recent-menu-copy small')?.textContent).toContain('Scalable thin-film');
  });
});

function renderTopbar(
  activeMenu: MenuId | null,
  recentFiles: RecentFilePreview[] = [],
  overrides: Partial<Pick<ComponentProps<typeof AppTopbar>, 'hasPasteReview' | 'onOpenPasteReview'>> = {},
) {
  const handler = vi.fn();
  act(() => {
    root.render(
      <AppTopbar
        mode="visual"
        activeMenu={activeMenu}
        filePath={null}
        dirty={false}
        outlineOpen
        inspectorOpen={false}
        focusMode={false}
        themeMode="dark"
        currentVisualStyle={{ label: 'Scienfy', shortLabel: 'Scienfy' }}
        selectedVisualStyle="scienfy"
        recentFiles={recentFiles}
        hasPasteReview={overrides.hasPasteReview ?? false}
        onToggleMenu={handler}
        onCloseMenus={noop}
        onNew={noop}
        onOpen={noop}
        onOpenFolder={noop}
        onOpenRecent={noop}
        onSave={noop}
        onSaveAs={noop}
        onFind={noop}
        onUndo={noop}
        onRedo={noop}
        onCopyRichText={noop}
        onApplyScientificTypography={noop}
        onInsertMarkdown={noop}
        onInsertImage={noop}
        onInsertLink={noop}
        onInsertCitation={noop}
        onInsertVariable={noop}
        onInsertMermaid={noop}
        onInsertSvgFigure={noop}
        onInsertSemanticBlock={noop}
        onInsertProtectedBlock={noop}
        onInsertEditorComment={noop}
        onInsertHumanEditorComment={noop}
        onInsertTargetedInstruction={noop}
        onInsertVariantGroup={noop}
        onInsertReferencesDirective={noop}
        onReloadBibliography={noop}
        onSyncBibliography={noop}
        onCopyScieMDLlmSkill={noop}
        onGenerateScieMDLlmSkill={noop}
        onGenerateSubmissionReadiness={noop}
        onOpenPasteReview={overrides.onOpenPasteReview ?? noop}
        onOpenExportDialog={noop}
        onPrintPreview={noop}
        onShowExportLog={noop}
        onOpenTutorial={noop}
        onOpenFullTutorial={noop}
        onShowShortcuts={noop}
        onOpenTemplates={noop}
        onCheckTools={noop}
        onSetInkscapePath={noop}
        onOpenSettings={noop}
        onShowAbout={noop}
        onOpenGithub={noop}
        onReportBug={noop}
        onOpenCommandPalette={noop}
        onOpenSlashMenu={noop}
        onModeChange={noop}
        onSetVisualStyle={noop}
        onSetThemeMode={noop}
        onIncreaseFont={noop}
        onDecreaseFont={noop}
        onResetFont={noop}
        onFormatHeading={noop}
        onFormatInline={noop}
        onToggleOutline={noop}
        onSidebarView={noop}
        onToggleInspector={noop}
        onToggleFocusMode={noop}
        onWindowMinimize={noop}
        onWindowMaximize={noop}
        onWindowClose={noop}
        onTitlebarMouseDown={noop}
        onTitlebarDoubleClick={noop}
      />,
    );
  });
}

function menuText(): string {
  return container.querySelector('.app-menu-panel')?.textContent ?? '';
}

function findMenuButton(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.app-menu-item'))
    .find((button) => button.textContent === label);
}
