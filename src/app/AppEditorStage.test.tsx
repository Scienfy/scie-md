import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sourceEditorCapabilitiesFor } from '@sciemd/core';
import { AppEditorStage } from './AppEditorStage';
import { formatCapabilitiesFor } from './formatCapabilities';
import { parseSourceFormatDiagnostics } from './formatDiagnostics';
import { createStructuredSurfaceNavigationModel } from './structuredSurfaceNavigation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const editorBoundaryState = vi.hoisted(() => ({
  forceFallback: false,
}));

const sourceMenuMockState = vi.hoisted(() => ({
  selectLine: vi.fn(),
}));

const visualAtomMockState = vi.hoisted(() => ({
  edit: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../components/SavePill', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    SavePill: (props: { status: string; text: string; queueDepth: number }) => React.createElement(
      'div',
      { 'data-testid': 'save-pill', 'data-status': props.status, 'data-queue-depth': String(props.queueDepth) },
      props.text,
    ),
  };
});

vi.mock('../components/QuickOutlineHover', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    QuickOutlineHover: (props: { activeHeadingId: string | null; onJump: (id: string) => void }) => React.createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'quick-outline',
        'data-active-heading-id': props.activeHeadingId ?? '',
        onClick: () => props.onJump('heading-2'),
      },
      'Outline',
    ),
  };
});

vi.mock('../components/EditorErrorBoundary', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    EditorErrorBoundary: (props: {
      children: React.ReactNode;
      fallback: (error: Error, reset: () => void) => React.ReactNode;
    }) => {
      if (!editorBoundaryState.forceFallback) return React.createElement(React.Fragment, null, props.children);
      return React.createElement(React.Fragment, null, props.fallback(new Error('mock editor failure'), () => {
        editorBoundaryState.forceFallback = false;
      }));
    },
  };
});

vi.mock('../components/VisualMarkdownEditor', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    VisualMarkdownEditor: (props: {
      markdown: string;
      filePath: string | null;
      referenceLabels: string[];
      citationKeys: string[];
      highlightedVariableName: string | null;
      onChange: (markdown: string) => void;
      onEditorReady: (editor: unknown) => void;
      onInsertReady: (handler: unknown) => void;
    }) => {
      const visualContent = props.markdown.includes(':::figure')
        ? React.createElement(
          'section',
          {
            'data-testid': 'visual-atom',
            className: 'scie-md-visual-atom scie-md-directive-atom',
            'data-scie-md-node': 'directive-block',
            'data-directive-name': 'figure',
          },
          React.createElement('div', { className: 'scie-md-visual-atom-content' }, 'Rendered figure block'),
          React.createElement('button', { type: 'button', className: 'scie-md-visual-atom-edit', onClick: visualAtomMockState.edit }, 'atom edit'),
          React.createElement('button', { type: 'button', className: 'scie-md-visual-atom-delete', onClick: visualAtomMockState.delete }, 'atom delete'),
        )
        : React.createElement('p', { 'data-testid': 'visual-editor-content' }, props.markdown);
      return React.createElement(
        'section',
        {
          'data-testid': 'visual-editor',
          className: 'visual-editor',
          'data-file-path': props.filePath ?? '',
          'data-reference-labels': props.referenceLabels.join(','),
          'data-citation-keys': props.citationKeys.join(','),
          'data-highlighted-variable': props.highlightedVariableName ?? '',
        },
        visualContent,
        React.createElement('button', { type: 'button', onClick: () => props.onChange('visual draft') }, 'change visual'),
        React.createElement('button', { type: 'button', onClick: () => props.onEditorReady({ id: 'visual-editor' }) }, 'ready visual'),
        React.createElement('button', { type: 'button', onClick: () => props.onInsertReady(() => undefined) }, 'insert ready visual'),
      );
    },
  };
});

vi.mock('../components/SourceMarkdownEditor', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    SourceMarkdownEditor: (props: {
      markdown: string;
      citationKeys: string[];
      highlightedVariableName: string | null;
      onChange: (markdown: string) => void;
      onInsertReady: (handler: unknown) => void;
      onContextMenuRequest?: (request: unknown) => boolean | void;
    }) => React.createElement(
      'section',
      {
        'data-testid': 'source-editor',
        'data-citation-keys': props.citationKeys.join(','),
        'data-highlighted-variable': props.highlightedVariableName ?? '',
      },
      React.createElement('pre', null, props.markdown),
      React.createElement('button', { type: 'button', onClick: () => props.onChange('source draft') }, 'change source'),
      React.createElement('button', { type: 'button', onClick: () => props.onInsertReady(() => undefined) }, 'insert ready source'),
      React.createElement('button', { type: 'button', onClick: () => props.onContextMenuRequest?.(mockSourceContextMenuRequest('markdown')) }, 'open markdown source context'),
      React.createElement('button', { type: 'button', onClick: () => props.onContextMenuRequest?.(mockSourceLineContextMenuRequest('markdown')) }, 'open markdown source line context'),
    ),
  };
});

vi.mock('../components/JsonTreeView', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    JsonTreeView: (props: {
      value: unknown;
      sourceText?: string;
      schemaValidation?: unknown;
      editable?: boolean;
      selectedPath?: string | null;
      onSelectedPathChange?: (path: string) => void;
      onEditIntent?: (intent: unknown) => void;
      onRevealSource?: (node: unknown) => void;
    }) => React.createElement(
      'section',
      {
        'data-testid': 'json-tree-view',
        'data-selected-path': props.selectedPath ?? '',
        'data-editable': String(Boolean(props.editable)),
        'data-source-text': props.sourceText ?? '',
        'data-schema': props.schemaValidation ? 'yes' : 'no',
        'data-value': JSON.stringify(props.value),
      },
      React.createElement('button', { type: 'button', onClick: () => props.onSelectedPathChange?.('$.sample') }, 'select json path'),
      React.createElement('button', { type: 'button', onClick: () => props.onEditIntent?.({ kind: 'replaceScalar', path: ['sample'], nextValue: 2 }) }, 'edit json path'),
      React.createElement('button', {
        type: 'button',
        onClick: () => props.onRevealSource?.({
          format: 'json',
          path: ['sample'],
          pointer: '/sample',
          displayPath: '$.sample',
          type: 'array',
          span: { offset: 1, length: 14, line: 1, column: 2 },
          valueSpan: { offset: 10, length: 5, line: 1, column: 11 },
          lossy: false,
          editable: true,
        }),
      }, 'reveal json source'),
    ),
  };
});

