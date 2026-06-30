import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VscodeEditorStage,
  VscodeDataSidebar,
  VscodeMarkdownToolbar,
  VscodeReadOnlyBanner,
  VscodeStartupPanel,
  VscodeToast,
  VscodeTopbar,
  VscodeWorkbenchShell,
} from './VscodeWorkbenchShell';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

describe('VS Code workbench shell components', () => {
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

  it('renders the topbar, toolbar, editor stage, status strip, and overlay slots', () => {
    renderWorkbench({ noteCount: 2, variableCount: 5, variantCount: 1 });

    const shell = container.querySelector<HTMLElement>('.vscode-scie-workbench');
    expect(shell).not.toBeNull();
    expect(shell?.dataset.editorMode).toBe('visual');
    expect(container.querySelector('.vscode-scie-topbar')?.textContent).toContain('ScieMD');
    expect(container.querySelector('.vscode-scie-toolbar')).not.toBeNull();
    expect(container.querySelector('.vscode-scie-metrics')?.textContent).toContain('2 notes');
    expect(container.querySelector('.vscode-scie-banner')?.textContent).toContain('Readonly from VS Code');
    expect(container.querySelector('.vscode-scie-content')?.getAttribute('data-data-sidebar-open')).toBe('true');
    expect(container.querySelector('.vscode-scie-data-sidebar')?.textContent).toContain('cohort_n');
    expect(container.querySelector('.startup-panel')?.textContent).toContain('Waiting for Markdown document');
    expect(container.querySelector('[data-testid="review-slot"]')?.textContent).toBe('Review slot');
    expect(container.querySelector('[data-testid="vscode-editor-stage"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="quick-outline-slot"]')?.textContent).toBe('Quick outline');
    expect(container.querySelector('[data-testid="visual-editor-slot"]')?.textContent).toBe('Visual editor');
    expect(container.querySelector('[data-testid="source-editor-slot"]')).toBeNull();
    expect(container.querySelector('.vscode-scie-toast')?.textContent).toBe('Saved');
    expect(container.querySelector('[data-testid="modal-slot"]')?.textContent).toBe('Modal slot');
  });

  it('keeps one stable editor stage when toolbar state changes', () => {
    renderWorkbench({ noteCount: 1, variableCount: 1, variantCount: 1 });
    const stageBefore = container.querySelector('.vscode-scie-editor-stage');

    renderWorkbench({ noteCount: 3, variableCount: 2, variantCount: 1 });
    const stageAfter = container.querySelector('.vscode-scie-editor-stage');

    expect(container.querySelectorAll('.vscode-scie-editor-stage')).toHaveLength(1);
    expect(stageAfter).toBe(stageBefore);
    expect(container.querySelector('.vscode-scie-metrics')?.textContent).toContain('3 notes');
    expect(container.querySelector('[data-testid="visual-editor-slot"]')?.textContent).toBe('Visual editor');
  });

  it('renders editable data variables with selected state, usage actions, and width controls', () => {
    const onSelectVariable = vi.fn();
    const onEditVariable = vi.fn();
    const onInsertVariable = vi.fn();
    const onClose = vi.fn();
    const onWidthChange = vi.fn();

    act(() => {
      root.render(
        <VscodeDataSidebar
          variableDefinitions={[
            { name: 'cohort_n', value: '12', source: 'frontmatter' },
          ]}
          variableUsages={[
            { name: 'cohort_n', raw: '{{ cohort_n }}', line: 5, from: 42, to: 56 },
          ]}
          missingVariables={[]}
          selectedVariableName="cohort_n"
          documentReadOnly={false}
          width={320}
          minWidth={260}
          maxWidth={460}
          widthStep={32}
          onInsertVariable={onInsertVariable}
          onEditVariable={onEditVariable}
          onSelectVariable={onSelectVariable}
          onClose={onClose}
          onWidthChange={onWidthChange}
        />,
      );
    });

    expect(container.querySelector('.vscode-scie-data-title')?.textContent).toContain('1 variable');
    expect(variableRow('cohort_n').getAttribute('aria-pressed')).toBe('true');

    clickButton('Insert variable');
    expect(onInsertVariable).toHaveBeenCalledTimes(1);

    clickButtonByAriaLabel('Widen data sidebar');
    expect(onWidthChange).toHaveBeenLastCalledWith(352);

    clickButtonByAriaLabel('Narrow data sidebar');
    expect(onWidthChange).toHaveBeenLastCalledWith(288);

    clickButtonByAriaLabel('Close data sidebar');
    expect(onClose).toHaveBeenCalledTimes(1);

    clickButton('Line 5');
    expect(onSelectVariable).toHaveBeenLastCalledWith('cohort_n', { name: 'cohort_n', raw: '{{ cohort_n }}', line: 5, from: 42, to: 56 });

    setInputByAriaLabel('Variable value cohort_n', '24');
    clickButton('Save');
    expect(onEditVariable).toHaveBeenLastCalledWith('cohort_n', 'cohort_n', '24');
  });

  it('renders an empty data sidebar state', () => {
    act(() => {
      root.render(
        <VscodeDataSidebar
          variableDefinitions={[]}
          variableUsages={[]}
          missingVariables={[]}
          selectedVariableName={null}
          documentReadOnly={false}
          width={320}
          minWidth={260}
          maxWidth={460}
          widthStep={32}
          onInsertVariable={vi.fn()}
          onEditVariable={vi.fn()}
          onSelectVariable={vi.fn()}
          onClose={vi.fn()}
          onWidthChange={vi.fn()}
        />,
      );
    });

    expect(container.querySelector('.vscode-scie-data-empty')?.textContent).toContain('No data variables yet');
  });
});

