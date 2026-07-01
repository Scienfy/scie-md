import { act, type ComponentProps } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { safeParseScienfyDocument } from '@sciemd/core';
import { DEFAULT_METADATA } from '../app/documentState';
import { formatCapabilitiesFor } from '../app/formatCapabilities';
import { parseSourceFormatDiagnostics } from '../app/formatDiagnostics';
import { InspectorPane, type InspectorPaneData } from './InspectorPane';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let writeClipboardText: ReturnType<typeof vi.fn>;

describe('InspectorPane', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    writeClipboardText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: writeClipboardText,
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  it('shows validation issue context actions for line jump and diagnostics copy', async () => {
    const onJumpToLine = vi.fn();
    renderInspector({
      data: {
        ...baseInspectorData(),
        validationIssues: [
          {
            severity: 'warning',
            code: 'citation-missing',
            message: 'Citation @missing is unresolved (line 27).',
          },
          {
            severity: 'error',
            code: 'conflict-marker',
            message: 'Unresolved conflict markers are present.',
          },
        ],
      },
      actions: {
        ...baseInspectorActions(),
        onJumpToLine,
      },
    });

    const validationIssue = requiredElement<HTMLLIElement>('.inspector-list .warning');
    openContextMenu(validationIssue);
    expect(document.querySelector('[role="menu"][aria-label="Actions for warning validation issue"]')).not.toBeNull();

    await clickContextMenuItem('Jump to line');
    expect(onJumpToLine).toHaveBeenCalledWith(27);

    openContextMenu(validationIssue);
    await clickContextMenuItem('Copy issue');
    expect(writeClipboardText).toHaveBeenLastCalledWith(
      'WARNING citation-missing - Line 27 - Citation @missing is unresolved (line 27).',
    );

    openContextMenu(validationIssue);
    await clickContextMenuItem('More copy options');
    await clickContextMenuItem('Copy diagnostics summary');
    expect(writeClipboardText.mock.calls.at(-1)?.[0]).toContain('ERROR conflict-marker');
  });

  it('opens validation issue menus from the keyboard and restores issue focus on close', async () => {
    renderInspector({
      data: {
        ...baseInspectorData(),
        validationIssues: [
          {
            severity: 'warning',
            code: 'citation-missing',
            message: 'Citation @missing is unresolved (line 27).',
          },
        ],
      },
    });

    const validationIssue = requiredElement<HTMLLIElement>('.inspector-list .warning');
    openKeyboardContextMenu(validationIssue);

    expect(document.querySelector('[role="menu"][aria-label="Actions for warning validation issue"]')).not.toBeNull();

    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await nextAnimationFrame();
    });

    expect(document.querySelector('.context-menu-card')).toBeNull();
    expect(document.activeElement).toBe(validationIssue);
  });

  it('shows structured health warning and preview context actions with copy feedback', async () => {
    const onCopyFeedback = vi.fn();
    const diagnostics = parseSourceFormatDiagnostics('yaml', 'name: Alpha # source-only comment\n', 'C:\\lab\\config.yaml');
    expect(diagnostics.structuredAnalysis).not.toBeNull();
    renderInspector({
      data: {
        ...baseInspectorData(),
        formatCapabilities: formatCapabilitiesFor('yaml'),
        filePath: 'C:\\lab\\config.yaml',
        structuredAnalysis: diagnostics.structuredAnalysis,
      },
      actions: {
        ...baseInspectorActions(),
        onCopyFeedback,
      },
    });

    const warning = requiredElement<HTMLLIElement>('.json-health-subsection .inspector-list .warning');
    openContextMenu(warning);
    await clickContextMenuItem('Copy');
    await clickContextMenuItem('Copy warning');
    expect(writeClipboardText.mock.calls.at(-1)?.[0]).toContain('WARNING yaml-comments-readonly');
    expect(onCopyFeedback).toHaveBeenLastCalledWith('Copy warning copied.', 'success');

    const previewButton = buttonByText('Copy JSON preview');
    openContextMenu(previewButton);
    await clickContextMenuItem('Copy');
    await clickContextMenuItem('Copy JSON preview');
    expect(writeClipboardText.mock.calls.at(-1)?.[0]).toContain('"name": "Alpha"');
  });

  it('shows structured context actions for JSON without Markdown LLM controls', () => {
    const diagnostics = parseSourceFormatDiagnostics('json', '{"study":{"id":"S-001"}}\n', 'C:\\lab\\study.json');
    const onCopyStructuredContext = vi.fn();
    const onCopySelectedStructureContext = vi.fn();
    const onCopySchemaAwareJsonContext = vi.fn();
    const onCopyParserDiagnostics = vi.fn();
    renderInspector({
      data: {
        ...baseInspectorData(),
        formatCapabilities: formatCapabilitiesFor('json'),
        filePath: 'C:\\lab\\study.json',
        jsonAnalysis: diagnostics.jsonAnalysis,
        selectedJsonPath: '$.study.id',
        structuredContextAvailable: true,
        structuredPasteBackValidationAvailable: true,
      },
      actions: {
        ...baseInspectorActions(),
        onCopyStructuredContext,
        onCopySelectedStructureContext,
        onCopySchemaAwareJsonContext,
        onCopyParserDiagnostics,
      },
    });

    expect(container.textContent).toContain('Structured context');
    expect(container.textContent).toContain('Local copy/export only');
    expect(container.textContent).toContain('Copy structured context');
    expect(container.textContent).toContain('Copy selected path context');
    expect(container.textContent).toContain('Copy schema-aware JSON context');
    expect(container.textContent).toContain('Copy parser diagnostics');
    expect(container.textContent).not.toContain('LLM markers');

    act(() => buttonByText('Copy structured context').click());
    act(() => buttonByText('Copy selected path context').click());
    act(() => buttonByText('Copy schema-aware JSON context').click());
    act(() => buttonByText('Copy parser diagnostics').click());

    expect(onCopyStructuredContext).toHaveBeenCalledTimes(1);
    expect(onCopySelectedStructureContext).toHaveBeenCalledTimes(1);
    expect(onCopySchemaAwareJsonContext).toHaveBeenCalledTimes(1);
    expect(onCopyParserDiagnostics).toHaveBeenCalledTimes(1);
  });

  it('shows table sample context for CSV without JSON schema context', () => {
    const diagnostics = parseSourceFormatDiagnostics('csv', 'id,count\n001,12\n', 'C:\\lab\\table.csv');
    const onCopyStructuredTableSample = vi.fn();
    renderInspector({
      data: {
        ...baseInspectorData(),
        formatCapabilities: formatCapabilitiesFor('csv'),
        filePath: 'C:\\lab\\table.csv',
        tabularAnalysis: diagnostics.tabularAnalysis,
        structuredContextAvailable: true,
        structuredTableSampleAvailable: true,
        structuredPasteBackValidationAvailable: true,
      },
      actions: {
        ...baseInspectorActions(),
        onCopyStructuredTableSample,
      },
    });

    expect(container.textContent).toContain('Copy table sample');
    expect(container.textContent).not.toContain('Copy schema-aware JSON context');

    act(() => buttonByText('Copy table sample').click());
    expect(onCopyStructuredTableSample).toHaveBeenCalledTimes(1);
  });

  it('shows the structured edit journal and jumps to edited source lines', () => {
    const onJumpToLine = vi.fn();
    renderInspector({
      data: {
        ...baseInspectorData(),
        structuredEditJournal: [
          {
            id: 'json:replaceScalar:test',
            format: 'json',
            operationLabel: 'Edit JSON value',
            targetLabel: '$.study.title',
            previewLabel: 'Updated $.study.title.',
            riskLabel: 'Replace source range',
            appliedAt: new Date('2026-07-01T10:00:00Z').getTime(),
            line: 12,
            column: 7,
          },
        ],
      },
      actions: {
        ...baseInspectorActions(),
        onJumpToLine,
      },
    });

    expect(container.textContent).toContain('Structured edits');
    expect(container.textContent).toContain('Edit JSON value');
    expect(container.textContent).toContain('$.study.title');
    act(() => {
      buttonByText('Edit JSON value').click();
    });
    expect(onJumpToLine).toHaveBeenCalledWith(12);
  });

  it('shows metadata path and recent file context actions', async () => {
    const onOpenRecent = vi.fn();
    const onCopyFeedback = vi.fn();
    renderInspector({
      data: {
        ...baseInspectorData(),
        recentPreviews: [
          {
            path: 'C:\\lab\\previous.md',
            name: 'previous.md',
            heading: 'Previous study',
            excerpt: 'Recent preview excerpt.',
          },
        ],
      },
      actions: {
        ...baseInspectorActions(),
        onOpenRecent,
        onCopyFeedback,
      },
    });

    toggleInspectorSection('File details');
    const pathValue = elementByAriaLabel<HTMLElement>('File path C:\\lab\\paper.md');
    openContextMenu(pathValue);
    await clickContextMenuItem('Copy');
    await clickContextMenuItem('Copy filename');
    expect(writeClipboardText).toHaveBeenLastCalledWith('paper.md');
    expect(onCopyFeedback).toHaveBeenLastCalledWith('Copy filename copied.', 'success');

    toggleInspectorSection('Recent files');
    const recentButton = buttonByText('Previous study');
    openContextMenu(recentButton);
    await clickContextMenuItem('Open recent file');
    expect(onOpenRecent).toHaveBeenCalledWith('C:\\lab\\previous.md');

    openContextMenu(recentButton);
    await clickContextMenuItem('Copy');
    await clickContextMenuItem('Copy excerpt');
    expect(writeClipboardText).toHaveBeenLastCalledWith('Recent preview excerpt.');
  });
});