vi.mock('../components/JsonlRecordList', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    JsonlRecordList: (props: {
      analysis: { recordCount: number; invalidLineCount: number } | null;
      sourceText?: string;
      onEditIntent?: (intent: unknown) => void;
      onCopyText?: (content: string, label: string) => void;
    }) => React.createElement(
      'section',
      {
        'data-testid': 'jsonl-record-list',
        'data-record-count': String(props.analysis?.recordCount ?? 0),
        'data-invalid-count': String(props.analysis?.invalidLineCount ?? 0),
        'data-source-text': props.sourceText ?? '',
      },
      React.createElement('button', { type: 'button', onClick: () => props.onEditIntent?.({ kind: 'appendRecord', value: { id: 3 } }) }, 'edit jsonl'),
      React.createElement('button', { type: 'button', onClick: () => props.onCopyText?.('[1]\n', 'JSON array') }, 'copy jsonl conversion'),
    ),
  };
});

vi.mock('../components/TabularTablePreview', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    TabularTablePreview: (props: {
      analysis: { dataRowCount: number; columnCount: number } | null;
      sourceText?: string;
      onEditIntent?: (intent: unknown) => void;
      onCopyText?: (content: string, label: string) => void;
    }) => React.createElement(
      'section',
      {
        'data-testid': 'tabular-table-preview',
        'data-row-count': String(props.analysis?.dataRowCount ?? 0),
        'data-column-count': String(props.analysis?.columnCount ?? 0),
        'data-source-text': props.sourceText ?? '',
      },
      React.createElement('button', { type: 'button', onClick: () => props.onEditIntent?.({ kind: 'replaceCell', dataRowIndex: 0, columnIndex: 1, nextValue: '14' }) }, 'edit table cell'),
      React.createElement('button', { type: 'button', onClick: () => props.onCopyText?.('a,b\n1,2\n', 'CSV copy') }, 'copy table conversion'),
    ),
  };
});

vi.mock('../components/SourceTextEditor', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    SourceTextEditor: (props: {
      value: string;
      language: string;
      diagnostics?: unknown[];
      onChange: (value: string) => void;
      onInsertReady: (handler: unknown) => void;
      onContextMenuRequest?: (request: unknown) => boolean | void;
    }) => React.createElement(
      'section',
      {
        'data-testid': 'source-text-editor',
        'data-language': props.language,
        'data-diagnostics': String(props.diagnostics?.length ?? 0),
      },
      React.createElement('pre', null, props.value),
      React.createElement('button', { type: 'button', onClick: () => props.onChange('generic source draft') }, 'change generic source'),
      React.createElement('button', { type: 'button', onClick: () => props.onInsertReady(() => undefined) }, 'insert ready generic source'),
      React.createElement('button', { type: 'button', onClick: () => props.onContextMenuRequest?.(mockSourceContextMenuRequest(props.language)) }, 'open generic source context'),
      React.createElement('button', { type: 'button', onClick: () => props.onContextMenuRequest?.(mockSourceLineContextMenuRequest(props.language)) }, 'open generic source line context'),
    ),
  };
});

vi.mock('../components/FloatingFormatToolbar', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    FloatingFormatToolbar: (props: { enabled: boolean; selectionRoot: HTMLElement | null }) => React.createElement(
      'div',
      {
        'data-testid': 'floating-toolbar',
        'data-enabled': String(props.enabled),
        'data-has-selection-root': String(Boolean(props.selectionRoot)),
      },
    ),
  };
});

vi.mock('../components/MetadataRail', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    MetadataRail: (props: {
      mode: string;
      currentLine: number | null;
      onJumpToLine: (line: number) => void;
      onOpenReferences: () => void;
      onOpenData: () => void;
    }) => React.createElement(
      'nav',
      {
        'data-testid': 'metadata-rail',
        'data-mode': props.mode,
        'data-current-line': props.currentLine === null ? '' : String(props.currentLine),
      },
      React.createElement('button', { type: 'button', onClick: () => props.onJumpToLine(42) }, 'jump line'),
      React.createElement('button', { type: 'button', onClick: props.onOpenReferences }, 'open references'),
      React.createElement('button', { type: 'button', onClick: props.onOpenData }, 'open data'),
    ),
  };
});

vi.mock('./StartupOpenFailureBanner', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    StartupOpenFailureBanner: (props: {
      onRetry: () => void;
      onOpenDocument: () => void;
      onDismiss: () => void;
    }) => React.createElement(
      'section',
      { 'data-testid': 'startup-open-failure' },
      React.createElement('button', { type: 'button', onClick: props.onRetry }, 'retry'),
      React.createElement('button', { type: 'button', onClick: props.onOpenDocument }, 'open document'),
      React.createElement('button', { type: 'button', onClick: props.onDismiss }, 'dismiss'),
    ),
  };
});

let container: HTMLDivElement;
let root: Root;

