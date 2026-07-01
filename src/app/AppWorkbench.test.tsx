import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppWorkbench } from './AppWorkbench';
import { DEFAULT_METADATA } from './documentState';
import { formatCapabilitiesFor } from './formatCapabilities';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../components/AppTopbar', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    AppTopbar: (props: {
      activeMenu: string | null;
      dirty: boolean;
      filePath: string | null;
      onToggleMenu: (menu: string) => void;
      onCloseMenus: () => void;
      onSave: () => void;
    }) => React.createElement(
      'header',
      {
        'data-testid': 'topbar',
        'data-active-menu': props.activeMenu ?? '',
        'data-dirty': String(props.dirty),
        'data-file-path': props.filePath ?? '',
      },
      React.createElement('button', { type: 'button', onClick: () => props.onToggleMenu('file') }, 'toggle file'),
      React.createElement('button', { type: 'button', onClick: props.onCloseMenus }, 'close menus'),
      React.createElement('button', { type: 'button', onClick: props.onSave }, 'save'),
    ),
  };
});

vi.mock('../components/MarkdownToolbar', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    MarkdownToolbar: (props: {
      mode: string;
      nextFigureLabel: string;
      onInsertImage: () => void;
    }) => React.createElement(
      'section',
      {
        'data-testid': 'markdown-toolbar',
        'data-mode': props.mode,
        'data-next-figure-label': props.nextFigureLabel,
      },
      React.createElement('button', { type: 'button', onClick: props.onInsertImage }, 'insert image'),
    ),
  };
});

vi.mock('../components/FindReplacePanel', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    FindReplacePanel: (props: {
      markdown: string;
      onChange: (markdown: string) => void;
      onClose: () => void;
      onNavigate: (from: number, to: number) => void;
    }) => React.createElement(
      'section',
      { 'data-testid': 'find-panel', 'data-markdown': props.markdown },
      React.createElement('button', { type: 'button', onClick: () => props.onChange('found') }, 'change find'),
      React.createElement('button', { type: 'button', onClick: props.onClose }, 'close find'),
      React.createElement('button', { type: 'button', onClick: () => props.onNavigate(2, 7) }, 'navigate find'),
    ),
  };
});

vi.mock('./AppSidebar', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    AppSidebar: (props: {
      open: boolean;
      view: string;
      width: number;
      onOpen: () => void;
    }) => React.createElement(
      'aside',
      {
        'data-testid': 'app-sidebar',
        'data-open': String(props.open),
        'data-view': props.view,
        'data-width': String(props.width),
      },
      React.createElement('button', { type: 'button', onClick: props.onOpen }, 'open sidebar'),
    ),
  };
});

vi.mock('./AppEditorStage', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    AppEditorStage: (props: {
      mode: string;
      markdown: string;
      onMarkdownChange: (markdown: string) => void;
    }) => React.createElement(
      'main',
      {
        id: 'editor-stage',
        'data-testid': 'editor-stage',
        'data-mode': props.mode,
        'data-markdown': props.markdown,
      },
      React.createElement('button', { type: 'button', onClick: () => props.onMarkdownChange('edited') }, 'edit markdown'),
    ),
  };
});

vi.mock('../components/InspectorPane', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    InspectorPane: (props: { open: boolean; focusSection?: string | null }) => React.createElement(
      'aside',
      {
        'data-testid': 'inspector-pane',
        'data-open': String(props.open),
        'data-focus-section': props.focusSection ?? '',
      },
    ),
  };
});

vi.mock('../components/AmbientSuggestions', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    AmbientSuggestions: (props: {
      hasPasteReview: boolean;
      onOpenPasteReview: () => void;
    }) => React.createElement(
      'section',
      { 'data-testid': 'ambient-suggestions', 'data-has-paste-review': String(props.hasPasteReview) },
      React.createElement('button', { type: 'button', onClick: props.onOpenPasteReview }, 'open paste review'),
    ),
  };
});

vi.mock('../components/StatusBar', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    StatusBar: (props: {
      statusText: string;
      wordCount: number;
      onSaveNow: () => void;
    }) => React.createElement(
      'footer',
      {
        'data-testid': 'status-bar',
        'data-status-text': props.statusText,
        'data-word-count': String(props.wordCount),
      },
      React.createElement('button', { type: 'button', onClick: props.onSaveNow }, 'save now'),
    ),
  };
});

