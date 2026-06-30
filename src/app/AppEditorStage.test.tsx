import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppEditorStage } from './AppEditorStage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const editorBoundaryState = vi.hoisted(() => ({
  forceFallback: false,
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
    }) => React.createElement(
      'section',
      {
        'data-testid': 'visual-editor',
        'data-file-path': props.filePath ?? '',
        'data-reference-labels': props.referenceLabels.join(','),
        'data-citation-keys': props.citationKeys.join(','),
        'data-highlighted-variable': props.highlightedVariableName ?? '',
      },
      React.createElement('pre', null, props.markdown),
      React.createElement('button', { type: 'button', onClick: () => props.onChange('visual draft') }, 'change visual'),
      React.createElement('button', { type: 'button', onClick: () => props.onEditorReady({ id: 'visual-editor' }) }, 'ready visual'),
      React.createElement('button', { type: 'button', onClick: () => props.onInsertReady(() => undefined) }, 'insert ready visual'),
    ),
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
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
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

function createProps(overrides: Partial<ComponentProps<typeof AppEditorStage>> = {}): ComponentProps<typeof AppEditorStage> {
  return {
    editorStageRef: { current: null },
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
    onRetryStartupOpen: vi.fn(),
    onOpenStartupFallbackDocument: vi.fn(),
    onDismissStartupOpenFailure: vi.fn(),
    ...overrides,
  };
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
