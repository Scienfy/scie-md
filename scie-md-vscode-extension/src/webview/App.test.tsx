import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionToWebviewMessage, ScieMDDocumentSnapshot, WebviewToExtensionMessage } from '../shared/webviewProtocol';
import { App } from './App';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const webviewMocks = vi.hoisted(() => ({
  vscodeApi: {
    postMessage: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
  },
  flushVisualEditorState: vi.fn(),
  visualJump: vi.fn(),
  sourceJump: vi.fn(),
}));

vi.mock('./vscodeApi', () => ({
  vscodeApi: webviewMocks.vscodeApi,
}));

vi.mock('../scie-md/components/visualEditorStateSync', () => ({
  flushVisualEditorState: webviewMocks.flushVisualEditorState,
}));

vi.mock('../scie-md/components/VisualMarkdownEditor', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    VisualMarkdownEditor: (props: {
      markdown: string;
      readOnly?: boolean;
      onChange: (markdown: string) => void;
      onInsertReady: (handler: unknown) => void;
      onJumpReady: (handler: unknown) => void;
      onSelectionTextReady: (getter: unknown) => void;
      onCursorLineChange: (line: number) => void;
    }) => {
      const { onJumpReady } = props;
      React.useEffect(() => {
        onJumpReady((target: unknown) => webviewMocks.visualJump(target));
        return () => onJumpReady(undefined);
      }, [onJumpReady]);
      return React.createElement(
        'section',
        { 'data-testid': 'visual-editor', 'data-read-only': String(Boolean(props.readOnly)) },
        React.createElement('pre', null, props.markdown),
        React.createElement('button', {
          type: 'button',
          disabled: props.readOnly,
          onClick: () => props.onChange('# Visual draft\n'),
        }, 'visual edit'),
        React.createElement('button', {
          type: 'button',
          onClick: () => props.onInsertReady(() => undefined),
        }, 'visual insert ready'),
        React.createElement('button', {
          type: 'button',
          onClick: () => props.onSelectionTextReady(() => ({ text: 'selection', line: 1, surface: 'visual' })),
        }, 'visual selection ready'),
        React.createElement('button', {
          type: 'button',
          onClick: () => props.onCursorLineChange(4),
        }, 'visual cursor'),
      );
    },
  };
});

vi.mock('../scie-md/components/SourceMarkdownEditor', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    SourceMarkdownEditor: (props: {
      markdown: string;
      readOnly?: boolean;
      onChange: (markdown: string) => void;
      onInsertReady: (handler: unknown) => void;
      onJumpReady: (handler: unknown) => void;
      onSelectionTextReady: (getter: unknown) => void;
      onCursorLineChange: (line: number) => void;
    }) => {
      const { onJumpReady } = props;
      React.useEffect(() => {
        onJumpReady((line: unknown) => webviewMocks.sourceJump(line));
        return () => onJumpReady(undefined);
      }, [onJumpReady]);
      return React.createElement(
        'section',
        { 'data-testid': 'source-editor', 'data-read-only': String(Boolean(props.readOnly)) },
        React.createElement('pre', null, props.markdown),
        React.createElement('button', {
          type: 'button',
          disabled: props.readOnly,
          onClick: () => props.onChange('# Source draft\n'),
        }, 'source edit'),
        React.createElement('button', {
          type: 'button',
          onClick: () => props.onInsertReady(() => undefined),
        }, 'source insert ready'),
        React.createElement('button', {
          type: 'button',
          onClick: () => props.onSelectionTextReady(() => ({ text: 'selection', line: 1, surface: 'source' })),
        }, 'source selection ready'),
        React.createElement('button', {
          type: 'button',
          onClick: () => props.onCursorLineChange(7),
        }, 'source cursor'),
      );
    },
  };
});

let container: HTMLDivElement;
let root: Root;

