import {
  useState,
  useMemo,
  type ClipboardEventHandler,
  type ComponentProps,
  type DragEventHandler,
  type KeyboardEventHandler,
  type MouseEvent as ReactMouseEvent,
  type MouseEventHandler,
  type RefObject,
} from 'react';
import { editorViewCtx, type Editor } from '@milkdown/kit/core';
import { toggleEmphasisCommand, toggleStrongCommand } from '@milkdown/kit/preset/commonmark';
import { callCommand } from '@milkdown/kit/utils';
import { TextSelection } from '@milkdown/prose/state';
import { convertDelimitedText, createJsonArrayTableModel, formatDefinitionFor, parseDelimitedText, structuredAnalysisCanRenderSurface } from '@sciemd/core';
import type { DocumentFormat, FormatDiagnostic, JsonVisualEditIntent, JsonlVisualEditIntent, StructuredAnalysisModel, StructuredNodeRef, TabularVisualEditIntent } from '@sciemd/core';
import { Bold, CircleAlert, Copy, Eye, FileCode2, GitBranch, Heading1, Heading2, Italic, LockKeyhole, MessageSquareText, Pencil, Pilcrow, Trash2, UserRound } from 'lucide-react';
import { ContextMenuCard, type ContextMenuSection } from '../components/ContextMenuCard';
import { EditorErrorBoundary } from '../components/EditorErrorBoundary';
import { FloatingFormatToolbar } from '../components/FloatingFormatToolbar';
import { MetadataRail } from '../components/MetadataRail';
import { QuickOutlineHover } from '../components/QuickOutlineHover';
import { SavePill } from '../components/SavePill';
import type { EditorSelectionSnapshot } from '../components/editorSelection';
import { JsonArrayTableView } from '../components/JsonArrayTableView';
import { JsonHealthPanel } from '../components/JsonHealthPanel';
import { JsonlRecordList } from '../components/JsonlRecordList';
import { JsonTreeView } from '../components/JsonTreeView';
import { SourceMarkdownEditor } from '../components/SourceMarkdownEditor';
import { SourceTextEditor, type SourceTextContextMenuRequest } from '../components/SourceTextEditor';
import { TabularTablePreview } from '../components/TabularTablePreview';
import { VisualMarkdownEditor } from '../components/VisualMarkdownEditor';
import type { EditorMode } from './documentState';
import type { FormatUiCapabilities } from './formatCapabilities';
import { parseSourceFormatDiagnostics } from './formatDiagnostics';
import type { JsonDocumentAnalysis, JsonlDocumentAnalysis, StructuredDocumentAnalysis, TabularDocumentAnalysis } from './formatDiagnostics';
import type { StructuredSurfaceNavigationModel } from './structuredSurfaceNavigation';
import type { StructuredConversionRequest } from './structuredConversionActions';
import { structuredOperationSectionsForTarget } from './structuredOperationRegistry';
import { structuredOperationSectionsToContextMenuSections } from '../components/structuredOperationMenu';
import { StartupOpenFailureBanner } from './StartupOpenFailureBanner';
import type { StartupOpenFailureState } from './startupOpenFailure';

interface AppEditorStageProps {
  editorStageRef: RefObject<HTMLElement | null>;
  format: DocumentFormat;
  formatCapabilities: FormatUiCapabilities;
  mode: EditorMode;
  filePath: string | null;
  sourceText?: string;
  markdown: string;
  editorResetToken: number;
  dropOverlayVisible: boolean;
  autosaveStatus: ComponentProps<typeof SavePill>['status'];
  statusText: string;
  saveQueueDepth: number;
  startupOpenFailure: StartupOpenFailureState | null;
  headings: ComponentProps<typeof QuickOutlineHover>['headings'];
  activeHeadingId: string | null;
  activeNavigationLine: ComponentProps<typeof MetadataRail>['currentLine'];
  navigationHeadings: ComponentProps<typeof VisualMarkdownEditor>['outlineHeadings'];
  visualEditor: Editor | undefined;
  layerTwoDocument: ComponentProps<typeof MetadataRail>['document'];
  protectedBlocks: ComponentProps<typeof MetadataRail>['protectedBlocks'];
  editorComments: ComponentProps<typeof MetadataRail>['editorComments'];
  targetedInstructions: ComponentProps<typeof MetadataRail>['targetedInstructions'];
  variantGroups: ComponentProps<typeof MetadataRail>['variantGroups'];
  citationCompletionKeys: string[];
  selectedVariableName: string | null;
  authorshipMarks: ComponentProps<typeof SourceMarkdownEditor>['authorshipMarks'];
  validationIssues: ComponentProps<typeof SourceMarkdownEditor>['validationIssues'];
  sourceDiagnostics?: FormatDiagnostic[];
  sourceParsingPending?: boolean;
  structuredModel?: StructuredAnalysisModel | null;
  structuredSurfaceNavigation?: StructuredSurfaceNavigationModel | null;
  jsonAnalysis?: JsonDocumentAnalysis | null;
  jsonlAnalysis?: JsonlDocumentAnalysis | null;
  structuredAnalysis?: StructuredDocumentAnalysis | null;
  tabularAnalysis?: TabularDocumentAnalysis | null;
  selectedJsonPath?: string | null;
  onJsonEditIntent?: (intent: JsonVisualEditIntent) => void;
  onJsonlEditIntent?: (intent: JsonlVisualEditIntent) => void;
  onJsonlCopyText?: (content: string, label: string) => void;
  onTabularEditIntent?: (intent: TabularVisualEditIntent) => void;
  onTabularCopyText?: (content: string, label: string) => void;
  onStructuredConversionAction?: (request: StructuredConversionRequest) => void;
  onRevealStructuredSource?: (node: StructuredNodeRef) => void;
  onKeyDownCapture: KeyboardEventHandler<HTMLElement>;
  onPasteCapture: ClipboardEventHandler<HTMLElement>;
  onDragEnterCapture: DragEventHandler<HTMLElement>;
  onDragLeaveCapture: DragEventHandler<HTMLElement>;
  onDropCapture: DragEventHandler<HTMLElement>;
  onDragOver: DragEventHandler<HTMLElement>;
  onJumpToHeading: ComponentProps<typeof QuickOutlineHover>['onJump'];
  onMarkdownChange: (markdown: string) => void;
  onEditorReset: () => void;
  onVisualEditorReady: ComponentProps<typeof VisualMarkdownEditor>['onEditorReady'];
  onVisualInsertReady: ComponentProps<typeof VisualMarkdownEditor>['onInsertReady'];
  onVisualJumpReady: ComponentProps<typeof VisualMarkdownEditor>['onJumpReady'];
  onVisualFindReady: ComponentProps<typeof VisualMarkdownEditor>['onFindReady'];
  onVisualHistoryReady: ComponentProps<typeof VisualMarkdownEditor>['onHistoryReady'];
  onSourceInsertReady: ComponentProps<typeof SourceMarkdownEditor>['onInsertReady'];
  onSourceJumpReady: ComponentProps<typeof SourceMarkdownEditor>['onJumpReady'];
  onSourceFindReady: ComponentProps<typeof SourceMarkdownEditor>['onFindReady'];
  onSourceHistoryReady: ComponentProps<typeof SourceMarkdownEditor>['onHistoryReady'];
  onSelectionTextReady: ComponentProps<typeof VisualMarkdownEditor>['onSelectionTextReady'];
  onCursorLineChange: ComponentProps<typeof VisualMarkdownEditor>['onCursorLineChange'];
  onViewportLineChange: ComponentProps<typeof VisualMarkdownEditor>['onViewportLineChange'];
  onJsonSelectedPathChange?: (path: string) => void;
  onLockViolation: (message: string) => void;
  onToast: ComponentProps<typeof VisualMarkdownEditor>['onToast'];
  confirmText: ComponentProps<typeof VisualMarkdownEditor>['confirmText'];
  onEditCitation: ComponentProps<typeof VisualMarkdownEditor>['onEditCitation'];
  onEditVariable: ComponentProps<typeof VisualMarkdownEditor>['onEditVariable'];
  getSelectionSnapshot: ComponentProps<typeof FloatingFormatToolbar>['getSelectionSnapshot'];
  onLockSelection: ComponentProps<typeof FloatingFormatToolbar>['onLockSelection'];
  onCommentSelection: ComponentProps<typeof FloatingFormatToolbar>['onCommentSelection'];
  onHumanCommentSelection: ComponentProps<typeof FloatingFormatToolbar>['onHumanCommentSelection'];
  onVariantSelection: ComponentProps<typeof FloatingFormatToolbar>['onVariantSelection'];
  onCopySelection: ComponentProps<typeof FloatingFormatToolbar>['onCopySelection'];
  onHeadingSelection: ComponentProps<typeof FloatingFormatToolbar>['onHeadingSelection'];
  onBlockSelection: ComponentProps<typeof FloatingFormatToolbar>['onBlockSelection'];
  onJumpToLine: ComponentProps<typeof MetadataRail>['onJumpToLine'];
  onOpenReferences: ComponentProps<typeof MetadataRail>['onOpenReferences'];
  onOpenData: ComponentProps<typeof MetadataRail>['onOpenData'];
  onSwitchToVisualMode: () => void;
  onRetryStartupOpen: () => void;
  onOpenStartupFallbackDocument: () => void;
  onDismissStartupOpenFailure: () => void;
}

