import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent as ReactDragEvent, SetStateAction } from 'react';
import type { Editor } from '@milkdown/kit/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { PanelLeftOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { EditorMode } from './documentState';
import { createWindowTitle, DEFAULT_METADATA } from './documentState';
import { AppOverlays } from './AppOverlays';
import { AmbientSuggestions } from '../components/AmbientSuggestions';
import { AppTopbar, type AppTopbarMenuId } from '../components/AppTopbar';
import type { SelectionBlockType } from '../components/BlockTypeDialog';
import type { CommandItem } from '../components/CommandPalette';
import { EditorErrorBoundary } from '../components/EditorErrorBoundary';
import type { ExportRenderHostHandle } from '../components/ExportRenderHost';
import { FindReplacePanel } from '../components/FindReplacePanel';
import { FloatingFormatToolbar } from '../components/FloatingFormatToolbar';
import { InspectorPane } from '../components/InspectorPane';
import { MarkdownToolbar } from '../components/MarkdownToolbar';
import { MetadataRail } from '../components/MetadataRail';
import { NavigationSidebar } from '../components/NavigationSidebar';
import { QuickOutlineHover } from '../components/QuickOutlineHover';
import { SavePill } from '../components/SavePill';
import { StatusBar } from '../components/StatusBar';
import type { VariableDialogState } from '../components/VariableDialog';
import type { EditorHistoryControls } from '../components/editorControls';
import type { EditorSelectionSnapshot } from '../components/editorSelection';
import { SourceMarkdownEditor } from '../components/SourceMarkdownEditor';
import type { SourceMarkdownFind, SourceMarkdownInsert, SourceMarkdownJump, SourceMarkdownSelection } from '../components/SourceMarkdownEditor';
import { VisualMarkdownEditor } from '../components/VisualMarkdownEditor';
import type { VisualMarkdownFind, VisualMarkdownInsert, VisualMarkdownJump, VisualMarkdownSelection } from '../components/VisualMarkdownEditor';
import { flushVisualEditorState } from '../components/visualEditorStateSync';
import { useDialogs } from './hooks/useDialogs';
import {
  initialDocumentMarkdownForLaunch,
  initialExplorerPathForLaunch,
  parentDirectoryForDocument,
  shouldCommitWelcomeAfterStartup,
  shouldShowAutomaticOnboardingDialog,
} from './documentLaunch';
import { useAppCommandRegistry } from './hooks/useAppCommandRegistry';
import { useDocumentDropPaste } from './hooks/useDocumentDropPaste';
import type { PasteReviewState } from './hooks/useDocumentDropPaste';
import { useDocumentSession } from './hooks/useDocumentSession';
import { useAuthorshipMaintenance } from './hooks/useAuthorshipMaintenance';
import { useDerivedDocumentInsights } from './hooks/useDerivedDocumentInsights';
import { useDocumentNavigation } from './hooks/useDocumentNavigation';
import { useFileExplorer } from './hooks/useFileExplorer';
import { useImageInsertion } from './hooks/useImageInsertion';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useLayoutAttributes, useThemeAttribute } from './hooks/useResolvedTheme';
import { useRendererDiagnostics } from './hooks/useRendererDiagnostics';
import { useExportActions } from './hooks/useExportActions';
import { useExportWorkflow } from './hooks/useExportWorkflow';
import { useExternalConflictReviewWorkflow } from './hooks/useExternalConflictReviewWorkflow';
import { useCitationWorkflow } from './hooks/useCitationWorkflow';
import { useMissingImageDetection } from './hooks/useMissingImageDetection';
import { useLlmWorkflow } from './hooks/useLlmWorkflow';
import { usePasteReviewWorkflow } from './hooks/usePasteReviewWorkflow';
import { useRecentFilePreviews } from './hooks/useRecentFilePreviews';
import { useSlashCommandMenu } from './hooks/useSlashCommandMenu';
import { useStableRegistration } from './hooks/useStableRegistration';
import { useToasts } from './hooks/useToasts';
import { useWindowChrome } from './hooks/useWindowChrome';
import { cleanupStaleTempFilesForPaths } from '../services/fileService';
import { copyImageToAssets, defaultImageAlt, markdownImageSyntax, pickImageFile } from '../services/assetService';
import { checkPandocAvailable } from '../services/exportService';
import { checkInkscapeAvailable } from '../services/inkscapeService';
import { updateRawDocumentRescue } from '../services/rawDocumentRescue';
import { revealInFileManager } from '../services/revealService';
import { loadSettings, normalizeSidebarWidth, updateSettings } from '../services/settingsService';
import type { DocumentType, SidebarView, ThemeMode } from '../services/settingsService';
import { getVisualStyleOption, nextVisualStyle } from '../services/visualStyleService';
import type { VisualStyleId } from '../services/visualStyleService';
import type { AuthorshipMark } from '../markdown/authorship';
import { analyzeMarkdownDocument } from '../markdown/documentIntelligence';
import { assessManuscriptReadiness } from '../markdown/manuscriptReadiness';
import { extractHeadings } from '../markdown/outline';
import { normalizeScientificTypography } from '../markdown/scientificTypography';
import { toggleMarkdownHeadingSelection } from '../markdown/headingToggle';
import { createSemanticBlockMarkdown } from '../markdown/semanticBlocks';
import { insertStandaloneMarkdownBlockNearSelection, wrapMarkdownBlockSelection, wrapMarkdownSelection } from '../markdown/selectionWrapping';
import { insertEditorNote, parseEditorComments } from '../markdown/editorComments';
import type { EditorNoteKind } from '../markdown/editorComments';
import { createTargetedInstructionSnippet, parseTargetedInstructions } from '../markdown/targetedInstructions';
import { createAnchoredVariantGroupSnippet, createVariantGroupSnippet, parseVariantGroups } from '../markdown/variants';
import { createProtectedAnchorSnippet, createProtectedBlockSnippet, detectProtectedChanges, parseProtectedBlocks } from '../markdown/protectedBlocks';
import { syncGeneratedBibliography } from '../domain/citations/bibtex';
import type { BibtexEntry } from '../domain/citations/bibtex';
import type { ScienfyTemplateId } from '../domain/document/templates';
import { createVariableToken, nextVariableName, renameVariableAndUpdateUsages, upsertFrontmatterVariable, upsertScienfyVariablesFile } from '../domain/variables/variableEditing';
import { captureEditorHtmlForExport } from '../export/renderCapture';
import type { ExportLogEntry } from '../export/exportTypes';
import { isTauriRuntime } from './runtime';
import welcomeMarkdown from '../samples/welcome.md?raw';
import fullTutorialMarkdown from '../samples/full-tutorial.md?raw';

function formatAutosaveTime(timestamp: number | null): string {
  if (!timestamp) return '';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 5) return 'Autosaved just now';
  if (seconds < 60) return `Autosaved ${seconds}s ago`;
  return `Autosaved ${Math.round(seconds / 60)}m ago`;
}