describe('VS Code webview App protocol', () => {
  beforeEach(() => {
    webviewMocks.vscodeApi.postMessage.mockClear();
    webviewMocks.vscodeApi.getState.mockReset();
    webviewMocks.vscodeApi.getState.mockReturnValue(undefined);
    webviewMocks.vscodeApi.setState.mockClear();
    webviewMocks.flushVisualEditorState.mockReset();
    webviewMocks.flushVisualEditorState.mockReturnValue(null);
    webviewMocks.visualJump.mockClear();
    webviewMocks.sourceJump.mockClear();
    window.localStorage.clear();
    document.body.innerHTML = '';
    document.body.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-mode');
    document.documentElement.removeAttribute('data-visual-style');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    document.body.className = '';
  });

  it('announces readiness, sends pending save text, and reflects operation failures', () => {
    renderWebview();
    expect(postedMessages('ready')).toHaveLength(1);

    sendDocumentUpdate('# Original\n');
    clickButton('visual edit');
    clickButton('Save');

    const saveMessage = lastPosted('save');
    expect(saveMessage).toMatchObject({
      type: 'save',
      panelId: 'panel-1',
      pendingText: '# Visual draft\n',
      baseText: '# Original\n',
      baseVersion: 1,
    });
    expect(typeof saveMessage.editId).toBe('string');

    sendOperationResult({
      id: saveMessage.editId,
      ok: false,
      result: 'readonly',
      message: 'The Markdown file is read-only.',
    });

    expect(container.querySelector('.vscode-scie-status')?.textContent).toBe('Read-only');
    expect(container.textContent).toContain('The Markdown file is read-only.');
  });

  it('flushes pending edits when VS Code hides the webview before debounce fires', () => {
    renderWebview();
    sendDocumentUpdate('# Original\n');
    clickButton('visual edit');

    dispatchHiddenVisibilityChange();

    const replaceMessage = lastPosted('replaceDocument');
    expect(replaceMessage).toMatchObject({
      type: 'replaceDocument',
      panelId: 'panel-1',
      text: '# Visual draft\n',
      baseText: '# Original\n',
      baseVersion: 1,
    });
    expect(typeof replaceMessage.editId).toBe('string');
  });

  it('keeps read-only keyboard undo/redo commands free of pending edit payloads', () => {
    renderWebview();
    sendDocumentUpdate('# Locked\n', {
      isReadonly: true,
      readonlyReason: 'Readonly from VS Code',
    });

    dispatchKeyboard('z', { ctrlKey: true });

    const undoMessage = lastPosted('undo');
    expect(undoMessage).toMatchObject({
      type: 'undo',
      panelId: 'panel-1',
    });
    expect('pendingText' in undoMessage).toBe(false);
    expect('editId' in undoMessage).toBe(false);
    expect(container.textContent).toContain('Readonly from VS Code');
  });

  it('treats sourceEditId updates as own echoes and settles later keyboard commands against the echoed text', () => {
    renderWebview();
    sendDocumentUpdate('# Original\n');
    clickButton('Source');
    clickButton('source edit');
    clickButton('Save');

    const saveMessage = lastPosted('save');
    expect(saveMessage).toMatchObject({
      type: 'save',
      pendingText: '# Source draft\n',
      baseText: '# Original\n',
    });

    sendDocumentUpdate('# Source draft\n\n', {
      reason: 'changed',
      version: 2,
      sourceEditId: saveMessage.editId,
    });

    expect(container.querySelector('.vscode-scie-review-panel')).toBeNull();
    expect(container.querySelector('[data-testid="source-editor"]')?.textContent).toContain('# Source draft');

    dispatchKeyboard('z', { ctrlKey: true });

    const undoMessage = lastPosted('undo');
    expect(undoMessage).toMatchObject({
      type: 'undo',
      panelId: 'panel-1',
    });
    expect('pendingText' in undoMessage).toBe(false);
    expect('editId' in undoMessage).toBe(false);
  });

  it('resolves VS Code high contrast light when the webview follows the workbench theme', () => {
    document.body.classList.add('vscode-high-contrast-light');
    webviewMocks.vscodeApi.getState.mockReturnValue({
      mode: 'visual',
      themeMode: 'vscode',
      visualStyle: 'science',
    });

    renderWebview();

    expect(document.documentElement.dataset.themeMode).toBe('vscode');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('uses custom style and theme popovers and persists selected options', () => {
    webviewMocks.vscodeApi.getState.mockReturnValue({
      mode: 'visual',
      themeMode: 'dark',
      visualStyle: 'science',
    });

    renderWebview();

    expect(container.querySelector('select')).toBeNull();

    clickButtonByAriaLabel('Style: Science');
    expect(menuByLabel('Style options')).not.toBeNull();
    clickMenuItem('Style options', 'Scienfy');
    expect(menuByLabel('Style options')).toBeNull();
    expect(latestSavedState()).toMatchObject({ visualStyle: 'scienfy' });

    clickButtonByAriaLabel('Theme: Dark');
    expect(menuByLabel('Theme options')).not.toBeNull();
    clickMenuItem('Theme options', 'Sepia');
    expect(menuByLabel('Theme options')).toBeNull();
    expect(latestSavedState()).toMatchObject({ themeMode: 'sepia' });
  });

  it('closes custom popovers with Escape and outside pointer down', () => {
    renderWebview();

    clickButtonByAriaLabel('Theme: Dark');
    expect(menuByLabel('Theme options')).not.toBeNull();
    dispatchDocumentKeyboard('Escape');
    expect(menuByLabel('Theme options')).toBeNull();

    clickButtonByAriaLabel('Style: Science');
    expect(menuByLabel('Style options')).not.toBeNull();
    dispatchOutsidePointerDown();
    expect(menuByLabel('Style options')).toBeNull();
  });

  it('keeps mutation controls disabled for read-only documents while view controls remain usable', () => {
    renderWebview();
    sendDocumentUpdate('# Locked\n', {
      isReadonly: true,
      readonlyReason: 'Readonly from VS Code',
    });

    expect(buttonByAriaLabel('Save document').disabled).toBe(true);
    expect(buttonByAriaLabel('Insert note').disabled).toBe(true);
    expect(buttonByAriaLabel('Insert version').disabled).toBe(true);
    expect(buttonByAriaLabel('Style: Science').disabled).toBe(false);
    expect(buttonByAriaLabel('Theme: Dark').disabled).toBe(false);
    expect(container.querySelector('.vscode-scie-command-strip')?.textContent).not.toContain('Human');
    expect(container.querySelector('.vscode-scie-command-strip')?.textContent).not.toContain('Variable');

    clickButtonByAriaLabel('Theme: Dark');
    expect(menuByLabel('Theme options')).not.toBeNull();
  });

  it('renders structured JSON snapshots as read-only tree and source previews', () => {
    renderWebview();
    sendDocumentUpdate('{"cohort":{"n":12,"arm":"control"},"active":true}\n', {
      fileName: 'cohort.json',
      format: 'json',
      isReadonly: true,
      readonlyReason: 'Structured preview is read-only.',
    });

    expect(container.querySelector('[data-testid="structured-preview-stage"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="structured-operation-summary"]')?.textContent).toContain('Source reveal');
    expect(container.querySelector('[data-testid="structured-operation-summary"]')?.textContent).toContain('Apply clipboard replacement');
    expect(container.querySelector('[data-testid="structured-operation-summary"]')?.textContent).toContain('Opt-in');
    expect(container.querySelector('[data-testid="structured-tree-preview"]')?.textContent).toContain('cohort');
    expect(container.querySelector('[data-testid="visual-editor"]')).toBeNull();
    expect(container.querySelector('[data-testid="source-editor"]')).toBeNull();
    expect(container.textContent).toContain('JSON');
    expect(container.textContent).toContain('No errors');
    expect(container.textContent).not.toContain('Insert note');

    clickButton('Source');

    expect(container.querySelector('[data-testid="structured-source-preview"]')?.textContent).toContain('"active":true');
    expect(queryButtonByText('Save')).toBeUndefined();
  });

  it('renders JSONL, YAML, TOML, and XML structured snapshots through the shared preview model', () => {
    renderWebview();
    sendDocumentUpdate('{"id":1,"name":"Alpha"}\n{"id":2}\n', {
      fileName: 'records.jsonl',
      format: 'jsonl',
      isReadonly: true,
      readonlyReason: 'Structured preview is read-only.',
    });

    expect(container.textContent).toContain('JSON Lines');
    expect(container.textContent).toContain('2 records');
    expect(container.querySelector('[data-testid="structured-tree-preview"]')?.textContent).toContain('Alpha');
    expect(queryButtonByText('Save')).toBeUndefined();

    sendDocumentUpdate('sample:\n  name: Alpha\n', {
      fileName: 'sample.yaml',
      format: 'yaml',
      isReadonly: true,
      readonlyReason: 'Structured preview is read-only.',
      version: 2,
    });

    expect(container.textContent).toContain('YAML');
    expect(container.querySelector('[data-testid="structured-tree-preview"]')?.textContent).toContain('sample');

    sendDocumentUpdate('[sample]\nname = "Alpha"\n', {
      fileName: 'sample.toml',
      format: 'toml',
      isReadonly: true,
      readonlyReason: 'Structured preview is read-only.',
      version: 3,
    });

    expect(container.textContent).toContain('TOML');
    expect(container.querySelector('[data-testid="structured-tree-preview"]')?.textContent).toContain('Alpha');
    expect(container.querySelector('[data-testid="structured-operation-summary"]')?.textContent).toContain('source-preserving visual writes are not available');

    sendDocumentUpdate('<study><sample id="S-001">Alpha</sample></study>\n', {
      fileName: 'study.xml',
      format: 'xml',
      isReadonly: true,
      readonlyReason: 'Structured preview is read-only.',
      version: 4,
    });

    expect(container.textContent).toContain('XML');
    expect(container.querySelector('[data-testid="structured-tree-preview"]')?.textContent).toContain('sample');
  });

  it('renders quick-outline headings and marks the active heading from the current editor line', () => {
    renderWebview();
    sendDocumentUpdate('# Intro\n\n## Methods\n\n## Results\n');

    expect(container.querySelector('.quick-outline')).not.toBeNull();
    expect(container.querySelectorAll('.quick-outline-dash').length).toBeGreaterThan(0);
    expect(outlineItem('Intro').className).toContain('active');

    clickButton('visual cursor');

    expect(outlineItem('Intro').className).not.toContain('active');
    expect(outlineItem('Methods').className).toContain('active');
  });

  it('jumps from quick-outline items through the active visual or source editor path', () => {
    renderWebview();
    sendDocumentUpdate('# Intro\n\n## Methods\n\n## Results\n');

    clickOutlineItem('Methods');
    expect(webviewMocks.visualJump).toHaveBeenLastCalledWith({
      level: 2,
      text: 'Methods',
      occurrence: 0,
    });

    clickButton('Source');
    clickOutlineItem('Results');

    expect(webviewMocks.sourceJump).toHaveBeenLastCalledWith(5);
  });

  it('keeps the quick outline available with an empty-state card when no headings exist', () => {
    renderWebview();
    sendDocumentUpdate('Plain paragraph without section headings.\n');

    expect(container.querySelector('.quick-outline')).not.toBeNull();
    expect(container.querySelector('.quick-outline-empty')?.textContent).toBe('No headings');
  });

  it('opens and closes the data sidebar while persisting the state', () => {
    renderWebview();
    sendDocumentUpdate('---\nvariables:\n  cohort_n: 12\n---\n# Intro\n\nValue {{ cohort_n }}\n');

    expect(container.querySelector('.vscode-scie-data-sidebar')).toBeNull();

    clickButtonByAriaLabel('Show data sidebar');

    expect(container.querySelector('.vscode-scie-data-sidebar')).not.toBeNull();
    expect(container.querySelector('.vscode-scie-data-sidebar')?.textContent).toContain('cohort_n');
    expect(container.querySelector('.vscode-scie-content')?.getAttribute('data-data-sidebar-open')).toBe('true');
    expect(latestSavedState()).toMatchObject({
      dataSidebarOpen: true,
      dataSidebarWidth: 320,
    });

    clickButtonByAriaLabel('Close data sidebar');

    expect(container.querySelector('.vscode-scie-data-sidebar')).toBeNull();
    expect(latestSavedState()).toMatchObject({ dataSidebarOpen: false });
  });

  it('hydrates persisted data sidebar state and width controls', () => {
    webviewMocks.vscodeApi.getState.mockReturnValue({
      mode: 'visual',
      themeMode: 'dark',
      visualStyle: 'science',
      dataSidebarOpen: true,
      dataSidebarWidth: 352,
    });

    renderWebview();
    sendDocumentUpdate('---\nvariables:\n  cohort_n: 12\n---\n# Intro\n\nValue {{ cohort_n }}\n');

    expect(container.querySelector('.vscode-scie-data-sidebar')).not.toBeNull();
    expect((container.querySelector('.vscode-scie-content') as HTMLElement).style.getPropertyValue('--vscode-scie-data-sidebar-width')).toBe('352px');

    clickButtonByAriaLabel('Widen data sidebar');
    expect(latestSavedState()).toMatchObject({ dataSidebarWidth: 384 });

    clickButtonByAriaLabel('Narrow data sidebar');
    expect(latestSavedState()).toMatchObject({ dataSidebarWidth: 352 });
  });

  it('uses legacy outline sidebar state as data sidebar migration input', () => {
    webviewMocks.vscodeApi.getState.mockReturnValue({
      mode: 'visual',
      themeMode: 'dark',
      visualStyle: 'science',
      outlineSidebarOpen: true,
      outlineSidebarWidth: 344,
    });

    renderWebview();
    sendDocumentUpdate('---\nvariables:\n  cohort_n: 12\n---\n# Intro\n\nValue {{ cohort_n }}\n');

    expect(container.querySelector('.vscode-scie-data-sidebar')).not.toBeNull();
    expect((container.querySelector('.vscode-scie-content') as HTMLElement).style.getPropertyValue('--vscode-scie-data-sidebar-width')).toBe('344px');
    expect(latestSavedState()).toMatchObject({ dataSidebarOpen: true, dataSidebarWidth: 344 });
  });

  it('edits variables from the data sidebar and jumps source usage chips', () => {
    renderWebview();
    sendDocumentUpdate('---\nvariables:\n  cohort_n: 12\n---\n# Intro\n\nValue {{ cohort_n }}\n\nMissing {{ missing_value }}\n');
    clickButtonByAriaLabel('Show data sidebar');

    setInputByAriaLabel('Variable value cohort_n', '24');
    clickDataSidebarButton('Save');
    expect(container.querySelector('[data-testid="visual-editor"]')?.textContent).toContain('cohort_n: "24"');

    clickButton('Source');
    clickFirstVariableUsageChip();
    expect(webviewMocks.sourceJump).toHaveBeenLastCalledWith(expect.any(Number));

    setInputByAriaLabel('Variable value missing_value', 'alpha');
    clickDataSidebarButton('Define');
    expect(container.querySelector('[data-testid="source-editor"]')?.textContent).toContain('missing_value: alpha');
  });

  it('cancels the note dialog without changing the document', () => {
    renderWebview();
    sendDocumentUpdate('# Original\n');

    clickButtonByAriaLabel('Insert note');

    expect(dialogText()).toContain('Insert note');
    setTextAreaValue('Please tighten the abstract.');
    clickButton('Cancel');

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[data-testid="visual-editor"]')?.textContent).toContain('# Original');
    expect(container.querySelector('[data-testid="visual-editor"]')?.textContent).not.toContain('Please tighten the abstract.');
  });

  it('submits variable and text-version dialogs through the refactored modal surface', () => {
    renderWebview();
    sendDocumentUpdate('# Original\n');

    clickButtonByAriaLabel('Show data sidebar');
    clickDataSidebarButton('Insert variable');
    setFirstInputValue('sample_count');
    setInputValueAt(1, '12');
    clickButton('Create Variable');

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[data-testid="visual-editor"]')?.textContent).toContain('sample_count');

    clickButtonByAriaLabel('Close data sidebar');
    clickButtonByAriaLabel('Insert version');
    setFirstInputValue('abstract-options');
    clickButton('Insert Version');

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[data-testid="visual-editor"]')?.textContent).toContain('abstract-options');
  });

  it('renders external review cards and applies rejected disk changes without losing local edits', () => {
    renderWebview();
    sendDocumentUpdate('# Original\n');
    clickButton('visual edit');

    sendDocumentUpdate('# Original\n\nDisk addition.\n', { reason: 'changed', version: 2 });

    expect(container.querySelector('.vscode-scie-review-panel')).not.toBeNull();
    expect(container.querySelector('.vscode-scie-review-unit')).not.toBeNull();
    expect(container.querySelector('.review-unit-body')).not.toBeNull();

    clickFirstReviewRejectCheckbox();
    expect(container.querySelector('.vscode-scie-review-panel')?.textContent).toContain('0 accepted');
    expect(container.querySelector('.vscode-scie-review-panel')?.textContent).toContain('1 rejected');

    clickButton('Apply review');
    expect(container.querySelector('.vscode-scie-review-panel')).toBeNull();

    clickButton('Save');
    const saveMessage = lastPosted('save');
    expect(saveMessage.rejectedHunkIds?.length).toBeGreaterThan(0);
  });

  it('starts large external reviews collapsed so previews do not flood the webview', () => {
    const before = numberedLines('Original line', 170);
    const after = numberedLines('Changed disk line', 170);

    renderWebview();
    sendDocumentUpdate(before);
    clickButton('visual edit');
    sendDocumentUpdate(after, { reason: 'changed', version: 2 });

    expect(container.querySelector('.vscode-scie-review-large-note')?.textContent).toContain('Large external change set');
    expect(container.querySelector('.review-unit-body')).toBeNull();

    clickReviewSummary();
    expect(container.querySelector('.review-unit-body')).not.toBeNull();
  });

  it('keeps protected read-only external review mutations disabled', () => {
    const before = [
      '# Locked',
      '',
      '<!-- scie_md:lock:start reason="approved" -->',
      'Approved sentence.',
      '<!-- scie_md:lock:end -->',
      '',
    ].join('\n');
    const after = before.replace('Approved sentence.', 'Changed locked sentence.');

    renderWebview();
    sendDocumentUpdate(before, { isReadonly: true, readonlyReason: 'Readonly from VS Code' });
    sendDocumentUpdate(after, { reason: 'changed', version: 2, isReadonly: true, readonlyReason: 'Readonly from VS Code' });

    expect(container.querySelector('.vscode-scie-review-warning')?.textContent).toContain('Locked content changed');
    expect(firstReviewRejectCheckbox().checked).toBe(true);
    expect(firstReviewRejectCheckbox().disabled).toBe(true);
    expect(buttonByText('Apply review').disabled).toBe(true);
  });
});

function renderWebview(): void {
  act(() => {
    root.render(<App />);
  });
}

function sendDocumentUpdate(
  text: string,
  overrides: Partial<{
    panelId: string;
    reason: 'initial' | 'changed' | 'saved';
    version: number;
    isDirty: boolean;
    isReadonly: boolean;
    readonlyReason: string;
    sourceEditId: string | null;
    fileName: string;
    format: ScieMDDocumentSnapshot['format'];
  }> = {},
): void {
  const {
    panelId = 'panel-1',
    reason = 'initial',
    version = 1,
    isDirty = false,
    isReadonly = false,
    readonlyReason,
    sourceEditId,
    fileName = 'paper.md',
    format = 'markdown',
  } = overrides;
  const message: ExtensionToWebviewMessage = {
    type: 'documentUpdate',
    panelId,
    reason,
    sourceEditId,
      snapshot: {
        uri: 'file:///C:/docs/paper.md',
        fileName,
        format,
        text,
      version,
      isDirty,
      isReadonly,
      readonlyReason,
    },
  };
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: message }));
  });
}

