import { act, type ComponentProps } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedScienfyDocument } from '../domain/document/documentModel';
import { NavigationSidebar } from './NavigationSidebar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

describe('NavigationSidebar', () => {
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

function renderSidebar(overrides: Partial<ComponentProps<typeof NavigationSidebar>> = {}) {
  const props: ComponentProps<typeof NavigationSidebar> = {
    view: 'outline',
    width: 360,
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