function renderWorkbench({
  noteCount,
  variableCount,
  variantCount,
}: {
  noteCount: number;
  variableCount: number;
  variantCount: number;
}): void {
  const noop = vi.fn();
  act(() => {
    root.render(
      <VscodeWorkbenchShell
        editorMode="visual"
        topbar={(
          <VscodeTopbar
            fileLabel="paper.md"
            mode="visual"
            visualStyle="science"
            themeMode="dark"
            openMenu={null}
            status="Synced"
            dirty={false}
            documentReadOnly={false}
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
        readonlyBanner={<VscodeReadOnlyBanner reason="Readonly from VS Code" />}
        toolbar={(
          <VscodeMarkdownToolbar
            documentReadOnly={false}
            noteCount={noteCount}
            variableCount={variableCount}
            variantCount={variantCount}
            onInsertNote={noop}
            onInsertVersion={noop}
          />
        )}
        startupPanel={<VscodeStartupPanel />}
        reviewPanel={<section data-testid="review-slot">Review slot</section>}
        dataSidebarOpen
        dataSidebarWidth={320}
        dataSidebar={(
          <VscodeDataSidebar
            variableDefinitions={[{ name: 'cohort_n', value: '12', source: 'frontmatter' }]}
            variableUsages={[{ name: 'cohort_n', raw: '{{ cohort_n }}', line: 5, from: 42, to: 56 }]}
            missingVariables={[]}
            selectedVariableName="cohort_n"
            documentReadOnly={false}
            width={320}
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
            quickOutline={<nav data-testid="quick-outline-slot">Quick outline</nav>}
            visualEditor={<section data-testid="visual-editor-slot">Visual editor</section>}
            sourceEditor={<section data-testid="source-editor-slot">Source editor</section>}
          />
        )}
        toast={<VscodeToast toast={{ text: 'Saved', tone: 'success' }} />}
        modal={<section data-testid="modal-slot">Modal slot</section>}
      />,
    );
  });
}

function clickButtonByAriaLabel(label: string): void {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.getAttribute('aria-label') === label);
  expect(button, `button aria-label "${label}"`).not.toBeUndefined();
  act(() => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function clickButton(label: string): void {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent?.includes(label));
  expect(button, `button "${label}"`).not.toBeUndefined();
  act(() => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function variableRow(label: string): HTMLElement {
  const row = Array.from(container.querySelectorAll<HTMLElement>('.vscode-scie-variable-row'))
    .find((candidate) => candidate.textContent?.includes(label) || candidate.querySelector(`input[aria-label="Variable name ${label}"]`));
  expect(row, `variable row "${label}"`).not.toBeUndefined();
  return row as HTMLElement;
}

function setInputByAriaLabel(label: string, value: string): void {
  const input = Array.from(container.querySelectorAll<HTMLInputElement>('input'))
    .find((candidate) => candidate.getAttribute('aria-label') === label);
  expect(input, `input aria-label "${label}"`).not.toBeUndefined();
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    valueSetter?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  });
}