function sendOperationResult(
  overrides: Partial<Extract<ExtensionToWebviewMessage, { type: 'operationResult' }>>,
): void {
  const message: ExtensionToWebviewMessage = {
    type: 'operationResult',
    panelId: 'panel-1',
    ok: true,
    result: 'applied',
    message: 'Applied.',
    ...overrides,
  };
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: message }));
  });
}

function dispatchKeyboard(key: string, init: KeyboardEventInit): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    }));
  });
}

function dispatchDocumentKeyboard(key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    }));
  });
}

function dispatchOutsidePointerDown(): void {
  act(() => {
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
  });
}

function dispatchHiddenVisibilityChange(): void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'hidden',
  });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true, cancelable: true }));
  });
  if (originalDescriptor) {
    Object.defineProperty(document, 'visibilityState', originalDescriptor);
  } else {
    delete (document as { visibilityState?: unknown }).visibilityState;
  }
}

function clickButton(label: string): void {
  const button = buttonByText(label);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function clickDataSidebarButton(label: string): void {
  const sidebar = container.querySelector('.vscode-scie-data-sidebar');
  expect(sidebar).not.toBeNull();
  const button = Array.from(sidebar?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    .find((candidate) => candidate.textContent === label);
  expect(button, `data sidebar button "${label}"`).not.toBeUndefined();
  act(() => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function buttonByText(label: string): HTMLButtonElement {
  const button = queryButtonByText(label);
  expect(button, `button "${label}"`).not.toBeUndefined();
  return button as HTMLButtonElement;
}

function queryButtonByText(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent === label);
}

function clickButtonByAriaLabel(label: string): void {
  const button = buttonByAriaLabel(label);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
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

function clickMenuItem(menuLabel: string, itemLabel: string): void {
  const menu = menuByLabel(menuLabel);
  expect(menu, `menu "${menuLabel}"`).not.toBeNull();
  const button = Array.from(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    .find((candidate) => candidate.textContent?.includes(itemLabel));
  expect(button, `menu item "${itemLabel}"`).not.toBeUndefined();
  act(() => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function outlineItem(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('.quick-outline-item'))
    .find((candidate) => candidate.textContent?.includes(label));
  expect(button, `quick outline item "${label}"`).not.toBeUndefined();
  return button as HTMLButtonElement;
}

function clickOutlineItem(label: string): void {
  const button = outlineItem(label);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function dialogText(): string {
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  return dialog?.textContent ?? '';
}

function setTextAreaValue(value: string): void {
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea');
  expect(textarea).not.toBeNull();
  setControlValue(textarea as HTMLTextAreaElement, value);
}

function setFirstInputValue(value: string): void {
  setInputValueAt(0, value);
}

function setInputValueAt(index: number, value: string): void {
  const input = container.querySelectorAll<HTMLInputElement>('input')[index];
  expect(input, `input ${index}`).not.toBeUndefined();
  setControlValue(input, value);
}

function setInputByAriaLabel(label: string, value: string): void {
  const input = Array.from(container.querySelectorAll<HTMLInputElement>('input'))
    .find((candidate) => candidate.getAttribute('aria-label') === label);
  expect(input, `input aria-label "${label}"`).not.toBeUndefined();
  setControlValue(input as HTMLInputElement, value);
}

function clickFirstVariableUsageChip(): void {
  const button = container.querySelector<HTMLButtonElement>('.vscode-scie-variable-usage-chips button');
  expect(button).not.toBeNull();
  act(() => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function setControlValue(control: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = control instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  act(() => {
    valueSetter?.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  });
}

function firstReviewRejectCheckbox(): HTMLInputElement {
  const checkbox = container.querySelector<HTMLInputElement>('.vscode-scie-review-selector input[type="checkbox"]');
  expect(checkbox).not.toBeNull();
  return checkbox as HTMLInputElement;
}

function clickFirstReviewRejectCheckbox(): void {
  const checkbox = firstReviewRejectCheckbox();
  act(() => {
    checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function clickReviewSummary(): void {
  const button = container.querySelector<HTMLButtonElement>('.vscode-scie-review-summary');
  expect(button).not.toBeNull();
  act(() => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function numberedLines(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join('\n');
}

function latestSavedState(): unknown {
  const calls = webviewMocks.vscodeApi.setState.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls.at(-1)?.[0];
}

function postedMessages(type: WebviewToExtensionMessage['type']): WebviewToExtensionMessage[] {
  return webviewMocks.vscodeApi.postMessage.mock.calls
    .map((call) => call[0] as WebviewToExtensionMessage)
    .filter((message) => message.type === type);
}

function lastPosted<T extends WebviewToExtensionMessage['type']>(
  type: T,
): Extract<WebviewToExtensionMessage, { type: T }> {
  const messages = postedMessages(type);
  expect(messages.length, `posted message type ${type}`).toBeGreaterThan(0);
  return messages.at(-1) as Extract<WebviewToExtensionMessage, { type: T }>;
}