function nextReferenceLabel(prefix: string, existingLabels: string[]): string {
  const used = new Set(existingLabels);
  let index = 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

type EditorSelectionOverride = string | EditorSelectionSnapshot;

function citationCommandDetail(entry: BibtexEntry | undefined): string {
  if (!entry) return 'Previously used citation key';
  const title = cleanBibtexCommandField(entry.fields.title) || entry.key;
  const authors = cleanBibtexCommandField(entry.fields.author || entry.fields.editor || '');
  const year = cleanBibtexCommandField(entry.fields.year || '');
  return [title, [authors, year].filter(Boolean).join(', ')].filter(Boolean).join(' - ');
}

function cleanBibtexCommandField(value: string): string {
  return value.replace(/[{}]/g, '').replace(/\\&/g, '&').replace(/\s+/g, ' ').trim();
}

function createSvgFigureSnippet(label: string): string {
  return [
    `:::figure {#${label}}`,
    '```svg',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 180" role="img" aria-label="Editable vector workflow">',
    '  <rect x="24" y="42" width="150" height="64" rx="14" fill="#e7f0ff" stroke="#6b8cff"/>',
    '  <text x="99" y="80" text-anchor="middle" font-family="Scie Sans, sans-serif" font-size="18" fill="#1f2a44">Draft</text>',
    '  <path d="M 188 74 H 284" stroke="#6b7280" stroke-width="3" marker-end="url(#arrow)"/>',
    '  <rect x="300" y="42" width="150" height="64" rx="14" fill="#eef8ec" stroke="#5aa469"/>',
    '  <text x="375" y="80" text-anchor="middle" font-family="Scie Sans, sans-serif" font-size="18" fill="#203824">Revise</text>',
    '  <path d="M 464 74 H 560" stroke="#6b7280" stroke-width="3" marker-end="url(#arrow)"/>',
    '  <circle cx="598" cy="74" r="34" fill="#fff4db" stroke="#c48a2c"/>',
    '  <text x="598" y="80" text-anchor="middle" font-family="Scie Sans, sans-serif" font-size="18" fill="#4b3417">Submit</text>',
    '  <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#6b7280"/></marker></defs>',
    '</svg>',
    '```',
    '',
    'Vector caption.',
    ':::',
    '',
  ].join('\n');
}

const PROJECT_URL = 'https://github.com/scienfy/scie-md';
const BUG_REPORT_URL = `${PROJECT_URL}/issues/new`;

function openProjectUrl(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function App() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(loadSettings);
  const [sidebarWidth, setSidebarWidth] = useState(settings.sidebarWidth);
  const [authorshipMarks, setAuthorshipMarks] = useState<AuthorshipMark[]>([]);
  const { promptState, confirmState, promptText, confirmText, completePrompt, completeConfirm } = useDialogs();
  const { toasts, pushToast, dismissToast, pauseToast, resumeToast } = useToasts();
  const [pasteReview, setPasteReview] = useState<PasteReviewState | null>(null);
  const documentEpochRef = useRef(0);
  const handleDocumentReplaced = useCallback(() => {
    documentEpochRef.current += 1;
    setPasteReview(null);
  }, []);
  const {
    markdown,
    commitMarkdownEdit,
    commitEditorMarkdownEdit,
    undoDocumentEdit,
    redoDocumentEdit,
    lastSavedMarkdown,
    filePath,
    fileMetadata,
    mode,
    setMode,
    autosaveStatus,
    lastAutosavedAt,
    saveQueueDepth,
    startupDocumentOpenPending,
    startupDocumentOpenFailed,
    documentOpenStatus,
    externalConflict,
    dirty,
    validation,
    validateNow,
    layerTwoDocument,
    bibliographyLoading,
    reloadBibliography,
    closeDialogOpen,
    setCloseDialogOpen,
    closeWindow,
    cancelAutosave,
    saveCurrent,
    ensureDocumentPathForAssets,
    settleDirtyDocumentBeforeReplace,
    commitOpenedDocument,
    adoptReviewedDiskMerge,
    handleOpen,
    handleNew,
    handleNewFromTemplate,
    handleCloseSave,
    handleCloseDiscard,
    handleReloadFromDisk,
  } = useDocumentSession({
    initialMarkdown: initialDocumentMarkdownForLaunch({
      onboardingComplete: settings.onboardingComplete,
      nativeRuntime: isTauriRuntime(),
      welcomeMarkdown,
    }),
    setSettings,
    setAuthorshipMarks,
    onDocumentReplaced: handleDocumentReplaced,
    confirmText,
    pushToast,
  });
  const [visualEditor, setVisualEditor] = useState<Editor | undefined>();
  const [selectedVariableName, setSelectedVariableName] = useState<string | null>(null);
  const [sourceInsertHandler, handleSourceInsertReady] = useStableRegistration<SourceMarkdownInsert>();
  const [visualInsertHandler, handleVisualInsertReady] = useStableRegistration<VisualMarkdownInsert>();
  const [sourceJumpHandler, handleSourceJumpReady] = useStableRegistration<SourceMarkdownJump>();
  const [sourceFindHandler, handleSourceFindReady] = useStableRegistration<SourceMarkdownFind>();
  const [visualJumpHandler, handleVisualJumpReady] = useStableRegistration<VisualMarkdownJump>();
  const [visualFindHandler, handleVisualFindReady] = useStableRegistration<VisualMarkdownFind>();
  const [sourceHistory, handleSourceHistoryReady] = useStableRegistration<EditorHistoryControls>();
  const [visualHistory, handleVisualHistoryReady] = useStableRegistration<EditorHistoryControls>();
  const selectionTextGetterRef = useRef<SourceMarkdownSelection | VisualMarkdownSelection | undefined>(undefined);
  const [findOpen, setFindOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutDialogOpen, setShortcutDialogOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [documentTypeDialogOpen, setDocumentTypeDialogOpen] = useState(false);
  const [linkDialog, setLinkDialog] = useState<{ selectedText: string; text: string; url: string } | null>(null);
  const [activeTopbarMenu, setActiveTopbarMenu] = useState<AppTopbarMenuId | null>(null);
  const [editorResetToken, setEditorResetToken] = useState(0);
  const [variableDialog, setVariableDialog] = useState<VariableDialogState | null>(null);
  const [citationDialogInitialKey, setCitationDialogInitialKey] = useState<string | null>(null);
  const [blockDialogState, setBlockDialogState] = useState<{ selection: EditorSelectionSnapshot | null } | null>(null);
  const [inspectorFocusSection, setInspectorFocusSection] = useState<'readiness' | 'validation' | null>(null);
  const updateUserSettings = useCallback((patch: Parameters<typeof updateSettings>[0]) => {
    setSettings(updateSettings(patch));
  }, []);
  useEffect(() => {
    setSidebarWidth(normalizeSidebarWidth(settings.sidebarWidth));
  }, [settings.sidebarWidth]);
  useEffect(() => {
    if (filePath) setDocumentTypeDialogOpen(false);
  }, [filePath]);
  const editorStageRef = useRef<HTMLElement | null>(null);
  const dropDepthRef = useRef(0);
  const exportRenderHostRef = useRef<ExportRenderHostHandle | null>(null);
  const exportLogSinkRef = useRef<(entries: ExportLogEntry[]) => void>(() => undefined);
  const [exportRenderHostMounted, setExportRenderHostMounted] = useState(false);
  const [dropOverlayVisible, setDropOverlayVisible] = useState(false);
  const handleSelectionTextReady = useCallback((getter: SourceMarkdownSelection | VisualMarkdownSelection | undefined) => {
    selectionTextGetterRef.current = getter;
  }, []);
  const markdownRef = useRef(markdown);
  const commitMarkdown = useCallback((action: SetStateAction<string>) => {
    const next = typeof action === 'function'
      ? (action as (value: string) => string)(markdownRef.current)
      : action;
    markdownRef.current = next;
    commitMarkdownEdit(next);
  }, [commitMarkdownEdit]);
  const getEditorSelectionSnapshot = useCallback((): EditorSelectionSnapshot => {
    const snapshot = selectionTextGetterRef.current?.();
    if (snapshot) {
      return {
        ...snapshot,
        text: snapshot.text.trim(),
      };
    }
    return { text: (window.getSelection()?.toString() || '').trim(), surface: 'unknown' };
  }, []);
  const getSelectedEditorText = useCallback(() => getEditorSelectionSnapshot().text.trim(), [getEditorSelectionSnapshot]);
  const effectiveEditorMode: EditorMode = mode;

  const documentTitle = createWindowTitle(filePath, dirty);
  const warnings = validation.issues.filter((issue) => issue.severity === 'warning');
  const errors = validation.issues.filter((issue) => issue.severity === 'error');
  const currentVisualStyle = getVisualStyleOption(settings.visualStyle);
  const recentPreviews = useRecentFilePreviews(settings.recentFiles);
  const deferredMarkdownForPanels = useDeferredValue(markdown);
  const citationCompletionKeys = useMemo(() => Array.from(new Set([
    ...layerTwoDocument.citations.bibtexKeys,
    ...layerTwoDocument.citations.usages.map((usage) => usage.key),
  ])).sort((a, b) => a.localeCompare(b)), [layerTwoDocument.citations.bibtexKeys, layerTwoDocument.citations.usages]);
  const nextFigureLabel = useMemo(
    () => nextReferenceLabel('fig', layerTwoDocument.references.labels.map((label) => label.id)),
    [layerTwoDocument.references.labels],
  );
  const parsedMarkdownGraph = useMemo(() => ({
    baseDocumentInsights: analyzeMarkdownDocument(deferredMarkdownForPanels),
    navigationHeadings: extractHeadings(deferredMarkdownForPanels),
  }), [deferredMarkdownForPanels]);
  const liveAnnotationGraph = useMemo(() => ({
    editorComments: parseEditorComments(markdown),
    targetedInstructions: parseTargetedInstructions(markdown),
    protectedBlocks: parseProtectedBlocks(markdown),
    variantGroups: parseVariantGroups(markdown),
  }), [markdown]);
  const {
    baseDocumentInsights,
    navigationHeadings,
  } = parsedMarkdownGraph;
  const {
    editorComments,
    targetedInstructions,
    protectedBlocks,
    variantGroups,
  } = liveAnnotationGraph;
  const {
    currentLine,
    currentColumn,
    activeNavigationLine,
    handleCursorPositionChange,
    handleViewportLineChange,
    jumpToHeading,
    jumpToLineInCurrentMode,
    jumpToLineInSource,
    preserveLineForModeChange,
    navigateToFindMatch,
  } = useDocumentNavigation({
    mode,
    setMode,
    headings: navigationHeadings,
    sourceJumpHandler,
    sourceFindHandler,
    visualJumpHandler,
    visualFindHandler,
  });
  const wrapSelectedEditorText = useCallback((selectedText: string, wrap: (rawSelection: string) => string) => {
    const nextMarkdown = wrapMarkdownSelection(markdownRef.current, selectedText, wrap, currentLine);
    if (!nextMarkdown) {
      pushToast('Could not safely map this visual selection to Markdown. Try placing the cursor in the exact block before applying this command.', 'warning');
      return false;
    }
    commitMarkdown(nextMarkdown);
    return true;
  }, [commitMarkdown, currentLine, pushToast]);
  const wrapSelectedEditorBlock = useCallback((selection: EditorSelectionSnapshot, wrap: (rawSelection: string) => string) => {
    const nextMarkdown = wrapMarkdownBlockSelection(markdownRef.current, selection, wrap, currentLine);
    if (!nextMarkdown) return false;
    commitMarkdown(nextMarkdown);
    return true;
  }, [commitMarkdown, currentLine]);
  const insertAnchoredSelectionBlock = useCallback((selection: EditorSelectionSnapshot, block: string) => {
    commitMarkdown(insertStandaloneMarkdownBlockNearSelection(markdownRef.current, selection, `${block.trimEnd()}\n\n`, currentLine));
  }, [commitMarkdown, currentLine]);
  const missingImageCount = useMissingImageDetection(filePath, baseDocumentInsights.imageReferences);
  const {
    headings,
    documentInsights,
    currentHeadingPath,
    activeHeadingId,
    ambientIssues,
  } = useDerivedDocumentInsights({
    markdown,
    documentInsights: baseDocumentInsights,
    headings: navigationHeadings,
    currentLine: activeNavigationLine,
    validationIssues: validation.issues,
    missingImageCount,
  });
  const manuscriptReadiness = useMemo(
    () => assessManuscriptReadiness(deferredMarkdownForPanels, layerTwoDocument, documentInsights, missingImageCount, navigationHeadings),
    [deferredMarkdownForPanels, documentInsights, layerTwoDocument, missingImageCount, navigationHeadings],
  );
  const nextVariantGroupId = useMemo(
    () => nextReferenceLabel('variant', variantGroups.map((group) => group.id)),
    [variantGroups],
  );
  const pasteProtectedChanges = useMemo(
    () => pasteReview ? detectProtectedChanges(pasteReview.before, pasteReview.hunks) : [],
    [pasteReview],
  );
  const resolvedTheme = useThemeAttribute(settings.themeMode);
  useLayoutAttributes(settings.fontScale, settings.visualStyle);

  const statusText = useMemo(() => {
    if (autosaveStatus === 'idle') return filePath ? 'Saved' : 'Autosave off until saved';
    if (autosaveStatus === 'pending') return 'Autosave pending';
    if (autosaveStatus === 'saving') return 'Saving';
    if (autosaveStatus === 'saved') return formatAutosaveTime(lastAutosavedAt) || 'Saved';
    if (autosaveStatus === 'conflict') return 'External change detected';
    return 'Save failed';
  }, [autosaveStatus, filePath, lastAutosavedAt]);

  useEffect(() => {
    document.title = documentTitle;
  }, [documentTitle]);

  useEffect(() => {
    markdownRef.current = markdown;
    updateRawDocumentRescue(markdown, filePath);
  }, [filePath, markdown]);

  useAuthorshipMaintenance(setAuthorshipMarks);

  useEffect(() => {
    if (!isTauriRuntime() || settings.recentFiles.length === 0) return;
    void cleanupStaleTempFilesForPaths(settings.recentFiles).catch((error) => {
      console.warn('Could not clean stale temporary files.', error);
    });
  }, [settings.recentFiles]);

  const {
    insertMarkdown,
    insertImageFromPath,
    insertImageBlob,
    handleInsertImage,
  } = useImageInsertion({
    mode: effectiveEditorMode,
    sourceInsertHandler,
    visualInsertHandler,
    ensureDocumentPathForAssets,
    promptText,
    pushToast,
  });

  const suggestedVariableName = useMemo(
    () => nextVariableName(layerTwoDocument.variables.definitions),
    [layerTwoDocument.variables.definitions],
  );

  const openVariableInsert = useCallback(() => {
    setVariableDialog({ mode: 'insert' });
    updateUserSettings({ outlineOpen: true, sidebarView: 'data' });
  }, [updateUserSettings]);

  const openVariableEdit = useCallback((name: string) => {
    setVariableDialog({ mode: 'edit', name });
    updateUserSettings({ outlineOpen: true, sidebarView: 'data' });
  }, [updateUserSettings]);

  const insertVariableToken = useCallback((name: string) => {
    insertMarkdown(`${createVariableToken(name)} `);
    setVariableDialog(null);
  }, [insertMarkdown]);

  const createVariableAndInsert = useCallback((name: string, value: string) => {
    const ensureDefinition = () => {
      commitMarkdown((current) => {
        return upsertFrontmatterVariable(current, name, value);
      });
    };
    try {
      ensureDefinition();
      insertMarkdown(`${createVariableToken(name)} `);
      window.setTimeout(() => {
        try {
          ensureDefinition();
        } catch (error) {
          pushToast(error instanceof Error ? error.message : 'Variable could not be created.', 'error');
        }
      }, 0);
      setVariableDialog(null);
      setSelectedVariableName(name);
      pushToast(`Variable {{ ${name} }} created.`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Variable could not be created.', 'error');
    }
  }, [commitMarkdown, insertMarkdown, pushToast]);

  const saveVariableEdit = useCallback((originalName: string, nextName: string, value: string) => {
    void (async () => {
      try {
        const usageCount = layerTwoDocument.variables.usages.filter((usage) => usage.name === originalName).length;
        if (originalName !== nextName && usageCount > 0) {
          const confirmed = await confirmText({
            title: `Rename {{ ${originalName} }}?`,
            message: `Update ${usageCount} variable use${usageCount === 1 ? '' : 's'} in this document to {{ ${nextName} }}?`,
            okLabel: 'Rename variable',
            cancelLabel: 'Cancel',
          });
          if (!confirmed) return;
        }
        commitMarkdown((current) => renameVariableAndUpdateUsages(current, originalName, nextName, value));
        setSelectedVariableName(nextName);
        setVariableDialog(null);
        pushToast(`Variable {{ ${nextName} }} updated.`, 'success');
      } catch (error) {
        pushToast(error instanceof Error ? error.message : 'Variable could not be updated.', 'error');
      }
    })();
  }, [commitMarkdown, confirmText, layerTwoDocument.variables.usages, pushToast]);

  const selectVariableInDocument = useCallback((name: string, targetUsage?: typeof layerTwoDocument.variables.usages[number]) => {
    setSelectedVariableName(name);
    const usages = layerTwoDocument.variables.usages.filter((usage) => usage.name === name);
    if (usages.length === 0) {
      pushToast(`{{ ${name} }} is defined but is not used within the document.`, 'info');
      return;
    }
    const firstUsage = targetUsage ?? usages[0];
    const occurrenceIndex = layerTwoDocument.variables.usages
      .filter((usage) => usage.raw === firstUsage.raw && usage.from < firstUsage.from)
      .length;
    navigateToFindMatch(
      { from: firstUsage.from, to: firstUsage.to },
      {
        index: occurrenceIndex,
        query: firstUsage.raw,
        caseSensitive: true,
        line: firstUsage.line,
      },
    );
  }, [layerTwoDocument.variables.usages, navigateToFindMatch, pushToast]);

  const linkVariableFile = useCallback(async () => {
    const file = await promptText({
      title: 'Link data file',
      label: 'Relative JSON or CSV path',
      defaultValue: layerTwoDocument.variableFiles[0] ?? 'results.json',
    });
    if (file === null) return;
    try {
      commitMarkdown((current) => upsertScienfyVariablesFile(current, file));
      updateUserSettings({ outlineOpen: true, sidebarView: 'data' });
      pushToast(`Linked data file: ${file.trim()}`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Data file could not be linked.', 'error');
    }
  }, [commitMarkdown, layerTwoDocument.variableFiles, promptText, pushToast, updateUserSettings]);

  const insertOutlineHeading = useCallback(() => {
    insertMarkdown('## New heading\n\n');
    updateUserSettings({ outlineOpen: true, sidebarView: 'outline' });
  }, [insertMarkdown, updateUserSettings]);

  const insertSvgFigure = useCallback(() => {
    insertMarkdown(createSvgFigureSnippet(nextFigureLabel));
    pushToast('SVG figure inserted. The saved Markdown keeps the vector source as text.', 'success');
  }, [insertMarkdown, nextFigureLabel, pushToast]);

  const checkInkscape = useCallback(async () => {
    try {
      const info = await checkInkscapeAvailable(settings.inkscapePath);
      updateUserSettings({ inkscapePath: info.path });
      pushToast(`Inkscape ready: ${info.version}`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Inkscape was not found.', 'warning');
    }
  }, [pushToast, settings.inkscapePath, updateUserSettings]);

  const {
    citationDialogOpen,
    setCitationDialogOpen,
    reloadBibliographyFromDisk,
    saveCitationEntry,
    deleteCitationEntry,
  } = useCitationWorkflow({
    filePath,
    layerTwoDocument,
    markdownRef,
    setMarkdown: commitMarkdown,
    saveCurrent,
    reloadBibliography,
    pushToast,
    confirmText,
  });

  const openCitationLibrary = useCallback(() => {
    setCitationDialogInitialKey(null);
    setCitationDialogOpen(true);
  }, [setCitationDialogOpen]);

  const openCitationEditor = useCallback((key: string) => {
    setCitationDialogInitialKey(key);
    setCitationDialogOpen(true);
  }, [setCitationDialogOpen]);

  const setInkscapePath = useCallback(async () => {
    const path = await promptText({
      title: 'Set Inkscape path',
      label: 'Path to inkscape executable',
      defaultValue: settings.inkscapePath ?? '',
    });
    if (path === null) return;
    const trimmed = path.trim();
    if (!trimmed) {
      updateUserSettings({ inkscapePath: null });
      pushToast('Inkscape path reset. ScieMD will search common install locations.', 'info');
      return;
    }
    try {
      const info = await checkInkscapeAvailable(trimmed);
      updateUserSettings({ inkscapePath: info.path });
      pushToast(`Inkscape ready: ${info.version}`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Inkscape path is not valid.', 'error');
    }
  }, [promptText, pushToast, settings.inkscapePath, updateUserSettings]);

  const openTutorialDocument = useCallback(async () => {
    setActiveTopbarMenu(null);
    if (!(await settleDirtyDocumentBeforeReplace())) return;
    commitOpenedDocument(null, welcomeMarkdown, DEFAULT_METADATA, 'visual');
    pushToast('Tutorial opened.', 'info');
  }, [commitOpenedDocument, pushToast, settleDirtyDocumentBeforeReplace]);

  const openFullTutorialDocument = useCallback(async () => {
    setActiveTopbarMenu(null);
    if (!(await settleDirtyDocumentBeforeReplace())) return;
    commitOpenedDocument(null, fullTutorialMarkdown, DEFAULT_METADATA, 'visual');
    pushToast('Full tutorial opened.', 'info');
  }, [commitOpenedDocument, pushToast, settleDirtyDocumentBeforeReplace]);

  const openTemplateDialog = useCallback(() => {
    setActiveTopbarMenu(null);
    setTemplateDialogOpen(true);
  }, []);

  const createFromTemplate = useCallback((template: ScienfyTemplateId) => {
    setTemplateDialogOpen(false);
    void handleNewFromTemplate(template);
  }, [handleNewFromTemplate]);

  const openWritingDefaults = useCallback(() => {
    setSettingsOpen(false);
    setDocumentTypeDialogOpen(true);
  }, []);

  const checkExternalTools = useCallback(async () => {
    setActiveTopbarMenu(null);
    const [inkscapeResult, pandocResult] = await Promise.allSettled([
      checkInkscapeAvailable(settings.inkscapePath),
      checkPandocAvailable(),
    ]);
    const ready: string[] = [];
    const missing: string[] = [];
    if (inkscapeResult.status === 'fulfilled') {
      updateUserSettings({ inkscapePath: inkscapeResult.value.path });
      ready.push(`Inkscape ${inkscapeResult.value.version}`);
    } else {
      missing.push(inkscapeResult.reason instanceof Error ? inkscapeResult.reason.message : 'Inkscape was not found.');
    }
    if (pandocResult.status === 'fulfilled') {
      ready.push(`Pandoc ${pandocResult.value}`);
    } else {
      missing.push(pandocResult.reason instanceof Error ? pandocResult.reason.message : 'Pandoc was not found.');
    }
    if (ready.length > 0) {
      pushToast(`Tools ready: ${ready.join(', ')}`, 'success');
    }
    if (missing.length > 0) {
      pushToast(`Tool check needs attention: ${missing.join(' ')}`, 'warning');
    }
  }, [pushToast, settings.inkscapePath, updateUserSettings]);

  const openGithub = useCallback(() => {
    setActiveTopbarMenu(null);
    openProjectUrl(PROJECT_URL);
  }, []);

  const reportBug = useCallback(() => {
    setActiveTopbarMenu(null);
    openProjectUrl(BUG_REPORT_URL);
  }, []);

  const locateMissingImage = useCallback(async (source: string, alt: string) => {
    try {
      const imagePath = await pickImageFile();
      if (!imagePath) return;
      const documentPath = await ensureDocumentPathForAssets();
      if (!documentPath) return;
      const altText = alt.trim() || defaultImageAlt(imagePath);
      const copied = await copyImageToAssets(documentPath, imagePath, altText);
      const replacement = markdownImageSyntax(copied.altText, copied.markdownPath);
      commitMarkdown((current) => {
        return replaceFirstMissingImageReference(current, source, alt, replacement);
      });
      pushToast('Missing image reference updated.', 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not update the missing image reference.', 'error');
    }
  }, [commitMarkdown, ensureDocumentPathForAssets, pushToast]);

  useEffect(() => {
    const handleLocateMissingImage = (event: Event) => {
      const custom = event as CustomEvent<{ source?: string; alt?: string }>;
      void locateMissingImage(custom.detail?.source ?? '', custom.detail?.alt ?? 'image');
    };
    window.addEventListener('scie-md-locate-missing-image', handleLocateMissingImage);
    return () => window.removeEventListener('scie-md-locate-missing-image', handleLocateMissingImage);
  }, [locateMissingImage]);

  const { handlePasteCapture, handleDropCapture } = useDocumentDropPaste({
    markdownRef,
    documentEpochRef,
    insertImageBlob,
    insertImageFromPath,
    openDocumentPath: async (path) => {
      await handleOpen(path);
    },
    settleDirtyDocumentBeforeReplace,
    commitOpenedDocument,
    validateNow,
    setAuthorshipMarks,
    setPasteReview,
    pushToast,
  });

  const {
    openPasteReview,
    closePasteReview,
    acceptPasteReview,
    rejectPasteReview,
    applyPasteReview,
  } = usePasteReviewWorkflow({
    getCurrentMarkdown: () => markdownRef.current,
    setMarkdown: commitMarkdown,
    setAuthorshipMarks,
    setPasteReview,
    pushToast,
  });

  const persistExplorerPath = useCallback((path: string) => {
    updateUserSettings({ explorerRootPath: path });
  }, [updateUserSettings]);

  const openExplorerDocument = useCallback((path: string) => {
    void handleOpen(path);
  }, [handleOpen]);
  const initialExplorerPath = useMemo(() => initialExplorerPathForLaunch({
    persistedExplorerRootPath: settings.explorerRootPath,
    startupDocumentOpenPending,
    startupDocumentOpenFailed,
    filePath,
  }), [filePath, settings.explorerRootPath, startupDocumentOpenFailed, startupDocumentOpenPending]);

  const {
    currentPath: explorerCurrentPath,
    entries: explorerEntries,
    selectedImage: explorerSelectedImage,
    loading: explorerLoading,
    error: explorerError,
    loadDirectory: loadExplorerDirectory,
    chooseFolder: chooseExplorerFolder,
    openEntry: handleOpenExplorerEntry,
  } = useFileExplorer({
    initialPath: initialExplorerPath,
    onPersistPath: persistExplorerPath,
    onOpenDocument: openExplorerDocument,
  });

  const syncDocumentParentToExplorer = useCallback((path: string) => {
    const parentPath = parentDirectoryForDocument(path);
    if (!parentPath) return;
    updateUserSettings({ outlineOpen: true, sidebarView: 'files' });
    void loadExplorerDirectory(parentPath, { silent: true, suppressError: true }).catch((error) => {
      console.warn('Document parent folder could not be loaded in the file panel.', error);
    });
  }, [loadExplorerDirectory, updateUserSettings]);

  useEffect(() => {
    if (filePath) syncDocumentParentToExplorer(filePath);
  }, [filePath, syncDocumentParentToExplorer]);

  useEffect(() => {
    if (!shouldCommitWelcomeAfterStartup({
      onboardingComplete: settings.onboardingComplete,
      startupDocumentOpenPending,
      startupDocumentOpenFailed,
      filePath,
      markdown,
    })) return;
    commitOpenedDocument(null, welcomeMarkdown, DEFAULT_METADATA, 'visual');
  }, [
    commitOpenedDocument,
    filePath,
    markdown,
    settings.onboardingComplete,
    startupDocumentOpenFailed,
    startupDocumentOpenPending,
  ]);

  const handleChooseExplorerFolder = useCallback(async () => {
    updateUserSettings({ outlineOpen: true, sidebarView: 'files' });
    await chooseExplorerFolder();
  }, [chooseExplorerFolder, updateUserSettings]);

  const {
    copyScieMDLlmSkill,
    generateScieMDLlmSkill,
    generateSubmissionReadiness,
  } = useLlmWorkflow({
    filePath,
    manuscriptReadiness,
    closeLlmMenu: () => setActiveTopbarMenu(null),
    pushToast,
  });

  const insertProtectedBlock = useCallback(async (selectedTextOverride?: string) => {
    const selectionSnapshot = getEditorSelectionSnapshot();
    const selection = selectedTextOverride === undefined
      ? selectionSnapshot
      : { text: selectedTextOverride, line: selectionSnapshot.line, endLine: selectionSnapshot.endLine, surface: 'unknown' as const };
    const selectedText = selection.text.trim();
    const reason = selectedText
      ? await promptText({ title: 'Lock selected text', label: 'Reason shown to external LLMs', defaultValue: 'human-approved' })
      : 'human-approved';
    if (reason === null) return;
    if (selectedText) {
      const wrapped = wrapSelectedEditorBlock(selection, (rawSelection) => (
        createProtectedBlockSnippet(rawSelection.trimEnd(), reason || 'human-approved')
      ));
      if (wrapped) {
        pushToast('Selection locked from external LLM edits.', 'info');
        return;
      }
      insertAnchoredSelectionBlock(selection, createProtectedAnchorSnippet(selectedText, reason || 'human-approved', undefined, {
        markdown: markdownRef.current,
        selectionLine: selection.line,
        preferredLine: currentLine,
        prefix: selection.prefix,
        suffix: selection.suffix,
      }));
      pushToast('Selected text locked as an anchored range without changing the paragraph.', 'info');
      return;
    }
    insertMarkdown(createProtectedBlockSnippet(selectedText || 'Protected content.', reason || 'human-approved'));
    pushToast(selectedText ? 'Selection locked from external LLM edits.' : 'Locked section inserted. ScieMD LLM skill instructions will tell models to preserve it.', 'info');
  }, [currentLine, getEditorSelectionSnapshot, insertAnchoredSelectionBlock, insertMarkdown, promptText, pushToast, wrapSelectedEditorBlock]);

  const insertEditorNoteCommand = useCallback(async (kind: EditorNoteKind = 'llm', selectionOverride?: EditorSelectionOverride) => {
    const selectionSnapshot = getEditorSelectionSnapshot();
    const overrideSnapshot = typeof selectionOverride === 'object' ? selectionOverride : undefined;
    const selectedText = (typeof selectionOverride === 'string'
      ? selectionOverride
      : overrideSnapshot?.text ?? selectionSnapshot.text
    ).trim();
    const isHumanNote = kind === 'human';
    const body = await promptText({
      title: selectedText
        ? (isHumanNote ? 'Add note to human reviewer' : 'Add note to LLM')
        : (isHumanNote ? 'Insert note to human reviewer' : 'Insert note to LLM'),
      label: isHumanNote ? 'Note for human review' : 'Note for the LLM',
      defaultValue: isHumanNote
        ? 'Review note: summarize what changed and why.'
        : 'Revise this text for clarity while preserving the scientific meaning.',
    });
    if (!body) return;
    const result = insertEditorNote(markdownRef.current, {
      body,
      kind,
      selectedText,
      prefix: overrideSnapshot?.prefix ?? selectionSnapshot.prefix,
      suffix: overrideSnapshot?.suffix ?? selectionSnapshot.suffix,
      selectionLine: overrideSnapshot?.line ?? selectionSnapshot.line,
      selectionEndLine: overrideSnapshot?.endLine ?? selectionSnapshot.endLine,
      preferredLine: currentLine,
    });
    commitMarkdown(result.markdown);
    const noteLabel = isHumanNote ? 'Note to Human' : 'Note to LLM';
    pushToast(selectedText ? `${noteLabel} anchored to the selected text without changing it.` : `${noteLabel} inserted.`, 'info');
  }, [commitMarkdown, currentLine, getEditorSelectionSnapshot, promptText, pushToast]);

  const insertEditorComment = useCallback((selectionOverride?: EditorSelectionOverride) => (
    insertEditorNoteCommand('llm', selectionOverride)
  ), [insertEditorNoteCommand]);

  const insertHumanEditorComment = useCallback((selectionOverride?: EditorSelectionOverride) => (
    insertEditorNoteCommand('human', selectionOverride)
  ), [insertEditorNoteCommand]);

  const insertTargetedInstruction = useCallback(async () => {
    const selection = getEditorSelectionSnapshot();
    const selectedText = selection.text.trim();
    const prompt = await promptText({
      title: selectedText ? 'Ask LLM to revise selected text' : 'Insert LLM instruction',
      label: 'Instruction',
      defaultValue: 'Make this clearer while preserving every scientific claim and number.',
    });
    if (!prompt) return;
    const snippet = createTargetedInstructionSnippet(prompt, 'next-block');
    if (selectedText) {
      const wrapped = wrapSelectedEditorBlock(selection, (rawSelection) => `${snippet}${rawSelection.trimEnd()}\n\n`);
      if (wrapped) {
        pushToast('LLM instruction attached to selection.', 'info');
        return;
      }
      insertAnchoredSelectionBlock(selection, snippet);
      pushToast('LLM instruction placed next to the selected text without changing it.', 'info');
      return;
    }
    insertMarkdown(snippet);
    pushToast('LLM instruction inserted.', 'info');
  }, [getEditorSelectionSnapshot, insertAnchoredSelectionBlock, insertMarkdown, promptText, pushToast, wrapSelectedEditorBlock]);

  const insertVariantGroup = useCallback((selectedTextOverride?: string) => {
    const selectionSnapshot = getEditorSelectionSnapshot();
    const selection = selectedTextOverride === undefined
      ? selectionSnapshot
      : { text: selectedTextOverride, line: selectionSnapshot.line, endLine: selectionSnapshot.endLine, surface: 'unknown' as const };
    const selectedText = selection.text.trim();
    if (selectedText) {
      const wrapped = wrapSelectedEditorBlock(selection, (rawSelection) => (
        createVariantGroupSnippet(nextVariantGroupId, 'v1').replace('Write the first version here.', rawSelection.trimEnd())
      ));
      if (wrapped) {
        pushToast('Selection stored as the first text version.', 'info');
        return;
      }
      insertAnchoredSelectionBlock(selection, createAnchoredVariantGroupSnippet(nextVariantGroupId, selectedText, 'v1', {
        markdown: markdownRef.current,
        selectionLine: selection.line,
        preferredLine: currentLine,
        prefix: selection.prefix,
        suffix: selection.suffix,
      }));
      pushToast('Selection stored as an anchored text version without changing the paragraph.', 'info');
      return;
    }
    const snippet = selectedText
      ? createVariantGroupSnippet(nextVariantGroupId, 'v1').replace('Write the first version here.', selectedText)
      : createVariantGroupSnippet(nextVariantGroupId);
    insertMarkdown(snippet);
    pushToast(selectedText ? 'Selection stored as the first text version.' : 'Text versions inserted. Visual mode shows the active version and preserves the alternatives.', 'info');
  }, [currentLine, getEditorSelectionSnapshot, insertAnchoredSelectionBlock, insertMarkdown, nextVariantGroupId, pushToast, wrapSelectedEditorBlock]);

  const {
    slashMenu,
    slashCommands,
    openSlashMenu,
    handleEditorKeyDownCapture,
    insertSlashCommand,
    closeSlashMenu,
  } = useSlashCommandMenu({
    mode,
    markdown,
    currentLine,
    currentColumn,
    editorStageRef,
    insertMarkdown,
    onVariableCommand: openVariableInsert,
    onCitationCommand: openCitationLibrary,
    onImageCommand: () => void handleInsertImage(),
    onLockedSectionCommand: () => void insertProtectedBlock(),
    onLlmNoteCommand: () => void insertEditorComment(),
    onHumanNoteCommand: () => void insertHumanEditorComment(),
    onLlmInstructionCommand: () => void insertTargetedInstruction(),
    onVersionCommand: () => insertVariantGroup(),
    nextFigureLabel,
  });

  const syncBibliographySection = useCallback(() => {
    const entries = layerTwoDocument.citations.bibtexEntries;
    if (layerTwoDocument.citations.usages.length === 0) {
      pushToast('No citation keys found to sync.', 'warning');
      return;
    }
    const nextMarkdown = syncGeneratedBibliography(markdown, entries);
    commitMarkdown(nextMarkdown);
    pushToast(entries.length > 0 ? 'Bibliography synced from loaded .bib file.' : 'Bibliography section created with missing-key placeholders.', 'success');
  }, [commitMarkdown, layerTwoDocument.citations.bibtexEntries, layerTwoDocument.citations.usages.length, markdown, pushToast]);

  const insertReferencesDirective = useCallback(() => {
    insertMarkdown(':::references\n:::\n\n');
    pushToast('Auto References section inserted. It renders the loaded .bib entries for cited keys.', 'success');
  }, [insertMarkdown, pushToast]);

  const applyScientificTypography = useCallback(() => {
    const nextMarkdown = normalizeScientificTypography(markdownRef.current);
    if (nextMarkdown === markdownRef.current) {
      pushToast('Scientific typography already clean.', 'info');
      return;
    }
    commitMarkdown(nextMarkdown);
    pushToast('Scientific typography applied.', 'success');
  }, [commitMarkdown, pushToast]);

  const renderVisualExportHtml = useCallback(async (preparedMarkdown: string) => {
    setExportRenderHostMounted(true);
    try {
      const host = await waitForExportRenderHost(exportRenderHostRef);
      if (!host) return null;
      return await host.render({
        markdown: preparedMarkdown,
        filePath,
        variableDefinitions: layerTwoDocument.variables.definitions,
        citationEntries: layerTwoDocument.citations.bibtexEntries,
      });
    } finally {
      setExportRenderHostMounted(false);
    }
  }, [filePath, layerTwoDocument.citations.bibtexEntries, layerTwoDocument.variables.definitions]);

  const { copyRichText, exportHtml, exportPandoc, printPreview } = useExportActions({
    markdown,
    filePath,
    variableDefinitions: layerTwoDocument.variables.definitions,
    citationEntries: layerTwoDocument.citations.bibtexEntries,
    themeMode: settings.themeMode,
    resolvedTheme,
    visualStyle: settings.visualStyle,
    fontScale: settings.fontScale,
    exportOptions: settings.exportOptions,
    captureVisualHtml: () => captureEditorHtmlForExport(editorStageRef.current),
    renderVisualExportHtml,
    onExportLog: (entries) => exportLogSinkRef.current(entries),
    pushToast,
  });

  const runPrintPreview = useCallback(() => {
    setActiveTopbarMenu(null);
    void printPreview(settings.exportOptions);
  }, [printPreview, settings.exportOptions]);

  const exportWorkflow = useExportWorkflow({
    exportHtml,
    exportPandoc,
  });

  useEffect(() => {
    if (!exportWorkflow.activeExport) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [exportWorkflow.activeExport]);

  useEffect(() => {
    if (!isTauriRuntime() || !exportWorkflow.activeExport) return undefined;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      pushToast('An export is still running. Keep ScieMD open until it finishes.', 'warning');
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [exportWorkflow.activeExport, pushToast]);

  useEffect(() => {
    exportLogSinkRef.current = exportWorkflow.handleLog;
  }, [exportWorkflow.handleLog]);

  const visualAtomCount = useMemo(
    () => editorComments.length + targetedInstructions.length + variantGroups.length + protectedBlocks.length,
    [editorComments.length, protectedBlocks.length, targetedInstructions.length, variantGroups.length],
  );
  const activeBackgroundJobCount = useMemo(
    () => [
      bibliographyLoading,
      startupDocumentOpenPending,
      Boolean(documentOpenStatus),
      Boolean(exportWorkflow.activeExport),
    ].filter(Boolean).length,
    [bibliographyLoading, documentOpenStatus, exportWorkflow.activeExport, startupDocumentOpenPending],
  );
  const handlePreviousRendererCrashDetected = useCallback(() => {
    pushToast(
      'Previous ScieMD session ended unexpectedly. A local diagnostics marker and raw recovery snapshot are available if needed.',
      'warning',
    );
  }, [pushToast]);
  useRendererDiagnostics({
    markdown,
    filePath,
    mode,
    warningCount: warnings.length,
    errorCount: errors.length,
    visualAtomCount,
    activeBackgroundJobCount,
    onPreviousSessionCrashDetected: handlePreviousRendererCrashDetected,
  });

  const {
    externalConflictReview,
    externalProtectedChanges,
    openExternalConflictReview,
    closeExternalConflictReview,
    applyExternalConflictReview,
  } = useExternalConflictReviewWorkflow({
    filePath,
    documentEpochRef,
    markdown,
    lastSavedMarkdown,
    adoptReviewedDiskMerge,
    setAuthorshipMarks,
    pushToast,
  });

  const handleSidebarViewChange = useCallback((sidebarView: SidebarView) => {
    updateUserSettings({ outlineOpen: true, sidebarView });
  }, [updateUserSettings]);
  const handleSidebarResize = useCallback((width: number) => {
    setSidebarWidth(normalizeSidebarWidth(width));
  }, []);
  const handleSidebarResizeCommit = useCallback((width: number) => {
    const nextWidth = normalizeSidebarWidth(width);
    setSidebarWidth(nextWidth);
    updateUserSettings({ sidebarWidth: nextWidth });
  }, [updateUserSettings]);
  const openNavigationSidebar = useCallback(() => {
    updateUserSettings({ outlineOpen: true });
  }, [updateUserSettings]);
  const closeNavigationSidebar = useCallback(() => {
    updateUserSettings({ outlineOpen: false });
  }, [updateUserSettings]);

  const cycleTheme = useCallback(() => {
    const next: ThemeMode = settings.themeMode === 'system'
      ? 'dark'
      : settings.themeMode === 'dark'
        ? 'sepia'
        : settings.themeMode === 'sepia'
          ? 'light'
          : 'system';
    updateUserSettings({ themeMode: next });
  }, [settings.themeMode, updateUserSettings]);

  const openCommandPalette = useCallback(() => {
    setActiveTopbarMenu(null);
    setCommandPaletteOpen(true);
  }, []);

  const setVisualStyle = useCallback((visualStyle: VisualStyleId) => {
    updateUserSettings({ visualStyle });
    setActiveTopbarMenu(null);
    pushToast(`Visual style: ${getVisualStyleOption(visualStyle).label}`, 'info');
  }, [pushToast, updateUserSettings]);

  const setThemeMode = useCallback((themeMode: ThemeMode) => {
    updateUserSettings({ themeMode });
    setActiveTopbarMenu(null);
    pushToast(`Theme: ${themeMode}`, 'info');
  }, [pushToast, updateUserSettings]);

  const cycleVisualStyle = useCallback(() => {
    setVisualStyle(nextVisualStyle(settings.visualStyle));
  }, [setVisualStyle, settings.visualStyle]);

  const adjustFontScale = useCallback((delta: number) => {
    const next = Math.min(1.35, Math.max(0.85, Math.round((settings.fontScale + delta) * 20) / 20));
    updateUserSettings({ fontScale: next });
    pushToast(`Font size ${Math.round(next * 100)}%`, 'info');
  }, [pushToast, settings.fontScale, updateUserSettings]);

  const resetFontScale = useCallback(() => {
    updateUserSettings({ fontScale: 1 });
    pushToast('Font size reset', 'info');
  }, [pushToast, updateUserSettings]);

  const toggleFocusMode = useCallback(() => {
    updateUserSettings({ focusMode: !settings.focusMode });
  }, [settings.focusMode, updateUserSettings]);

  const applyDocumentType = useCallback((documentType: DocumentType) => {
    const defaults: Record<DocumentType, { fontScale: number; visualStyle: VisualStyleId }> = {
      'lab-note': { fontScale: 0.95, visualStyle: 'lab-notebook' },
      report: { fontScale: 1, visualStyle: 'scientific-draft' },
      memo: { fontScale: 0.95, visualStyle: 'journal-manuscript' },
      notes: { fontScale: 1, visualStyle: 'scientific-draft' },
      other: { fontScale: 1, visualStyle: 'scientific-draft' },
    };
    updateUserSettings({ ...defaults[documentType], documentType, onboardingComplete: true });
    setDocumentTypeDialogOpen(false);
    if (!startupDocumentOpenPending && !startupDocumentOpenFailed && !filePath && markdownRef.current.trim() === '') {
      commitOpenedDocument(null, welcomeMarkdown, DEFAULT_METADATA, 'visual');
    }
    pushToast('Writing defaults applied', 'success');
  }, [commitOpenedDocument, filePath, pushToast, startupDocumentOpenFailed, startupDocumentOpenPending, updateUserSettings]);

  const skipDocumentType = useCallback(() => {
    updateUserSettings({ onboardingComplete: true });
    setDocumentTypeDialogOpen(false);
    if (!startupDocumentOpenPending && !startupDocumentOpenFailed && !filePath && markdownRef.current.trim() === '') {
      commitOpenedDocument(null, welcomeMarkdown, DEFAULT_METADATA, 'visual');
    }
  }, [commitOpenedDocument, filePath, startupDocumentOpenFailed, startupDocumentOpenPending, updateUserSettings]);

  const automaticDocumentTypeDialogOpen = shouldShowAutomaticOnboardingDialog({
    onboardingComplete: settings.onboardingComplete,
    startupDocumentOpenPending,
    startupDocumentOpenFailed,
    filePath,
    markdown,
  });

  const shortcutsEnabled = !closeDialogOpen
    && !promptState
    && !confirmState
    && !pasteReview?.open
    && !commandPaletteOpen
    && !shortcutDialogOpen
    && !aboutOpen
    && !settingsOpen
    && !templateDialogOpen
    && !documentTypeDialogOpen
    && !linkDialog
    && !citationDialogOpen
    && !variableDialog
    && !blockDialogState
    && !externalConflictReview
    && !exportWorkflow.dialogFormat
    && !exportWorkflow.logOpen
    && !findOpen
    && !slashMenu
    && !activeTopbarMenu
    && (settings.onboardingComplete || !automaticDocumentTypeDialogOpen);

  const runHistoryCommand = useCallback((command: keyof EditorHistoryControls) => {
    const handledByDocumentHistory = command === 'undo'
      ? undoDocumentEdit()
      : redoDocumentEdit();
    if (handledByDocumentHistory) return;
    pushToast(command === 'undo' ? 'Nothing to undo' : 'Nothing to redo', 'info');
  }, [pushToast, redoDocumentEdit, undoDocumentEdit]);

  useKeyboardShortcuts(useMemo(() => ({
    onSave: () => void saveCurrent(),
    onSaveAs: () => void saveCurrent({ forceSaveAs: true }),
    onOpen: () => void handleOpen(),
    onNew: () => void handleNew(),
    onFind: () => setFindOpen(true),
    onCommandPalette: openCommandPalette,
    onShortcutSheet: () => setShortcutDialogOpen(true),
    onIncreaseFont: () => adjustFontScale(0.05),
    onDecreaseFont: () => adjustFontScale(-0.05),
    onResetFont: resetFontScale,
    onUndo: () => runHistoryCommand('undo'),
    onRedo: () => runHistoryCommand('redo'),
    onPrint: runPrintPreview,
    onToggleOutline: () => updateUserSettings({ outlineOpen: !settings.outlineOpen }),
  }), [adjustFontScale, handleNew, handleOpen, openCommandPalette, resetFontScale, runHistoryCommand, runPrintPreview, saveCurrent, settings.outlineOpen, updateUserSettings]), { enabled: shortcutsEnabled });

  const handleModeChange = useCallback(async (nextMode: EditorMode) => {
    if (nextMode === mode) return;
    const flushedMarkdown = flushVisualEditorState();
    if (flushedMarkdown !== null) {
      commitMarkdown(flushedMarkdown);
    }
    preserveLineForModeChange(currentLine, nextMode);
    setMode(nextMode);
  }, [commitMarkdown, currentLine, mode, preserveLineForModeChange]);

  const openLinkDialog = useCallback(() => {
    const selectedText = getSelectedEditorText();
    setLinkDialog({ selectedText, text: selectedText, url: '' });
  }, [getSelectedEditorText]);

  const insertLinkFromDialog = useCallback((link: { text: string; url: string }) => {
    const url = link.url.trim();
    if (!url) {
      pushToast('Enter a URL or relative path for the link.', 'warning');
      return;
    }
    const text = (link.text.trim() || url).replace(/\s+/g, ' ');
    const markdownLink = `[${escapeMarkdownLinkText(text)}](${escapeMarkdownLinkDestination(url)})`;
    if (linkDialog?.selectedText) {
      const wrapped = wrapSelectedEditorText(linkDialog.selectedText, () => markdownLink);
      if (wrapped) {
        setLinkDialog(null);
        pushToast('Link inserted.', 'success');
        return;
      }
      return;
    }
    insertMarkdown(`${markdownLink} `);
    setLinkDialog(null);
    pushToast('Link inserted.', 'success');
  }, [insertMarkdown, linkDialog, pushToast, wrapSelectedEditorText]);

  const dragHasUsefulPayload = useCallback((event: ReactDragEvent<HTMLElement>) => (
    Array.from(event.dataTransfer.types).some((type) => type === 'Files' || type === 'text/uri-list' || type === 'text/plain')
  ), []);

  const handleEditorDragEnter = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!dragHasUsefulPayload(event)) return;
    dropDepthRef.current += 1;
    setDropOverlayVisible(true);
  }, [dragHasUsefulPayload]);

  const handleEditorDragLeave = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!dragHasUsefulPayload(event)) return;
    dropDepthRef.current = Math.max(0, dropDepthRef.current - 1);
    if (dropDepthRef.current === 0) setDropOverlayVisible(false);
  }, [dragHasUsefulPayload]);

  const handleEditorDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!dragHasUsefulPayload(event)) return;
    event.preventDefault();
    setDropOverlayVisible(true);
  }, [dragHasUsefulPayload]);

  const handleEditorDrop = useCallback((event: ReactDragEvent<HTMLElement>) => {
    dropDepthRef.current = 0;
    setDropOverlayVisible(false);
    handleDropCapture(event);
  }, [handleDropCapture]);

  const {
    handleWindowMinimize,
    handleWindowMaximize,
    handleWindowClose,
    handleTitlebarMouseDown,
    handleTitlebarDoubleClick,
  } = useWindowChrome({ dirty, onDirtyCloseRequested: cancelAutosave, setCloseDialogOpen, closeWindow });

  const copySelectionFromFloatingToolbar = useCallback(async () => {
    const selectedText = getSelectedEditorText();
    if (!selectedText) {
      pushToast('Select text first.', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(selectedText);
      pushToast('Selection copied.', 'success');
    } catch {
      pushToast('Could not copy selection.', 'error');
    }
  }, [getSelectedEditorText, pushToast]);

  const convertSelectionToHeading = useCallback((level: 1 | 2 | 3 | 4 | 5 | 6) => {
    const selectedText = getSelectedEditorText();
    if (!selectedText) {
      pushToast('Select text first.', 'warning');
      return;
    }
    const wrapped = wrapSelectedEditorText(selectedText, (rawSelection) => toggleMarkdownHeadingSelection(rawSelection, level));
    if (wrapped) pushToast(`H${level} toggled.`, 'success');
  }, [getSelectedEditorText, pushToast, wrapSelectedEditorText]);

  const formatHeadingFromMenu = useCallback((level: 1 | 2 | 3 | 4 | 5 | 6) => {
    const selectedText = getSelectedEditorText();
    if (selectedText) {
      const wrapped = wrapSelectedEditorText(selectedText, (rawSelection) => toggleMarkdownHeadingSelection(rawSelection, level));
      if (wrapped) pushToast(`Heading ${level} applied.`, 'success');
      return;
    }
    insertMarkdown(`${'#'.repeat(level)} Heading\n\n`);
    pushToast(`Heading ${level} inserted.`, 'success');
  }, [getSelectedEditorText, insertMarkdown, pushToast, wrapSelectedEditorText]);

  const formatInlineFromMenu = useCallback((format: 'bold' | 'italic' | 'code') => {
    const selectedText = getSelectedEditorText();
    const wrappers = {
      bold: ['**', '**', 'bold'] as const,
      italic: ['*', '*', 'italic'] as const,
      code: ['`', '`', 'code'] as const,
    };
    const [prefix, suffix, placeholder] = wrappers[format];
    if (selectedText) {
      const wrapped = wrapSelectedEditorText(selectedText, (rawSelection) => `${prefix}${rawSelection.trim()}${suffix}`);
      if (wrapped) pushToast(`${format} applied.`, 'success');
      return;
    }
    insertMarkdown(`${prefix}${placeholder}${suffix}`);
    pushToast(`${format} inserted.`, 'success');
  }, [getSelectedEditorText, insertMarkdown, pushToast, wrapSelectedEditorText]);

  const insertSemanticBlockFromMenu = useCallback((type: SelectionBlockType) => {
    insertMarkdown(createSemanticBlockMarkdown(type, { figureLabel: nextFigureLabel }));
    pushToast(`${type} block inserted.`, 'success');
  }, [insertMarkdown, nextFigureLabel, pushToast]);

  const openBlockSelectionDialog = useCallback(() => {
    const selection = getEditorSelectionSnapshot();
    if (!selection.text.trim()) {
      pushToast('Select text first.', 'warning');
      return;
    }
    setBlockDialogState({ selection });
  }, [getEditorSelectionSnapshot, pushToast]);

  const wrapSelectionAsBlock = useCallback((type: SelectionBlockType) => {
    const selection = blockDialogState?.selection ?? null;
    const selectedText = selection?.text.trim() ?? '';
    setBlockDialogState(null);

    if (!selectedText) {
      insertMarkdown(createSemanticBlockMarkdown(type, { figureLabel: nextFigureLabel }));
      pushToast(`${type} block inserted.`, 'success');
      return;
    }

    const wrapped = selection ? wrapSelectedEditorBlock(selection, (rawSelection) => (
      `\n\n${createSemanticBlockMarkdown(type, { body: rawSelection, figureLabel: nextFigureLabel })}`
    )) : false;
    if (wrapped) pushToast(`Selection wrapped as ${type}.`, 'success');
    else pushToast('Block wrapping needs a whole source block selection. For sentence-level notes, use Note to LLM or Lock.', 'warning');
  }, [blockDialogState, insertMarkdown, nextFigureLabel, pushToast, wrapSelectedEditorBlock]);

  useEffect(() => {
    if (!activeTopbarMenu) return undefined;
    const closeMenus = () => setActiveTopbarMenu(null);
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.app-menu-button')) return;
      if (target?.closest('.topbar-popover-anchor')) return;
      closeMenus();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenus();
    };
    window.addEventListener('pointerdown', closeOnPointerDown);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [activeTopbarMenu]);

  const commands = useAppCommandRegistry({
    outlineOpen: settings.outlineOpen,
    focusMode: settings.focusMode,
    themeMode: settings.themeMode,
    currentVisualStyleLabel: currentVisualStyle.label,
    pasteReviewHunks: pasteReview?.hunks.length ?? null,
    recentPreviews,
    headings,
    onNew: () => void handleNew(),
    onOpen: () => void handleOpen(),
    onOpenFolder: () => void handleChooseExplorerFolder(),
    onSave: () => void saveCurrent(),
    onSaveAs: () => void saveCurrent({ forceSaveAs: true }),
    onFind: () => setFindOpen(true),
    onOpenSlashMenu: () => openSlashMenu(),
    onOpenTemplates: openTemplateDialog,
    onOpenSettings: () => setSettingsOpen(true),
    onOpenTutorial: () => void openTutorialDocument(),
    onOpenFullTutorial: () => void openFullTutorialDocument(),
    onInsertImage: () => void handleInsertImage(),
    onInsertCitation: openCitationLibrary,
    onInsertMermaid: () => insertMarkdown('```mermaid\nflowchart LR\n  A[Question] --> B[Experiment]\n  B --> C[Result]\n```\n\n'),
    onInsertSvgFigure: insertSvgFigure,
    onInsertVariable: openVariableInsert,
    onCheckExternalTools: () => void checkExternalTools(),
    onCheckInkscape: () => void checkInkscape(),
    onSetInkscapePath: () => void setInkscapePath(),
    onInsertProtectedBlock: insertProtectedBlock,
    onInsertEditorComment: insertEditorComment,
    onInsertHumanEditorComment: insertHumanEditorComment,
    onInsertTargetedInstruction: insertTargetedInstruction,
    onInsertVariantGroup: insertVariantGroup,
    onReloadBibliography: reloadBibliographyFromDisk,
    onSyncBibliography: syncBibliographySection,
    onInsertReferencesDirective: insertReferencesDirective,
    onApplyScientificTypography: applyScientificTypography,
    onGenerateSubmissionReadiness: () => void generateSubmissionReadiness(),
    onCopyScieMDLlmSkill: () => void copyScieMDLlmSkill(),
    onGenerateScieMDLlmSkill: () => void generateScieMDLlmSkill(),
    onCopyRichText: () => void copyRichText(),
    onExportHtml: () => void exportWorkflow.runConfiguredExport('html', settings.exportOptions),
    onExportPandoc: (format) => void exportWorkflow.runConfiguredExport(format, settings.exportOptions),
    onPrintPreview: runPrintPreview,
    onOpenPasteReview: openPasteReview,
    onToggleOutline: () => updateUserSettings({ outlineOpen: !settings.outlineOpen }),
    onToggleFocusMode: toggleFocusMode,
    onSidebarOutline: () => handleSidebarViewChange('outline'),
    onSidebarFiles: () => handleSidebarViewChange('files'),
    onSidebarReferences: () => handleSidebarViewChange('references'),
    onSidebarData: () => handleSidebarViewChange('data'),
    onCycleTheme: cycleTheme,
    onCycleVisualStyle: cycleVisualStyle,
    onSetVisualStyle: setVisualStyle,
    onIncreaseFont: () => adjustFontScale(0.05),
    onDecreaseFont: () => adjustFontScale(-0.05),
    onShowShortcuts: () => setShortcutDialogOpen(true),
    onShowAbout: () => setAboutOpen(true),
    onOpenRecent: (recentPath) => void handleOpen(recentPath),
    onJumpToHeading: jumpToHeading,
    onNewFromTemplate: (template) => void handleNewFromTemplate(template),
    missingCitationCount: layerTwoDocument.citations.missingKeys.length,
    missingVariableCount: layerTwoDocument.variables.missingVariables.length,
  });
  const commandPaletteDynamicCommands = useCallback((query: string): CommandItem[] => {
    const trimmed = query.trim();
    if (trimmed.startsWith('@')) {
      const needle = trimmed.slice(1).toLowerCase();
      const entryByKey = new Map(layerTwoDocument.citations.bibtexEntries.map((entry) => [entry.key, entry]));
      return citationCompletionKeys
        .filter((key) => key.toLowerCase().includes(needle))
        .slice(0, 12)
        .map((key) => ({
          id: `dynamic-citation-${key}`,
          label: `Insert citation @${key}`,
          detail: citationCommandDetail(entryByKey.get(key)),
          run: () => insertMarkdown(`[@${key}]`),
        }));
    }
    if (trimmed.startsWith('#')) {
      const needle = trimmed.slice(1).trim().toLowerCase();
      return headings
        .filter((heading) => !needle || heading.text.toLowerCase().includes(needle))
        .slice(0, 12)
        .map((heading) => ({
          id: `dynamic-heading-${heading.id}-${heading.line}`,
          label: `Go to ${'#'.repeat(Math.min(heading.level, 6))} ${heading.text}`,
          detail: `Line ${heading.line}`,
          run: () => jumpToHeading(heading),
        }));
    }
    return [];
  }, [citationCompletionKeys, headings, insertMarkdown, jumpToHeading, layerTwoDocument.citations.bibtexEntries]);
  const workbenchStyle = useMemo(() => ({
    '--outline-width': `${sidebarWidth}px`,
  }) as CSSProperties, [sidebarWidth]);

  return (
    <div className={`app-shell ${settings.focusMode ? 'focus-mode' : ''}`}>
      <a className="skip-link" href="#editor-stage">{t('accessibility.skipToEditor')}</a>
      <AppTopbar
        mode={mode}
        activeMenu={activeTopbarMenu}
        filePath={filePath}
        dirty={dirty}
        outlineOpen={settings.outlineOpen}
        inspectorOpen={settings.inspectorOpen}
        focusMode={settings.focusMode}
        themeMode={settings.themeMode}
        currentVisualStyle={currentVisualStyle}
        selectedVisualStyle={settings.visualStyle}
        recentFiles={recentPreviews}
        hasPasteReview={Boolean(pasteReview)}
        onToggleMenu={(menu) => setActiveTopbarMenu((current) => current === menu ? null : menu)}
        onCloseMenus={() => setActiveTopbarMenu(null)}
        onNew={() => void handleNew()}
        onOpen={() => void handleOpen()}
        onOpenFolder={() => void handleChooseExplorerFolder()}
        onOpenRecent={(recentPath) => void handleOpen(recentPath)}
        onSave={() => void saveCurrent()}
        onSaveAs={() => void saveCurrent({ forceSaveAs: true })}
        onFind={() => setFindOpen(true)}
        onUndo={() => runHistoryCommand('undo')}
        onRedo={() => runHistoryCommand('redo')}
        onCopyRichText={() => void copyRichText()}
        onApplyScientificTypography={applyScientificTypography}
        onInsertMarkdown={insertMarkdown}
        onInsertImage={() => void handleInsertImage()}
        onInsertLink={openLinkDialog}
        onInsertCitation={openCitationLibrary}
        onInsertVariable={openVariableInsert}
        onInsertMermaid={() => insertMarkdown('```mermaid\nflowchart LR\n  A[Question] --> B[Experiment]\n  B --> C[Result]\n```\n\n')}
        onInsertSvgFigure={insertSvgFigure}
        onInsertSemanticBlock={insertSemanticBlockFromMenu}
        onInsertProtectedBlock={() => void insertProtectedBlock()}
        onInsertEditorComment={() => void insertEditorComment()}
        onInsertHumanEditorComment={() => void insertHumanEditorComment()}
        onInsertTargetedInstruction={() => void insertTargetedInstruction()}
        onInsertVariantGroup={() => insertVariantGroup()}
        onInsertReferencesDirective={insertReferencesDirective}
        onReloadBibliography={reloadBibliographyFromDisk}
        onSyncBibliography={syncBibliographySection}
        onCopyScieMDLlmSkill={() => void copyScieMDLlmSkill()}
        onGenerateScieMDLlmSkill={() => void generateScieMDLlmSkill()}
        onGenerateSubmissionReadiness={() => void generateSubmissionReadiness()}
        onOpenPasteReview={openPasteReview}
        onOpenExportDialog={(format) => exportWorkflow.openDialog(format)}
        onShowExportLog={exportWorkflow.openLog}
        onPrintPreview={runPrintPreview}
        onOpenTutorial={() => void openTutorialDocument()}
        onOpenFullTutorial={() => void openFullTutorialDocument()}
        onShowShortcuts={() => setShortcutDialogOpen(true)}
        onOpenTemplates={openTemplateDialog}
        onCheckTools={() => void checkExternalTools()}
        onSetInkscapePath={() => void setInkscapePath()}
        onOpenSettings={() => setSettingsOpen(true)}
        onShowAbout={() => setAboutOpen(true)}
        onOpenGithub={openGithub}
        onReportBug={reportBug}
        onOpenCommandPalette={openCommandPalette}
        onOpenSlashMenu={() => openSlashMenu()}
        onModeChange={(nextMode) => void handleModeChange(nextMode)}
        onSetVisualStyle={setVisualStyle}
        onSetThemeMode={setThemeMode}
        onIncreaseFont={() => adjustFontScale(0.05)}
        onDecreaseFont={() => adjustFontScale(-0.05)}
        onResetFont={resetFontScale}
        onFormatHeading={formatHeadingFromMenu}
        onFormatInline={formatInlineFromMenu}
        onToggleOutline={() => updateUserSettings({ outlineOpen: !settings.outlineOpen })}
        onSidebarView={handleSidebarViewChange}
        onToggleInspector={() => updateUserSettings({ inspectorOpen: !settings.inspectorOpen })}
        onToggleFocusMode={toggleFocusMode}
        onWindowMinimize={handleWindowMinimize}
        onWindowMaximize={handleWindowMaximize}
        onWindowClose={handleWindowClose}
        onTitlebarMouseDown={handleTitlebarMouseDown}
        onTitlebarDoubleClick={handleTitlebarDoubleClick}
      />

      <MarkdownToolbar
        mode={mode}
        visualEditor={visualEditor}
        onInsertMarkdown={insertMarkdown}
        onInsertImage={() => void handleInsertImage()}
        onInsertCitation={openCitationLibrary}
        onUndo={() => runHistoryCommand('undo')}
        onRedo={() => runHistoryCommand('redo')}
        onInsertLink={openLinkDialog}
        onInsertVariable={openVariableInsert}
        onInsertLlmNote={() => void insertEditorComment()}
        onInsertHumanNote={() => void insertHumanEditorComment()}
        onInsertVariantGroup={() => insertVariantGroup()}
        onOpenTablePicker={() => openSlashMenu('table')}
        nextFigureLabel={nextFigureLabel}
      />

      {findOpen && (
        <FindReplacePanel
          markdown={markdown}
          onChange={commitMarkdown}
          onClose={() => setFindOpen(false)}
          onNavigate={navigateToFindMatch}
        />
      )}

      <div
        className={`workbench ${settings.outlineOpen ? 'with-outline' : ''} ${settings.inspectorOpen ? 'with-inspector' : ''}`}
        style={workbenchStyle}
      >
        {!settings.outlineOpen && (
          <button
            type="button"
            className="sidebar-open-button"
            aria-label="Open navigation sidebar"
            data-tooltip="Open navigation sidebar"
            onClick={openNavigationSidebar}
          >
            <PanelLeftOpen size={17} />
          </button>
        )}
        {settings.outlineOpen && (
          <NavigationSidebar
            view={settings.sidebarView}
            width={sidebarWidth}
            outline={{ headings, activeHeadingId, onJump: jumpToHeading, onInsertHeading: insertOutlineHeading }}
            explorer={{
              path: explorerCurrentPath,
              entries: explorerEntries,
              selectedImage: explorerSelectedImage,
              loading: explorerLoading,
              error: explorerError,
              onChooseFolder: handleChooseExplorerFolder,
              onOpenPath: loadExplorerDirectory,
              onOpenEntry: handleOpenExplorerEntry,
            }}
            layerTwoDocument={layerTwoDocument}
            bibliographyLoading={bibliographyLoading}
            onViewChange={handleSidebarViewChange}
            onJumpToLine={jumpToLineInCurrentMode}
            onReloadBibliography={reloadBibliographyFromDisk}
            onManageCitations={openCitationLibrary}
            onInsertVariable={openVariableInsert}
            onLinkVariableFile={() => void linkVariableFile()}
            onEditVariable={saveVariableEdit}
            selectedVariableName={selectedVariableName}
            onSelectVariable={selectVariableInDocument}
            onResize={handleSidebarResize}
            onResizeCommit={handleSidebarResizeCommit}
            onClose={closeNavigationSidebar}
          />
        )}
        <main
          id="editor-stage"
          ref={editorStageRef}
          className="editor-stage"
          tabIndex={-1}
          onKeyDownCapture={handleEditorKeyDownCapture}
          onPasteCapture={handlePasteCapture}
          onDragEnterCapture={handleEditorDragEnter}
          onDragLeaveCapture={handleEditorDragLeave}
          onDropCapture={handleEditorDrop}
          onDragOver={handleEditorDragOver}
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
          <QuickOutlineHover headings={headings} activeHeadingId={activeHeadingId} onJump={jumpToHeading} />
          <EditorErrorBoundary
            resetKey={`${filePath ?? 'untitled'}:${mode}:${editorResetToken}`}
            fallback={(error, reset) => (
              <div className="editor-fallback">
                <div className="editor-fallback-banner">
                  <strong>Visual editor could not render this view.</strong>
                  <span>{error.message || 'The visual editor failed to render this document.'}</span>
                  <button
                    onClick={() => {
                      setEditorResetToken((current) => current + 1);
                      reset();
                    }}
                  >
                    Retry visual editor
                  </button>
                </div>
                <textarea
                  className="editor-fallback-raw"
                  aria-label="Raw Markdown fallback"
                  value={markdown}
                  onChange={(event) => commitEditorMarkdownEdit(event.target.value)}
                />
              </div>
            )}
          >
            {mode === 'visual' ? (
              <VisualMarkdownEditor
                markdown={markdown}
                filePath={filePath}
                onChange={commitEditorMarkdownEdit}
                onEditorReady={setVisualEditor}
                onInsertReady={handleVisualInsertReady}
                onJumpReady={handleVisualJumpReady}
                onFindReady={handleVisualFindReady}
                onHistoryReady={handleVisualHistoryReady}
                onSelectionTextReady={handleSelectionTextReady}
                onCursorLineChange={handleCursorPositionChange}
                onViewportLineChange={handleViewportLineChange}
                outlineHeadings={navigationHeadings}
                onLockViolation={(message) => pushToast(message, 'warning')}
                onToast={pushToast}
                confirmText={confirmText}
                referenceLabels={layerTwoDocument.references.labels.map((label) => label.id)}
                citationKeys={citationCompletionKeys}
                citationEntries={layerTwoDocument.citations.bibtexEntries}
                variableDefinitions={layerTwoDocument.variables.definitions}
                highlightedVariableName={selectedVariableName}
                onEditCitation={openCitationEditor}
                onEditVariable={openVariableEdit}
              />
            ) : (
              <SourceMarkdownEditor
                markdown={markdown}
                onChange={commitEditorMarkdownEdit}
                onInsertReady={handleSourceInsertReady}
                onJumpReady={handleSourceJumpReady}
                onFindReady={handleSourceFindReady}
                onHistoryReady={handleSourceHistoryReady}
                onSelectionTextReady={handleSelectionTextReady}
                onCursorLineChange={handleCursorPositionChange}
                onViewportLineChange={handleViewportLineChange}
                authorshipMarks={settings.authorshipVisible ? authorshipMarks : []}
                citationKeys={citationCompletionKeys}
                citationEntries={layerTwoDocument.citations.bibtexEntries}
                crossReferenceLabels={layerTwoDocument.references.labels}
                variableDefinitions={layerTwoDocument.variables.definitions}
                highlightedVariableName={selectedVariableName}
                validationIssues={validation.issues}
                protectedBlocks={protectedBlocks}
                onLockViolation={(message) => pushToast(message, 'warning')}
              />
            )}
          </EditorErrorBoundary>
          <FloatingFormatToolbar
            enabled={mode === 'visual'}
            visualEditor={visualEditor}
            selectionRoot={editorStageRef.current?.querySelector<HTMLElement>('.visual-editor') ?? null}
            getSelectionSnapshot={getEditorSelectionSnapshot}
            onLockSelection={() => void insertProtectedBlock()}
            onCommentSelection={(selection) => void insertEditorComment(selection)}
            onHumanCommentSelection={(selection) => void insertHumanEditorComment(selection)}
            onVariantSelection={() => insertVariantGroup()}
            onCopySelection={() => void copySelectionFromFloatingToolbar()}
            onHeadingSelection={convertSelectionToHeading}
            onBlockSelection={openBlockSelectionDialog}
          />
          <MetadataRail
            mode={mode}
            document={layerTwoDocument}
            protectedBlocks={protectedBlocks}
            editorComments={editorComments}
            targetedInstructions={targetedInstructions}
            variantGroups={variantGroups}
            currentLine={activeNavigationLine}
            onJumpToLine={jumpToLineInCurrentMode}
            onOpenReferences={() => handleSidebarViewChange('references')}
            onOpenData={() => handleSidebarViewChange('data')}
          />
        </main>
        <InspectorPane
          open={settings.inspectorOpen}
          focusSection={inspectorFocusSection}
          data={{
            filePath,
            mode,
            metadata: fileMetadata,
            validationIssues: ambientIssues,
            insights: documentInsights,
            recentPreviews,
            authorshipMarks,
            authorshipVisible: settings.authorshipVisible,
            missingImageCount,
            autosaveStatus,
            protectedBlocks,
            editorComments,
            targetedInstructions,
            variantGroups,
            visualStyle: settings.visualStyle,
            visualStyleLabel: currentVisualStyle.label,
            documentType: settings.documentType,
            hasPasteReview: Boolean(pasteReview),
            layerTwoDocument,
            manuscriptReadiness,
            bibliographyLoading,
            inkscapePath: settings.inkscapePath,
          }}
          actions={{
            onClose: () => updateUserSettings({ inspectorOpen: false }),
            onOpenPasteReview: openPasteReview,
            onGenerateSubmissionReadiness: () => void generateSubmissionReadiness(),
            onToggleAuthorship: () => updateUserSettings({ authorshipVisible: !settings.authorshipVisible }),
            onOpenRecent: (recentPath) => void handleOpen(recentPath),
            onReloadBibliography: reloadBibliographyFromDisk,
            onCheckInkscape: () => void checkInkscape(),
            onSetInkscapePath: () => void setInkscapePath(),
            onJumpToLine: jumpToLineInCurrentMode,
          }}
        />
      </div>

      <AmbientSuggestions
        issues={ambientIssues}
        hasPasteReview={Boolean(pasteReview)}
        onOpenPasteReview={openPasteReview}
      />

      <StatusBar
        autosaveStatus={autosaveStatus}
        statusText={statusText}
        headingPath={currentHeadingPath}
        wordCount={validation.wordCount}
        manuscriptScore={manuscriptReadiness.score}
        manuscriptStatus={manuscriptReadiness.status}
        errors={errors.map((error) => error.message)}
        warnings={warnings.map((warning) => warning.message)}
        externalConflict={externalConflict}
        filePath={filePath}
        onReviewConflict={() => void openExternalConflictReview()}
        onSaveAnyway={() => void saveCurrent({ forceOverwrite: true })}
        onReveal={() => filePath && void revealInFileManager(filePath)}
        onReload={() => filePath && void handleReloadFromDisk()}
        onSaveNow={() => void saveCurrent({ forceSaveAs: true })}
        onJumpToHeading={jumpToHeading}
        onOpenReadiness={() => {
          setInspectorFocusSection('readiness');
          updateUserSettings({ inspectorOpen: true });
        }}
        onOpenValidation={() => {
          setInspectorFocusSection('validation');
          updateUserSettings({ inspectorOpen: true });
        }}
      />

      <AppOverlays
        closeDialogOpen={closeDialogOpen}
        onCloseSave={() => void handleCloseSave()}
        onCloseDiscard={() => void handleCloseDiscard()}
        onCloseCancel={() => setCloseDialogOpen(false)}
        promptState={promptState}
        onPromptComplete={completePrompt}
        confirmState={confirmState}
        onConfirmComplete={completeConfirm}
        linkDialog={linkDialog}
        onLinkSubmit={insertLinkFromDialog}
        onLinkCancel={() => setLinkDialog(null)}
        variableDialog={variableDialog}
        variableDefinitions={layerTwoDocument.variables.definitions}
        suggestedVariableName={suggestedVariableName}
        onUseExistingVariable={insertVariableToken}
        onCreateVariable={createVariableAndInsert}
        onSaveVariable={saveVariableEdit}
        onCancelVariable={() => setVariableDialog(null)}
        citationDialogOpen={citationDialogOpen}
        citationDocumentPath={filePath}
        citationEntries={layerTwoDocument.citations.bibtexEntries}
        citationBibliographyFiles={layerTwoDocument.citations.bibliographyFiles}
        citationLoading={bibliographyLoading}
        citationDialogInitialKey={citationDialogInitialKey}
        onCloseCitationDialog={() => {
          setCitationDialogOpen(false);
          setCitationDialogInitialKey(null);
        }}
        onInsertCitation={(key) => {
          insertMarkdown(`[@${key}]`);
          setCitationDialogOpen(false);
          setCitationDialogInitialKey(null);
        }}
        onSaveCitationEntry={saveCitationEntry}
        onDeleteCitationEntry={deleteCitationEntry}
        onReloadBibliography={reloadBibliographyFromDisk}
        blockDialogState={blockDialogState}
        onSelectBlockType={wrapSelectionAsBlock}
        onCancelBlockType={() => setBlockDialogState(null)}
        exportDialogFormat={exportWorkflow.dialogFormat}
        exportOptions={settings.exportOptions}
        onCancelExportDialog={exportWorkflow.closeDialog}
        onRunExport={(format, options) => {
          updateUserSettings({ exportOptions: options });
          void exportWorkflow.runConfiguredExport(format, options);
        }}
        exportLogOpen={exportWorkflow.logOpen}
        exportLogEntries={exportWorkflow.logEntries}
        onCloseExportLog={exportWorkflow.closeLog}
        pasteReviewOpen={Boolean(pasteReview?.open)}
        pasteReviewHunks={pasteReview?.hunks ?? []}
        pasteReviewPlan={pasteReview?.reviewPlan}
        pasteReviewLargeChangeSummary={pasteReview?.bulkReview?.summary}
        pasteProtectedChanges={pasteProtectedChanges}
        onApplyPasteReview={applyPasteReview}
        onAcceptPasteReview={acceptPasteReview}
        onRejectPasteReview={rejectPasteReview}
        onClosePasteReview={closePasteReview}
        onFocusReviewLine={jumpToLineInCurrentMode}
        externalConflictOpen={Boolean(externalConflictReview)}
        externalConflictHunks={externalConflictReview?.hunks ?? []}
        externalProtectedChanges={externalProtectedChanges}
        onApplyExternalConflictReview={applyExternalConflictReview}
        onCloseExternalConflictReview={closeExternalConflictReview}
        shortcutDialogOpen={shortcutDialogOpen}
        onCloseShortcutDialog={() => setShortcutDialogOpen(false)}
        aboutOpen={aboutOpen}
        onCloseAbout={() => setAboutOpen(false)}
        settingsOpen={settingsOpen}
        settings={settings}
        onUpdateSettings={updateUserSettings}
        onCheckInkscape={() => void checkInkscape()}
        onSetInkscapePath={() => void setInkscapePath()}
        onOpenWritingDefaults={openWritingDefaults}
        onCloseSettings={() => setSettingsOpen(false)}
        templateDialogOpen={templateDialogOpen}
        onCreateFromTemplate={createFromTemplate}
        onCancelTemplateDialog={() => setTemplateDialogOpen(false)}
        automaticDocumentTypeDialogOpen={automaticDocumentTypeDialogOpen}
        documentTypeDialogOpen={documentTypeDialogOpen}
        onSelectDocumentType={applyDocumentType}
        onSkipDocumentType={skipDocumentType}
        commandPaletteOpen={commandPaletteOpen}
        commands={commands}
        dynamicCommands={commandPaletteDynamicCommands}
        onCloseCommandPalette={() => setCommandPaletteOpen(false)}
        slashMenu={slashMenu}
        slashCommands={slashCommands}
        onSelectSlashCommand={insertSlashCommand}
        onCloseSlashMenu={closeSlashMenu}
        exportStatus={exportWorkflow.activeExport ?? exportWorkflow.lastExportStatus}
        exportBusy={Boolean(exportWorkflow.activeExport)}
        documentOpenStatus={documentOpenStatus}
        onOpenExportLog={exportWorkflow.openLog}
        onDismissExportStatus={exportWorkflow.activeExport ? undefined : exportWorkflow.clearLastStatus}
        toasts={toasts}
        onDismissToast={dismissToast}
        onPauseToast={pauseToast}
        onResumeToast={resumeToast}
        exportRenderHostMounted={exportRenderHostMounted}
        exportRenderHostRef={exportRenderHostRef}
      />
    </div>
  );
}

async function waitForExportRenderHost(
  ref: { current: ExportRenderHostHandle | null },
): Promise<ExportRenderHostHandle | null> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (ref.current) return ref.current;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  return ref.current;
}