let container: HTMLDivElement;
let root: Root;

describe('AppWorkbench', () => {
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

  it('renders the workbench shell with grouped surfaces and layout state', () => {
    const defaultProps = createProps();
    const props = createProps({
      focusMode: true,
      activeTopbarMenu: 'file',
      outlineOpen: true,
      inspectorOpen: true,
      sidebarWidth: 412,
      sidebar: { ...defaultProps.sidebar, width: 412 },
    });

    renderWorkbench(props);

    expect(container.querySelector('.app-shell')?.className).toContain('focus-mode');
    expect(container.querySelector<HTMLAnchorElement>('.skip-link')?.getAttribute('href')).toBe('#editor-stage');
    expect(container.querySelector('.skip-link')?.textContent).toBe('Skip editor');
    expect(container.querySelector('[data-testid="topbar"]')?.getAttribute('data-active-menu')).toBe('file');
    expect(container.querySelector('[data-testid="markdown-toolbar"]')?.getAttribute('data-next-figure-label')).toBe('fig-2');
    expect(container.querySelector('[data-testid="app-sidebar"]')?.getAttribute('data-width')).toBe('412');
    expect(container.querySelector('[data-testid="editor-stage"]')?.getAttribute('data-markdown')).toBe('# Draft');
    expect(container.querySelector('[data-testid="inspector-pane"]')?.getAttribute('data-focus-section')).toBe('validation');
    expect(container.querySelector('[data-testid="ambient-suggestions"]')?.getAttribute('data-has-paste-review')).toBe('true');
    expect(container.querySelector('[data-testid="status-bar"]')?.getAttribute('data-word-count')).toBe('123');
    expect(container.querySelector('[data-testid="overlay-child"]')).not.toBeNull();

    const workbench = container.querySelector<HTMLElement>('.workbench');
    expect(workbench?.className).toContain('with-outline');
    expect(workbench?.className).toContain('with-inspector');
    expect(workbench?.style.getPropertyValue('--outline-width')).toBe('412px');
  });

  it('forwards topbar, toolbar, editor, ambient, and status actions through the boundary', () => {
    const props = createProps({
      onToggleTopbarMenu: vi.fn(),
      onCloseTopbarMenus: vi.fn(),
      topbar: { ...createProps().topbar, onSave: vi.fn() },
      toolbar: { ...createProps().toolbar, onInsertImage: vi.fn() },
      editorStage: { ...createProps().editorStage, onMarkdownChange: vi.fn() },
      ambientSuggestions: { ...createProps().ambientSuggestions, onOpenPasteReview: vi.fn() },
      statusBar: { ...createProps().statusBar, onSaveNow: vi.fn() },
    });

    renderWorkbench(props);
    clickButton('toggle file');
    clickButton('close menus');
    clickButton('save');
    clickButton('insert image');
    clickButton('edit markdown');
    clickButton('open paste review');
    clickButton('save now');

    expect(props.onToggleTopbarMenu).toHaveBeenCalledWith('file');
    expect(props.onCloseTopbarMenus).toHaveBeenCalledTimes(1);
    expect(props.topbar.onSave).toHaveBeenCalledTimes(1);
    expect(props.toolbar.onInsertImage).toHaveBeenCalledTimes(1);
    expect(props.editorStage.onMarkdownChange).toHaveBeenCalledWith('edited');
    expect(props.ambientSuggestions.onOpenPasteReview).toHaveBeenCalledTimes(1);
    expect(props.statusBar.onSaveNow).toHaveBeenCalledTimes(1);
  });

  it('renders and forwards find panel actions only when find state is open', () => {
    const closedProps = createProps({ findReplace: null });
    renderWorkbench(closedProps);
    expect(container.querySelector('[data-testid="find-panel"]')).toBeNull();

    const openProps = createProps({
      findReplace: {
        ...createProps().findReplace!,
        onChange: vi.fn(),
        onClose: vi.fn(),
        onNavigate: vi.fn(),
      },
    });
    renderWorkbench(openProps);

    clickButton('change find');
    clickButton('close find');
    clickButton('navigate find');

    expect(openProps.findReplace?.onChange).toHaveBeenCalledWith('found');
    expect(openProps.findReplace?.onClose).toHaveBeenCalledTimes(1);
    expect(openProps.findReplace?.onNavigate).toHaveBeenCalledWith(2, 7);
  });

  it('hides the Markdown toolbar for source-only formats', () => {
    const props = createProps({
      formatCapabilities: formatCapabilitiesFor('json'),
    });

    renderWorkbench(props);

    expect(container.querySelector('[data-testid="markdown-toolbar"]')).toBeNull();
    expect(container.querySelector('[data-testid="topbar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="editor-stage"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="status-bar"]')).not.toBeNull();
  });
});