function renderInspector(overrides: Partial<ComponentProps<typeof InspectorPane>> = {}) {
  const props: ComponentProps<typeof InspectorPane> = {
    open: true,
    focusSection: null,
    data: baseInspectorData(),
    actions: baseInspectorActions(),
    ...overrides,
  };

  act(() => {
    root.render(<InspectorPane {...props} />);
  });
}

function baseInspectorData(): InspectorPaneData {
  const parsed = safeParseScienfyDocument('# Test document\n\nBody text.');
  return {
    formatCapabilities: formatCapabilitiesFor('markdown'),
    filePath: 'C:\\lab\\paper.md',
    mode: 'visual',
    metadata: DEFAULT_METADATA,
    validationIssues: [],
    insights: {
      firstHeading: 'Test document',
      excerpt: 'Body text.',
      codeBlockCount: 0,
      imageReferences: [],
      longestLineLength: 10,
      tableCount: 0,
      taskCount: 0,
    },
    recentPreviews: [],
    authorshipMarks: [],
    authorshipVisible: false,
    missingImageCount: 0,
    autosaveStatus: 'saved',
    protectedBlocks: [],
    editorComments: [],
    targetedInstructions: [],
    variantGroups: [],
    visualStyle: 'scienfy',
    visualStyleLabel: 'Scienfy',
    documentType: 'report',
    hasPasteReview: false,
    layerTwoDocument: parsed,
    manuscriptReadiness: {
      score: 100,
      status: 'ready',
      summary: 'Ready',
      items: [],
      counts: {
        headings: 1,
        citations: 0,
        labels: 0,
        figures: 0,
        tables: 0,
        missingImages: 0,
        unresolvedCitations: 0,
        unresolvedReferences: 0,
        missingVariables: 0,
      },
    },
    bibliographyLoading: false,
    inkscapePath: null,
  };
}

