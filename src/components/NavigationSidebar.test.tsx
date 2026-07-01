import { act, type ComponentProps } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedScienfyDocument } from '@sciemd/core';
import { NavigationSidebar } from './NavigationSidebar';
import { formatCapabilitiesFor } from '../app/formatCapabilities';
import { parseSourceFormatDiagnostics } from '../app/formatDiagnostics';
import { createStructuredNavigationIndex } from '../app/structuredNavigation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let writeClipboardText: ReturnType<typeof vi.fn>;

describe('NavigationSidebar', () => {
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

  it('keeps tabs, close, and resize controls reachable while Data is active', () => {
    const onViewChange = vi.fn();
    const onClose = vi.fn();
    const onResize = vi.fn();
    const onResizeCommit = vi.fn();

    renderSidebar({
      view: 'data',
      onViewChange,
      onClose,
      onResize,
      onResizeCommit,
    });

    container.querySelector<HTMLButtonElement>('#sidebar-tab-references')?.click();
    container.querySelector<HTMLButtonElement>('#sidebar-tab-outline')?.click();
    container.querySelector<HTMLButtonElement>('.sidebar-close-button')?.click();

    expect(onViewChange).toHaveBeenCalledWith('references');
    expect(onViewChange).toHaveBeenCalledWith('outline');
    expect(onClose).toHaveBeenCalledTimes(1);

    const resizeHandle = container.querySelector<HTMLElement>('.sidebar-resize-handle');
    expect(resizeHandle?.getAttribute('role')).toBe('separator');
    expect(resizeHandle?.getAttribute('aria-valuenow')).toBe('360');
  });

  it('renders sidebar tabs in file, outline, data, refs order', () => {
    renderSidebar();

    const labels = Array.from(container.querySelectorAll('.sidebar-tabs [role="tab"]'))
      .map((tab) => tab.textContent?.trim());

    expect(labels).toEqual(['Files', 'Outline', 'Data', 'Refs']);
  });

  it('falls back to Files and hides manuscript tabs for source-only formats', () => {
    renderSidebar({
      view: 'references',
      formatCapabilities: formatCapabilitiesFor('plainText'),
    });

    const labels = Array.from(container.querySelectorAll('.sidebar-tabs [role="tab"]'))
      .map((tab) => tab.textContent?.trim());

    expect(labels).toEqual(['Files']);
    expect(container.querySelector('#sidebar-panel-files')).not.toBeNull();
    expect(container.querySelector('#sidebar-tab-references')).toBeNull();
    expect(container.querySelector('#sidebar-tab-data')).toBeNull();
    expect(container.querySelector('#sidebar-tab-outline')).toBeNull();
  });

  it('renders structured navigation in the outline slot for structured formats', () => {
    const onNavigate = vi.fn();
    const diagnostics = parseSourceFormatDiagnostics('json', '{"study":{"id":"S-001"}}', null);
    const index = createStructuredNavigationIndex({
      format: 'json',
      diagnostics: diagnostics.diagnostics,
      jsonAnalysis: diagnostics.jsonAnalysis,
    });

    renderSidebar({
      view: 'outline',
      formatCapabilities: formatCapabilitiesFor('json'),
      structuredNavigation: {
        index,
        activeTargetKey: 'json:path:$.study',
        onNavigate,
      },
    });

    const labels = Array.from(container.querySelectorAll('.sidebar-tabs [role="tab"]'))
      .map((tab) => tab.textContent?.trim());
    expect(labels).toEqual(['Files', 'Struct']);
    expect(container.querySelector('.outline-header')?.textContent).toContain('JSON structure');
    expect(container.querySelector('.structured-navigation-item.active')?.textContent).toContain('study');

    const studyItem = Array.from(container.querySelectorAll<HTMLButtonElement>('.structured-navigation-item'))
      .find((item) => item.textContent?.includes('study'));
    expect(studyItem).toBeTruthy();
    studyItem?.click();
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({
      path: '$.study',
    }));
  });

  it('filters structured navigation by path, row, field, or diagnostic text', () => {
    const diagnostics = parseSourceFormatDiagnostics('jsonl', '{"id":1}\nnot json\n', null);
    const index = createStructuredNavigationIndex({
      format: 'jsonl',
      diagnostics: diagnostics.diagnostics,
      jsonlAnalysis: diagnostics.jsonlAnalysis,
    });

    renderSidebar({
      view: 'outline',
      formatCapabilities: formatCapabilitiesFor('jsonl'),
      structuredNavigation: {
        index,
        activeTargetKey: null,
        onNavigate: vi.fn(),
      },
    });

    const input = requiredElement<HTMLInputElement>('.structured-navigation-search');
    act(() => {
      setInputValue(input, 'not json');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const items = Array.from(container.querySelectorAll('.structured-navigation-item'));
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.some((item) => item.textContent?.includes('Invalid line 2'))).toBe(true);
    expect(items.some((item) => item.textContent?.includes('Record 1'))).toBe(false);
  });

  it('renders structured explorer entries as readable documents', () => {
    const onOpenEntry = vi.fn();
    renderSidebar({
      view: 'files',
      explorer: {
        path: null,
        entries: [
          {
            name: 'results.json',
            path: 'C:\\lab\\results.json',
            kind: 'json',
            sizeBytes: 12,
            modifiedMs: 1,
          },
          {
            name: 'records.jsonl',
            path: 'C:\\lab\\records.jsonl',
            kind: 'jsonl',
            sizeBytes: 18,
            modifiedMs: 2,
          },
          {
            name: 'config.yaml',
            path: 'C:\\lab\\config.yaml',
            kind: 'yaml',
            sizeBytes: 20,
            modifiedMs: 3,
          },
          {
            name: 'settings.toml',
            path: 'C:\\lab\\settings.toml',
            kind: 'toml',
            sizeBytes: 24,
            modifiedMs: 4,
          },
          {
            name: 'samples.csv',
            path: 'C:\\lab\\samples.csv',
            kind: 'csv',
            sizeBytes: 32,
            modifiedMs: 5,
          },
          {
            name: 'samples.tsv',
            path: 'C:\\lab\\samples.tsv',
            kind: 'tsv',
            sizeBytes: 36,
            modifiedMs: 6,
          },
          {
            name: 'notes.txt',
            path: 'C:\\lab\\notes.txt',
            kind: 'plainText',
            sizeBytes: 8,
            modifiedMs: 7,
          },
        ],
        selectedImage: null,
        loading: false,
        error: null,
        onChooseFolder: vi.fn(),
        onOpenPath: vi.fn(),
        onOpenEntry,
      },
    });

    expect(container.querySelector('.explorer-path')?.textContent).toBe('Choose a folder to browse readable documents.');
    expect(container.querySelector('.explorer-item.json')?.textContent).toContain('results.json');
    expect(container.querySelector('.explorer-item.jsonl')?.textContent).toContain('records.jsonl');
    expect(container.querySelector('.explorer-item.yaml')?.textContent).toContain('config.yaml');
    expect(container.querySelector('.explorer-item.toml')?.textContent).toContain('settings.toml');
    expect(container.querySelector('.explorer-item.csv')?.textContent).toContain('samples.csv');
    expect(container.querySelector('.explorer-item.tsv')?.textContent).toContain('samples.tsv');
    expect(container.querySelector('.explorer-item.plainText')?.textContent).toContain('notes.txt');
    container.querySelector<HTMLButtonElement>('.explorer-item.csv')?.click();
    expect(onOpenEntry).toHaveBeenCalledWith(expect.objectContaining({
      path: 'C:\\lab\\samples.csv',
      kind: 'csv',
    }));
  });

  it('shows file explorer context actions for open, copy, and parent navigation', async () => {
    const onOpenEntry = vi.fn();
    const onOpenPath = vi.fn();
    renderSidebar({
      view: 'files',
      explorer: {
        path: 'C:\\lab',
        entries: [
          {
            name: 'samples.csv',
            path: 'C:\\lab\\samples.csv',
            kind: 'csv',
            sizeBytes: 32,
            modifiedMs: 5,
          },
        ],
        selectedImage: null,
        loading: false,
        error: null,
        onChooseFolder: vi.fn(),
        onOpenPath,
        onOpenEntry,
      },
    });

    const fileItem = requiredElement<HTMLButtonElement>('.explorer-item.csv');
    openContextMenu(fileItem);
    expect(document.querySelector('[role="menu"][aria-label="Actions for samples.csv"]')).not.toBeNull();

    await clickContextMenuItem('Open file');
    expect(onOpenEntry).toHaveBeenCalledWith(expect.objectContaining({ path: 'C:\\lab\\samples.csv' }));

    openContextMenu(fileItem);
    await clickContextMenuItem('Copy');
    await clickContextMenuItem('Copy path');
    expect(writeClipboardText).toHaveBeenLastCalledWith('C:\\lab\\samples.csv');

    openContextMenu(fileItem);
    await clickContextMenuItem('Open parent folder');
    expect(onOpenPath).toHaveBeenCalledWith('C:\\lab');
  });

  it('shows explorer path and image preview context actions with copy feedback', async () => {
    const onOpenPath = vi.fn();
    const onCopyFeedback = vi.fn();
    renderSidebar({
      view: 'files',
      onCopyFeedback,
      explorer: {
        path: 'C:\\lab\\project',
        entries: [],
        selectedImage: 'C:\\lab\\project\\figure.png',
        loading: false,
        error: null,
        onChooseFolder: vi.fn(),
        onOpenPath,
        onOpenEntry: vi.fn(),
      },
    });

    const explorerPath = requiredElement<HTMLDivElement>('.explorer-path');
    openContextMenu(explorerPath);
    await clickContextMenuItem('Open parent folder');
    expect(onOpenPath).toHaveBeenCalledWith('C:\\lab');

    openContextMenu(explorerPath);
    await clickContextMenuItem('Copy');
    await clickContextMenuItem('Copy folder name');
    expect(writeClipboardText).toHaveBeenLastCalledWith('project');
    expect(onCopyFeedback).toHaveBeenLastCalledWith('Copy folder name copied.', 'success');

    const imagePreview = requiredElement<HTMLDivElement>('.explorer-image-preview');
    openContextMenu(imagePreview);
    await clickContextMenuItem('Copy');
    await clickContextMenuItem('Copy image path');
    expect(writeClipboardText).toHaveBeenLastCalledWith('C:\\lab\\project\\figure.png');
  });

  it('shows outline context actions for jump and copy', async () => {
    const onJump = vi.fn();
    renderSidebar({
      view: 'outline',
      outline: {
        headings: [
          {
            id: 'methods',
            level: 2,
            text: 'Methods',
            line: 14,
          },
        ],
        activeHeadingId: null,
        onJump,
        onInsertHeading: vi.fn(),
      },
    });

    const headingItem = requiredElement<HTMLButtonElement>('.outline-item');
    openContextMenu(headingItem);
    await clickContextMenuItem('Jump to heading');
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ id: 'methods', line: 14 }));

    openContextMenu(headingItem);
    await clickContextMenuItem('Copy');
    await clickContextMenuItem('Copy heading text');
    expect(writeClipboardText).toHaveBeenLastCalledWith('Methods');
  });

  it('opens sidebar item context menus from the keyboard and restores item focus on close', async () => {
    renderSidebar({
      view: 'outline',
      outline: {
        headings: [
          {
            id: 'methods',
            level: 2,
            text: 'Methods',
            line: 14,
          },
        ],
        activeHeadingId: null,
        onJump: vi.fn(),
        onInsertHeading: vi.fn(),
      },
    });

    const headingItem = requiredElement<HTMLButtonElement>('.outline-item');
    openKeyboardContextMenu(headingItem);

    expect(document.querySelector('[role="menu"][aria-label="Actions for heading Methods"]')).not.toBeNull();

    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await nextAnimationFrame();
    });

    expect(document.querySelector('.context-menu-card')).toBeNull();
    expect(document.activeElement).toBe(headingItem);
  });

  it('shows variable context actions without replacing native input menus', async () => {
    const onSelectVariable = vi.fn();
    renderSidebar({
      view: 'data',
      onSelectVariable,
    });

    const variableRow = requiredElement<HTMLDivElement>('.variable-editor-row');
    openContextMenu(variableRow);
    await clickContextMenuItem('Edit variable');
    expect(onSelectVariable).toHaveBeenCalledWith('hands_on_reduction');

    openContextMenu(variableRow);
    await clickContextMenuItem('Copy');
    await clickContextMenuItem('Copy variable token');
    expect(writeClipboardText).toHaveBeenLastCalledWith('{{ hands_on_reduction }}');

    const variableInput = requiredElement<HTMLInputElement>('input[aria-label="Variable value hands_on_reduction"]');
    openContextMenu(variableInput);
    expect(document.querySelector('[role="menu"][aria-label="Actions for variable hands_on_reduction"]')).toBeNull();
  });

  it('shows reference context actions for citations and labels', async () => {
    const onJumpToLine = vi.fn();
    renderSidebar({
      view: 'references',
      onJumpToLine,
      layerTwoDocument: {
        ...minimalDocument(),
        citations: {
          bibliographyFiles: ['C:\\lab\\refs.bib'],
          bibtexKeys: ['smith2020'],
          missingKeys: [],
          usages: [
            {
              key: 'smith2020',
              line: 42,
              from: 120,
              to: 132,
            },
          ],
          bibtexEntries: [
            {
              type: 'article',
              key: 'smith2020',
              fields: {
                title: '{A reference title}',
                author: 'Smith and Doe',
                year: '2020',
                journal: 'Journal of Tests',
              },
            },
          ],
        },
        references: {
          labels: [
            {
              id: 'fig:workflow',
              line: 55,
              kind: 'figure',
            },
          ],
        },
      } as unknown as ParsedScienfyDocument,
    });

    const citationItem = requiredElement<HTMLButtonElement>('.citation-item');
    openContextMenu(citationItem);
    await clickContextMenuItem('Jump to citation line');
    expect(onJumpToLine).toHaveBeenCalledWith(42);

    openContextMenu(citationItem);
    await clickContextMenuItem('Copy');
    await clickContextMenuItem('Copy formatted citation');
    expect(writeClipboardText.mock.calls.at(-1)?.[0]).toContain('A reference title');

    const labelItem = requiredElement<HTMLButtonElement>('.explorer-item.markdown');
    openContextMenu(labelItem);
    await clickContextMenuItem('Jump to label line');
    expect(onJumpToLine).toHaveBeenCalledWith(55);
  });

  it('cleans up resize state when pointer cancellation is received', () => {
    const onResizeCommit = vi.fn();
    renderSidebar({ onResizeCommit });
    const resizeHandle = container.querySelector<HTMLElement>('.sidebar-resize-handle');
    expect(resizeHandle).not.toBeNull();

    act(() => {
      resizeHandle?.dispatchEvent(new MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 100,
      }));
    });
    expect(document.documentElement.classList.contains('resizing-navigation-sidebar')).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('pointercancel'));
    });
    expect(document.documentElement.classList.contains('resizing-navigation-sidebar')).toBe(false);
    expect(onResizeCommit).toHaveBeenCalledWith(360);
  });
});

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
      clientX: 160,
      clientY: 96,
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
      key: 'ContextMenu',
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

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function renderSidebar(overrides: Partial<ComponentProps<typeof NavigationSidebar>> = {}) {
  const props: ComponentProps<typeof NavigationSidebar> = {
    view: 'outline',
    width: 360,
    formatCapabilities: formatCapabilitiesFor('markdown'),
    outline: {
      headings: [],
      activeHeadingId: null,
      onJump: vi.fn(),
      onInsertHeading: vi.fn(),
    },
    explorer: {
      path: null,
      entries: [],
      selectedImage: null,
      loading: false,
      error: null,
      onChooseFolder: vi.fn(),
      onOpenPath: vi.fn(),
      onOpenEntry: vi.fn(),
    },
    layerTwoDocument: minimalDocument(),
    bibliographyLoading: false,
    onViewChange: vi.fn(),
    onJumpToLine: vi.fn(),
    onReloadBibliography: vi.fn(),
    onManageCitations: vi.fn(),
    onInsertVariable: vi.fn(),
    onLinkVariableFile: vi.fn(),
    onEditVariable: vi.fn(),
    selectedVariableName: 'hands_on_reduction',
    onSelectVariable: vi.fn(),
    onResize: vi.fn(),
    onResizeCommit: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };

  act(() => {
    root.render(<NavigationSidebar {...props} />);
  });
}

function minimalDocument(): ParsedScienfyDocument {
  return {
    variableFiles: [],
    citations: {
      bibliographyFiles: [],
      bibtexEntries: [],
      bibtexKeys: [],
      missingKeys: [],
      usages: [],
    },
    references: {
      labels: [],
    },
    variables: {
      missingVariables: [],
      definitions: [
        {
          name: 'hands_on_reduction',
          value: '85_test',
          source: 'frontmatter',
        },
      ],
      usages: [
        {
          name: 'hands_on_reduction',
          raw: '{{ hands_on_reduction }}',
          line: 61,
          from: 120,
          to: 144,
        },
      ],
    },
  } as unknown as ParsedScienfyDocument;
}