interface VisualSelectionContextMenuState {
  position: { x: number; y: number };
  selection: EditorSelectionSnapshot;
  selectionRanges: Range[];
}

interface VisualBlockContextMenuState {
  position: { x: number; y: number };
  label: string;
  text: string;
  selectionRanges: Range[];
  proseSelection: VisualProseSelectionRange | null;
  atom: VisualAtomContext | null;
}

interface VisualAtomContext {
  label: string;
  editButton: HTMLButtonElement | null;
  deleteButton: HTMLButtonElement | null;
}

interface VisualProseSelectionRange {
  from: number;
  to: number;
}

interface SourceContextMenuState {
  request: SourceTextContextMenuRequest;
}

export function AppEditorStage({
  editorStageRef,
  format,
  formatCapabilities,
  mode,
  filePath,
  sourceText,
  markdown,
  editorResetToken,
  dropOverlayVisible,
  autosaveStatus,
  statusText,
  saveQueueDepth,
  startupOpenFailure,
  headings,
  activeHeadingId,
  activeNavigationLine,
  navigationHeadings,
  visualEditor,
  layerTwoDocument,
  protectedBlocks,
  editorComments,
  targetedInstructions,
  variantGroups,
  citationCompletionKeys,
  selectedVariableName,
  authorshipMarks,
  validationIssues,
  sourceDiagnostics = [],
  sourceParsingPending = false,
  structuredModel = null,
  structuredSurfaceNavigation = null,
  jsonAnalysis = null,
  jsonlAnalysis = null,
  structuredAnalysis = null,
  tabularAnalysis = null,
  selectedJsonPath = null,
  onJsonEditIntent,
  onJsonlEditIntent,
  onJsonlCopyText,
  onTabularEditIntent,
  onTabularCopyText,
  onStructuredConversionAction,
  onRevealStructuredSource,
  onKeyDownCapture,
  onPasteCapture,
  onDragEnterCapture,
  onDragLeaveCapture,
  onDropCapture,
  onDragOver,
  onJumpToHeading,
  onMarkdownChange,
  onEditorReset,
  onVisualEditorReady,
  onVisualInsertReady,
  onVisualJumpReady,
  onVisualFindReady,
  onVisualHistoryReady,
  onSourceInsertReady,
  onSourceJumpReady,
  onSourceFindReady,
  onSourceHistoryReady,
  onSelectionTextReady,
  onCursorLineChange,
  onViewportLineChange,
  onJsonSelectedPathChange,
  onLockViolation,
  onToast,
  confirmText,
  onEditCitation,
  onEditVariable,
  getSelectionSnapshot,
  onLockSelection,
  onCommentSelection,
  onHumanCommentSelection,
  onVariantSelection,
  onCopySelection,
  onHeadingSelection,
  onBlockSelection,
  onJumpToLine,
  onOpenReferences,
  onOpenData,
  onSwitchToVisualMode,
  onRetryStartupOpen,
  onOpenStartupFallbackDocument,
  onDismissStartupOpenFailure,
}: AppEditorStageProps) {
  const [visualSelectionContextMenu, setVisualSelectionContextMenu] = useState<VisualSelectionContextMenuState | null>(null);
  const [visualBlockContextMenu, setVisualBlockContextMenu] = useState<VisualBlockContextMenuState | null>(null);
  const [sourceContextMenu, setSourceContextMenu] = useState<SourceContextMenuState | null>(null);
  const activeSourceText = sourceText ?? markdown;
  const canRenderTree = structuredModel
    ? structuredAnalysisCanRenderSurface(structuredModel, 'tree')
    : formatCapabilities.canUseStructuredVisualMode;
  const canRenderJsonTree = canRenderTree
    && format === 'json'
    && (structuredModel ? structuredAnalysisCanRenderSurface(structuredModel, 'tree') : jsonAnalysis?.status === 'valid')
    && Boolean(jsonAnalysis?.parseResult.parsed);
  const canRenderStructuredTree = canRenderTree
    && (format === 'yaml' || format === 'toml' || format === 'xml')
    && (structuredModel ? structuredAnalysisCanRenderSurface(structuredModel, 'tree') : structuredAnalysis?.status === 'valid')
    && Boolean(structuredAnalysis?.parseResult.parsed);
  const canRenderJsonlRecords = (
    structuredModel
      ? structuredAnalysisCanRenderSurface(structuredModel, 'records')
      : formatCapabilities.canUseRecordList
  ) && Boolean(jsonlAnalysis?.parseResult.parsed);
  const canRenderTabularPreview = (
    structuredModel
      ? structuredAnalysisCanRenderSurface(structuredModel, 'table')
      : formatCapabilities.canUseTablePreview && tabularAnalysis?.status !== 'invalid'
  ) && Boolean(tabularAnalysis?.parseResult.parsed);
  const waitingForStructuredVisualSurface = mode === 'visual'
    && sourceParsingPending
    && (
      formatCapabilities.canUseStructuredVisualMode
      || formatCapabilities.canUseRecordList
      || formatCapabilities.canUseTablePreview
    );
  const canUseVisualSurface = formatCapabilities.canUseVisualMarkdown
    || canRenderJsonTree
    || canRenderStructuredTree
    || canRenderJsonlRecords
    || canRenderTabularPreview
    || waitingForStructuredVisualSurface;
  const activeMode: EditorMode = canUseVisualSurface ? mode : 'source';
  const activeStructuredSurface = structuredSurfaceNavigation?.activeSurface ?? null;
  const renderedMode: EditorMode = activeStructuredSurface === 'source' ? 'source' : activeMode;
  const fallbackIsMarkdownVisual = renderedMode === 'visual' && formatCapabilities.canUseVisualMarkdown;
  const fallbackIsJsonTree = renderedMode === 'visual' && activeStructuredSurface !== 'health' && canRenderJsonTree;
  const fallbackIsJsonArray = renderedMode === 'visual' && (activeStructuredSurface === 'table' || activeStructuredSurface === 'cards');
  const fallbackIsJsonHealth = renderedMode === 'visual' && activeStructuredSurface === 'health';
  const fallbackIsStructuredTree = renderedMode === 'visual' && canRenderStructuredTree;
  const fallbackIsJsonlRecordList = renderedMode === 'visual' && canRenderJsonlRecords;
  const fallbackIsTabularPreview = renderedMode === 'visual' && canRenderTabularPreview;
  const visualSelectionContextMenuEnabled = renderedMode === 'visual' && formatCapabilities.canUseVisualMarkdown;
  const sourceContextMenuCanSwitchToVisual = renderedMode === 'source' && canUseVisualSurface;
  const jsonArrayViewMode = activeStructuredSurface === 'cards'
    ? 'cards'
    : activeStructuredSurface === 'table'
      ? 'table'
      : undefined;
  const jsonArrayTableModel = useMemo(() => (
    canRenderJsonTree && jsonAnalysis?.parseResult.parsed
      ? createJsonArrayTableModel(
        jsonAnalysis.parseResult.parsed.value,
        jsonAnalysis.parseResult.parsed.sourceMap,
        { selectedPath: selectedJsonPath, viewMode: jsonArrayViewMode },
      )
      : null
  ), [canRenderJsonTree, jsonAnalysis?.parseResult.parsed, jsonArrayViewMode, selectedJsonPath]);

  const handleStageContextMenu: MouseEventHandler<HTMLElement> = (event) => {
    if (!visualSelectionContextMenuEnabled) return;

    const eventTargetElement = elementFromEventTarget(event.target);
    if (eventTargetElement?.closest('.context-menu-card')) return;

    const visualRoot = event.currentTarget.querySelector<HTMLElement>('.visual-editor');
    const selectedText = selectedTextInsideVisualRoot(visualRoot, event.target);
    if (!selectedText) {
      setVisualSelectionContextMenu(null);
      const blockContext = visualBlockContextFromEvent(event, visualRoot, visualEditor);
      if (!blockContext) {
        setVisualBlockContextMenu(null);
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setSourceContextMenu(null);
      setVisualBlockContextMenu({
        ...blockContext,
        position: { x: event.clientX, y: event.clientY },
      });
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const selectionSnapshot = getSelectionSnapshot();
    setSourceContextMenu(null);
    setVisualBlockContextMenu(null);
    setVisualSelectionContextMenu({
      position: { x: event.clientX, y: event.clientY },
      selection: selectionSnapshot.text.trim()
        ? selectionSnapshot
        : { text: selectedText, surface: 'visual' },
      selectionRanges: cloneCurrentSelectionRanges(),
    });
  };

  const handleSourceContextMenuRequest = (request: SourceTextContextMenuRequest) => {
    if (request.kind === 'selection' && !request.text.trim()) {
      setSourceContextMenu(null);
      return false;
    }
    setVisualSelectionContextMenu(null);
    setVisualBlockContextMenu(null);
    setSourceContextMenu({ request });
    return true;
  };

  const copyContextText = (content: string, label: string) => {
    const copyPromise = navigator.clipboard?.writeText(content);
    if (!copyPromise) {
      onToast?.('Clipboard is not available in this window.', 'warning');
      return;
    }
    void copyPromise
      .then(() => onToast?.(`${label} copied.`, 'success'))
      .catch(() => onToast?.(`Could not copy ${label.toLowerCase()}.`, 'error'));
  };

  const restoreVisualBlockContextSelection = (context: VisualBlockContextMenuState) => {
    restoreSelectionRanges(context.selectionRanges);
    restoreVisualEditorSelection(visualEditor, context.proseSelection);
  };

  const currentVisualBlockSelectionSnapshot = (context: VisualBlockContextMenuState): EditorSelectionSnapshot => {
    restoreVisualBlockContextSelection(context);
    const selectionSnapshot = getSelectionSnapshot();
    return selectionSnapshot.text.trim()
      ? selectionSnapshot
      : { text: context.text, surface: 'visual' };
  };

  const copyVisualBlockMarkdown = (context: VisualBlockContextMenuState) => {
    const selectionSnapshot = currentVisualBlockSelectionSnapshot(context);
    const sourceBlock = sourceLinesForSelection(markdown, selectionSnapshot);
    if (!sourceBlock) {
      onToast?.('Could not map this visual block back to source Markdown yet.', 'warning');
      return;
    }
    copyContextText(sourceBlock, `${context.label} Markdown`);
  };

  const visualSelectionContextMenuSections: Array<ContextMenuSection> = visualSelectionContextMenu ? [
    {
      id: 'text-formatting',
      label: 'Text formatting',
      items: [
        {
          id: 'bold',
          label: 'Bold',
          icon: <Bold size={18} />,
          shortcut: 'Ctrl+B',
          disabled: !visualEditor,
          disabledReason: 'Visual editor is still loading.',
          onSelect: () => {
            restoreSelectionRanges(visualSelectionContextMenu.selectionRanges);
            visualEditor?.action(callCommand(toggleStrongCommand.key));
          },
        },
        {
          id: 'italic',
          label: 'Italic',
          icon: <Italic size={18} />,
          shortcut: 'Ctrl+I',
          disabled: !visualEditor,
          disabledReason: 'Visual editor is still loading.',
          onSelect: () => {
            restoreSelectionRanges(visualSelectionContextMenu.selectionRanges);
            visualEditor?.action(callCommand(toggleEmphasisCommand.key));
          },
        },
        {
          id: 'heading-1',
          label: 'Convert to H1',
          icon: <Heading1 size={18} />,
          onSelect: () => {
            restoreSelectionRanges(visualSelectionContextMenu.selectionRanges);
            onHeadingSelection(1);
          },
        },
        {
          id: 'heading-2',
          label: 'Convert to H2',
          icon: <Heading2 size={18} />,
          onSelect: () => {
            restoreSelectionRanges(visualSelectionContextMenu.selectionRanges);
            onHeadingSelection(2);
          },
        },
      ],
    },
    {
      id: 'sciemd-actions',
      label: 'ScieMD actions',
      items: [
        {
          id: 'note-llm',
          label: 'Note to LLM',
          icon: <MessageSquareText size={18} />,
          onSelect: () => {
            restoreSelectionRanges(visualSelectionContextMenu.selectionRanges);
            onCommentSelection(visualSelectionContextMenu.selection);
          },
        },
        {
          id: 'note-human',
          label: 'Note to Human',
          icon: <UserRound size={18} />,
          onSelect: () => {
            restoreSelectionRanges(visualSelectionContextMenu.selectionRanges);
            onHumanCommentSelection(visualSelectionContextMenu.selection);
          },
        },
        {
          id: 'lock-section',
          label: 'Lock section',
          icon: <LockKeyhole size={18} />,
          onSelect: () => {
            restoreSelectionRanges(visualSelectionContextMenu.selectionRanges);
            onLockSelection();
          },
        },
        {
          id: 'text-versions',
          label: 'Text versions',
          icon: <GitBranch size={18} />,
          onSelect: () => {
            restoreSelectionRanges(visualSelectionContextMenu.selectionRanges);
            onVariantSelection();
          },
        },
        {
          id: 'wrap-block',
          label: 'Wrap in block',
          icon: <Pilcrow size={18} />,
          onSelect: () => {
            restoreSelectionRanges(visualSelectionContextMenu.selectionRanges);
            onBlockSelection();
          },
        },
      ],
    },
    {
      id: 'clipboard',
      label: 'Clipboard',
      items: [
        {
          id: 'copy-selection',
          label: 'Copy',
          icon: <Copy size={18} />,
          shortcut: 'Ctrl+C',
          onSelect: () => {
            restoreSelectionRanges(visualSelectionContextMenu.selectionRanges);
            onCopySelection();
          },
        },
      ],
    },
  ] : [];
  const visualBlockContextMenuSections: Array<ContextMenuSection> = visualBlockContextMenu ? [
    {
      id: 'visual-block-selection',
      label: visualBlockContextMenu.atom ? visualBlockContextMenu.atom.label : visualBlockContextMenu.label,
      items: [
        {
          id: 'select-visual-block',
          label: 'Select block',
          icon: <Pilcrow size={18} />,
          disabled: visualBlockContextMenu.selectionRanges.length === 0 && !visualBlockContextMenu.proseSelection,
          disabledReason: 'This visual block cannot be selected.',
          onSelect: () => restoreVisualBlockContextSelection(visualBlockContextMenu),
        },
      ],
    },
    {
      id: 'visual-block-copy',
      label: 'Clipboard',
      items: [
        {
          id: 'copy-visual-block',
          label: 'Copy',
          icon: <Copy size={18} />,
          submenu: [
            {
              id: 'visual-block-copy-options',
              items: [
                {
                  id: 'copy-visual-block-text',
                  label: 'Copy block text',
                  icon: <Copy size={18} />,
                  disabled: !visualBlockContextMenu.text.trim(),
                  disabledReason: 'This visual block has no readable text.',
                  onSelect: () => copyContextText(visualBlockContextMenu.text, `${visualBlockContextMenu.label} text`),
                },
                {
                  id: 'copy-visual-block-markdown',
                  label: 'Copy block Markdown',
                  icon: <FileCode2 size={18} />,
                  disabled: !visualBlockContextMenu.proseSelection,
                  disabledReason: 'This visual block is not mapped to the editor document.',
                  onSelect: () => copyVisualBlockMarkdown(visualBlockContextMenu),
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'visual-block-sciemd-actions',
      label: 'ScieMD actions',
      items: [
        {
          id: 'note-visual-block-llm',
          label: 'Note to LLM',
          icon: <MessageSquareText size={18} />,
          disabled: !visualBlockContextMenu.text.trim(),
          disabledReason: 'This visual block has no readable text.',
          onSelect: () => onCommentSelection(currentVisualBlockSelectionSnapshot(visualBlockContextMenu)),
        },
        {
          id: 'note-visual-block-human',
          label: 'Note to Human',
          icon: <UserRound size={18} />,
          disabled: !visualBlockContextMenu.text.trim(),
          disabledReason: 'This visual block has no readable text.',
          onSelect: () => onHumanCommentSelection(currentVisualBlockSelectionSnapshot(visualBlockContextMenu)),
        },
        {
          id: 'lock-visual-block',
          label: 'Lock block',
          icon: <LockKeyhole size={18} />,
          disabled: !visualBlockContextMenu.text.trim(),
          disabledReason: 'This visual block has no readable text.',
          onSelect: () => {
            restoreVisualBlockContextSelection(visualBlockContextMenu);
            onLockSelection();
          },
        },
        {
          id: 'versions-visual-block',
          label: 'Text versions',
          icon: <GitBranch size={18} />,
          disabled: !visualBlockContextMenu.text.trim(),
          disabledReason: 'This visual block has no readable text.',
          onSelect: () => {
            restoreVisualBlockContextSelection(visualBlockContextMenu);
            onVariantSelection();
          },
        },
        {
          id: 'wrap-visual-block',
          label: 'Wrap in block',
          icon: <Pilcrow size={18} />,
          disabled: !visualBlockContextMenu.text.trim(),
          disabledReason: 'This visual block has no readable text.',
          onSelect: () => {
            restoreVisualBlockContextSelection(visualBlockContextMenu);
            onBlockSelection();
          },
        },
      ],
    },
    ...(visualBlockContextMenu.atom ? [{
      id: 'visual-atom-actions',
      label: 'Visual atom',
      items: [
        {
          id: 'edit-visual-atom',
          label: 'Edit visual atom',
          icon: <Pencil size={18} />,
          disabled: !visualBlockContextMenu.atom.editButton,
          disabledReason: 'This visual atom is not editable from visual mode.',
          onSelect: () => visualBlockContextMenu.atom?.editButton?.click(),
        },
        {
          id: 'delete-visual-atom',
          label: 'Delete visual atom',
          icon: <Trash2 size={18} />,
          danger: true,
          disabled: !visualBlockContextMenu.atom.deleteButton,
          disabledReason: 'This visual atom cannot be deleted from this view.',
          onSelect: () => visualBlockContextMenu.atom?.deleteButton?.click(),
        },
      ],
    }] satisfies Array<ContextMenuSection> : []),
  ] : [];
  const validateSourceText = (text: string, label: string) => {
    const request = sourceContextMenu?.request;
    if (!request) return;
    const content = text.trim();
    if (!content) {
      onToast?.(`${label} is empty.`, 'warning');
      return;
    }
    const diagnostics = parseSourceFormatDiagnostics(request.language, text, null).diagnostics;
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    const warnings = diagnostics.filter((diagnostic) => diagnostic.severity !== 'error');
    const formatName = formatDefinitionFor(request.language)?.label ?? request.language.toUpperCase();
    if (errors.length > 0) {
      onToast?.(`${label} is not valid ${formatName}: ${errors[0]?.message ?? 'parser error'}`, 'error');
      return;
    }
    if (warnings.length > 0) {
      onToast?.(`${label} parsed as ${formatName} with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`, 'warning');
      return;
    }
    onToast?.(`${label} is valid ${formatName}.`, 'success');
  };

  const validateClipboardSourceText = () => {
    const readClipboard = navigator.clipboard?.readText;
    if (!readClipboard) {
      onToast?.('Clipboard text is not available in this window.', 'warning');
      return;
    }
    void readClipboard.call(navigator.clipboard)
      .then((clipboardText) => validateSourceText(clipboardText, 'Clipboard'))
      .catch(() => onToast?.('Could not read clipboard text.', 'error'));
  };

  const convertSourceSelectionToJson = () => {
    const request = sourceContextMenu?.request;
    if (!request) return;
    if (request.language !== 'csv' && request.language !== 'tsv') {
      onToast?.('Source selection conversion is only available for CSV and TSV text in this round.', 'warning');
      return;
    }
    const text = request.text.trim();
    if (!text) {
      onToast?.('Select delimited source text before converting.', 'warning');
      return;
    }
    const parsed = parseDelimitedText(text, {
      delimiter: request.language === 'tsv' ? '\t' : undefined,
      maxRows: 500,
    });
    const blockingError = parsed.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
    if (blockingError) {
      onToast?.(`Selection could not be converted: ${blockingError.message}`, 'error');
      return;
    }
    if (parsed.columnCount < 2 || parsed.dataRowCount < 1) {
      onToast?.('Selection does not look like a table with headers and data rows.', 'warning');
      return;
    }
    const conversion = convertDelimitedText(parsed, 'json');
    copyContextText(conversion.content, 'Selection JSON array');
  };

  const sourceContextMenuSections: Array<ContextMenuSection> = sourceContextMenu
    ? structuredOperationSectionsToContextMenuSections(
      structuredOperationSectionsForTarget({
        kind: 'source',
        selection: sourceContextMenu.request.kind === 'selection',
        sameLine: sourceContextMenu.request.line === sourceContextMenu.request.endLine,
        canCopyLine: sourceContextMenu.request.selectedLinesText.length > 0,
        canSwitchToVisual: sourceContextMenuCanSwitchToVisual,
        hasDiagnostics: sourceContextMenu.request.diagnostics.length > 0,
        contextOperations: sourceContextMenu.request.sourceEditor.contextMenuOperations,
        canValidateSelection: sourceContextMenu.request.kind === 'selection' && sourceContextMenu.request.text.trim().length > 0,
        canValidateClipboard: Boolean(navigator.clipboard?.readText),
        canConvertSelection: (
          sourceContextMenu.request.kind === 'selection'
          && sourceContextMenu.request.text.trim().length > 0
          && (sourceContextMenu.request.language === 'csv' || sourceContextMenu.request.language === 'tsv')
        ),
        validateSelectionDisabledReason: 'Select source text before validating a fragment.',
        validateClipboardDisabledReason: 'Clipboard text is not available in this window.',
        convertSelectionDisabledReason: sourceContextMenu.request.language === 'csv' || sourceContextMenu.request.language === 'tsv'
          ? 'Select delimited source text before converting.'
          : 'Selection conversion is available for CSV and TSV source.',
      }),
      {
        copyText: () => copyContextText(sourceContextMenu.request.text, 'Selection'),
        copyLine: () => copyContextText(
          sourceContextMenu.request.selectedLinesText,
          sourceContextMenu.request.line === sourceContextMenu.request.endLine ? 'Line' : 'Selected lines',
        ),
        selectLine: sourceContextMenu.request.selectLine,
        switchToVisual: onSwitchToVisualMode,
        copyDiagnostics: () => copyContextText(
          formatSourceDiagnosticsForClipboard(sourceContextMenu.request),
          sourceContextMenu.request.diagnostics.length === 1 ? 'Line diagnostic' : 'Line diagnostics',
        ),
        validateSelection: () => validateSourceText(sourceContextMenu.request.text, 'Selection'),
        validateClipboard: validateClipboardSourceText,
        convertSelection: convertSourceSelectionToJson,
      },
    )
    : [];

  return (
    <main
      id="editor-stage"
      ref={editorStageRef}
      className="editor-stage"
      tabIndex={-1}
      onKeyDownCapture={onKeyDownCapture}
      onPasteCapture={onPasteCapture}
      onDragEnterCapture={onDragEnterCapture}
      onDragLeaveCapture={onDragLeaveCapture}
      onDropCapture={onDropCapture}
      onDragOver={onDragOver}
      onContextMenu={handleStageContextMenu}
    >
      {dropOverlayVisible && (
        <div className="editor-drop-overlay" aria-hidden="true">
          <div>
            <strong>Drop into ScieMD</strong>
            <span>Images are copied into assets. Markdown files open as documents.</span>
          </div>
        </div>
      )}
      <SavePill status={autosaveStatus} text={statusText} queueDepth={saveQueueDepth} />
      {startupOpenFailure && (
        <StartupOpenFailureBanner
          failure={startupOpenFailure}
          onRetry={onRetryStartupOpen}
          onOpenDocument={onOpenStartupFallbackDocument}
          onDismiss={onDismissStartupOpenFailure}
        />
      )}
      <QuickOutlineHover headings={headings} activeHeadingId={activeHeadingId} onJump={onJumpToHeading} onCopyFeedback={onToast} />
      <EditorErrorBoundary
        resetKey={`${filePath ?? 'untitled'}:${format}:${renderedMode}:${activeStructuredSurface ?? 'default'}:${editorResetToken}`}
        fallback={(error, reset) => (
          <div className="editor-fallback">
            <div className="editor-fallback-banner">
              <strong>{fallbackIsMarkdownVisual ? 'Visual editor could not render this view.' : fallbackIsJsonArray ? 'JSON array surface could not render this view.' : fallbackIsJsonHealth ? 'JSON health could not render this view.' : fallbackIsJsonTree ? 'JSON tree could not render this view.' : fallbackIsStructuredTree ? 'Structured tree could not render this view.' : fallbackIsJsonlRecordList ? 'JSONL records could not render this view.' : fallbackIsTabularPreview ? 'Table preview could not render this view.' : 'Source editor could not render this view.'}</strong>
              <span>{error.message || 'The editor failed to render this document.'}</span>
              <button
                onClick={() => {
                  onEditorReset();
                  reset();
                }}
              >
                {fallbackIsMarkdownVisual ? 'Retry visual editor' : fallbackIsJsonArray ? 'Retry array view' : fallbackIsJsonHealth ? 'Retry health' : fallbackIsJsonTree || fallbackIsStructuredTree ? 'Retry tree' : fallbackIsJsonlRecordList ? 'Retry records' : fallbackIsTabularPreview ? 'Retry table' : 'Retry editor'}
              </button>
            </div>
            <textarea
              className="editor-fallback-raw"
              aria-label={renderedMode === 'visual' && formatCapabilities.canUseVisualMarkdown ? 'Raw Markdown fallback' : 'Raw source fallback'}
              value={activeSourceText}
              onChange={(event) => onMarkdownChange(event.target.value)}
            />
          </div>
        )}
      >
        {renderedMode === 'visual' && formatCapabilities.canUseVisualMarkdown ? (
          <VisualMarkdownEditor
            markdown={markdown}
            filePath={filePath}
            onChange={onMarkdownChange}
            onEditorReady={onVisualEditorReady}
            onInsertReady={onVisualInsertReady}
            onJumpReady={onVisualJumpReady}
            onFindReady={onVisualFindReady}
            onHistoryReady={onVisualHistoryReady}
            onSelectionTextReady={onSelectionTextReady}
            onCursorLineChange={onCursorLineChange}
            onViewportLineChange={onViewportLineChange}
            outlineHeadings={navigationHeadings}
            onLockViolation={onLockViolation}
            onToast={onToast}
            confirmText={confirmText}
            referenceLabels={layerTwoDocument.references.labels.map((label) => label.id)}
            citationKeys={citationCompletionKeys}
            citationEntries={layerTwoDocument.citations.bibtexEntries}
            variableDefinitions={layerTwoDocument.variables.definitions}
            highlightedVariableName={selectedVariableName}
            onEditCitation={onEditCitation}
            onEditVariable={onEditVariable}
          />
        ) : renderedMode === 'visual' && activeStructuredSurface === 'health' && format === 'json' ? (
          <JsonHealthPanel
            analysis={jsonAnalysis}
            selectedPath={selectedJsonPath}
            onSelectedPathChange={onJsonSelectedPathChange}
          />
        ) : renderedMode === 'visual' && (activeStructuredSurface === 'table' || activeStructuredSurface === 'cards') && jsonArrayTableModel ? (
          <JsonArrayTableView
            model={jsonArrayTableModel}
            sourceText={activeSourceText}
            editable={formatCapabilities.canEditJsonVisualTree && !sourceParsingPending}
            onEditIntent={onJsonEditIntent}
            onRevealSource={onRevealStructuredSource}
            onCopyText={(content, label) => copyContextText(content, label)}
            onUnsupportedEdit={(message) => onToast?.(message, 'warning')}
          />
        ) : renderedMode === 'visual' && canRenderJsonTree && jsonAnalysis?.parseResult.parsed ? (
          <JsonTreeView
            key={`json-tree:${filePath ?? 'untitled'}:${format}`}
            value={jsonAnalysis.parseResult.parsed.value}
            sourceMap={jsonAnalysis.parseResult.parsed.sourceMap}
            sourceText={activeSourceText}
            schemaValidation={jsonAnalysis.parseResult.parsed.schemaValidation}
            editable={formatCapabilities.canEditJsonVisualTree && !sourceParsingPending}
            selectedPath={selectedJsonPath}
            onSelectedPathChange={onJsonSelectedPathChange}
            onEditIntent={onJsonEditIntent}
            onRevealSource={onRevealStructuredSource}
            onUnsupportedEdit={(message) => onToast?.(message, 'warning')}
          />
        ) : renderedMode === 'visual' && canRenderStructuredTree && structuredAnalysis?.parseResult.parsed ? (
          <JsonTreeView
            key={`structured-tree:${filePath ?? 'untitled'}:${format}`}
            value={structuredAnalysis.parseResult.parsed.value}
            label={`${formatLabel(format)} tree`}
            sourceMap={structuredAnalysis.parseResult.parsed.sourceMap}
            preservationWarnings={structuredAnalysis.parseResult.parsed.warnings}
            jsonPreview={structuredAnalysis.parseResult.parsed.jsonPreview}
            selectedPath={selectedJsonPath}
            onSelectedPathChange={onJsonSelectedPathChange}
            onRevealSource={onRevealStructuredSource}
          />
        ) : renderedMode === 'visual' && canRenderJsonlRecords ? (
          <JsonlRecordList
            analysis={jsonlAnalysis}
            sourceText={activeSourceText}
            editable={formatCapabilities.canUseRecordList}
            onEditIntent={onJsonlEditIntent}
            onCopyText={onJsonlCopyText}
            onConversionAction={onStructuredConversionAction}
            onJumpToLine={onJumpToLine}
            onUnsupportedEdit={(message) => onToast?.(message, 'warning')}
          />
        ) : renderedMode === 'visual' && canRenderTabularPreview ? (
          <TabularTablePreview
            analysis={tabularAnalysis}
            sourceText={activeSourceText}
            editable={formatCapabilities.canUseTablePreview}
            onEditIntent={onTabularEditIntent}
            onCopyText={onTabularCopyText}
            onConversionAction={onStructuredConversionAction}
            onJumpToLine={onJumpToLine}
            onUnsupportedEdit={(message) => onToast?.(message, 'warning')}
          />
        ) : renderedMode === 'visual' && waitingForStructuredVisualSurface ? (
          <StructuredVisualPreparingView format={format} capabilities={formatCapabilities} />
        ) : formatCapabilities.canUseVisualMarkdown ? (
          <SourceMarkdownEditor
            markdown={markdown}
            onChange={onMarkdownChange}
            onInsertReady={onSourceInsertReady}
            onJumpReady={onSourceJumpReady}
            onFindReady={onSourceFindReady}
            onHistoryReady={onSourceHistoryReady}
            onSelectionTextReady={onSelectionTextReady}
            onContextMenuRequest={handleSourceContextMenuRequest}
            onCursorLineChange={onCursorLineChange}
            onViewportLineChange={onViewportLineChange}
            authorshipMarks={authorshipMarks}
            citationKeys={citationCompletionKeys}
            citationEntries={layerTwoDocument.citations.bibtexEntries}
            crossReferenceLabels={layerTwoDocument.references.labels}
            variableDefinitions={layerTwoDocument.variables.definitions}
            highlightedVariableName={selectedVariableName}
            validationIssues={validationIssues}
            protectedBlocks={protectedBlocks}
            onLockViolation={onLockViolation}
          />
        ) : (
          <SourceTextEditor
            value={activeSourceText}
            onChange={onMarkdownChange}
            language={formatCapabilities.sourceLanguage}
            diagnostics={sourceDiagnostics}
            parsingPending={sourceParsingPending}
            autosavePausedReason={autosaveStatus === 'paused' ? statusText : null}
            onInsertReady={onSourceInsertReady}
            onJumpReady={onSourceJumpReady}
            onFindReady={onSourceFindReady}
            onHistoryReady={onSourceHistoryReady}
            onSelectionTextReady={onSelectionTextReady}
            onContextMenuRequest={handleSourceContextMenuRequest}
            onCursorLineChange={onCursorLineChange}
            onViewportLineChange={onViewportLineChange}
          />
        )}
      </EditorErrorBoundary>
      <FloatingFormatToolbar
        enabled={renderedMode === 'visual' && formatCapabilities.canUseVisualMarkdown}
        visualEditor={visualEditor}
        selectionRoot={editorStageRef.current?.querySelector<HTMLElement>('.visual-editor') ?? null}
        getSelectionSnapshot={getSelectionSnapshot}
        onLockSelection={onLockSelection}
        onCommentSelection={onCommentSelection}
        onHumanCommentSelection={onHumanCommentSelection}
        onVariantSelection={onVariantSelection}
        onCopySelection={onCopySelection}
        onHeadingSelection={onHeadingSelection}
        onBlockSelection={onBlockSelection}
      />
      {visualSelectionContextMenuEnabled && visualSelectionContextMenu && (
        <ContextMenuCard
          ariaLabel="Selected text actions"
          sections={visualSelectionContextMenuSections}
          position={visualSelectionContextMenu.position}
          onClose={() => setVisualSelectionContextMenu(null)}
        />
      )}
      {visualSelectionContextMenuEnabled && visualBlockContextMenu && (
        <ContextMenuCard
          ariaLabel={`Visual actions for ${visualBlockContextMenu.label}`}
          sections={visualBlockContextMenuSections}
          position={visualBlockContextMenu.position}
          onClose={() => setVisualBlockContextMenu(null)}
        />
      )}
      {renderedMode === 'source' && sourceContextMenu && (
        <ContextMenuCard
          ariaLabel={`Source actions for line ${sourceContextMenu.request.line}`}
          sections={sourceContextMenuSections}
          position={sourceContextMenu.request.position}
          onClose={() => setSourceContextMenu(null)}
        />
      )}
      {formatCapabilities.canUseManuscriptReadiness && (
        <MetadataRail
          mode={renderedMode}
          document={layerTwoDocument}
          protectedBlocks={protectedBlocks}
          editorComments={editorComments}
          targetedInstructions={targetedInstructions}
          variantGroups={variantGroups}
          currentLine={activeNavigationLine}
          onJumpToLine={onJumpToLine}
          onOpenReferences={onOpenReferences}
          onOpenData={onOpenData}
        />
      )}
    </main>
  );
}

function visualBlockContextFromEvent(
  event: ReactMouseEvent<HTMLElement>,
  visualRoot: HTMLElement | null,
  visualEditor: Editor | undefined,
): Omit<VisualBlockContextMenuState, 'position'> | null {
  if (!visualRoot) return null;
  const targetElement = elementFromEventTarget(event.target);
  if (!targetElement || !visualRoot.contains(targetElement)) return null;

  const blockElement = closestVisualBlockElement(targetElement, visualRoot);
  if (!blockElement) return null;

  const selectionRange = createRangeForVisualBlock(blockElement);
  const atom = visualAtomContext(blockElement);
  const text = visualBlockReadableText(blockElement, atom).trim();
  return {
    label: visualBlockLabel(blockElement, atom),
    text,
    selectionRanges: selectionRange ? [selectionRange] : [],
    proseSelection: visualProseSelectionForBlock(visualEditor, blockElement),
    atom,
  };
}

function closestVisualBlockElement(targetElement: Element, visualRoot: HTMLElement): HTMLElement | null {
  const selector = [
    '.scie-md-visual-atom',
    '[data-scie-md-node]',
    'figure',
    'table',
    'blockquote',
    'pre',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'img',
    'hr',
  ].join(',');
  const blockElement = targetElement.closest<HTMLElement>(selector);
  if (!blockElement || !visualRoot.contains(blockElement) || blockElement === visualRoot) return null;
  return blockElement;
}

function createRangeForVisualBlock(blockElement: HTMLElement): Range | null {
  const range = document.createRange();
  try {
    if (blockElement.tagName.toLowerCase() === 'img' || blockElement.tagName.toLowerCase() === 'hr') {
      range.selectNode(blockElement);
    } else {
      range.selectNodeContents(blockElement);
    }
    return range;
  } catch {
    return null;
  }
}

function visualAtomContext(blockElement: HTMLElement): VisualAtomContext | null {
  const atomElement = blockElement.closest<HTMLElement>('.scie-md-visual-atom,[data-scie-md-node]');
  if (!atomElement) return null;
  const scieNode = atomElement.dataset.scieMdNode ?? '';
  const directiveName = atomElement.dataset.directiveName ?? '';
  const label = directiveName
    ? `${directiveName} directive`
    : scieNode
      ? scieNode.replaceAll('-', ' ')
      : 'Visual atom';
  return {
    label,
    editButton: atomElement.querySelector<HTMLButtonElement>('.scie-md-visual-atom-edit'),
    deleteButton: atomElement.querySelector<HTMLButtonElement>('.scie-md-visual-atom-delete'),
  };
}

function visualBlockReadableText(blockElement: HTMLElement, atom: VisualAtomContext | null): string {
  if (blockElement instanceof HTMLImageElement) {
    return [blockElement.alt, blockElement.currentSrc || blockElement.src].filter(Boolean).join('\n');
  }
  const text = blockElement.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  return text || atom?.label || '';
}

function visualBlockLabel(blockElement: HTMLElement, atom: VisualAtomContext | null): string {
  if (atom) return atom.label;
  const tagName = blockElement.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tagName)) return `Heading ${tagName.slice(1)}`;
  if (tagName === 'p') return 'Paragraph';
  if (tagName === 'li') return 'List item';
  if (tagName === 'pre') return 'Code block';
  if (tagName === 'blockquote') return 'Quote block';
  if (tagName === 'table') return 'Table';
  if (tagName === 'figure') return 'Figure';
  if (tagName === 'img') return 'Image';
  if (tagName === 'hr') return 'Divider';
  return 'Visual block';
}

function visualProseSelectionForBlock(editor: Editor | undefined, blockElement: HTMLElement): VisualProseSelectionRange | null {
  if (!editor) return null;
  let proseSelection: VisualProseSelectionRange | null = null;
  try {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      proseSelection = proseSelectionRangeFromDom(view, blockElement);
    });
  } catch {
    return null;
  }
  return proseSelection;
}

function proseSelectionRangeFromDom(
  view: { state: { doc: { content: { size: number }; resolve: (position: number) => { depth: number; start: (depth: number) => number; end: (depth: number) => number; node: (depth: number) => { isTextblock?: boolean } } } }; posAtDOM: (node: Node, offset: number) => number },
  blockElement: HTMLElement,
): VisualProseSelectionRange | null {
  const firstText = firstTextNode(blockElement);
  const lastText = lastTextNode(blockElement);
  const docSize = view.state.doc.content.size;
  try {
    let from = firstText
      ? view.posAtDOM(firstText, 0)
      : view.posAtDOM(blockElement, 0);
    let to = lastText
      ? view.posAtDOM(lastText, lastText.textContent?.length ?? 0)
      : Math.min(docSize, from + 1);
    from = clampEditorPosition(from, docSize);
    to = clampEditorPosition(Math.max(from, to), docSize);

    if (to <= from) return null;
    const resolvedFrom = view.state.doc.resolve(from);
    const resolvedTo = view.state.doc.resolve(Math.max(from, to - 1));
    for (let depth = Math.min(resolvedFrom.depth, resolvedTo.depth); depth > 0; depth -= 1) {
      if (resolvedFrom.node(depth).isTextblock) {
        return {
          from: resolvedFrom.start(depth),
          to: resolvedFrom.end(depth),
        };
      }
    }
    return { from, to };
  } catch {
    return null;
  }
}

function firstTextNode(element: HTMLElement): Text | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  return walker.nextNode() as Text | null;
}

function lastTextNode(element: HTMLElement): Text | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  let last: Text | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    last = node as Text;
  }
  return last;
}

function clampEditorPosition(position: number, docSize: number): number {
  return Math.max(0, Math.min(position, docSize));
}

function restoreVisualEditorSelection(editor: Editor | undefined, proseSelection: VisualProseSelectionRange | null): void {
  if (!editor || !proseSelection) return;
  try {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const docSize = view.state.doc.content.size;
      const from = clampEditorPosition(proseSelection.from, docSize);
      const to = clampEditorPosition(Math.max(from, proseSelection.to), docSize);
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
      view.focus();
    });
  } catch {
    // DOM selection restoration still gives the user visible feedback when the editor is not ready.
  }
}