function baseInspectorActions(): ComponentProps<typeof InspectorPane>['actions'] {
  return {
    onClose: vi.fn(),
    onOpenPasteReview: vi.fn(),
    onGenerateSubmissionReadiness: vi.fn(),
    onToggleAuthorship: vi.fn(),
    onOpenRecent: vi.fn(),
    onReloadBibliography: vi.fn(),
    onCheckInkscape: vi.fn(),
    onSetInkscapePath: vi.fn(),
    onJumpToLine: vi.fn(),
    onSelectJsonSchema: vi.fn(),
    onClearJsonSchema: vi.fn(),
    onSelectJsonPath: vi.fn(),
  };
}

function requiredElement<T extends Element>(selector: string): T {
  const element = container.querySelector<T>(selector);
  expect(element).not.toBeNull();
  return element as T;
}

function openContextMenu(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 180,
      clientY: 120,
      button: 2,
    }));
  });
}

function openKeyboardContextMenu(element: HTMLElement) {
  act(() => {
    element.focus();
    element.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'F10',
      shiftKey: true,
    }));
  });
}

function contextMenuItem(label: string): HTMLButtonElement {
  const item = Array.from(document.querySelectorAll<HTMLButtonElement>('.context-menu-item'))
    .find((candidate) => candidate.querySelector('.context-menu-label')?.textContent === label);
  expect(item).toBeTruthy();
  return item as HTMLButtonElement;
}

function clickContextMenuItem(label: string) {
  const item = contextMenuItem(label);
  return act(async () => {
    item.click();
    await Promise.resolve();
  });
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent?.includes(text));
  expect(button, `button containing "${text}"`).not.toBeUndefined();
  return button as HTMLButtonElement;
}

function toggleInspectorSection(title: string): void {
  const header = Array.from(container.querySelectorAll<HTMLButtonElement>('.inspector-collapsible-header'))
    .find((candidate) => candidate.textContent?.includes(title));
  expect(header, `section "${title}"`).not.toBeUndefined();
  act(() => {
    header?.click();
  });
}

function elementByAriaLabel<T extends HTMLElement>(label: string): T {
  const element = Array.from(container.querySelectorAll<T>('[aria-label]'))
    .find((candidate) => candidate.getAttribute('aria-label') === label);
  expect(element, `element aria-label "${label}"`).not.toBeUndefined();
  return element as T;
}