describe('AppEditorStage', () => {
  beforeEach(() => {
    editorBoundaryState.forceFallback = false;
    sourceMenuMockState.selectLine.mockClear();
    visualAtomMockState.edit.mockClear();
    visualAtomMockState.delete.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  it('renders the visual editor branch, forwards editor callbacks, and keeps stage event handlers attached', () => {
    const props = createProps({
      dropOverlayVisible: true,
      onMarkdownChange: vi.fn(),
      onVisualEditorReady: vi.fn(),
      onVisualInsertReady: vi.fn(),
      onKeyDownCapture: vi.fn(),
      onDropCapture: vi.fn(),
    });

    renderStage(props);

    expect(container.querySelector('[data-testid="visual-editor"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="source-editor"]')).toBeNull();
    expect(container.querySelector('.editor-drop-overlay')?.textContent).toContain('Drop into ScieMD');
    expect(container.querySelector('[data-testid="floating-toolbar"]')?.getAttribute('data-enabled')).toBe('true');

    clickButton('change visual');
    clickButton('ready visual');
    clickButton('insert ready visual');
    expect(props.onMarkdownChange).toHaveBeenCalledWith('visual draft');
    expect(props.onVisualEditorReady).toHaveBeenCalledWith({ id: 'visual-editor' });
    expect(props.onVisualInsertReady).toHaveBeenCalledTimes(1);

    const stage = container.querySelector<HTMLElement>('#editor-stage');
    expect(stage).not.toBeNull();
    act(() => {
      stage?.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
      stage?.dispatchEvent(new Event('drop', { bubbles: true }));
    });
    expect(props.onKeyDownCapture).toHaveBeenCalledTimes(1);
    expect(props.onDropCapture).toHaveBeenCalledTimes(1);
  });

  it('opens a Markdown visual selection context menu and dispatches selected-text actions', async () => {
    const selectionSnapshot = { text: 'Intro', line: 1, endLine: 1, surface: 'visual' as const };
    const props = createProps({
      markdown: 'Intro paragraph for selection.',
      getSelectionSnapshot: vi.fn(() => selectionSnapshot),
      onCommentSelection: vi.fn(),
      onHumanCommentSelection: vi.fn(),
      onLockSelection: vi.fn(),
      onVariantSelection: vi.fn(),
      onCopySelection: vi.fn(),
      onBlockSelection: vi.fn(),
    });

    renderStage(props);
    const selectedNode = selectVisualEditorText();
    const contextMenuEvent = openVisualSelectionContextMenu(selectedNode);

    expect(contextMenuEvent.defaultPrevented).toBe(true);
    expect(container.querySelector('.context-menu-card')?.getAttribute('aria-label')).toBe('Selected text actions');
    expect(menuItem('Note to LLM')).not.toBeNull();
    expect(menuItem('Note to Human')).not.toBeNull();
    expect(menuItem('Lock section')).not.toBeNull();
    expect(menuItem('Text versions')).not.toBeNull();
    expect(menuItem('Wrap in block')).not.toBeNull();
    expect(menuItem('Copy')).not.toBeNull();

    await clickContextMenuItem('Note to LLM');
    expect(props.onCommentSelection).toHaveBeenCalledWith(selectionSnapshot);

    selectVisualEditorText();
    openVisualSelectionContextMenu(selectedNode);
    await clickContextMenuItem('Note to Human');
    expect(props.onHumanCommentSelection).toHaveBeenCalledWith(selectionSnapshot);

    selectVisualEditorText();
    openVisualSelectionContextMenu(selectedNode);
    await clickContextMenuItem('Lock section');
    expect(props.onLockSelection).toHaveBeenCalledTimes(1);

    selectVisualEditorText();
    openVisualSelectionContextMenu(selectedNode);
    await clickContextMenuItem('Text versions');
    expect(props.onVariantSelection).toHaveBeenCalledTimes(1);

    selectVisualEditorText();
    openVisualSelectionContextMenu(selectedNode);
    await clickContextMenuItem('Wrap in block');
    expect(props.onBlockSelection).toHaveBeenCalledTimes(1);

    selectVisualEditorText();
    openVisualSelectionContextMenu(selectedNode);
    await clickContextMenuItem('Copy');
    expect(props.onCopySelection).toHaveBeenCalledTimes(1);
  });

  it('routes Markdown visual formatting context menu actions through the visual editor and heading command', async () => {
    const visualEditor = { action: vi.fn() } as unknown as ComponentProps<typeof AppEditorStage>['visualEditor'];
    const props = createProps({
      markdown: 'Intro paragraph for selection.',
      visualEditor,
      getSelectionSnapshot: vi.fn(() => ({ text: 'Intro', surface: 'visual' as const })),
      onHeadingSelection: vi.fn(),
    });

    renderStage(props);
    const selectedNode = selectVisualEditorText();

    openVisualSelectionContextMenu(selectedNode);
    await clickContextMenuItem('Bold');
    expect(visualEditor?.action).toHaveBeenCalledTimes(1);

    selectVisualEditorText();
    openVisualSelectionContextMenu(selectedNode);
    await clickContextMenuItem('Italic');
    expect(visualEditor?.action).toHaveBeenCalledTimes(2);

    selectVisualEditorText();
    openVisualSelectionContextMenu(selectedNode);
    await clickContextMenuItem('Convert to H1');
    expect(props.onHeadingSelection).toHaveBeenCalledWith(1);

    selectVisualEditorText();
    openVisualSelectionContextMenu(selectedNode);
    await clickContextMenuItem('Convert to H2');
    expect(props.onHeadingSelection).toHaveBeenCalledWith(2);
  });

  it('opens a Markdown visual block context menu when right-clicking without selected text', async () => {
    const clipboardWrite = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    const props = createProps({
      markdown: 'Intro paragraph without selection.',
      getSelectionSnapshot: vi.fn(() => ({ text: 'Intro paragraph without selection.', surface: 'visual' as const })),
      onCommentSelection: vi.fn(),
      onHumanCommentSelection: vi.fn(),
      onLockSelection: vi.fn(),
      onVariantSelection: vi.fn(),
      onBlockSelection: vi.fn(),
    });

    renderStage(props);
    const selectedNode = container.querySelector<HTMLElement>('[data-testid="visual-editor-content"]');
    expect(selectedNode).not.toBeNull();
    window.getSelection()?.removeAllRanges();

    const contextMenuEvent = openVisualBlockContextMenu(selectedNode!);

    expect(contextMenuEvent.defaultPrevented).toBe(true);
    expect(container.querySelector('.context-menu-card')?.getAttribute('aria-label')).toBe('Visual actions for Paragraph');
    expect(menuItem('Select block')).not.toBeNull();
    expect(menuItem('Note to LLM')).not.toBeNull();
    expect(menuItem('Note to Human')).not.toBeNull();
    expect(menuItem('Lock block')).not.toBeNull();
    expect(menuItem('Text versions')).not.toBeNull();
    expect(menuItem('Wrap in block')).not.toBeNull();

    await clickContextMenuItem('Select block');
    expect(window.getSelection()?.toString()).toContain('Intro paragraph without selection.');

    openVisualBlockContextMenu(selectedNode!);
    openContextMenuSubmenu('Copy');
    await clickContextMenuItem('Copy block text');
    expect(clipboardWrite).toHaveBeenCalledWith('Intro paragraph without selection.');

    openVisualBlockContextMenu(selectedNode!);
    await clickContextMenuItem('Note to LLM');
    expect(props.onCommentSelection).toHaveBeenCalledWith({ text: 'Intro paragraph without selection.', surface: 'visual' });

    openVisualBlockContextMenu(selectedNode!);
    await clickContextMenuItem('Note to Human');
    expect(props.onHumanCommentSelection).toHaveBeenCalledWith({ text: 'Intro paragraph without selection.', surface: 'visual' });

    openVisualBlockContextMenu(selectedNode!);
    await clickContextMenuItem('Lock block');
    expect(props.onLockSelection).toHaveBeenCalledTimes(1);

    openVisualBlockContextMenu(selectedNode!);
    await clickContextMenuItem('Text versions');
    expect(props.onVariantSelection).toHaveBeenCalledTimes(1);

    openVisualBlockContextMenu(selectedNode!);
    await clickContextMenuItem('Wrap in block');
    expect(props.onBlockSelection).toHaveBeenCalledTimes(1);
  });

  it('exposes existing visual atom edit and delete controls from the block context menu', async () => {
    const props = createProps({
      markdown: ':::figure {#fig:test}\nA rendered figure\n:::\n',
      getSelectionSnapshot: vi.fn(() => ({ text: 'Rendered figure block', surface: 'visual' as const })),
    });

    renderStage(props);
    const atom = container.querySelector<HTMLElement>('[data-testid="visual-atom"]');
    expect(atom).not.toBeNull();

    const contextMenuEvent = openVisualBlockContextMenu(atom!);

    expect(contextMenuEvent.defaultPrevented).toBe(true);
    expect(container.querySelector('.context-menu-card')?.getAttribute('aria-label')).toBe('Visual actions for figure directive');
    expect(menuItem('Edit visual atom')).not.toBeNull();
    expect(menuItem('Delete visual atom')).not.toBeNull();

    await clickContextMenuItem('Edit visual atom');
    expect(visualAtomMockState.edit).toHaveBeenCalledTimes(1);

    openVisualBlockContextMenu(atom!);
    await clickContextMenuItem('Delete visual atom');
    expect(visualAtomMockState.delete).toHaveBeenCalledTimes(1);
  });

  it('renders the source editor branch with source-specific callback forwarding', () => {
    const props = createProps({
      mode: 'source',
      onMarkdownChange: vi.fn(),
      onSourceInsertReady: vi.fn(),
    });

    renderStage(props);

    expect(container.querySelector('[data-testid="source-editor"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="visual-editor"]')).toBeNull();
    expect(container.querySelector('[data-testid="floating-toolbar"]')?.getAttribute('data-enabled')).toBe('false');

    clickButton('change source');
    clickButton('insert ready source');
    expect(props.onMarkdownChange).toHaveBeenCalledWith('source draft');
    expect(props.onSourceInsertReady).toHaveBeenCalledTimes(1);
  });

  it('shows source Markdown selected-text context actions and can switch back to visual mode', async () => {
    const props = createProps({
      mode: 'source',
      onSwitchToVisualMode: vi.fn(),
      onToast: vi.fn(),
    });

    renderStage(props);
    clickButton('open markdown source context');

    expect(container.querySelector('.context-menu-card')?.getAttribute('aria-label')).toBe('Source actions for line 1');
    expect(menuItem('Copy')).not.toBeNull();
    expect(menuItem('Switch to visual editor')).not.toBeNull();
    expect(menuItem('Copy line diagnostic')).not.toBeNull();

    await clickContextMenuItem('Switch to visual editor');
    expect(props.onSwitchToVisualMode).toHaveBeenCalledTimes(1);
  });

  it('shows source Markdown line context actions when there is no selected text', async () => {
    const props = createProps({
      mode: 'source',
      onSwitchToVisualMode: vi.fn(),
      onToast: vi.fn(),
    });

    renderStage(props);
    clickButton('open markdown source line context');

    expect(container.querySelector('.context-menu-card')?.getAttribute('aria-label')).toBe('Source actions for line 2');
    expect(menuItem('Copy')).not.toBeNull();
    expect(menuItem('Copy selection')).toBeNull();
    expect(menuItem('Copy line')).not.toBeNull();
    expect(menuItem('Select line')).not.toBeNull();
    expect(menuItem('Switch to visual editor')).not.toBeNull();
    expect(menuItem('Copy line diagnostic')).not.toBeNull();

    await clickContextMenuItem('Select line');
    expect(sourceMenuMockState.selectLine).toHaveBeenCalledTimes(1);
  });

  it('shows conservative structured source context actions without Markdown-only commands', async () => {
    const clipboardWrite = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    const props = createProps({
      format: 'json',
      formatCapabilities: formatCapabilitiesFor('json'),
      mode: 'source',
      markdown: '{\n  \"a\": \n}',
      sourceDiagnostics: [{
        severity: 'error',
        code: 'json-syntax',
        message: 'Expected a JSON value.',
        line: 2,
        column: 8,
        source: 'json',
      }],
      onToast: vi.fn(),
      onSwitchToVisualMode: vi.fn(),
    });

    renderStage(props);
    clickButton('open generic source context');

    expect(container.querySelector('.context-menu-card')?.getAttribute('aria-label')).toBe('Source actions for line 1');
    expect(menuItem('Copy')).not.toBeNull();
    expect(menuItem('Copy line diagnostic')).not.toBeNull();
    expect(menuItem('Validate selection')).not.toBeNull();
    expect(menuItem('Switch to visual editor')).toBeNull();
    expect(menuItem('Note to LLM')).toBeNull();
    expect(menuItem('Lock section')).toBeNull();

    await clickContextMenuItem('Validate selection');
    expect(props.onToast).toHaveBeenCalledWith('Selection is valid JSON.', 'success');

    clickButton('open generic source context');
    await clickContextMenuItem('Copy line diagnostic');
    expect(clipboardWrite).toHaveBeenCalledWith('ERROR [json] line 2:8: Expected a JSON value.');
    expect(props.onToast).toHaveBeenCalledWith('Line diagnostic copied.', 'success');
  });

  it('converts selected CSV source text from the source context menu', async () => {
    const clipboardWrite = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    const props = createProps({
      format: 'csv',
      formatCapabilities: formatCapabilitiesFor('csv'),
      mode: 'source',
      markdown: 'id,count\n001,12\n',
      onToast: vi.fn(),
    });

    renderStage(props);
    clickButton('open generic source context');

    expect(menuItem('Convert selection to JSON')).not.toBeNull();
    await clickContextMenuItem('Convert selection to JSON');
    expect(clipboardWrite).toHaveBeenCalledWith('[\n  {\n    "id": "001",\n    "count": "12"\n  }\n]\n');
    expect(props.onToast).toHaveBeenCalledWith('Selection JSON array copied.', 'success');
  });

  it('shows structured source line context actions without selection-only commands', async () => {
    const clipboardWrite = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    const props = createProps({
      format: 'json',
      formatCapabilities: formatCapabilitiesFor('json'),
      mode: 'source',
      markdown: '{\n  \"a\": \n}',
      sourceDiagnostics: [{
        severity: 'error',
        code: 'json-syntax',
        message: 'Expected a JSON value.',
        line: 2,
        column: 8,
        source: 'json',
      }],
      onToast: vi.fn(),
      onSwitchToVisualMode: vi.fn(),
    });

    renderStage(props);
    clickButton('open generic source line context');

    expect(container.querySelector('.context-menu-card')?.getAttribute('aria-label')).toBe('Source actions for line 2');
    expect(menuItem('Copy')).not.toBeNull();
    expect(menuItem('Copy selection')).toBeNull();
    expect(menuItem('Copy line')).not.toBeNull();
    expect(menuItem('Select line')).not.toBeNull();
    expect(menuItem('Copy line diagnostic')).not.toBeNull();
    expect(menuItem('Note to LLM')).toBeNull();

    await clickContextMenuItem('Copy line');
    expect(clipboardWrite).toHaveBeenCalledWith('  "a": ');
  });

  it('routes source-only formats to the generic source editor and suppresses Markdown rail surfaces', () => {
    const props = createProps({
      format: 'json',
      formatCapabilities: formatCapabilitiesFor('json'),
      mode: 'visual',
      markdown: '{ "title": "Dataset" }',
      sourceDiagnostics: [{
        severity: 'error',
        code: 'json-syntax',
        message: 'Expected a JSON value.',
        source: 'json',
      }],
      onMarkdownChange: vi.fn(),
      onSourceInsertReady: vi.fn(),
    });

    renderStage(props);

    expect(container.querySelector('[data-testid="source-text-editor"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="source-text-editor"]')?.getAttribute('data-language')).toBe('json');
    expect(container.querySelector('[data-testid="source-text-editor"]')?.getAttribute('data-diagnostics')).toBe('1');
    expect(container.querySelector('[data-testid="visual-editor"]')).toBeNull();
    expect(container.querySelector('[data-testid="source-editor"]')).toBeNull();
    expect(container.querySelector('[data-testid="metadata-rail"]')).toBeNull();
    expect(container.querySelector('[data-testid="floating-toolbar"]')?.getAttribute('data-enabled')).toBe('false');

    clickButton('change generic source');
    clickButton('insert ready generic source');
    expect(props.onMarkdownChange).toHaveBeenCalledWith('generic source draft');
    expect(props.onSourceInsertReady).toHaveBeenCalledTimes(1);
  });

  it('routes valid JSON tree mode to the read-only JSON tree without source change callbacks', () => {
    const onMarkdownChange = vi.fn();
    const onJsonSelectedPathChange = vi.fn();
    const onJsonEditIntent = vi.fn();
    const onRevealStructuredSource = vi.fn();
    const jsonAnalysis = parseSourceFormatDiagnostics('json', '{"sample":[1,2]}', null).jsonAnalysis;
    const props = createProps({
      format: 'json',
      formatCapabilities: formatCapabilitiesFor('json'),
      mode: 'visual',
      markdown: '{"sample":[1,2]}',
      jsonAnalysis,
      selectedJsonPath: '$.sample',
      onMarkdownChange,
      onJsonSelectedPathChange,
      onJsonEditIntent,
      onRevealStructuredSource,
    });

    renderStage(props);

    expect(container.querySelector('[data-testid="json-tree-view"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="json-tree-view"]')?.getAttribute('data-value')).toBe('{"sample":[1,2]}');
    expect(container.querySelector('[data-testid="json-tree-view"]')?.getAttribute('data-editable')).toBe('true');
    expect(container.querySelector('[data-testid="json-tree-view"]')?.getAttribute('data-source-text')).toBe('{"sample":[1,2]}');
    expect(container.querySelector('[data-testid="source-text-editor"]')).toBeNull();
    clickButton('select json path');
    clickButton('edit json path');
    clickButton('reveal json source');
    expect(onJsonSelectedPathChange).toHaveBeenCalledWith('$.sample');
    expect(onJsonEditIntent).toHaveBeenCalledWith({ kind: 'replaceScalar', path: ['sample'], nextValue: 2 });
    expect(onRevealStructuredSource).toHaveBeenCalledWith(expect.objectContaining({
      pointer: '/sample',
      displayPath: '$.sample',
    }));
    expect(onMarkdownChange).not.toHaveBeenCalled();
  });

  it('routes selected object arrays to a deliberate JSON table surface without mounting the tree', () => {
    const source = '{"samples":[{"id":"S-001","score":1},{"id":"S-002","score":2}]}';
    const jsonAnalysis = parseSourceFormatDiagnostics('json', source, null).jsonAnalysis;
    const props = createProps({
      format: 'json',
      formatCapabilities: formatCapabilitiesFor('json'),
      mode: 'visual',
      markdown: source,
      jsonAnalysis,
      selectedJsonPath: '$.samples',
      structuredSurfaceNavigation: structuredSurfaceNavigation({
        format: 'json',
        preferredVisualSurface: 'table',
        jsonAnalysis,
        jsonArrayTableAvailable: true,
      }),
    });

    renderStage(props);

    expect(container.querySelector('.json-tree-with-array-table')).toBeNull();
    expect(container.querySelector('.json-array-table-view')?.textContent).toContain('JSON table');
    expect(container.querySelector('.json-array-table-view')?.textContent).toContain('S-001');
    expect(container.querySelector('[data-testid="json-tree-view"]')).toBeNull();
  });

  it('routes selected object arrays to a deliberate JSON cards surface', () => {
    const source = '{"samples":[{"id":"S-001","score":1},{"id":"S-002","score":2}]}';
    const jsonAnalysis = parseSourceFormatDiagnostics('json', source, null).jsonAnalysis;
    const props = createProps({
      format: 'json',
      formatCapabilities: formatCapabilitiesFor('json'),
      mode: 'visual',
      markdown: source,
      jsonAnalysis,
      selectedJsonPath: '$.samples',
      structuredSurfaceNavigation: structuredSurfaceNavigation({
        format: 'json',
        preferredVisualSurface: 'cards',
        jsonAnalysis,
        jsonArrayTableAvailable: true,
      }),
    });

    renderStage(props);

    expect(container.querySelector('.json-array-table-view.mode-cards')).not.toBeNull();
    expect(container.querySelector('.json-array-table-view')?.textContent).toContain('JSON cards');
    expect(container.querySelector('[data-testid="json-tree-view"]')).toBeNull();
  });

  it('routes JSON health to a deliberate health surface', () => {
    const source = '{"samples":[{"id":"S-001"}]}';
    const jsonAnalysis = parseSourceFormatDiagnostics('json', source, null).jsonAnalysis;
    const props = createProps({
      format: 'json',
      formatCapabilities: formatCapabilitiesFor('json'),
      mode: 'visual',
      markdown: source,
      jsonAnalysis,
      structuredSurfaceNavigation: structuredSurfaceNavigation({
        format: 'json',
        preferredVisualSurface: 'health',
        jsonAnalysis,
        jsonArrayTableAvailable: true,
      }),
    });

    renderStage(props);

    expect(container.querySelector('.json-health-panel')?.textContent).toContain('JSON health');
    expect(container.querySelector('[data-testid="json-tree-view"]')).toBeNull();
    expect(container.querySelector('.json-array-table-view')).toBeNull();
  });

  it('keeps the current JSON tree mounted but read-only while parsing refreshes', () => {
    const jsonAnalysis = parseSourceFormatDiagnostics('json', '{"sample":[1,2]}', null).jsonAnalysis;
    const props = createProps({
      format: 'json',
      formatCapabilities: formatCapabilitiesFor('json'),
      mode: 'visual',
      markdown: '{"sample":[1,3]}',
      sourceParsingPending: true,
      jsonAnalysis,
      selectedJsonPath: '$.sample',
    });

    renderStage(props);

    expect(container.querySelector('[data-testid="json-tree-view"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="json-tree-view"]')?.getAttribute('data-value')).toBe('{"sample":[1,2]}');
    expect(container.querySelector('[data-testid="json-tree-view"]')?.getAttribute('data-source-text')).toBe('{"sample":[1,3]}');
    expect(container.querySelector('[data-testid="json-tree-view"]')?.getAttribute('data-editable')).toBe('false');
    expect(container.querySelector('.structured-visual-preparing')).toBeNull();
    expect(container.querySelector('[data-testid="source-text-editor"]')).toBeNull();
  });

  it('routes valid YAML tree mode to the read-only structured tree without source change callbacks', () => {
    const onMarkdownChange = vi.fn();
    const onJsonSelectedPathChange = vi.fn();
    const onRevealStructuredSource = vi.fn();
    const structuredAnalysis = parseSourceFormatDiagnostics('yaml', 'sample:\n  name: Alpha\n', null).structuredAnalysis;
    const props = createProps({
      format: 'yaml',
      formatCapabilities: formatCapabilitiesFor('yaml'),
      mode: 'visual',
      markdown: 'sample:\n  name: Alpha\n',
      structuredAnalysis,
      selectedJsonPath: '$.sample',
      onMarkdownChange,
      onJsonSelectedPathChange,
      onRevealStructuredSource,
    });

    renderStage(props);

    expect(container.querySelector('[data-testid="json-tree-view"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="json-tree-view"]')?.getAttribute('data-value')).toBe('{"sample":{"name":"Alpha"}}');
    expect(container.querySelector('[data-testid="json-tree-view"]')?.getAttribute('data-editable')).toBe('false');
    expect(container.querySelector('[data-testid="source-text-editor"]')).toBeNull();
    clickButton('select json path');
    clickButton('reveal json source');
    expect(onJsonSelectedPathChange).toHaveBeenCalledWith('$.sample');
    expect(onRevealStructuredSource).toHaveBeenCalledWith(expect.objectContaining({
      pointer: '/sample',
      displayPath: '$.sample',
    }));
    expect(onMarkdownChange).not.toHaveBeenCalled();
  });

  it('keeps invalid TOML in generic source mode even when tree mode is requested', () => {
    const structuredAnalysis = parseSourceFormatDiagnostics('toml', 'a = [\n', null).structuredAnalysis;
    const props = createProps({
      format: 'toml',
      formatCapabilities: formatCapabilitiesFor('toml'),
      mode: 'visual',
      markdown: 'a = [\n',
      structuredAnalysis,
    });

    renderStage(props);

    expect(container.querySelector('[data-testid="source-text-editor"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="source-text-editor"]')?.getAttribute('data-language')).toBe('toml');
    expect(container.querySelector('[data-testid="json-tree-view"]')).toBeNull();
  });

  it('keeps invalid JSON in generic source mode even when tree mode is requested', () => {
    const jsonAnalysis = parseSourceFormatDiagnostics('json', '{"sample": [}', null).jsonAnalysis;
    const props = createProps({
      format: 'json',
      formatCapabilities: formatCapabilitiesFor('json'),
      mode: 'visual',
      markdown: '{"sample": [}',
      jsonAnalysis,
    });

    renderStage(props);

    expect(container.querySelector('[data-testid="source-text-editor"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="json-tree-view"]')).toBeNull();
  });

  it('keeps structured visual mode on a visual preparing surface while parsing is pending', () => {
    const props = createProps({
      format: 'json',
      formatCapabilities: formatCapabilitiesFor('json'),
      mode: 'visual',
      markdown: '{"sample":[1,2]}',
      sourceParsingPending: true,
      jsonAnalysis: null,
    });

    renderStage(props);

    expect(container.querySelector('.structured-visual-preparing')?.textContent).toContain('Preparing JSON tree');
    expect(container.querySelector('[data-testid="source-text-editor"]')).toBeNull();
    expect(container.querySelector('[data-testid="json-tree-view"]')).toBeNull();
  });

  it('keeps marker-injected JSON source out of the read-only tree', () => {
    const markerInjectedJson = '{"sample":[1]}\n<<<<<<< current\n{"sample":[2]}\n=======\n{"sample":[3]}\n>>>>>>> disk\n';
    const jsonAnalysis = parseSourceFormatDiagnostics('json', markerInjectedJson, null).jsonAnalysis;
    const props = createProps({
      format: 'json',
      formatCapabilities: formatCapabilitiesFor('json'),
      mode: 'visual',
      markdown: markerInjectedJson,
      jsonAnalysis,
    });

    renderStage(props);

    expect(jsonAnalysis?.status).toBe('invalid');
    expect(container.querySelector('[data-testid="source-text-editor"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="json-tree-view"]')).toBeNull();
  });

  it('routes JSONL visual mode to the bounded read-only record list', () => {
    const onMarkdownChange = vi.fn();
    const onJsonlEditIntent = vi.fn();
    const onJsonlCopyText = vi.fn();
    const jsonlAnalysis = parseSourceFormatDiagnostics('jsonl', '{"id":1}\n\n{"id":2}\n', null).jsonlAnalysis;
    const props = createProps({
      format: 'jsonl',
      formatCapabilities: formatCapabilitiesFor('jsonl'),
      mode: 'visual',
      markdown: '{"id":1}\n\n{"id":2}\n',
      jsonlAnalysis,
      onMarkdownChange,
      onJsonlEditIntent,
      onJsonlCopyText,
    });

    renderStage(props);

    expect(container.querySelector('[data-testid="jsonl-record-list"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="jsonl-record-list"]')?.getAttribute('data-record-count')).toBe('2');
    expect(container.querySelector('[data-testid="jsonl-record-list"]')?.getAttribute('data-invalid-count')).toBe('1');
    expect(container.querySelector('[data-testid="jsonl-record-list"]')?.getAttribute('data-source-text')).toBe('{"id":1}\n\n{"id":2}\n');
    expect(container.querySelector('[data-testid="source-text-editor"]')).toBeNull();
    clickButton('edit jsonl');
    clickButton('copy jsonl conversion');
    expect(onJsonlEditIntent).toHaveBeenCalledWith({ kind: 'appendRecord', value: { id: 3 } });
    expect(onJsonlCopyText).toHaveBeenCalledWith('[1]\n', 'JSON array');
    expect(onMarkdownChange).not.toHaveBeenCalled();
  });

  it('falls back to generic source editing when JSONL analysis is not available', () => {
    const props = createProps({
      format: 'jsonl',
      formatCapabilities: formatCapabilitiesFor('jsonl'),
      mode: 'visual',
      markdown: '{"id":1}\n',
      jsonlAnalysis: null,
    });

    renderStage(props);

    expect(container.querySelector('[data-testid="source-text-editor"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="source-text-editor"]')?.getAttribute('data-language')).toBe('jsonl');
    expect(container.querySelector('[data-testid="jsonl-record-list"]')).toBeNull();
  });

  it('routes CSV visual mode to the bounded table preview', () => {
    const onMarkdownChange = vi.fn();
    const onTabularEditIntent = vi.fn();
    const onTabularCopyText = vi.fn();
    const tabularAnalysis = parseSourceFormatDiagnostics('csv', 'id,count\n001,12\n002,13\n', null).tabularAnalysis;
    const props = createProps({
      format: 'csv',
      formatCapabilities: formatCapabilitiesFor('csv'),
      mode: 'visual',
      markdown: 'id,count\n001,12\n002,13\n',
      tabularAnalysis,
      onMarkdownChange,
      onTabularEditIntent,
      onTabularCopyText,
    });

    renderStage(props);

    expect(container.querySelector('[data-testid="tabular-table-preview"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tabular-table-preview"]')?.getAttribute('data-row-count')).toBe('2');
    expect(container.querySelector('[data-testid="tabular-table-preview"]')?.getAttribute('data-column-count')).toBe('2');
    expect(container.querySelector('[data-testid="tabular-table-preview"]')?.getAttribute('data-source-text')).toBe('id,count\n001,12\n002,13\n');
    expect(container.querySelector('[data-testid="source-text-editor"]')).toBeNull();
    clickButton('edit table cell');
    expect(onTabularEditIntent).toHaveBeenCalledWith({ kind: 'replaceCell', dataRowIndex: 0, columnIndex: 1, nextValue: '14' });
    clickButton('copy table conversion');
    expect(onTabularCopyText).toHaveBeenCalledWith('a,b\n1,2\n', 'CSV copy');
    expect(onMarkdownChange).not.toHaveBeenCalled();
  });

  it('keeps a raw Markdown fallback editable and resets the editor boundary', () => {
    editorBoundaryState.forceFallback = true;
    const props = createProps({
      markdown: '# fallback\n',
      onMarkdownChange: vi.fn(),
      onEditorReset: vi.fn(),
    });

    renderStage(props);

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Raw Markdown fallback"]');
    expect(textarea?.value).toBe('# fallback\n');
    act(() => {
      if (!textarea) return;
      const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      valueSetter?.call(textarea, '# fallback edited\n');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(props.onMarkdownChange).toHaveBeenCalledWith('# fallback edited\n');

    clickButton('Retry visual editor');
    expect(props.onEditorReset).toHaveBeenCalledTimes(1);
  });

  it('forwards metadata rail and startup failure actions from the shell', () => {
    const props = createProps({
      startupOpenFailure: {
        kind: 'open-failed',
        path: 'C:\\docs\\missing.md',
        title: 'Startup document did not open',
        message: 'Could not open file.',
        detail: null,
        failedAtMs: 100,
        canRetry: true,
      },
      onJumpToLine: vi.fn(),
      onOpenReferences: vi.fn(),
      onOpenData: vi.fn(),
      onRetryStartupOpen: vi.fn(),
      onOpenStartupFallbackDocument: vi.fn(),
      onDismissStartupOpenFailure: vi.fn(),
    });

    renderStage(props);

    clickButton('jump line');
    clickButton('open references');
    clickButton('open data');
    clickButton('retry');
    clickButton('open document');
    clickButton('dismiss');

    expect(props.onJumpToLine).toHaveBeenCalledWith(42);
    expect(props.onOpenReferences).toHaveBeenCalledTimes(1);
    expect(props.onOpenData).toHaveBeenCalledTimes(1);
    expect(props.onRetryStartupOpen).toHaveBeenCalledTimes(1);
    expect(props.onOpenStartupFallbackDocument).toHaveBeenCalledTimes(1);
    expect(props.onDismissStartupOpenFailure).toHaveBeenCalledTimes(1);
  });
});

function renderStage(props: ComponentProps<typeof AppEditorStage>): void {
  act(() => {
    root.render(<AppEditorStage {...props} />);
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

function selectVisualEditorText(): HTMLElement {
  const selectedNode = container.querySelector<HTMLElement>('[data-testid="visual-editor-content"]');
  expect(selectedNode).not.toBeNull();
  const textNode = selectedNode?.firstChild;
  expect(textNode?.nodeType).toBe(Node.TEXT_NODE);
  const textLength = textNode?.textContent?.length ?? 0;
  const range = document.createRange();
  range.setStart(textNode!, 0);
  range.setEnd(textNode!, Math.min(5, textLength));
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return selectedNode!;
}

function openVisualSelectionContextMenu(target: HTMLElement): MouseEvent {
  const contextMenuEvent = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 220,
    clientY: 140,
    button: 2,
  });
  act(() => {
    target.dispatchEvent(contextMenuEvent);
  });
  return contextMenuEvent;
}

function openVisualBlockContextMenu(target: HTMLElement): MouseEvent {
  window.getSelection()?.removeAllRanges();
  const contextMenuEvent = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 220,
    clientY: 140,
    button: 2,
  });
  act(() => {
    target.dispatchEvent(contextMenuEvent);
  });
  return contextMenuEvent;
}

function menuItem(label: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.context-menu-card .context-menu-item'))
    .find((button) => button.querySelector('.context-menu-label')?.textContent === label) ?? null;
}

function openContextMenuSubmenu(label: string): void {
  const button = menuItem(label);
  expect(button, `context menu item "${label}"`).not.toBeNull();
  act(() => {
    button?.focus();
    button?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
  });
}

async function clickContextMenuItem(label: string): Promise<void> {
  const button = menuItem(label);
  expect(button, `context menu item "${label}"`).not.toBeNull();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

function createProps(overrides: Partial<ComponentProps<typeof AppEditorStage>> = {}): ComponentProps<typeof AppEditorStage> {
  return {
    editorStageRef: { current: null },
    format: 'markdown',
    formatCapabilities: formatCapabilitiesFor('markdown'),
    mode: 'visual',
    filePath: 'C:\\docs\\paper.md',
    markdown: '# Intro\n',
    editorResetToken: 1,
    dropOverlayVisible: false,
    autosaveStatus: 'saved',
    statusText: 'Saved',
    saveQueueDepth: 0,
    startupOpenFailure: null,
    headings: [],
    activeHeadingId: 'heading-1',
    activeNavigationLine: 3,
    navigationHeadings: [],
    visualEditor: undefined,
    layerTwoDocument: minimalLayerTwoDocument(),
    protectedBlocks: [],
    editorComments: [],
    targetedInstructions: [],
    variantGroups: [],
    citationCompletionKeys: ['doe2026'],
    selectedVariableName: 'alpha',
    authorshipMarks: [],
    validationIssues: [],
    onKeyDownCapture: vi.fn(),
    onPasteCapture: vi.fn(),
    onDragEnterCapture: vi.fn(),
    onDragLeaveCapture: vi.fn(),
    onDropCapture: vi.fn(),
    onDragOver: vi.fn(),
    onJumpToHeading: vi.fn(),
    onMarkdownChange: vi.fn(),
    onEditorReset: vi.fn(),
    onVisualEditorReady: vi.fn(),
    onVisualInsertReady: vi.fn(),
    onVisualJumpReady: vi.fn(),
    onVisualFindReady: vi.fn(),
    onVisualHistoryReady: vi.fn(),
    onSourceInsertReady: vi.fn(),
    onSourceJumpReady: vi.fn(),
    onSourceFindReady: vi.fn(),
    onSourceHistoryReady: vi.fn(),
    onSelectionTextReady: vi.fn(),
    onCursorLineChange: vi.fn(),
    onViewportLineChange: vi.fn(),
    onLockViolation: vi.fn(),
    onToast: vi.fn(),
    confirmText: vi.fn(),
    onEditCitation: vi.fn(),
    onEditVariable: vi.fn(),
    getSelectionSnapshot: vi.fn(),
    onLockSelection: vi.fn(),
    onCommentSelection: vi.fn(),
    onHumanCommentSelection: vi.fn(),
    onVariantSelection: vi.fn(),
    onCopySelection: vi.fn(),
    onHeadingSelection: vi.fn(),
    onBlockSelection: vi.fn(),
    onJumpToLine: vi.fn(),
    onOpenReferences: vi.fn(),
    onOpenData: vi.fn(),
    onSwitchToVisualMode: vi.fn(),
    onRetryStartupOpen: vi.fn(),
    onOpenStartupFallbackDocument: vi.fn(),
    onDismissStartupOpenFailure: vi.fn(),
    ...overrides,
  };
}

function mockSourceContextMenuRequest(language: string) {
  const selectedText = language === 'markdown'
    ? 'Selected Markdown'
    : language === 'csv'
      ? 'id,count\n001,12\n'
      : language === 'tsv'
        ? 'id\tcount\n001\t12\n'
        : '"a"';
  return {
    kind: 'selection',
    position: { x: 260, y: 180 },
    language,
    text: selectedText,
    lineText: language === 'markdown' ? '# Intro' : '  "a": ',
    selectedLinesText: language === 'markdown' ? '# Intro' : '  "a": ',
    line: 1,
    endLine: 1,
    from: 0,
    to: selectedText.length,
    diagnostics: [{
      severity: 'error',
      code: language === 'markdown' ? 'markdown-test' : 'json-syntax',
      message: language === 'markdown' ? 'Mock Markdown issue.' : 'Expected a JSON value.',
      line: language === 'markdown' ? 1 : 2,
      column: language === 'markdown' ? 1 : 8,
      source: language,
    }],
    sourceEditor: sourceEditorCapabilitiesFor(language as Parameters<typeof sourceEditorCapabilitiesFor>[0]),
    selectLine: sourceMenuMockState.selectLine,
  };
}

function mockSourceLineContextMenuRequest(language: string) {
  return {
    kind: 'line',
    position: { x: 260, y: 180 },
    language,
    text: language === 'markdown' ? 'Second source line' : '  "a": ',
    lineText: language === 'markdown' ? 'Second source line' : '  "a": ',
    selectedLinesText: language === 'markdown' ? 'Second source line' : '  "a": ',
    line: 2,
    endLine: 2,
    from: language === 'markdown' ? 9 : 2,
    to: language === 'markdown' ? 27 : 8,
    diagnostics: [{
      severity: 'error',
      code: language === 'markdown' ? 'markdown-line' : 'json-syntax',
      message: language === 'markdown' ? 'Mock Markdown line issue.' : 'Expected a JSON value.',
      line: 2,
      column: language === 'markdown' ? 1 : 8,
      source: language,
    }],
    sourceEditor: sourceEditorCapabilitiesFor(language as Parameters<typeof sourceEditorCapabilitiesFor>[0]),
    selectLine: sourceMenuMockState.selectLine,
  };
}

function structuredSurfaceNavigation({
  format,
  preferredVisualSurface,
  jsonAnalysis = null,
  jsonArrayTableAvailable = false,
}: {
  format: 'json';
  preferredVisualSurface: 'tree' | 'table' | 'cards' | 'health';
  jsonAnalysis: ReturnType<typeof parseSourceFormatDiagnostics>['jsonAnalysis'];
  jsonArrayTableAvailable?: boolean;
}) {
  return createStructuredSurfaceNavigationModel({
    format,
    mode: 'visual',
    formatCapabilities: formatCapabilitiesFor(format),
    preferredVisualSurface,
    jsonAnalysis,
    jsonArrayTableAvailable,
  });
}

function minimalLayerTwoDocument() {
  return {
    references: {
      labels: [{ id: 'fig:one' }],
    },
    citations: {
      bibtexEntries: [{ key: 'doe2026', raw: '@article{doe2026}' }],
    },
    variables: {
      definitions: [{ name: 'alpha', value: '0.05', source: 'frontmatter' }],
    },
  } as unknown as ComponentProps<typeof AppEditorStage>['layerTwoDocument'];
}
