import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarkdownHeading } from '@sciemd/core';
import type { VisualStyleId } from '../scie-md/services/visualStyleService';
import type { VscodeThemeMode } from './theme';
import {
  VscodeEditorStage,
  VscodeDataSidebar,
  VscodeMarkdownToolbar,
  VscodeReadOnlyBanner,
  VscodeToast,
  VscodeTopbar,
  VscodeWorkbenchShell,
} from './VscodeWorkbenchShell';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const webviewStyles = readFileSync(join(process.cwd(), 'src/webview/styles.css'), 'utf8');
const longFileName = 'Very-Long-Research-Manuscript-Name-With-Multiple-Sections-And-Supplementary-Appendix.scie.md';
const headings: MarkdownHeading[] = [
  { id: 'intro', level: 1, text: 'Introduction', line: 1 },
  { id: 'methods', level: 2, text: 'Methods and validation matrix', line: 12 },
  { id: 'results', level: 2, text: 'Results across visual states', line: 31 },
  { id: 'discussion', level: 3, text: 'Discussion and limitations', line: 44 },
];

let container: HTMLDivElement;
let root: Root;

describe('VS Code webview visual smoke', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    document.body.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-mode');
    document.documentElement.removeAttribute('data-visual-style');
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    document.body.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-mode');
    document.documentElement.removeAttribute('data-visual-style');
  });

  it('renders the smoke matrix surface without native dropdowns or missing navigation chrome', () => {
    renderSmokeShell({
      bodyClass: 'vscode-dark',
      openMenu: 'style',
      readOnly: true,
      themeMode: 'dark',
      visualStyle: 'scienfy',
    });

    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('.vscode-scie-workbench')).not.toBeNull();
    expect(container.querySelector('.vscode-scie-topbar')).not.toBeNull();
    expect(container.querySelector('.vscode-scie-toolbar')).not.toBeNull();
    expect(container.querySelector('.vscode-scie-title span')?.getAttribute('title')).toBe(longFileName);
    expect(container.querySelector('.vscode-scie-title span')?.textContent).toBe(longFileName);
    expect(buttonByAriaLabel('Save document').disabled).toBe(true);
    expect(buttonByAriaLabel('Insert note').disabled).toBe(true);
    expect(buttonByAriaLabel('Style: Scienfy').disabled).toBe(false);
    expect(buttonByAriaLabel('Theme: Dark').disabled).toBe(false);
    expect(container.querySelector('.vscode-scie-command-strip')?.textContent).not.toContain('Human');
    expect(container.querySelector('.vscode-scie-command-strip')?.textContent).not.toContain('Variable');

    const styleMenu = menuByLabel('Style options');
    expect(styleMenu).not.toBeNull();
    expect(styleMenu?.querySelectorAll('[role="menuitemradio"]').length).toBeGreaterThan(6);
    expect(styleMenu?.textContent).toContain('Scientific Draft');
    expect(styleMenu?.textContent).toContain('Scienfy');

    const content = container.querySelector<HTMLElement>('.vscode-scie-content');
    expect(content?.getAttribute('data-data-sidebar-open')).toBe('true');
    expect(content?.style.getPropertyValue('--vscode-scie-data-sidebar-width')).toBe('344px');
    expect(container.querySelector('.quick-outline')).not.toBeNull();
    expect(container.querySelectorAll('.quick-outline-dash').length).toBeGreaterThan(2);
    expect(container.querySelector('.vscode-scie-data-sidebar')?.textContent).toContain('cohort_n');
    expect(container.querySelector('.vscode-scie-banner')?.textContent).toContain('Readonly from VS Code');
    expect(container.querySelector('.vscode-scie-review-panel')?.textContent).toContain('External Markdown changes');
    expect(container.querySelector('.vscode-scie-review-unit')?.textContent).toContain('Changed abstract paragraph');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Variable');
    expect(container.querySelector('.vscode-scie-toast')?.textContent).toBe('Visual smoke toast');
  });

  it('keeps style and theme popovers custom and readable across VS Code theme modes', () => {
    for (const scenario of [
      { bodyClass: 'vscode-dark', theme: 'dark', menu: 'theme' },
      { bodyClass: 'vscode-light', theme: 'light', menu: 'style' },
      { bodyClass: 'vscode-high-contrast', theme: 'vscode', menu: 'theme' },
    ] as const) {
      renderSmokeShell({
        bodyClass: scenario.bodyClass,
        openMenu: scenario.menu,
        readOnly: false,
        themeMode: scenario.theme,
        visualStyle: 'science',
      });

      expect(document.body.classList.contains(scenario.bodyClass)).toBe(true);
      expect(document.documentElement.dataset.themeMode).toBe(scenario.theme);
      expect(container.querySelector('select')).toBeNull();
      expect(container.querySelector('.vscode-scie-choice-menu')).not.toBeNull();
      expect(container.querySelector('.vscode-scie-choice-menu')?.textContent).toMatch(/VS Code|Scientific Draft/);
      expect(container.querySelector('.vscode-scie-choice-menu')?.querySelector('[aria-checked="true"]')).not.toBeNull();
    }
  });

  it('keeps CSS layout contracts that catch the screenshot-level regressions', () => {
    expectCssBlock('.vscode-scie-title span', [
      'overflow: hidden;',
      'text-overflow: ellipsis;',
      'white-space: nowrap;',
    ]);
    expectCssBlock('.vscode-scie-topbar-controls', [
      'display: flex;',
      'min-width: 0;',
      'flex: 2 1 520px;',
    ]);
    expectCssBlock('.vscode-scie-choice-menu', [
      'position: absolute;',
      'z-index: 50;',
      'overflow: auto;',
      'width: min(360px, calc(100vw - 28px));',
    ]);
    expectCssBlock('.vscode-scie-quick-outline-slot', [
      'position: sticky;',
      'z-index: 24;',
      'overflow: visible;',
      'pointer-events: none;',
    ]);
    expectCssBlock('.vscode-scie-content[data-data-sidebar-open="true"]', [
      'grid-template-columns: minmax(260px, var(--vscode-scie-data-sidebar-width, 320px)) minmax(0, 1fr);',
    ]);
    expectCssBlock('.vscode-scie-review-panel', [
      'max-height: min(58vh, 620px);',
      'overflow: hidden;',
    ]);
    expectCssBlock('.vscode-scie-review-units', [
      'overflow: auto;',
      'scrollbar-gutter: stable;',
    ]);
    expectCssBlock('.vscode-scie-modal', [
      'max-height: calc(100vh - 48px);',
      'overflow: hidden;',
    ]);

    expect(webviewStyles).toMatch(/@media \(max-width: 760px\) \{[\s\S]*\.vscode-scie-topbar,[\s\S]*\.vscode-scie-toolbar\s*\{[\s\S]*flex-wrap:\s*wrap;/);
    expect(webviewStyles).toMatch(/@media \(max-width: 760px\) \{[\s\S]*\.vscode-scie-content\[data-data-sidebar-open="true"\]\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    expect(webviewStyles).toMatch(/@media \(max-width: 760px\) \{[\s\S]*\.vscode-scie-data-sidebar\s*\{[\s\S]*position:\s*absolute;/);
    expect(webviewStyles).toMatch(/@media \(forced-colors: active\) \{[\s\S]*--scie-primary-bg:\s*Highlight;/);
    expect(webviewStyles).toMatch(/@media \(forced-colors: active\) \{[\s\S]*\.vscode-scie-editor-stage,[\s\S]*background:\s*Canvas !important;/);
  });
});

function renderSmokeShell({
  bodyClass,
  openMenu,
  readOnly,
  themeMode,
  visualStyle,
}: {
  bodyClass: string;
  openMenu: 'style' | 'theme';
  readOnly: boolean;
  themeMode: VscodeThemeMode;
  visualStyle: VisualStyleId;
}): void {
  const noop = vi.fn();
  document.body.className = bodyClass;
  document.documentElement.dataset.themeMode = themeMode;
  document.documentElement.dataset.visualStyle = visualStyle;
  act(() => {
    root.render(
      <VscodeWorkbenchShell
        editorMode="visual"
        topbar={(
          <VscodeTopbar
            fileLabel={longFileName}
            mode="visual"
            visualStyle={visualStyle}
            themeMode={themeMode}
            openMenu={openMenu}
            status="External changes pending"
            dirty
            documentReadOnly={readOnly}
            dataSidebarOpen
            onSelectVisual={noop}
            onSelectSource={noop}
            onToggleDataSidebar={noop}
            onOpenMenuChange={noop}
            onSelectStyle={noop}
            onSelectTheme={noop}
            onSave={noop}
          />
        )}
        readonlyBanner={readOnly ? <VscodeReadOnlyBanner reason="Readonly from VS Code" /> : null}
        toolbar={(
          <VscodeMarkdownToolbar
            documentReadOnly={readOnly}
            noteCount={3}
            variableCount={5}
            variantCount={1}
            onInsertNote={noop}
            onInsertVersion={noop}
          />
        )}
        reviewPanel={<SmokeReviewPanel />}
        dataSidebarOpen
        dataSidebarWidth={344}
        dataSidebar={(
          <VscodeDataSidebar
            variableDefinitions={[
              { name: 'cohort_n', value: '128', source: 'frontmatter' },
              { name: 'p_value', value: '0.03', source: 'frontmatter' },
            ]}
            variableUsages={[
              { name: 'cohort_n', raw: '{{ cohort_n }}', line: 8, from: 120, to: 134 },
              { name: 'p_value', raw: '{{ p_value }}', line: 16, from: 220, to: 233 },
              { name: 'missing_metric', raw: '{{ missing_metric }}', line: 28, from: 320, to: 340 },
            ]}
            missingVariables={['missing_metric']}
            selectedVariableName="cohort_n"
            documentReadOnly={readOnly}
            width={344}
            minWidth={260}
            maxWidth={460}
            widthStep={32}
            onInsertVariable={noop}
            onEditVariable={noop}
            onSelectVariable={noop}
            onClose={noop}
            onWidthChange={noop}
          />
        )}
        editorStage={(
          <VscodeEditorStage
            mode="visual"
            quickOutline={<SmokeQuickOutline />}
            visualEditor={<SmokeVisualEditor />}
            sourceEditor={<section className="cm-editor">Source editor</section>}
          />
        )}
        toast={<VscodeToast toast={{ text: 'Visual smoke toast', tone: 'success' }} />}
        modal={<SmokeModal />}
      />,
    );
  });
}

function SmokeQuickOutline() {
  return (
    <nav className="quick-outline" aria-label="Quick outline">
      <button type="button" className="quick-outline-trigger" aria-label="Quick outline">
        {headings.map((heading) => (
          <span
            key={heading.id}
            className={`quick-outline-dash level-${heading.level} ${heading.id === 'methods' ? 'active' : ''}`}
            aria-hidden="true"
          />
        ))}
      </button>
      <div className="quick-outline-card">
        {headings.map((heading) => (
          <button key={heading.id} type="button" className={`quick-outline-item level-${heading.level}`}>
            <span className="quick-outline-item-dash" aria-hidden="true" />
            <span className="quick-outline-item-text">{heading.text}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

function SmokeVisualEditor() {
  return (
    <section className="visual-editor">
      <div className="milkdown">
        <article className="ProseMirror">
          <h1>Introduction</h1>
          <p>Visual smoke content for ScieMD in the VS Code webview.</p>
        </article>
      </div>
    </section>
  );
}

function SmokeReviewPanel() {
  return (
    <section className="vscode-scie-review-panel">
      <header className="vscode-scie-review-header">
        <div>
          <strong>External Markdown changes</strong>
          <span>2 changes - 18 changed lines</span>
        </div>
      </header>
      <div className="vscode-scie-review-units">
        <article className="vscode-scie-review-unit">
          <div className="vscode-scie-review-card-shell">
            <label className="vscode-scie-review-selector">
              <input type="checkbox" defaultChecked />
              <span>Accept</span>
            </label>
            <button type="button" className="vscode-scie-review-summary">
              <span className="vscode-scie-review-index">Change 1</span>
              <span className="vscode-scie-review-title">Changed abstract paragraph</span>
              <span className="vscode-scie-review-preview">A concise summary of the incoming disk edit.</span>
            </button>
          </div>
        </article>
      </div>
      <footer>
        <span>1 accepted</span>
        <div>
          <button type="button">Reject selected</button>
          <button type="button" className="primary">Accept selected</button>
        </div>
      </footer>
    </section>
  );
}

function SmokeModal() {
  return (
    <div className="vscode-scie-modal-backdrop">
      <section className="vscode-scie-modal" role="dialog" aria-label="Variable">
        <header className="vscode-scie-dialog-header">
          <div>
            <span>Variable</span>
            <h2>Create Variable</h2>
            <p>Check modal framing and scroll behavior in the VS Code webview.</p>
          </div>
          <button type="button" className="vscode-scie-modal-close">Close</button>
        </header>
        <form className="vscode-scie-dialog-body vscode-scie-dialog-form">
          <label>
            Name
            <input defaultValue="sample_count" />
          </label>
        </form>
      </section>
    </div>
  );
}

function buttonByAriaLabel(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.getAttribute('aria-label') === label);
  expect(button, `button aria-label "${label}"`).not.toBeUndefined();
  return button as HTMLButtonElement;
}

function menuByLabel(label: string): HTMLElement | null {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="menu"]'))
    .find((menu) => menu.getAttribute('aria-label') === label) ?? null;
}

function expectCssBlock(selector: string, snippets: string[]): void {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = webviewStyles.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`));
  expect(match, `CSS block ${selector}`).not.toBeNull();
  const block = match?.[1] ?? '';
  for (const snippet of snippets) {
    expect(block, `${selector} includes ${snippet}`).toContain(snippet);
  }
}