function renderWorkbench(props: ComponentProps<typeof AppWorkbench>): void {
  act(() => {
    root.render(<AppWorkbench {...props} />);
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

function createProps(overrides: Partial<ComponentProps<typeof AppWorkbench>> = {}): ComponentProps<typeof AppWorkbench> {
  return {
    focusMode: false,
    skipToEditorLabel: 'Skip editor',
    activeTopbarMenu: null,
    onToggleTopbarMenu: vi.fn(),
    onCloseTopbarMenus: vi.fn(),
    formatCapabilities: formatCapabilitiesFor('markdown'),
    topbar: {
      mode: 'visual',
      format: 'markdown',
      filePath: 'C:\\docs\\paper.md',
      dirty: true,
      outlineOpen: true,
      inspectorOpen: true,
      focusMode: false,
      themeMode: 'light',
      currentVisualStyle: { label: 'ScieMD', shortLabel: 'ScieMD' },
      selectedVisualStyle: 'scienfy',
      recentFiles: [],
      hasPasteReview: false,
      onNew: vi.fn(),
      onOpen: vi.fn(),
      onOpenFolder: vi.fn(),
      onOpenRecent: vi.fn(),
      onSave: vi.fn(),
      onSaveAs: vi.fn(),
      onFind: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onCopyRichText: vi.fn(),
      onApplyScientificTypography: vi.fn(),
      onInsertMarkdown: vi.fn(),
      onInsertImage: vi.fn(),
      onInsertLink: vi.fn(),
      onInsertCitation: vi.fn(),
      onInsertVariable: vi.fn(),
      onInsertMermaid: vi.fn(),
      onInsertSvgFigure: vi.fn(),
      onInsertSemanticBlock: vi.fn(),
      onInsertProtectedBlock: vi.fn(),
      onInsertEditorComment: vi.fn(),
      onInsertHumanEditorComment: vi.fn(),
      onInsertTargetedInstruction: vi.fn(),
      onInsertVariantGroup: vi.fn(),
      onInsertReferencesDirective: vi.fn(),
      onReloadBibliography: vi.fn(),
      onSyncBibliography: vi.fn(),
      onCopyScieMDLlmSkill: vi.fn(),
      onGenerateScieMDLlmSkill: vi.fn(),
      onCopyStructuredContext: vi.fn(),
      onCopySelectedStructureContext: vi.fn(),
      onCopySchemaAwareJsonContext: vi.fn(),
      onCopyStructuredTableSample: vi.fn(),
      onCopyParserDiagnostics: vi.fn(),
      onCopyRedactedStructuredPreview: vi.fn(),
      onValidateStructuredClipboard: vi.fn(),
      onGenerateSubmissionReadiness: vi.fn(),
      onOpenPasteReview: vi.fn(),
      onOpenExportDialog: vi.fn(),
      onShowExportLog: vi.fn(),
      onPrintPreview: vi.fn(),
      onOpenTutorial: vi.fn(),
      onOpenFullTutorial: vi.fn(),
      onShowShortcuts: vi.fn(),
      onOpenTemplates: vi.fn(),
      onCheckTools: vi.fn(),
      onSetInkscapePath: vi.fn(),
      onExportDiagnosticsBundle: vi.fn(),
      onOpenSettings: vi.fn(),
      onShowAbout: vi.fn(),
      onOpenGithub: vi.fn(),
      onReportBug: vi.fn(),
      onOpenCommandPalette: vi.fn(),
      onOpenSlashMenu: vi.fn(),
      onModeChange: vi.fn(),
      onSetVisualStyle: vi.fn(),
      onSetThemeMode: vi.fn(),
      onIncreaseFont: vi.fn(),
      onDecreaseFont: vi.fn(),
      onResetFont: vi.fn(),
      onFormatHeading: vi.fn(),
      onFormatInline: vi.fn(),
      onToggleOutline: vi.fn(),
      onSidebarView: vi.fn(),
      onToggleInspector: vi.fn(),
      onToggleFocusMode: vi.fn(),
      onWindowMinimize: vi.fn(),
      onWindowMaximize: vi.fn(),
      onWindowClose: vi.fn(),
      onTitlebarMouseDown: vi.fn(),
      onTitlebarDoubleClick: vi.fn(),
    },
    toolbar: {
      mode: 'visual',
      visualEditor: undefined,
      onInsertMarkdown: vi.fn(),
      onInsertImage: vi.fn(),
      onInsertCitation: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onInsertLink: vi.fn(),
      onInsertVariable: vi.fn(),
      onInsertLlmNote: vi.fn(),
      onInsertHumanNote: vi.fn(),
      onInsertVariantGroup: vi.fn(),
      onOpenTablePicker: vi.fn(),
      nextFigureLabel: 'fig-2',
    },
    findReplace: {
      markdown: '# Draft',
      onChange: vi.fn(),
      onClose: vi.fn(),
      onNavigate: vi.fn(),
    },
    outlineOpen: true,
    inspectorOpen: false,
    sidebarWidth: 360,
    sidebar: {
      open: true,
      view: 'outline',
      width: 360,
      outline: { headings: [], activeHeadingId: null, onJump: vi.fn(), onInsertHeading: vi.fn() },
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
    },
    editorStage: {
      editorStageRef: { current: null },
      format: 'markdown',
      formatCapabilities: formatCapabilitiesFor('markdown'),
      mode: 'visual',
      filePath: 'C:\\docs\\paper.md',
      markdown: '# Draft',
      editorResetToken: 1,
      dropOverlayVisible: false,
      autosaveStatus: 'saved',
      statusText: 'Saved',
      saveQueueDepth: 0,
      startupOpenFailure: null,
      headings: [],
      activeHeadingId: null,
      activeNavigationLine: 1,
      navigationHeadings: [],
      visualEditor: undefined,
      layerTwoDocument: minimalLayerTwoDocument(),
      protectedBlocks: [],
      editorComments: [],
      targetedInstructions: [],
      variantGroups: [],
      citationCompletionKeys: [],
      selectedVariableName: null,
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
    },
    inspector: {
      open: true,
      focusSection: 'validation',
      data: {
        filePath: 'C:\\docs\\paper.md',
        mode: 'visual',
        metadata: DEFAULT_METADATA,
        validationIssues: [],
        insights: {
          firstHeading: 'Draft',
          excerpt: 'Draft excerpt',
          codeBlockCount: 0,
          imageReferences: [],
          longestLineLength: 7,
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
        visualStyleLabel: 'ScieMD',
        documentType: 'report',
        hasPasteReview: false,
        layerTwoDocument: minimalLayerTwoDocument(),
        manuscriptReadiness: {
          score: 80,
          status: 'needs-review',
          summary: 'Needs review.',
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
      },
      actions: {
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
      },
    },
    ambientSuggestions: {
      issues: [],
      hasPasteReview: true,
      onOpenPasteReview: vi.fn(),
    },
    statusBar: {
      formatCapabilities: formatCapabilitiesFor('markdown'),
      autosaveStatus: 'saved',
      statusText: 'Saved',
      headingPath: [],
      wordCount: 123,
      manuscriptScore: 80,
      manuscriptStatus: 'needs-review',
      errors: [],
      warnings: [],
      externalConflict: false,
      filePath: 'C:\\docs\\paper.md',
      onReviewConflict: vi.fn(),
      onSaveAnyway: vi.fn(),
      onReveal: vi.fn(),
      onReload: vi.fn(),
      onSaveNow: vi.fn(),
      onJumpToHeading: vi.fn(),
      onOpenReadiness: vi.fn(),
      onOpenValidation: vi.fn(),
    },
    children: <div data-testid="overlay-child" />,
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
    metadata: {
      title: null,
      author: null,
      date: null,
    },
  } as unknown as ComponentProps<typeof AppWorkbench>['editorStage']['layerTwoDocument'];
}
