import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSidebar } from './AppSidebar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../components/NavigationSidebar', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    NavigationSidebar: (props: {
      view: string;
      width: number;
      selectedVariableName?: string | null;
      onViewChange: (view: string) => void;
      onJumpToLine: (line: number) => void;
      onReloadBibliography: () => void;
      onManageCitations: () => void;
      onInsertVariable: () => void;
      onLinkVariableFile: () => void;
      onEditVariable: (name: string) => void;
      onSelectVariable: (name: string) => void;
      onResize: (width: number) => void;
      onResizeCommit: (width: number) => void;
      onClose: () => void;
    }) => React.createElement(
      'aside',
      {
        'data-testid': 'navigation-sidebar',
        'data-view': props.view,
        'data-width': String(props.width),
        'data-selected-variable': props.selectedVariableName ?? '',
      },
      React.createElement('button', { type: 'button', onClick: () => props.onViewChange('data') }, 'view data'),
      React.createElement('button', { type: 'button', onClick: () => props.onJumpToLine(9) }, 'jump'),
      React.createElement('button', { type: 'button', onClick: props.onReloadBibliography }, 'reload bibliography'),
      React.createElement('button', { type: 'button', onClick: props.onManageCitations }, 'manage citations'),
      React.createElement('button', { type: 'button', onClick: props.onInsertVariable }, 'insert variable'),
      React.createElement('button', { type: 'button', onClick: props.onLinkVariableFile }, 'link variable file'),
      React.createElement('button', { type: 'button', onClick: () => props.onEditVariable('alpha') }, 'edit variable'),
      React.createElement('button', { type: 'button', onClick: () => props.onSelectVariable('alpha') }, 'select variable'),
      React.createElement('button', { type: 'button', onClick: () => props.onResize(420) }, 'resize'),
      React.createElement('button', { type: 'button', onClick: () => props.onResizeCommit(420) }, 'resize commit'),
      React.createElement('button', { type: 'button', onClick: props.onClose }, 'close'),
    ),
  };
});

let container: HTMLDivElement;
let root: Root;

describe('AppSidebar', () => {
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

  it('renders a compact open button when the sidebar is closed', () => {
    const onOpen = vi.fn();

    renderSidebar(createProps({ open: false, onOpen }));

    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Open navigation sidebar"]');
    expect(button).not.toBeNull();
    expect(button?.className).toBe('sidebar-open-button');

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="navigation-sidebar"]')).toBeNull();
  });

  it('passes navigation state and actions through to the full sidebar', () => {
    const props = createProps({
      view: 'references',
      width: 384,
      selectedVariableName: 'alpha',
      onViewChange: vi.fn(),
      onJumpToLine: vi.fn(),
      onReloadBibliography: vi.fn(),
      onManageCitations: vi.fn(),
      onInsertVariable: vi.fn(),
      onLinkVariableFile: vi.fn(),
      onEditVariable: vi.fn(),
      onSelectVariable: vi.fn(),
      onResize: vi.fn(),
      onResizeCommit: vi.fn(),
      onClose: vi.fn(),
    });

    renderSidebar(props);

    const sidebar = container.querySelector<HTMLElement>('[data-testid="navigation-sidebar"]');
    expect(sidebar?.getAttribute('data-view')).toBe('references');
    expect(sidebar?.getAttribute('data-width')).toBe('384');
    expect(sidebar?.getAttribute('data-selected-variable')).toBe('alpha');

    for (const label of [
      'view data',
      'jump',
      'reload bibliography',
      'manage citations',
      'insert variable',
      'link variable file',
      'edit variable',
      'select variable',
      'resize',
      'resize commit',
      'close',
    ]) {
      clickButton(label);
    }

    expect(props.onViewChange).toHaveBeenCalledWith('data');
    expect(props.onJumpToLine).toHaveBeenCalledWith(9);
    expect(props.onReloadBibliography).toHaveBeenCalledTimes(1);
    expect(props.onManageCitations).toHaveBeenCalledTimes(1);
    expect(props.onInsertVariable).toHaveBeenCalledTimes(1);
    expect(props.onLinkVariableFile).toHaveBeenCalledTimes(1);
    expect(props.onEditVariable).toHaveBeenCalledWith('alpha');
    expect(props.onSelectVariable).toHaveBeenCalledWith('alpha');
    expect(props.onResize).toHaveBeenCalledWith(420);
    expect(props.onResizeCommit).toHaveBeenCalledWith(420);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

function renderSidebar(props: ComponentProps<typeof AppSidebar>): void {
  act(() => {
    root.render(<AppSidebar {...props} />);
  });
}

function clickButton(label: string): void {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent === label);
  expect(button, `button "${label}"`).not.toBeUndefined();
  act(() => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function createProps(overrides: Partial<ComponentProps<typeof AppSidebar>> = {}): ComponentProps<typeof AppSidebar> {
  return {
    open: true,
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
    layerTwoDocument: minimalLayerTwoDocument(),
    bibliographyLoading: false,
    selectedVariableName: null,
    onOpen: vi.fn(),
    onViewChange: vi.fn(),
    onJumpToLine: vi.fn(),
    onReloadBibliography: vi.fn(),
    onManageCitations: vi.fn(),
    onInsertVariable: vi.fn(),
    onLinkVariableFile: vi.fn(),
    onEditVariable: vi.fn(),
    onSelectVariable: vi.fn(),
    onResize: vi.fn(),
    onResizeCommit: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

function minimalLayerTwoDocument() {
  return {
    variableFiles: [],
    references: { labels: [] },
    citations: {
      bibliographyFiles: [],
      bibtexEntries: [],
      bibtexKeys: [],
      missingKeys: [],
      usages: [],
    },
    variables: {
      definitions: [],
      missingVariables: [],
      usages: [],
    },
  } as unknown as ComponentProps<typeof AppSidebar>['layerTwoDocument'];
}