function escapeMarkdownLinkText(value: string): string {
  return value
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .trim();
}

function escapeMarkdownLinkDestination(value: string): string {
  const trimmed = value.trim();
  if (!/[\s()]/.test(trimmed)) return trimmed;
  return `<${trimmed.replace(/>/g, '%3E')}>`;
}

function replaceFirstMissingImageReference(markdown: string, source: string, alt: string, replacement: string): string {
  const sourceKey = comparableImageToken(source);
  const sourceFile = imageFileName(sourceKey);
  let replaced = false;
  const next = markdown.replace(/!\[([^\]]*)]\(([^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g, (raw, rawAlt: string, rawUrl: string) => {
    if (replaced) return raw;
    const urlKey = comparableImageToken(rawUrl);
    const sameSource = sourceKey && (urlKey === sourceKey || imageFileName(urlKey) === sourceFile);
    const sameAlt = alt.trim() && rawAlt.trim() === alt.trim();
    if (!sameSource && !sameAlt) return raw;
    replaced = true;
    return replacement;
  });
  if (replaced) return next;
  const base = markdown.trimEnd();
  return base ? `${base}\n\n${replacement}\n` : `${replacement}\n`;
}

function comparableImageToken(value: string): string {
  const withoutQuery = value.split(/[?#]/, 1)[0] ?? value;
  try {
    return decodeURIComponent(withoutQuery).replace(/\\/g, '/').toLowerCase();
  } catch {
    return withoutQuery.replace(/\\/g, '/').toLowerCase();
  }
}

function imageFileName(value: string): string {
  return value.split('/').filter(Boolean).at(-1) ?? value;
}