function sourceLinesForSelection(markdown: string, selection: EditorSelectionSnapshot): string | null {
  if (!selection.line || !selection.endLine || selection.line < 1 || selection.endLine < selection.line) return null;
  const lines = markdown.split(/\r?\n/);
  const selectedLines = lines.slice(selection.line - 1, selection.endLine);
  const text = selectedLines.join('\n').trimEnd();
  return text || null;
}

function formatSourceDiagnosticsForClipboard(request: SourceTextContextMenuRequest): string {
  return request.diagnostics.map((diagnostic) => {
    const severity = diagnostic.severity.toUpperCase();
    const location = diagnostic.line
      ? `line ${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ''}`
      : `line ${request.line}`;
    const source = diagnostic.source ? ` [${diagnostic.source}]` : '';
    return `${severity}${source} ${location}: ${diagnostic.message}`;
  }).join('\n');
}

function selectedTextInsideVisualRoot(selectionRoot: HTMLElement | null, eventTarget: EventTarget | null): string | null {
  if (!selectionRoot) return null;
  const targetElement = elementFromEventTarget(eventTarget);
  if (!targetElement || !selectionRoot.contains(targetElement)) return null;

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const selectedText = selection.toString().trim();
  if (!selectedText) return null;

  const range = selection.getRangeAt(0);
  const anchorElement = elementFromNode(range.commonAncestorContainer);
  if (!anchorElement || !selectionRoot.contains(anchorElement)) return null;

  return selectedText;
}

