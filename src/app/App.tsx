import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, SetStateAction } from 'react';
import type { Editor } from '@milkdown/kit/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { EditorMode } from './documentState';
import { createWindowTitle, DEFAULT_METADATA } from './documentState';
import { useBackgroundJobTracker, type BackgroundJobSignal } from './backgroundJobs';
import { AppOverlays } from './AppOverlays';
import { AppWorkbench } from './AppWorkbench';
import type { AppTopbarMenuId } from '../components/AppTopbar';
import type { SelectionBlockType } from '../components/BlockTypeDialog';
import type { ExportRenderHostHandle } from '../components/ExportRenderHost';
import type { VariableDialogState } from '../components/VariableDialog';
import type { EditorHistoryControls } from '../components/editorControls';
import type { EditorSelectionSnapshot } from '../components/editorSelection';
import type { SourceMarkdownFind, SourceMarkdownInsert, SourceMarkdownJump, SourceMarkdownSelection } from '../components/SourceMarkdownEditor';
import type { VisualMarkdownFind, VisualMarkdownInsert, VisualMarkdownJump, VisualMarkdownSelection } from '../components/VisualMarkdownEditor';
import { commitVisualEditorState, readVisualEditorState } from '../components/visualEditorStateSync';
import { useDialogs } from './hooks/useDialogs';
import {
  initialDocumentMarkdownForLaunch,
  initialExplorerFallbackPathForLaunch,
  initialExplorerPathForLaunch,
  parentDirectoryForDocument,
  shouldCommitWelcomeAfterStartup,
  shouldShowAutomaticOnboardingDialog,
} from './documentLaunch';
import { useAppCommands } from './hooks/useAppCommands';
import { useDocumentDropPaste } from './hooks/useDocumentDropPaste';
import type { PasteReviewState, TabularPasteState } from './hooks/useDocumentDropPaste';
import { useDocumentSession } from './hooks/useDocumentSession';
import { labelForDocumentFormat } from './documentConflictPolicy';
import { formatCapabilitiesFor } from './formatCapabilities';
import { formatDiagnosticsToValidationIssues } from './formatDiagnostics';
import { useAuthorshipMaintenance } from './hooks/useAuthorshipMaintenance';
import { useDerivedDocumentInsights } from './hooks/useDerivedDocumentInsights';
import { useDocumentNavigation } from './hooks/useDocumentNavigation';
import { useFileExplorer } from './hooks/useFileExplorer';
import { useImageInsertion } from './hooks/useImageInsertion';
import { useJsonSchemaDiscovery } from './hooks/useJsonSchemaDiscovery';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useLayoutAttributes, useThemeAttribute } from './hooks/useResolvedTheme';
import { useRendererDiagnostics } from './hooks/useRendererDiagnostics';
import { useExportActions } from './hooks/useExportActions';
import { useExportWorkflow } from './hooks/useExportWorkflow';
import { useExternalConflictReviewWorkflow } from './hooks/useExternalConflictReviewWorkflow';
import { useSourceFormatDiagnostics } from './hooks/useSourceFormatDiagnostics';
import {
  createJsonEditReviewState,
  jsonVisualEditNeedsReview,
  resolveJsonEditReviewApply,
  type JsonEditReviewState,
} from './jsonEditReview';
import {
  appendStructuredEditJournalEntry,
  createStructuredEditJournalEntry,
  type StructuredEditJournalEntry,
} from './structuredEditJournal';
import {
  canCreateStructuredContextPackets,
  canCreateStructuredTableSamplePacket,
  createCurrentParserDiagnosticsContext,
  createCurrentRedactedStructuredPreview,
  createCurrentSchemaSummaryContext,
  createCurrentSelectedStructureContext,
  createCurrentStructuredTableSampleContext,
  createCurrentStructuredHealthContext,
  createCurrentWholeStructuredContext,
  type StructuredContextCommandState,
} from './structuredContextCommands';
import { createStructuredSavePolicy } from './structuredSavePolicy';
import { sourceSelectionForStructuredNode } from './structuredOperations';
import {
  createStructuredSurfaceNavigationModel,
  type StructuredSurfaceId,
} from './structuredSurfaceNavigation';
import {
  createStructuredNavigationIndex,
  structuredNavigationTargetKey,
  type StructuredNavigationTarget,
} from './structuredNavigation';
import { useCitationWorkflow } from './hooks/useCitationWorkflow';
import { useMissingImageDetection } from './hooks/useMissingImageDetection';
import { useLlmWorkflow } from './hooks/useLlmWorkflow';
import { usePasteReviewWorkflow } from './hooks/usePasteReviewWorkflow';
import { useRecentFilePreviews } from './hooks/useRecentFilePreviews';
import { useSlashCommandMenu } from './hooks/useSlashCommandMenu';
import { useStableRegistration } from './hooks/useStableRegistration';
import { useToasts } from './hooks/useToasts';
import { useWindowChrome } from './hooks/useWindowChrome';
import { desktopDocumentHost } from './host/desktopDocumentHost';
import { desktopPlatformHost } from './host/desktopPlatformHost';
import { updateRawDocumentRescue } from '../services/rawDocumentRescue';
import { exportDiagnosticsBundle } from '../services/nativeRecoveryService';
import { loadSettings, normalizeSidebarWidth, updateSettings } from '../services/settingsService';
import type { DocumentType, SidebarView, ThemeMode } from '../services/settingsService';
import { getVisualStyleOption, nextVisualStyle } from '../services/visualStyleService';
import type { VisualStyleId } from '../services/visualStyleService';
import type { AuthorshipMark } from '../markdown/authorship';
import { analyzeMarkdownDocument } from '../markdown/documentIntelligence';
import { assessManuscriptReadiness } from '../markdown/manuscriptReadiness';
import {
  createJsonArrayTableModel,
  extractHeadings,
  jsonlSourceHash,
  planJsonVisualEdit,
  planJsonlVisualEdit,
  planTabularVisualEdit,
  structuredAnalysisCanRenderSurface,
  structuredEditTransactionFromJsonEdit,
  structuredEditTransactionFromJsonlEdit,
  structuredEditTransactionFromTabularEdit,
  tabularSourceHash,
  validateStructuredPasteBack,
} from '@sciemd/core';
import type { JsonVisualEditIntent, JsonlVisualEditIntent, StructuredContextFormat, StructuredContextPacket, StructuredEditTransaction, StructuredNodeRef, TabularVisualEditIntent } from '@sciemd/core';
import type { DelimitedTextConversionFormat } from '@sciemd/core';
import { normalizeScientificTypography } from '../markdown/scientificTypography';
import { toggleMarkdownHeadingSelection } from '../markdown/headingToggle';
import { createSemanticBlockMarkdown } from '@sciemd/core';
import { insertStandaloneMarkdownBlockNearSelection, wrapMarkdownBlockSelection, wrapMarkdownSelection } from '@sciemd/core';
import { insertEditorNote, parseEditorComments } from '@sciemd/core';
import type { EditorNoteKind } from '@sciemd/core';
import { createTargetedInstructionSnippet, parseTargetedInstructions } from '@sciemd/core';
import { createAnchoredVariantGroupSnippet, createVariantGroupSnippet, parseVariantGroups } from '@sciemd/core';
import { createProtectedAnchorSnippet, createProtectedBlockSnippet, detectProtectedChanges, parseProtectedBlocks } from '@sciemd/core';
import { syncGeneratedBibliography } from '@sciemd/core';
import type { ScienfyTemplateId } from '../domain/document/templates';
import type { StructuredConversionRequest } from './structuredConversionActions';
import { suggestedDocumentSavePath } from './hooks/useSaveOperations';
import { createVariableToken, nextVariableName, renameVariableAndUpdateUsages, upsertFrontmatterVariable, upsertScienfyVariablesFile } from '@sciemd/core';
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

function isStructuredContextFormat(format: string): format is StructuredContextFormat {
  return format === 'json'
    || format === 'jsonl'
    || format === 'yaml'
    || format === 'toml'
    || format === 'xml'
    || format === 'csv'
    || format === 'tsv';
}

function isStructuredSurfaceFormat(format: string): boolean {
  return format === 'json'
    || format === 'jsonl'
    || format === 'yaml'
    || format === 'toml'
    || format === 'xml'
    || format === 'csv'
    || format === 'tsv';
}

export function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [sidebarWidth, setSidebarWidth] = useState(settings.sidebarWidth);
  const [authorshipMarks, setAuthorshipMarks] = useState<AuthorshipMark[]>([]);
  const { promptState, confirmState, promptText, confirmText, completePrompt, completeConfirm } = useDialogs();
  const { toasts, pushToast, dismissToast, pauseToast, resumeToast } = useToasts();
  const [pasteReview, setPasteReview] = useState<PasteReviewState | null>(null);
  const [tabularPaste, setTabularPaste] = useState<TabularPasteState | null>(null);
  const [jsonEditReview, setJsonEditReview] = useState<JsonEditReviewState | null>(null);
  const [structuredEditJournal, setStructuredEditJournal] = useState<StructuredEditJournalEntry[]>([]);
  const documentEpochRef = useRef(0);
  const handleDocumentReplaced = useCallback(() => {
    documentEpochRef.current += 1;
    setPasteReview(null);
    setTabularPaste(null);
    setJsonEditReview(null);
    setStructuredEditJournal([]);
  }, []);
  const {
    sourceText,
    markdown,
    format,
    commitSourceTextEdit,
    commitEditorSourceTextEdit,
    undoDocumentEdit,
    redoDocumentEdit,
    lastSavedSourceText,
    filePath,
    fileMetadata,
    mode,
    setMode,
    autosaveStatus,
    structuredSavePolicy,
    updateStructuredSavePolicy,
    lastAutosavedAt,
    saveQueueDepth,
    startupDocumentOpenPending,
    startupDocumentOpenFailed,
    startupDocumentOpenFailure,
    documentOpenStatus,
    externalConflict,
    dirty,
    validation,
    validateNow,
    layerTwoDocument,
    bibliographyLoading,
    documentParsingPending,
    validationPending,
    linkedVariableLoading,
    reloadBibliography,
    closeDialogOpen,
    setCloseDialogOpen,
    closeWindow,
    cancelAutosave,
    saveCurrent,
    confirmVisualRoundTripWrite,
    ensureDocumentPathForAssets,
    settleDirtyDocumentBeforeReplace,
    commitOpenedDocument,
    adoptReviewedDiskMerge,
    handleOpen,
    handleNewFromTemplate,
    retryStartupDocumentOpen,
    openStartupDocumentFallbackPicker,
    dismissStartupDocumentOpenFailure,
    recordStartupFallbackCommitted,
    handleCloseSave,
    handleCloseDiscard,
    handleCloseCancel,
    handleReloadFromDisk,
  } = useDocumentSession({
    initialSourceText: initialDocumentMarkdownForLaunch({
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
  const [selectedJsonPath, setSelectedJsonPath] = useState<string | null>('$');
  const [activeStructuredNavigationTargetKey, setActiveStructuredNavigationTargetKey] = useState<string | null>(null);
  const [preferredStructuredSurfaceByDocument, setPreferredStructuredSurfaceByDocument] = useState<Record<string, StructuredSurfaceId>>({});
  const [explicitJsonSchemaPath, setExplicitJsonSchemaPath] = useState<string | null>(null);
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
  const sourceTextRef = useRef(sourceText);
  const commitSourceText = useCallback((action: SetStateAction<string>) => {
    const next = typeof action === 'function'
      ? (action as (value: string) => string)(sourceTextRef.current)
      : action;
    sourceTextRef.current = next;
    commitSourceTextEdit(next);
  }, [commitSourceTextEdit]);
  const recordStructuredEdit = useCallback((transaction: StructuredEditTransaction, sourceBefore: string) => {
    setStructuredEditJournal((current) => appendStructuredEditJournalEntry(
      current,
      createStructuredEditJournalEntry({ transaction, sourceBefore }),
    ));
  }, []);
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
  const formatCapabilities = useMemo(() => formatCapabilitiesFor(format), [format]);
  const jsonSchemaDiscovery = useJsonSchemaDiscovery({
    format,
    filePath,
    explicitSchemaPath: explicitJsonSchemaPath,
    fileHost: desktopDocumentHost.file,
  });
  const sourceFormatDiagnosticState = useSourceFormatDiagnostics(format, sourceText, filePath, {
    jsonSchema: jsonSchemaDiscovery.schemaSource,
  });
  const structuredSurfaceDocumentKey = `${format}:${filePath ?? 'untitled'}`;
  useEffect(() => {
    setActiveStructuredNavigationTargetKey(null);
  }, [structuredSurfaceDocumentKey]);
  const preferredStructuredSurface = preferredStructuredSurfaceByDocument[structuredSurfaceDocumentKey] ?? null;
  const jsonArraySurfaceAvailable = useMemo(() => {
    if (format !== 'json') return false;
    const parsed = sourceFormatDiagnosticState.jsonAnalysis?.parseResult.parsed;
    if (!parsed) return false;
    return Boolean(createJsonArrayTableModel(parsed.value, parsed.sourceMap, { selectedPath: selectedJsonPath }));
  }, [format, selectedJsonPath, sourceFormatDiagnosticState.jsonAnalysis?.parseResult.parsed]);
  const nextStructuredSavePolicy = useMemo(() => createStructuredSavePolicy({
    format,
    diagnostics: sourceFormatDiagnosticState.diagnostics,
  }), [format, sourceFormatDiagnosticState.diagnostics]);
  useEffect(() => {
    updateStructuredSavePolicy(nextStructuredSavePolicy);
  }, [nextStructuredSavePolicy, updateStructuredSavePolicy]);
  const canUseReadonlyTreeMode = structuredAnalysisCanRenderSurface(sourceFormatDiagnosticState.structuredModel, 'tree');
  const canUseRecordListMode = structuredAnalysisCanRenderSurface(sourceFormatDiagnosticState.structuredModel, 'records');
  const canUseTabularPreviewMode = structuredAnalysisCanRenderSurface(sourceFormatDiagnosticState.structuredModel, 'table');
  const structuredContextCommandState = useMemo<StructuredContextCommandState | null>(() => {
    if (!isStructuredContextFormat(format)) return null;
    return {
      format,
      sourcePath: filePath,
      selectedPath: selectedJsonPath,
      jsonAnalysis: sourceFormatDiagnosticState.jsonAnalysis,
      jsonlAnalysis: sourceFormatDiagnosticState.jsonlAnalysis,
      structuredAnalysis: sourceFormatDiagnosticState.structuredAnalysis,
      tabularAnalysis: sourceFormatDiagnosticState.tabularAnalysis,
    };
  }, [
    filePath,
    format,
    selectedJsonPath,
    sourceFormatDiagnosticState.jsonAnalysis,
    sourceFormatDiagnosticState.jsonlAnalysis,
    sourceFormatDiagnosticState.structuredAnalysis,
    sourceFormatDiagnosticState.tabularAnalysis,
  ]);
  const structuredContextAvailable = structuredContextCommandState
    ? canCreateStructuredContextPackets(structuredContextCommandState)
    : false;
  const structuredTableSampleAvailable = structuredContextCommandState
    ? canCreateStructuredTableSamplePacket(structuredContextCommandState)
    : false;
  const structuredPasteBackValidationAvailable = isStructuredContextFormat(format);
  const effectiveEditorMode: EditorMode = formatCapabilities.canUseVisualMarkdown
    || canUseReadonlyTreeMode
    || canUseRecordListMode
    || canUseTabularPreviewMode
    ? mode
    : 'source';
  const structuredSurfaceNavigation = useMemo(() => (
    isStructuredSurfaceFormat(format)
      ? createStructuredSurfaceNavigationModel({
        format,
        mode: effectiveEditorMode,
        formatCapabilities,
        preferredVisualSurface: preferredStructuredSurface,
        parsingPending: sourceFormatDiagnosticState.parsingPending,
        jsonAnalysis: sourceFormatDiagnosticState.jsonAnalysis,
        jsonArrayTableAvailable: jsonArraySurfaceAvailable,
        jsonlAnalysis: sourceFormatDiagnosticState.jsonlAnalysis,
        structuredAnalysis: sourceFormatDiagnosticState.structuredAnalysis,
        tabularAnalysis: sourceFormatDiagnosticState.tabularAnalysis,
      })
      : null
  ), [
    effectiveEditorMode,
    format,
    formatCapabilities,
    jsonArraySurfaceAvailable,
    preferredStructuredSurface,
    sourceFormatDiagnosticState.jsonAnalysis,
    sourceFormatDiagnosticState.jsonlAnalysis,
    sourceFormatDiagnosticState.parsingPending,
    sourceFormatDiagnosticState.structuredAnalysis,
    sourceFormatDiagnosticState.tabularAnalysis,
  ]);
  const structuredNavigationIndex = useMemo(() => (
    createStructuredNavigationIndex({
      format,
      diagnostics: sourceFormatDiagnosticState.diagnostics,
      jsonAnalysis: sourceFormatDiagnosticState.jsonAnalysis,
      jsonlAnalysis: sourceFormatDiagnosticState.jsonlAnalysis,
      structuredAnalysis: sourceFormatDiagnosticState.structuredAnalysis,
      tabularAnalysis: sourceFormatDiagnosticState.tabularAnalysis,
    })
  ), [
    format,
    sourceFormatDiagnosticState.diagnostics,
    sourceFormatDiagnosticState.jsonAnalysis,
    sourceFormatDiagnosticState.jsonlAnalysis,
    sourceFormatDiagnosticState.structuredAnalysis,
    sourceFormatDiagnosticState.tabularAnalysis,
  ]);
  const selectedStructuredPathTargetKey = isStructuredSurfaceFormat(format) && selectedJsonPath
    ? `${format}:path:${selectedJsonPath}`
    : null;
  const activeStructuredNavigationKey = activeStructuredNavigationTargetKey ?? selectedStructuredPathTargetKey;
  const activeValidationIssues = useMemo(
    () => formatCapabilities.canUseVisualMarkdown
      ? validation.issues
      : formatDiagnosticsToValidationIssues(sourceFormatDiagnosticState.diagnostics),
    [formatCapabilities.canUseVisualMarkdown, sourceFormatDiagnosticState.diagnostics, validation.issues],
  );

  const documentTitle = createWindowTitle(filePath, dirty, format);
  const warnings = activeValidationIssues.filter((issue) => issue.severity === 'warning');
  const errors = activeValidationIssues.filter((issue) => issue.severity === 'error');
  const currentVisualStyle = getVisualStyleOption(settings.visualStyle);
  const recentPreviews = useRecentFilePreviews(settings.recentFiles);
  const deferredMarkdownForPanels = useDeferredValue(markdown);
  const citationCompletionKeys = useMemo(() => Array.from(new Set([
    ...layerTwoDocument.citations.bibtexKeys,
    ...layerTwoDocument.citations.usages.map((usage) => usage.key),
  ])).sort((a, b) => a.localeCompare(b)), [layerTwoDocument.citations.bibtexKeys, layerTwoDocument.citations.usages]);
  const activeCitationCompletionKeys = formatCapabilities.canUseCitations ? citationCompletionKeys : [];
  const nextFigureLabel = useMemo(
    () => nextReferenceLabel('fig', layerTwoDocument.references.labels.map((label) => label.id)),
    [layerTwoDocument.references.labels],
  );
  const parsedMarkdownGraph = useMemo(() => ({
    baseDocumentInsights: formatCapabilities.canUseManuscriptReadiness
      ? analyzeMarkdownDocument(deferredMarkdownForPanels)
      : analyzeMarkdownDocument(''),
    navigationHeadings: formatCapabilities.canUseManuscriptReadiness
      ? extractHeadings(deferredMarkdownForPanels)
      : [],
  }), [deferredMarkdownForPanels, formatCapabilities]);
  const liveAnnotationGraph = useMemo(() => ({
    editorComments: formatCapabilities.canUseLLMMarkdownMarkers ? parseEditorComments(markdown) : [],
    targetedInstructions: formatCapabilities.canUseLLMMarkdownMarkers ? parseTargetedInstructions(markdown) : [],
    protectedBlocks: formatCapabilities.canUseLLMMarkdownMarkers ? parseProtectedBlocks(markdown) : [],
    variantGroups: formatCapabilities.canUseLLMMarkdownMarkers ? parseVariantGroups(markdown) : [],
  }), [formatCapabilities, markdown]);
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
    revealSourceRange,
    navigateStructuredTarget,
    preserveLineForModeChange,
    navigateToFindMatch,
  } = useDocumentNavigation({
    mode: effectiveEditorMode,
    setMode,
    headings: navigationHeadings,
    sourceJumpHandler,
    sourceFindHandler,
    visualJumpHandler,
    visualFindHandler,
  });
  const wrapSelectedEditorText = useCallback((selectedText: string, wrap: (rawSelection: string) => string) => {
    const nextMarkdown = wrapMarkdownSelection(sourceTextRef.current, selectedText, wrap, currentLine);
    if (!nextMarkdown) {
      pushToast('Could not safely map this visual selection to Markdown. Try placing the cursor in the exact block before applying this command.', 'warning');
      return false;
    }
    commitSourceText(nextMarkdown);
    return true;
  }, [commitSourceText, currentLine, pushToast]);
  const wrapSelectedEditorBlock = useCallback((selection: EditorSelectionSnapshot, wrap: (rawSelection: string) => string) => {
    const nextMarkdown = wrapMarkdownBlockSelection(sourceTextRef.current, selection, wrap, currentLine);
    if (!nextMarkdown) return false;
    commitSourceText(nextMarkdown);
    return true;
  }, [commitSourceText, currentLine]);
  const applyJsonVisualEdit = useCallback((intent: JsonVisualEditIntent) => {
    if (format !== 'json' || sourceFormatDiagnosticState.jsonAnalysis?.status !== 'valid') {
      pushToast('JSON visual edits are available only for valid JSON tree mode.', 'warning');
      return;
    }
    const currentSource = sourceTextRef.current;
    const plan = planJsonVisualEdit(currentSource, intent, {
      schemaValidation: sourceFormatDiagnosticState.jsonAnalysis.parseResult.parsed?.schemaValidation ?? null,
    });
    if (!plan.ok || plan.nextSource === undefined) {
      pushToast(plan.unsupportedReason ?? plan.diagnostics[0]?.message ?? 'JSON visual edit is not available for this node.', 'warning');
      return;
    }
    if (plan.nextSource === sourceTextRef.current) {
      pushToast(plan.previewLabel, 'info');
      return;
    }
    const transaction = structuredEditTransactionFromJsonEdit(currentSource, intent, plan);
    if (!transaction) {
      pushToast('JSON edit transaction could not be created.', 'warning');
      return;
    }
    if (jsonVisualEditNeedsReview(intent)) {
      const review = createJsonEditReviewState({
        source: currentSource,
        intent,
        plan,
        documentEpoch: documentEpochRef.current,
      });
      if (!review) {
        pushToast('JSON source preview could not be created for this edit.', 'warning');
        return;
      }
      setJsonEditReview(review);
      return;
    }
    commitSourceText(plan.nextSource);
    recordStructuredEdit(transaction, currentSource);
    pushToast(plan.previewLabel, 'success');
  }, [commitSourceText, format, pushToast, recordStructuredEdit, sourceFormatDiagnosticState.jsonAnalysis]);
  const applyReviewedJsonEdit = useCallback(() => {
    if (!jsonEditReview) return;
    const sourceBefore = sourceTextRef.current;
    const result = resolveJsonEditReviewApply(sourceBefore, documentEpochRef.current, jsonEditReview);
    if (!result.ok) {
      setJsonEditReview(null);
      pushToast(result.reason, 'warning');
      return;
    }
    if (result.nextSource === sourceBefore) {
      setJsonEditReview(null);
      pushToast(result.previewLabel, 'info');
      return;
    }
    commitSourceText(result.nextSource);
    recordStructuredEdit(result.transaction, sourceBefore);
    setJsonEditReview(null);
    pushToast(result.previewLabel, 'success');
  }, [commitSourceText, jsonEditReview, pushToast, recordStructuredEdit]);
  const applyJsonlVisualEdit = useCallback((intent: JsonlVisualEditIntent) => {
    if (format !== 'jsonl' || !sourceFormatDiagnosticState.jsonlAnalysis?.parseResult.parsed) {
      pushToast('JSONL record edits are available only in JSONL Records mode.', 'warning');
      return;
    }
    const sourceBefore = sourceTextRef.current;
    const plan = planJsonlVisualEdit(sourceBefore, intent);
    if (!plan.ok || plan.nextSource === undefined) {
      pushToast(plan.unsupportedReason ?? plan.diagnostics[0]?.message ?? 'JSONL record edit is not available.', 'warning');
      return;
    }
    if (plan.nextSource === sourceBefore) {
      pushToast(plan.previewLabel, 'info');
      return;
    }
    const transaction = structuredEditTransactionFromJsonlEdit(sourceBefore, intent, plan);
    commitSourceText(plan.nextSource);
    if (transaction) recordStructuredEdit(transaction, sourceBefore);
    pushToast(plan.previewLabel, 'success');
  }, [commitSourceText, format, pushToast, recordStructuredEdit, sourceFormatDiagnosticState.jsonlAnalysis]);
  const applyTabularVisualEdit = useCallback((intent: TabularVisualEditIntent) => {
    if ((format !== 'csv' && format !== 'tsv') || !sourceFormatDiagnosticState.tabularAnalysis?.parseResult.parsed) {
      pushToast('Table edits are available only in CSV or TSV table preview mode.', 'warning');
      return;
    }
    const sourceBefore = sourceTextRef.current;
    const plan = planTabularVisualEdit(sourceBefore, intent);
    if (!plan.ok || plan.nextSource === undefined) {
      pushToast(plan.unsupportedReason ?? plan.diagnostics[0]?.message ?? 'Table edit is not available for this cell.', 'warning');
      return;
    }
    if (plan.nextSource === sourceBefore) {
      pushToast(plan.previewLabel, 'info');
      return;
    }
    const transaction = structuredEditTransactionFromTabularEdit(sourceBefore, intent, plan);
    commitSourceText(plan.nextSource);
    if (transaction) recordStructuredEdit(transaction, sourceBefore);
    pushToast(plan.previewLabel, 'success');
  }, [commitSourceText, format, pushToast, recordStructuredEdit, sourceFormatDiagnosticState.tabularAnalysis]);
  const copyStructuredText = useCallback((content: string, label: string) => {
    const copyPromise = navigator.clipboard?.writeText(content);
    if (!copyPromise) {
      pushToast('Clipboard is not available in this window.', 'warning');
      return;
    }
    void copyPromise
      .then(() => pushToast(`${label} copied`, 'success'))
      .catch((error) => {
        console.warn('Could not copy structured text.', error);
        pushToast(`Could not copy ${label}.`, 'error');
      });
  }, [pushToast]);
  const handleStructuredConversionAction = useCallback(async (request: StructuredConversionRequest) => {
    try {
      if (request.action === 'copy') {
        copyStructuredText(request.content, request.label);
        return;
      }

      if (request.sourceHash && request.sourceFormat) {
        const currentHash = conversionSourceHash(request.sourceFormat, sourceText);
        if (currentHash && currentHash !== request.sourceHash) {
          pushToast('The source changed after this conversion preview was created. Reopen the conversion preview and try again.', 'warning');
          return;
        }
      }

      if (request.action === 'save-as') {
        const targetPath = await desktopDocumentHost.dialog.pickSavePath(
          suggestedDocumentSavePath(request.content, null, request.format),
          request.format,
        );
        if (!targetPath) return;
        const existingMetadata = await desktopDocumentHost.file.statFile(targetPath, { contentHash: true }).catch(() => null);
        if (existingMetadata) {
          const replace = await confirmText({
            title: `Replace existing ${labelForDocumentFormat(request.format)} file?`,
            message: 'This writes the converted output to the selected file. A backup of the existing file will be created first.',
            okLabel: 'Replace',
            cancelLabel: 'Cancel',
          });
          if (!replace) return;
          await desktopDocumentHost.file.createBackupSnapshot(targetPath, 'conversion').catch((error) => {
            console.warn('Conversion backup snapshot could not be created.', error);
          });
        }
        await desktopDocumentHost.file.writeTextFileAtomic(
          targetPath,
          request.content,
          existingMetadata ?? DEFAULT_METADATA,
          existingMetadata,
        );
        updateUserSettings(desktopDocumentHost.settings.rememberRecentFile(targetPath));
        pushToast(`${request.label} saved`, 'success');
        return;
      }

      const confirmed = await confirmText({
        title: request.action === 'replace-current' ? 'Replace current document?' : 'Open converted document?',
        message: request.action === 'replace-current'
          ? `This replaces the current editor session with an untitled ${labelForDocumentFormat(request.format)} document. Your current file path will not be reused.`
          : `This opens the converted output as an untitled ${labelForDocumentFormat(request.format)} document in this window.`,
        okLabel: request.action === 'replace-current' ? 'Replace' : 'Open',
        cancelLabel: 'Cancel',
      });
      if (!confirmed) return;
      if (!(await settleDirtyDocumentBeforeReplace())) return;
      commitOpenedDocument(
        null,
        request.content,
        DEFAULT_METADATA,
        preferredModeForConvertedFormat(request.format),
        request.content.length > 0 ? '' : request.content,
        request.format,
      );
      pushToast(`${request.label} opened as ${labelForDocumentFormat(request.format)}`, 'success');
    } catch (error) {
      console.warn('Structured conversion action failed.', error);
      pushToast(error instanceof Error ? error.message : 'Could not complete the structured conversion action.', 'error');
    }
  }, [
    commitOpenedDocument,
    confirmText,
    copyStructuredText,
    pushToast,
    settleDirtyDocumentBeforeReplace,
    sourceText,
    updateUserSettings,
  ]);
  const copyStructuredContextPacket = useCallback((packet: StructuredContextPacket | null) => {
    if (!packet) {
      pushToast('Structured context is available only after the current structured file parses successfully.', 'warning');
      return;
    }
    copyStructuredText(packet.content, packet.label);
  }, [copyStructuredText, pushToast]);
  const copyWholeStructuredContext = useCallback(() => {
    copyStructuredContextPacket(structuredContextCommandState
      ? createCurrentWholeStructuredContext(structuredContextCommandState)
      : null);
  }, [copyStructuredContextPacket, structuredContextCommandState]);
  const copySelectedStructureContext = useCallback(() => {
    copyStructuredContextPacket(structuredContextCommandState
      ? createCurrentSelectedStructureContext(structuredContextCommandState)
      : null);
  }, [copyStructuredContextPacket, structuredContextCommandState]);
  const copyStructuredParserDiagnostics = useCallback(() => {
    if (!structuredContextCommandState) {
      pushToast('Parser diagnostics are unavailable for this document.', 'warning');
      return;
    }
    copyStructuredContextPacket(createCurrentParserDiagnosticsContext(structuredContextCommandState));
  }, [copyStructuredContextPacket, pushToast, structuredContextCommandState]);
  const copyStructuredSchemaSummary = useCallback(() => {
    copyStructuredContextPacket(structuredContextCommandState
      ? createCurrentSchemaSummaryContext(structuredContextCommandState)
      : null);
  }, [copyStructuredContextPacket, structuredContextCommandState]);
  const copyStructuredTableSample = useCallback(() => {
    copyStructuredContextPacket(structuredContextCommandState
      ? createCurrentStructuredTableSampleContext(structuredContextCommandState)
      : null);
  }, [copyStructuredContextPacket, structuredContextCommandState]);
  const copyStructuredHealthReport = useCallback(() => {
    copyStructuredContextPacket(structuredContextCommandState
      ? createCurrentStructuredHealthContext(structuredContextCommandState)
      : null);
  }, [copyStructuredContextPacket, structuredContextCommandState]);
  const copyRedactedStructuredPreview = useCallback(() => {
    copyStructuredContextPacket(structuredContextCommandState
      ? createCurrentRedactedStructuredPreview(structuredContextCommandState)
      : null);
  }, [copyStructuredContextPacket, structuredContextCommandState]);
  const revealStructuredSource = useCallback((node: StructuredNodeRef) => {
    const selection = sourceSelectionForStructuredNode(node);
    if (!selection) {
      pushToast('Source location is not available for this structured node.', 'warning');
      return;
    }
    setSelectedJsonPath(selection.displayPath);
    revealSourceRange(selection);
    pushToast(`Showing ${selection.displayPath} in source`, 'info');
  }, [pushToast, revealSourceRange]);
  const navigateStructuredSidebarTarget = useCallback((target: StructuredNavigationTarget) => {
    setActiveStructuredNavigationTargetKey(structuredNavigationTargetKey(target));
    if (target.path) setSelectedJsonPath(target.path);
    navigateStructuredTarget(target);
    if (!target.sourceRange && target.path) {
      pushToast(`Selected ${target.path}`, 'info');
    }
  }, [navigateStructuredTarget, pushToast]);
  const validateStructuredClipboard = useCallback(() => {
    if (!isStructuredContextFormat(format)) {
      pushToast('Structured paste-back validation is available for JSON, JSONL, YAML, and TOML.', 'warning');
      return;
    }
    const readPromise = navigator.clipboard?.readText();
    if (!readPromise) {
      pushToast('Clipboard read is not available in this window.', 'warning');
      return;
    }
    void readPromise
      .then((clipboardText) => {
        if (clipboardText.trim().length === 0) {
          pushToast('Clipboard does not contain structured text to validate.', 'warning');
          return;
        }
        const packet = validateStructuredPasteBack({
          format,
          text: clipboardText,
          sourcePath: filePath,
          schema: format === 'json' ? jsonSchemaDiscovery.schemaSource : null,
        });
        const firstError = packet.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
        if (firstError) {
          pushToast(`${packet.label}: ${firstError.message}`, 'warning');
          return;
        }
        pushToast(`${packet.label}: valid. Source was not changed.`, 'success');
      })
      .catch((error) => {
        console.warn('Could not validate structured clipboard text.', error);
        pushToast('Could not read structured text from the clipboard.', 'error');
      });
  }, [filePath, format, jsonSchemaDiscovery.schemaSource, pushToast]);
  const insertAnchoredSelectionBlock = useCallback((selection: EditorSelectionSnapshot, block: string) => {
    commitSourceText(insertStandaloneMarkdownBlockNearSelection(sourceTextRef.current, selection, `${block.trimEnd()}\n\n`, currentLine));
  }, [commitSourceText, currentLine]);
  const missingImageCount = useMissingImageDetection(
    filePath,
    formatCapabilities.canUseImageInsertion ? baseDocumentInsights.imageReferences : [],
  );
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
    validationIssues: activeValidationIssues,
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

  useEffect(() => {
    setSelectedJsonPath('$');
    setJsonEditReview(null);
  }, [filePath, format]);

  useEffect(() => {
    setExplicitJsonSchemaPath(null);
  }, [filePath, format]);

  useEffect(() => {
    if (mode !== 'visual') return;
    if (!formatCapabilities.canUseStructuredVisualMode && !formatCapabilities.canUseRecordList && !formatCapabilities.canUseTablePreview) return;
    if (sourceFormatDiagnosticState.parsingPending) return;
    if (canUseReadonlyTreeMode || canUseRecordListMode || canUseTabularPreviewMode) return;
    setMode('source');
  }, [canUseReadonlyTreeMode, canUseRecordListMode, canUseTabularPreviewMode, formatCapabilities.canUseRecordList, formatCapabilities.canUseStructuredVisualMode, formatCapabilities.canUseTablePreview, mode, setMode, sourceFormatDiagnosticState.parsingPending]);

  const statusText = useMemo(() => {
    if (autosaveStatus === 'idle') return filePath ? 'Saved' : 'Autosave off until saved';
    if (autosaveStatus === 'pending') return 'Autosave pending';
    if (autosaveStatus === 'paused') return structuredSavePolicy.reason ?? 'Autosave paused';
    if (autosaveStatus === 'saving') return 'Saving';
    if (autosaveStatus === 'saved') return formatAutosaveTime(lastAutosavedAt) || 'Saved';
    if (autosaveStatus === 'conflict') return 'External change detected';
    return 'Save failed';
  }, [autosaveStatus, filePath, lastAutosavedAt, structuredSavePolicy.reason]);

  useEffect(() => {
    document.title = documentTitle;
  }, [documentTitle]);

  useEffect(() => {
    sourceTextRef.current = sourceText;
    updateRawDocumentRescue(sourceText, filePath);
  }, [filePath, sourceText]);

  useAuthorshipMaintenance(setAuthorshipMarks);

  useEffect(() => {
    if (!isTauriRuntime() || settings.recentFiles.length === 0) return;
    void desktopPlatformHost.maintenance.cleanupStaleTempFilesForPaths(settings.recentFiles).catch((error) => {
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
    platformHost: desktopPlatformHost,
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
      commitSourceText((current) => {
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
  }, [commitSourceText, insertMarkdown, pushToast]);

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
        commitSourceText((current) => renameVariableAndUpdateUsages(current, originalName, nextName, value));
        setSelectedVariableName(nextName);
        setVariableDialog(null);
        pushToast(`Variable {{ ${nextName} }} updated.`, 'success');
      } catch (error) {
        pushToast(error instanceof Error ? error.message : 'Variable could not be updated.', 'error');
      }
    })();
  }, [commitSourceText, confirmText, layerTwoDocument.variables.usages, pushToast]);

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
      commitSourceText((current) => upsertScienfyVariablesFile(current, file));
      updateUserSettings({ outlineOpen: true, sidebarView: 'data' });
      pushToast(`Linked data file: ${file.trim()}`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Data file could not be linked.', 'error');
    }
  }, [commitSourceText, layerTwoDocument.variableFiles, promptText, pushToast, updateUserSettings]);

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
      const info = await desktopPlatformHost.inkscape.checkAvailable(settings.inkscapePath);
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
    markdownRef: sourceTextRef,
    setMarkdown: commitSourceText,
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
      const info = await desktopPlatformHost.inkscape.checkAvailable(trimmed);
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
      desktopPlatformHost.inkscape.checkAvailable(settings.inkscapePath),
      desktopPlatformHost.export.checkPandocAvailable(),
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
      const imagePath = await desktopPlatformHost.assets.pickImageFile();
      if (!imagePath) return;
      const documentPath = await ensureDocumentPathForAssets();
      if (!documentPath) return;
      const altText = alt.trim() || desktopPlatformHost.assets.defaultImageAlt(imagePath);
      const copied = await desktopPlatformHost.assets.copyImageToAssets(documentPath, imagePath, altText);
      const replacement = desktopPlatformHost.assets.markdownImageSyntax(copied.altText, copied.markdownPath);
      commitSourceText((current) => {
        return replaceFirstMissingImageReference(current, source, alt, replacement);
      });
      pushToast('Missing image reference updated.', 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not update the missing image reference.', 'error');
    }
  }, [commitSourceText, ensureDocumentPathForAssets, pushToast]);

  useEffect(() => {
    const handleLocateMissingImage = (event: Event) => {
      const custom = event as CustomEvent<{ source?: string; alt?: string }>;
      void locateMissingImage(custom.detail?.source ?? '', custom.detail?.alt ?? 'image');
    };
    window.addEventListener('scie-md-locate-missing-image', handleLocateMissingImage);
    return () => window.removeEventListener('scie-md-locate-missing-image', handleLocateMissingImage);
  }, [locateMissingImage]);

  const { handlePasteCapture, handleDropCapture } = useDocumentDropPaste({
    sourceTextRef,
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
    setTabularPaste,
    pushToast,
    platformHost: desktopPlatformHost,
  });

  const {
    openPasteReview,
    closePasteReview,
    acceptPasteReview,
    rejectPasteReview,
    applyPasteReview,
  } = usePasteReviewWorkflow({
    getCurrentMarkdown: () => sourceTextRef.current,
    setMarkdown: commitSourceText,
    setAuthorshipMarks,
    setPasteReview,
    pushToast,
  });

  const tabularPasteDefaultFormat: DelimitedTextConversionFormat = format === 'jsonl'
    ? 'jsonl'
    : format === 'json'
      ? 'json'
      : 'markdown';

  const insertTabularPaste = useCallback((content: string, conversionFormat: DelimitedTextConversionFormat) => {
    if (!insertMarkdown(content)) return;
    setTabularPaste(null);
    pushToast(`${tabularConversionLabel(conversionFormat)} inserted`, 'success');
  }, [insertMarkdown, pushToast]);

  const copyTabularPaste = useCallback((content: string, conversionFormat: DelimitedTextConversionFormat) => {
    const copyPromise = navigator.clipboard?.writeText(content);
    if (!copyPromise) {
      pushToast('Clipboard is not available in this window.', 'warning');
      return;
    }
    void copyPromise
      .then(() => {
        pushToast(`${tabularConversionLabel(conversionFormat)} copied`, 'success');
      })
      .catch((error) => {
        console.warn('Could not copy converted tabular data.', error);
        pushToast('Could not copy converted tabular data.', 'error');
      });
  }, [pushToast]);

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
    startupDocumentOpenFailurePath: startupDocumentOpenFailure?.path ?? null,
    filePath,
  }), [filePath, settings.explorerRootPath, startupDocumentOpenFailed, startupDocumentOpenFailure?.path, startupDocumentOpenPending]);
  const initialExplorerFallbackPath = useMemo(() => initialExplorerFallbackPathForLaunch({
    persistedExplorerRootPath: settings.explorerRootPath,
    startupDocumentOpenPending,
    startupDocumentOpenFailed,
    startupDocumentOpenFailurePath: startupDocumentOpenFailure?.path ?? null,
    filePath,
  }), [filePath, settings.explorerRootPath, startupDocumentOpenFailed, startupDocumentOpenFailure?.path, startupDocumentOpenPending]);

  const {
    currentPath: explorerCurrentPath,
    entries: explorerEntries,
    selectedImage: explorerSelectedImage,
    loading: explorerLoading,
    error: explorerError,
    watcherMessage: explorerWatcherMessage,
    loadDirectory: loadExplorerDirectory,
    chooseFolder: chooseExplorerFolder,
    openEntry: handleOpenExplorerEntry,
  } = useFileExplorer({
    initialPath: initialExplorerPath,
    fallbackInitialPath: initialExplorerFallbackPath,
    onPersistPath: persistExplorerPath,
    onOpenDocument: openExplorerDocument,
    platformHost: desktopPlatformHost,
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
    commitOpenedDocument(
      null,
      welcomeMarkdown,
      DEFAULT_METADATA,
      'visual',
      welcomeMarkdown,
      { preserveStartupOpenFailure: Boolean(startupDocumentOpenFailure) },
    );
    recordStartupFallbackCommitted(welcomeMarkdown);
  }, [
    commitOpenedDocument,
    filePath,
    markdown,
    recordStartupFallbackCommitted,
    settings.onboardingComplete,
    startupDocumentOpenFailed,
    startupDocumentOpenFailure,
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
        markdown: sourceTextRef.current,
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
    const result = insertEditorNote(sourceTextRef.current, {
      body,
      kind,
      selectedText,
      prefix: overrideSnapshot?.prefix ?? selectionSnapshot.prefix,
      suffix: overrideSnapshot?.suffix ?? selectionSnapshot.suffix,
      selectionLine: overrideSnapshot?.line ?? selectionSnapshot.line,
      selectionEndLine: overrideSnapshot?.endLine ?? selectionSnapshot.endLine,
      preferredLine: currentLine,
    });
    commitSourceText(result.markdown);
    const noteLabel = isHumanNote ? 'Note to Human' : 'Note to LLM';
    pushToast(selectedText ? `${noteLabel} anchored to the selected text without changing it.` : `${noteLabel} inserted.`, 'info');
  }, [commitSourceText, currentLine, getEditorSelectionSnapshot, promptText, pushToast]);

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
        markdown: sourceTextRef.current,
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
    mode: effectiveEditorMode,
    formatCapabilities,
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
    commitSourceText(nextMarkdown);
    pushToast(entries.length > 0 ? 'Bibliography synced from loaded .bib file.' : 'Bibliography section created with missing-key placeholders.', 'success');
  }, [commitSourceText, layerTwoDocument.citations.bibtexEntries, layerTwoDocument.citations.usages.length, markdown, pushToast]);

  const insertReferencesDirective = useCallback(() => {
    insertMarkdown(':::references\n:::\n\n');
    pushToast('Auto References section inserted. It renders the loaded .bib entries for cited keys.', 'success');
  }, [insertMarkdown, pushToast]);

  const applyScientificTypography = useCallback(() => {
    const nextMarkdown = normalizeScientificTypography(sourceTextRef.current);
    if (nextMarkdown === sourceTextRef.current) {
      pushToast('Scientific typography already clean.', 'info');
      return;
    }
    commitSourceText(nextMarkdown);
    pushToast('Scientific typography applied.', 'success');
  }, [commitSourceText, pushToast]);

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
  const getCurrentOutputMarkdown = useCallback(() => (
    readVisualEditorState()?.markdown ?? sourceTextRef.current
  ), []);

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
    getCurrentOutputMarkdown,
    captureVisualHtml: () => captureEditorHtmlForExport(editorStageRef.current),
    renderVisualExportHtml,
    onExportLog: (entries) => exportLogSinkRef.current(entries),
    pushToast,
    platformHost: desktopPlatformHost,
  });

  const runPrintPreview = useCallback(() => {
    setActiveTopbarMenu(null);
    void printPreview(settings.exportOptions);
  }, [printPreview, settings.exportOptions]);

  const handleExportDiagnosticsBundle = useCallback(async () => {
    const bundle = await exportDiagnosticsBundle();
    if (!bundle) {
      pushToast('Diagnostics bundle export is available in the desktop app.', 'warning');
      return;
    }
    pushToast(`Diagnostics bundle exported to ${bundle.path}.`, 'success');
    void desktopPlatformHost.reveal.revealInFileManager(bundle.path).catch((error) => {
      console.warn('Could not reveal diagnostics bundle.', error);
    });
  }, [pushToast]);

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
  const backgroundJobSignals = useMemo<BackgroundJobSignal[]>(() => [
    {
      id: 'startup-open',
      label: 'Startup document open',
      active: startupDocumentOpenPending,
      stuckAfterMs: 10_000,
    },
    {
      id: 'document-open',
      label: 'Document open',
      active: Boolean(documentOpenStatus),
      stuckAfterMs: 20_000,
    },
    {
      id: 'save-queue',
      label: 'Save queue',
      active: saveQueueDepth > 0,
      stuckAfterMs: 15_000,
    },
    {
      id: 'export',
      label: exportWorkflow.activeExport
        ? `${exportWorkflow.activeExport.format.toUpperCase()} export`
        : 'Export',
      active: Boolean(exportWorkflow.activeExport),
      stuckAfterMs: 60_000,
    },
    {
      id: 'document-parser',
      label: 'Document parser',
      active: documentParsingPending,
      stuckAfterMs: 15_000,
    },
    {
      id: 'document-validator',
      label: 'Document validation',
      active: validationPending,
      stuckAfterMs: 10_000,
    },
    {
      id: 'source-format-parser',
      label: 'Source format parser',
      active: sourceFormatDiagnosticState.parsingPending,
      stuckAfterMs: 10_000,
    },
    {
      id: 'bibliography-refresh',
      label: 'Bibliography refresh',
      active: bibliographyLoading,
      stuckAfterMs: 20_000,
    },
    {
      id: 'linked-variable-refresh',
      label: 'Linked variable refresh',
      active: linkedVariableLoading,
      stuckAfterMs: 20_000,
    },
  ], [
    bibliographyLoading,
    documentOpenStatus,
    documentParsingPending,
    exportWorkflow.activeExport,
    linkedVariableLoading,
    saveQueueDepth,
    sourceFormatDiagnosticState.parsingPending,
    startupDocumentOpenPending,
    validationPending,
  ]);
  const backgroundJobs = useBackgroundJobTracker(backgroundJobSignals);
  const handlePreviousRendererCrashDetected = useCallback(() => {
    pushToast(
      'Previous ScieMD session ended unexpectedly. A local diagnostics marker and raw recovery snapshot are available if needed.',
      'warning',
    );
  }, [pushToast]);
  useRendererDiagnostics({
    sourceText,
    filePath,
    mode,
    warningCount: warnings.length,
    errorCount: errors.length,
    visualAtomCount,
    backgroundJobs,
    onPreviousSessionCrashDetected: handlePreviousRendererCrashDetected,
  });

  const {
    externalConflictReview,
    externalProtectedChanges,
    openExternalConflictReview,
    closeExternalConflictReview,
    applyExternalConflictReview,
    applyStructuredJsonConflictReview,
    applyStructuredConflictReview,
  } = useExternalConflictReviewWorkflow({
    filePath,
    documentEpochRef,
    format,
    sourceText,
    lastSavedSourceText,
    adoptReviewedDiskMerge,
    setAuthorshipMarks,
    pushToast,
    host: desktopDocumentHost,
  });
  const lineExternalConflictReview = externalConflictReview?.kind === 'line-review' ? externalConflictReview : null;
  const structuredExternalConflictReview = externalConflictReview?.kind === 'structured-source' ? externalConflictReview : null;
  const structuredConflictFormatLabel = structuredExternalConflictReview
    ? labelForDocumentFormat(structuredExternalConflictReview.format)
    : labelForDocumentFormat(format);
  const keepStructuredConflict = useCallback(() => {
    closeExternalConflictReview();
    pushToast('Kept current in-memory source. Save As or Save Anyway when ready.', 'info');
  }, [closeExternalConflictReview, pushToast]);
  const reloadStructuredConflict = useCallback(() => {
    closeExternalConflictReview();
    if (filePath) void handleReloadFromDisk();
  }, [closeExternalConflictReview, filePath, handleReloadFromDisk]);
  const saveStructuredConflictAs = useCallback(() => {
    closeExternalConflictReview();
    void saveCurrent({ forceSaveAs: true });
  }, [closeExternalConflictReview, saveCurrent]);
  const saveStructuredConflictAnyway = useCallback(() => {
    closeExternalConflictReview();
    void saveCurrent({ forceOverwrite: true });
  }, [closeExternalConflictReview, saveCurrent]);

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
    if (!startupDocumentOpenPending && !filePath && sourceTextRef.current.trim() === '') {
      commitOpenedDocument(
        null,
        welcomeMarkdown,
        DEFAULT_METADATA,
        'visual',
        welcomeMarkdown,
        { preserveStartupOpenFailure: Boolean(startupDocumentOpenFailure) },
      );
      recordStartupFallbackCommitted(welcomeMarkdown);
    }
    pushToast('Writing defaults applied', 'success');
  }, [commitOpenedDocument, filePath, pushToast, recordStartupFallbackCommitted, startupDocumentOpenFailure, startupDocumentOpenPending, updateUserSettings]);

  const skipDocumentType = useCallback(() => {
    updateUserSettings({ onboardingComplete: true });
    setDocumentTypeDialogOpen(false);
    if (!startupDocumentOpenPending && !filePath && sourceTextRef.current.trim() === '') {
      commitOpenedDocument(
        null,
        welcomeMarkdown,
        DEFAULT_METADATA,
        'visual',
        welcomeMarkdown,
        { preserveStartupOpenFailure: Boolean(startupDocumentOpenFailure) },
      );
      recordStartupFallbackCommitted(welcomeMarkdown);
    }
  }, [commitOpenedDocument, filePath, recordStartupFallbackCommitted, startupDocumentOpenFailure, startupDocumentOpenPending, updateUserSettings]);

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
    && !tabularPaste
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
    onNew: openTemplateDialog,
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
  }), [adjustFontScale, handleOpen, openCommandPalette, openTemplateDialog, resetFontScale, runHistoryCommand, runPrintPreview, saveCurrent, settings.outlineOpen, updateUserSettings]), { enabled: shortcutsEnabled });

  const handleModeChange = useCallback(async (nextMode: EditorMode) => {
    if (nextMode === mode) return;
    if (nextMode === 'visual' && !formatCapabilities.canUseVisualMarkdown && !canUseReadonlyTreeMode && !canUseRecordListMode && !canUseTabularPreviewMode) {
      setMode('source');
      return;
    }
    if (nextMode === 'visual' && formatCapabilities.canUseVisualMarkdown) {
      const allowed = await confirmVisualRoundTripWrite(sourceTextRef.current, {
        reason: 'mode-switch-to-visual',
      });
      if (!allowed) return;
    }
    commitVisualEditorState(commitSourceText);
    preserveLineForModeChange(currentLine, nextMode);
    setMode(nextMode);
  }, [canUseReadonlyTreeMode, canUseRecordListMode, canUseTabularPreviewMode, commitSourceText, confirmVisualRoundTripWrite, currentLine, formatCapabilities.canUseVisualMarkdown, mode, preserveLineForModeChange, setMode]);

  const handleStructuredSurfaceChange = useCallback((surface: StructuredSurfaceId) => {
    if (surface !== 'source') {
      setPreferredStructuredSurfaceByDocument((current) => ({
        ...current,
        [structuredSurfaceDocumentKey]: surface,
      }));
    }
    void handleModeChange(surface === 'source' ? 'source' : 'visual');
  }, [handleModeChange, structuredSurfaceDocumentKey]);

  const selectJsonSchema = useCallback(async () => {
    try {
      const schemaPath = await desktopDocumentHost.dialog.pickJsonSchemaFile();
      if (!schemaPath) return;
      setExplicitJsonSchemaPath(schemaPath);
      pushToast('JSON Schema selected for validation.', 'success');
    } catch (error) {
      console.warn('JSON Schema picker failed.', error);
      pushToast(error instanceof Error ? error.message : 'Could not select JSON Schema.', 'error');
    }
  }, [pushToast]);

  const clearJsonSchema = useCallback(() => {
    setExplicitJsonSchemaPath(null);
    pushToast('JSON Schema validation cleared.', 'info');
  }, [pushToast]);

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

  const { commands, dynamicCommands: commandPaletteDynamicCommands } = useAppCommands({
    formatCapabilities,
    settings,
    currentVisualStyleLabel: currentVisualStyle.label,
    pasteReviewHunks: pasteReview?.hunks.length ?? null,
    recentPreviews,
    headings,
    citationCompletionKeys: activeCitationCompletionKeys,
    citationEntries: layerTwoDocument.citations.bibtexEntries,
    missingCitationCount: formatCapabilities.canUseCitations ? layerTwoDocument.citations.missingKeys.length : 0,
    missingVariableCount: formatCapabilities.canUseVariablesPanel ? layerTwoDocument.variables.missingVariables.length : 0,
    structuredContextAvailable,
    structuredTableSampleAvailable,
    structuredPasteBackValidationAvailable,
    onNew: openTemplateDialog,
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
    onInsertMarkdown: insertMarkdown,
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
    onCopyStructuredContext: copyWholeStructuredContext,
    onCopySelectedStructureContext: copySelectedStructureContext,
    onCopyParserDiagnostics: copyStructuredParserDiagnostics,
    onCopyStructuredSchemaSummary: copyStructuredSchemaSummary,
    onCopyStructuredTableSample: copyStructuredTableSample,
    onCopyStructuredHealthReport: copyStructuredHealthReport,
    onCopyRedactedStructuredPreview: copyRedactedStructuredPreview,
    onValidateStructuredClipboard: validateStructuredClipboard,
    onCopyRichText: () => void copyRichText(),
    onRunConfiguredExport: (format, options) => void exportWorkflow.runConfiguredExport(format, options),
    onPrintPreview: runPrintPreview,
    onOpenPasteReview: openPasteReview,
    onToggleOutline: () => updateUserSettings({ outlineOpen: !settings.outlineOpen }),
    onToggleFocusMode: toggleFocusMode,
    onSidebarViewChange: handleSidebarViewChange,
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
  });
  return (
    <AppWorkbench
      focusMode={settings.focusMode}
      skipToEditorLabel="Skip to editor"
      activeTopbarMenu={activeTopbarMenu}
      onToggleTopbarMenu={(menu) => setActiveTopbarMenu((current) => current === menu ? null : menu)}
      onCloseTopbarMenus={() => setActiveTopbarMenu(null)}
      formatCapabilities={formatCapabilities}
      topbar={{
        mode: effectiveEditorMode,
        format,
        filePath,
        dirty,
        outlineOpen: settings.outlineOpen,
        inspectorOpen: settings.inspectorOpen,
        focusMode: settings.focusMode,
        structuredSurfaceNavigation,
        themeMode: settings.themeMode,
        currentVisualStyle,
        selectedVisualStyle: settings.visualStyle,
        recentFiles: recentPreviews,
        hasPasteReview: Boolean(pasteReview),
        structuredContextAvailable,
        structuredTableSampleAvailable,
        structuredPasteBackValidationAvailable,
        onNew: openTemplateDialog,
        onOpen: () => void handleOpen(),
        onOpenFolder: () => void handleChooseExplorerFolder(),
        onOpenRecent: (recentPath) => void handleOpen(recentPath),
        onSave: () => void saveCurrent(),
        onSaveAs: () => void saveCurrent({ forceSaveAs: true }),
        onFind: () => setFindOpen(true),
        onUndo: () => runHistoryCommand('undo'),
        onRedo: () => runHistoryCommand('redo'),
        onCopyRichText: () => void copyRichText(),
        onApplyScientificTypography: applyScientificTypography,
        onInsertMarkdown: insertMarkdown,
        onInsertImage: () => void handleInsertImage(),
        onInsertLink: openLinkDialog,
        onInsertCitation: openCitationLibrary,
        onInsertVariable: openVariableInsert,
        onInsertMermaid: () => insertMarkdown('```mermaid\nflowchart LR\n  A[Question] --> B[Experiment]\n  B --> C[Result]\n```\n\n'),
        onInsertSvgFigure: insertSvgFigure,
        onInsertSemanticBlock: insertSemanticBlockFromMenu,
        onInsertProtectedBlock: () => void insertProtectedBlock(),
        onInsertEditorComment: () => void insertEditorComment(),
        onInsertHumanEditorComment: () => void insertHumanEditorComment(),
        onInsertTargetedInstruction: () => void insertTargetedInstruction(),
        onInsertVariantGroup: () => insertVariantGroup(),
        onInsertReferencesDirective: insertReferencesDirective,
        onReloadBibliography: reloadBibliographyFromDisk,
        onSyncBibliography: syncBibliographySection,
        onCopyScieMDLlmSkill: () => void copyScieMDLlmSkill(),
        onGenerateScieMDLlmSkill: () => void generateScieMDLlmSkill(),
        onCopyStructuredContext: copyWholeStructuredContext,
        onCopySelectedStructureContext: copySelectedStructureContext,
        onCopySchemaAwareJsonContext: copyStructuredSchemaSummary,
        onCopyStructuredTableSample: copyStructuredTableSample,
        onCopyParserDiagnostics: copyStructuredParserDiagnostics,
        onCopyRedactedStructuredPreview: copyRedactedStructuredPreview,
        onValidateStructuredClipboard: validateStructuredClipboard,
        onGenerateSubmissionReadiness: () => void generateSubmissionReadiness(),
        onOpenPasteReview: openPasteReview,
        onOpenExportDialog: (format) => exportWorkflow.openDialog(format),
        onShowExportLog: exportWorkflow.openLog,
        onPrintPreview: runPrintPreview,
        onOpenTutorial: () => void openTutorialDocument(),
        onOpenFullTutorial: () => void openFullTutorialDocument(),
        onShowShortcuts: () => setShortcutDialogOpen(true),
        onOpenTemplates: openTemplateDialog,
        onCheckTools: () => void checkExternalTools(),
        onSetInkscapePath: () => void setInkscapePath(),
        onExportDiagnosticsBundle: () => void handleExportDiagnosticsBundle(),
        onOpenSettings: () => setSettingsOpen(true),
        onShowAbout: () => setAboutOpen(true),
        onOpenGithub: openGithub,
        onReportBug: reportBug,
        onOpenCommandPalette: openCommandPalette,
        onOpenSlashMenu: () => openSlashMenu(),
        onModeChange: (nextMode) => void handleModeChange(nextMode),
        onStructuredSurfaceChange: handleStructuredSurfaceChange,
        onSetVisualStyle: setVisualStyle,
        onSetThemeMode: setThemeMode,
        onIncreaseFont: () => adjustFontScale(0.05),
        onDecreaseFont: () => adjustFontScale(-0.05),
        onResetFont: resetFontScale,
        onFormatHeading: formatHeadingFromMenu,
        onFormatInline: formatInlineFromMenu,
        onToggleOutline: () => updateUserSettings({ outlineOpen: !settings.outlineOpen }),
        onSidebarView: handleSidebarViewChange,
        onToggleInspector: () => updateUserSettings({ inspectorOpen: !settings.inspectorOpen }),
        onToggleFocusMode: toggleFocusMode,
        onWindowMinimize: handleWindowMinimize,
        onWindowMaximize: handleWindowMaximize,
        onWindowClose: handleWindowClose,
        onTitlebarMouseDown: handleTitlebarMouseDown,
        onTitlebarDoubleClick: handleTitlebarDoubleClick,
      }}
      toolbar={{
        mode: effectiveEditorMode,
        visualEditor,
        onInsertMarkdown: insertMarkdown,
        onInsertImage: () => void handleInsertImage(),
        onInsertCitation: openCitationLibrary,
        onUndo: () => runHistoryCommand('undo'),
        onRedo: () => runHistoryCommand('redo'),
        onInsertLink: openLinkDialog,
        onInsertVariable: openVariableInsert,
        onInsertLlmNote: () => void insertEditorComment(),
        onInsertHumanNote: () => void insertHumanEditorComment(),
        onInsertVariantGroup: () => insertVariantGroup(),
        onOpenTablePicker: () => openSlashMenu('table'),
        nextFigureLabel,
      }}
      findReplace={findOpen ? {
        markdown,
        onChange: commitSourceText,
        onClose: () => setFindOpen(false),
        onNavigate: navigateToFindMatch,
      } : null}
      outlineOpen={settings.outlineOpen}
      inspectorOpen={settings.inspectorOpen}
      sidebarWidth={sidebarWidth}
      sidebar={{
        open: settings.outlineOpen,
        view: settings.sidebarView,
        width: sidebarWidth,
        formatCapabilities,
        outline: { headings, activeHeadingId, onJump: jumpToHeading, onInsertHeading: insertOutlineHeading },
        structuredNavigation: {
          index: structuredNavigationIndex,
          activeTargetKey: activeStructuredNavigationKey,
          onNavigate: navigateStructuredSidebarTarget,
        },
        explorer: {
          path: explorerCurrentPath,
          entries: explorerEntries,
          selectedImage: explorerSelectedImage,
          loading: explorerLoading,
          error: explorerError,
          watcherMessage: explorerWatcherMessage,
          onChooseFolder: handleChooseExplorerFolder,
          onOpenPath: loadExplorerDirectory,
          onOpenEntry: handleOpenExplorerEntry,
        },
        layerTwoDocument,
        bibliographyLoading,
        selectedVariableName,
        onOpen: openNavigationSidebar,
        onViewChange: handleSidebarViewChange,
        onJumpToLine: jumpToLineInCurrentMode,
        onReloadBibliography: reloadBibliographyFromDisk,
        onManageCitations: openCitationLibrary,
        onInsertVariable: openVariableInsert,
        onLinkVariableFile: () => void linkVariableFile(),
        onEditVariable: saveVariableEdit,
        onSelectVariable: selectVariableInDocument,
        onResize: handleSidebarResize,
        onResizeCommit: handleSidebarResizeCommit,
        onClose: closeNavigationSidebar,
        onCopyFeedback: pushToast,
      }}
      editorStage={{
        editorStageRef,
        format,
        formatCapabilities,
        mode: effectiveEditorMode,
        filePath,
        sourceText,
        markdown,
        editorResetToken,
        dropOverlayVisible,
        autosaveStatus,
        statusText,
        saveQueueDepth,
        startupOpenFailure: startupDocumentOpenFailure,
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
        citationCompletionKeys: activeCitationCompletionKeys,
        selectedVariableName,
        authorshipMarks: settings.authorshipVisible ? authorshipMarks : [],
        validationIssues: activeValidationIssues,
        sourceDiagnostics: sourceFormatDiagnosticState.diagnostics,
        sourceParsingPending: sourceFormatDiagnosticState.parsingPending,
        structuredModel: sourceFormatDiagnosticState.structuredModel,
        structuredSurfaceNavigation,
        jsonAnalysis: sourceFormatDiagnosticState.jsonAnalysis,
        jsonlAnalysis: sourceFormatDiagnosticState.jsonlAnalysis,
        structuredAnalysis: sourceFormatDiagnosticState.structuredAnalysis,
        tabularAnalysis: sourceFormatDiagnosticState.tabularAnalysis,
        selectedJsonPath,
        onJsonEditIntent: applyJsonVisualEdit,
        onJsonlEditIntent: applyJsonlVisualEdit,
        onJsonlCopyText: copyStructuredText,
        onTabularEditIntent: applyTabularVisualEdit,
        onTabularCopyText: copyStructuredText,
        onStructuredConversionAction: (request) => void handleStructuredConversionAction(request),
        onRevealStructuredSource: revealStructuredSource,
        onKeyDownCapture: handleEditorKeyDownCapture,
        onPasteCapture: handlePasteCapture,
        onDragEnterCapture: handleEditorDragEnter,
        onDragLeaveCapture: handleEditorDragLeave,
        onDropCapture: handleEditorDrop,
        onDragOver: handleEditorDragOver,
        onJumpToHeading: jumpToHeading,
        onMarkdownChange: commitEditorSourceTextEdit,
        onEditorReset: () => setEditorResetToken((current) => current + 1),
        onVisualEditorReady: setVisualEditor,
        onVisualInsertReady: handleVisualInsertReady,
        onVisualJumpReady: handleVisualJumpReady,
        onVisualFindReady: handleVisualFindReady,
        onVisualHistoryReady: handleVisualHistoryReady,
        onSourceInsertReady: handleSourceInsertReady,
        onSourceJumpReady: handleSourceJumpReady,
        onSourceFindReady: handleSourceFindReady,
        onSourceHistoryReady: handleSourceHistoryReady,
        onSelectionTextReady: handleSelectionTextReady,
        onCursorLineChange: handleCursorPositionChange,
        onViewportLineChange: handleViewportLineChange,
        onJsonSelectedPathChange: setSelectedJsonPath,
        onLockViolation: (message) => pushToast(message, 'warning'),
        onToast: pushToast,
        confirmText,
        onEditCitation: openCitationEditor,
        onEditVariable: openVariableEdit,
        getSelectionSnapshot: getEditorSelectionSnapshot,
        onLockSelection: () => void insertProtectedBlock(),
        onCommentSelection: (selection) => void insertEditorComment(selection),
        onHumanCommentSelection: (selection) => void insertHumanEditorComment(selection),
        onVariantSelection: () => insertVariantGroup(),
        onCopySelection: () => void copySelectionFromFloatingToolbar(),
        onHeadingSelection: convertSelectionToHeading,
        onBlockSelection: openBlockSelectionDialog,
        onJumpToLine: jumpToLineInCurrentMode,
        onOpenReferences: () => handleSidebarViewChange('references'),
        onOpenData: () => handleSidebarViewChange('data'),
        onSwitchToVisualMode: () => void handleModeChange('visual'),
        onRetryStartupOpen: () => void retryStartupDocumentOpen(),
        onOpenStartupFallbackDocument: () => void openStartupDocumentFallbackPicker(),
        onDismissStartupOpenFailure: dismissStartupDocumentOpenFailure,
      }}
      inspector={{
        open: settings.inspectorOpen,
        focusSection: inspectorFocusSection,
        data: {
          formatCapabilities,
          filePath,
          mode: effectiveEditorMode,
          metadata: fileMetadata,
          validationIssues: ambientIssues,
          jsonAnalysis: sourceFormatDiagnosticState.jsonAnalysis,
          jsonSchemaLoading: jsonSchemaDiscovery.loading,
          jsonSchemaError: jsonSchemaDiscovery.error,
          structuredAnalysis: sourceFormatDiagnosticState.structuredAnalysis,
          jsonlAnalysis: sourceFormatDiagnosticState.jsonlAnalysis,
          tabularAnalysis: sourceFormatDiagnosticState.tabularAnalysis,
          structuredEditJournal,
          selectedJsonPath,
          structuredContextAvailable,
          structuredTableSampleAvailable,
          structuredPasteBackValidationAvailable,
          insights: documentInsights,
          recentPreviews,
          authorshipMarks,
          authorshipVisible: settings.authorshipVisible,
          missingImageCount,
          autosaveStatus,
          autosavePauseReason: structuredSavePolicy.reason,
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
        },
        actions: {
          onClose: () => updateUserSettings({ inspectorOpen: false }),
          onOpenPasteReview: openPasteReview,
          onGenerateSubmissionReadiness: () => void generateSubmissionReadiness(),
          onToggleAuthorship: () => updateUserSettings({ authorshipVisible: !settings.authorshipVisible }),
          onOpenRecent: (recentPath) => void handleOpen(recentPath),
          onReloadBibliography: reloadBibliographyFromDisk,
          onCheckInkscape: () => void checkInkscape(),
          onSetInkscapePath: () => void setInkscapePath(),
          onJumpToLine: jumpToLineInCurrentMode,
          onSelectJsonSchema: () => void selectJsonSchema(),
          onClearJsonSchema: clearJsonSchema,
          onSelectJsonPath: setSelectedJsonPath,
          onCopyStructuredContext: copyWholeStructuredContext,
          onCopySelectedStructureContext: copySelectedStructureContext,
          onCopySchemaAwareJsonContext: copyStructuredSchemaSummary,
          onCopyStructuredTableSample: copyStructuredTableSample,
          onCopyParserDiagnostics: copyStructuredParserDiagnostics,
          onCopyRedactedStructuredPreview: copyRedactedStructuredPreview,
          onValidateStructuredClipboard: validateStructuredClipboard,
          onCopyFeedback: pushToast,
        },
      }}
      ambientSuggestions={{
        issues: ambientIssues,
        hasPasteReview: Boolean(pasteReview),
        onOpenPasteReview: openPasteReview,
      }}
      statusBar={{
        formatCapabilities,
        autosaveStatus,
        statusText,
        headingPath: currentHeadingPath,
        wordCount: validation.wordCount,
        manuscriptScore: manuscriptReadiness.score,
        manuscriptStatus: manuscriptReadiness.status,
        errors: errors.map((error) => error.message),
        warnings: warnings.map((warning) => warning.message),
        externalConflict,
        filePath,
        onReviewConflict: () => void openExternalConflictReview(),
        onSaveAnyway: () => void saveCurrent({ forceOverwrite: true }),
        onReveal: () => filePath && void desktopPlatformHost.reveal.revealInFileManager(filePath),
        onReload: () => filePath && void handleReloadFromDisk(),
        onSaveNow: () => void saveCurrent({ forceSaveAs: true }),
        onJumpToHeading: jumpToHeading,
        onOpenReadiness: () => {
          setInspectorFocusSection('readiness');
          updateUserSettings({ inspectorOpen: true });
        },
        onOpenValidation: () => {
          setInspectorFocusSection('validation');
          updateUserSettings({ inspectorOpen: true });
        },
        onCopyFeedback: pushToast,
      }}
    >

      <AppOverlays
        closeDialogOpen={closeDialogOpen}
        onCloseSave={() => void handleCloseSave()}
        onCloseDiscard={() => void handleCloseDiscard()}
        onCloseCancel={handleCloseCancel}
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
        tabularPaste={tabularPaste}
        tabularPasteDefaultFormat={tabularPasteDefaultFormat}
        onInsertTabularPaste={insertTabularPaste}
        onCopyTabularPaste={copyTabularPaste}
        onStructuredConversionAction={(request) => void handleStructuredConversionAction(request)}
        onCancelTabularPaste={() => setTabularPaste(null)}
        jsonEditReviewPreview={jsonEditReview?.preview ?? null}
        jsonEditReviewPlan={jsonEditReview?.reviewPlan ?? null}
        jsonEditReviewSchemaExplanation={jsonEditReview?.schemaGeneratedValueExplanation}
        onApplyJsonEditReview={applyReviewedJsonEdit}
        onCancelJsonEditReview={() => setJsonEditReview(null)}
        externalConflictOpen={Boolean(lineExternalConflictReview)}
        externalConflictHunks={lineExternalConflictReview?.hunks ?? []}
        externalProtectedChanges={externalProtectedChanges}
        onApplyExternalConflictReview={applyExternalConflictReview}
        onCloseExternalConflictReview={closeExternalConflictReview}
        structuredConflictOpen={Boolean(structuredExternalConflictReview)}
        structuredConflictFormatLabel={structuredConflictFormatLabel}
        structuredConflictFilePath={structuredExternalConflictReview?.filePath ?? filePath}
        structuredConflictCurrentSource={structuredExternalConflictReview?.currentSource ?? markdown}
        structuredConflictDiskSource={structuredExternalConflictReview?.diskSource ?? ''}
        structuredConflictJsonReview={structuredExternalConflictReview?.jsonReview ?? null}
        structuredConflictExternalReview={structuredExternalConflictReview?.structuredReview ?? null}
        onKeepStructuredConflict={keepStructuredConflict}
        onReloadStructuredConflict={reloadStructuredConflict}
        onSaveStructuredConflictAs={saveStructuredConflictAs}
        onSaveStructuredConflictAnyway={saveStructuredConflictAnyway}
        onApplyStructuredJsonConflictReview={applyStructuredJsonConflictReview}
        onApplyStructuredConflictReview={applyStructuredConflictReview}
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
    </AppWorkbench>
  );
}

function conversionSourceHash(format: StructuredConversionRequest['sourceFormat'], text: string): string | null {
  if (format === 'jsonl') return jsonlSourceHash(text);
  if (format === 'csv' || format === 'tsv') return tabularSourceHash(text);
  return null;
}

function preferredModeForConvertedFormat(format: StructuredConversionRequest['format']): EditorMode {
  return format === 'plainText' ? 'source' : 'visual';
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

function tabularConversionLabel(format: DelimitedTextConversionFormat): string {
  if (format === 'json') return 'JSON array';
  if (format === 'jsonl') return 'JSON Lines';
  if (format === 'yaml') return 'YAML list';
  if (format === 'toml') return 'TOML array of tables';
  return 'Markdown table';
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