function elementFromEventTarget(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function elementFromNode(node: Node): Element | null {
  if (node instanceof Element) return node;
  return node.parentElement;
}

function cloneCurrentSelectionRanges(): Range[] {
  const selection = window.getSelection();
  if (!selection) return [];
  return Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange());
}

function restoreSelectionRanges(ranges: Range[]): void {
  if (ranges.length === 0) return;
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  for (const range of ranges) {
    selection.addRange(range);
  }
}

function formatLabel(format: DocumentFormat): string {
  if (format === 'yaml') return 'YAML';
  if (format === 'toml') return 'TOML';
  if (format === 'xml') return 'XML';
  if (format === 'json') return 'JSON';
  if (format === 'jsonl') return 'JSONL';
  if (format === 'csv') return 'CSV';
  if (format === 'tsv') return 'TSV';
  return 'Structured';
}

function StructuredVisualPreparingView({
  format,
  capabilities,
}: {
  format: DocumentFormat;
  capabilities: FormatUiCapabilities;
}) {
  const label = capabilities.canUseTablePreview
    ? `${formatLabel(format)} table`
    : capabilities.canUseRecordList
      ? `${formatLabel(format)} records`
      : `${formatLabel(format)} tree`;
  return (
    <section className="structured-visual-preparing" aria-live="polite" aria-label={`Preparing ${label}`}>
      <div>
        <strong>Preparing {label}</strong>
        <span>Parsing in the background...</span>
      </div>
    </section>
  );
}
