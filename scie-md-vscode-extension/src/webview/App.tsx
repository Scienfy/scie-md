import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { VisualMarkdownEditor } from '../scie-md/components/VisualMarkdownEditor';
import type { VisualMarkdownInsert, VisualMarkdownJump, VisualMarkdownJumpTarget, VisualMarkdownSelection } from '../scie-md/components/VisualMarkdownEditor';
import { SourceMarkdownEditor } from '../scie-md/components/SourceMarkdownEditor';
import type { SourceMarkdownInsert, SourceMarkdownJump, SourceMarkdownSelection } from '../scie-md/components/SourceMarkdownEditor';
import { QuickOutlineHover } from '../scie-md/components/QuickOutlineHover';
import { ReviewUnitBody } from '../scie-md/components/ReviewUnitBody';
import type { EditorSelectionSnapshot } from '../scie-md/components/editorSelection';
import { flushVisualEditorState } from '../scie-md/components/visualEditorStateSync';
import { buildVariableIndex } from '@sciemd/core';
import { createVariableToken, nextVariableName, renameVariableAndUpdateUsages, upsertFrontmatterVariable, VARIABLE_NAME_PATTERN } from '@sciemd/core';
import { parseFrontmatter } from '@sciemd/core';
import {
  applyReviewPlanDecisions,
  applyThreeWayDiffDecisions,
  createAnchoredVariantGroupSnippet,
  createReviewPlan,
  createVariantGroupSnippet,
  detectProtectedChanges,
  extractHeadings,
  insertEditorNote,
  insertStandaloneMarkdownBlockNearSelection,
  parseEditorComments,
  parseProtectedBlocks,
  parseVariantGroups,
  wrapMarkdownBlockSelection,
} from '@sciemd/core';
import type { EditorNoteKind, MarkdownHeading, ReviewPlan, ReviewUnit, VariableUsage } from '@sciemd/core';
import { isVisualStyleId } from '../scie-md/services/visualStyleService';
import type { VisualStyleId } from '../scie-md/services/visualStyleService';
import type { ExtensionToWebviewMessage, ScieMDDocumentSnapshot } from '../shared/webviewProtocol';
import { isStructuredPreviewWebviewFormat, StructuredPreviewWorkbench } from './StructuredPreview';
import { normalizeThemeMode, useResolvedVscodeTheme } from './theme';
import type { VscodeThemeMode } from './theme';
import {
  VscodeEditorStage,
  VscodeMarkdownToolbar,
  VscodeDataSidebar,
  VscodeReadOnlyBanner,
  VscodeStartupPanel,
  VscodeToast,
  VscodeTopbar,
  VscodeWorkbenchShell,
} from './VscodeWorkbenchShell';
import type { VscodeChromeMenu, VscodeEditorMode } from './VscodeWorkbenchShell';
import { vscodeApi } from './vscodeApi';

type EditorMode = VscodeEditorMode;

interface ReviewState {
  kind: 'external';
  title: string;
  before: string;
  after: string;
  plan: ReviewPlan;
  rejectedUnitIds: string[];
  protectedUnitIds: string[];
}

type ModalState =
  | { type: 'note'; kind: EditorNoteKind; body: string }
  | { type: 'variable'; name: string; value: string }
  | { type: 'version'; groupId: string }
  | null;

interface ToastState {
  text: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

const EDIT_DEBOUNCE_MS = 250;
const WEBVIEW_SETTINGS_KEY = 'scie-md-vscode.webview-settings.v1';
const DATA_SIDEBAR_DEFAULT_WIDTH = 320;
const DATA_SIDEBAR_MIN_WIDTH = 260;
const DATA_SIDEBAR_MAX_WIDTH = 460;
const DATA_SIDEBAR_WIDTH_STEP = 32;

export function App() {
  const [snapshot, setSnapshot] = useState<ScieMDDocumentSnapshot | null>(null);
  const savedState = useMemo(readSavedWebviewState, []);
  const [mode, setMode] = useState<EditorMode>(savedState.mode);
  const [themeMode, setThemeMode] = useState<VscodeThemeMode>(savedState.themeMode);
  const [visualStyle, setVisualStyle] = useState<VisualStyleId>(savedState.visualStyle);
  const [openChromeMenu, setOpenChromeMenu] = useState<VscodeChromeMenu>(null);
  const [dataSidebarOpen, setDataSidebarOpen] = useState(savedState.dataSidebarOpen);
  const [dataSidebarWidth, setDataSidebarWidth] = useState(savedState.dataSidebarWidth);
  const [selectedVariableName, setSelectedVariableName] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [status, setStatus] = useState('Loading');
  const [modal, setModal] = useState<ModalState>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [currentLine, setCurrentLine] = useState(1);
  const [visualInsert, setVisualInsert] = useState<VisualMarkdownInsert | undefined>();
  const [sourceInsert, setSourceInsert] = useState<SourceMarkdownInsert | undefined>();
  const selectionGetterRef = useRef<VisualMarkdownSelection | SourceMarkdownSelection | undefined>(undefined);
  const visualJumpRef = useRef<VisualMarkdownJump | undefined>(undefined);
  const sourceJumpRef = useRef<SourceMarkdownJump | undefined>(undefined);
  const textRef = useRef('');
  const snapshotRef = useRef<ScieMDDocumentSnapshot | null>(null);
  const reviewRef = useRef<ReviewState | null>(null);
  const lastSyncedDocumentTextRef = useRef<string | null>(null);
  const pendingEditTextByIdRef = useRef(new Map<string, string>());
  const lastSentTextRef = useRef('');
  const pendingRejectedHunkIdsRef = useRef<string[]>([]);
  const panelIdRef = useRef<string | null>(null);
  const editChainIdRef = useRef(createEditChainId());

  const documentReadOnly = Boolean(snapshot?.isReadonly);
  const documentFormat = snapshot?.format ?? 'markdown';
  const fileLabel = snapshot?.fileName ?? 'Markdown';
  const filePath = snapshot ? filePathFromUri(snapshot.uri) : null;
  const frontmatter = useMemo(() => parseFrontmatter(text), [text]);
  const variableIndex = useMemo(() => buildVariableIndex(text, frontmatter), [frontmatter, text]);
  const protectedBlocks = useMemo(() => parseProtectedBlocks(text), [text]);
  const headings = useMemo(() => extractHeadings(text), [text]);
  const activeHeadingId = useMemo(() => activeHeadingIdForLine(headings, currentLine), [currentLine, headings]);
  const noteCount = useMemo(() => parseEditorComments(text), [text]);
  const variantCount = useMemo(() => parseVariantGroups(text).length, [text]);
  const nextVariantGroupId = useMemo(() => `revision-${variantCount + 1}`, [variantCount]);
  const nextVariable = useMemo(() => nextVariableName(variableIndex.definitions), [variableIndex.definitions]);
  const activeMode: EditorMode = mode;
  const structuredPreviewMode = activeMode === 'source' ? 'source' : 'tree';
  const resolvedTheme = useResolvedVscodeTheme(themeMode);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (!selectedVariableName) return;
    const knownVariableNames = new Set([
      ...variableIndex.definitions.map((definition) => definition.name),
      ...variableIndex.usages.map((usage) => usage.name),
    ]);
    if (!knownVariableNames.has(selectedVariableName)) {
      setSelectedVariableName(null);
    }
  }, [selectedVariableName, variableIndex.definitions, variableIndex.usages]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themeMode = themeMode;
  }, [resolvedTheme, themeMode]);

  useEffect(() => {
    document.documentElement.dataset.visualStyle = visualStyle;
    document.documentElement.style.setProperty('--font-scale', '1');
  }, [visualStyle]);

  useEffect(() => {
    reviewRef.current = review;
  }, [review]);

  useEffect(() => {
    const listener = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const message = event.data;
      if (message.type === 'operationResult') {
        if (message.panelId && panelIdRef.current && message.panelId !== panelIdRef.current) return;
        if (message.id) pendingEditTextByIdRef.current.delete(message.id);
        if (!message.ok) {
          lastSentTextRef.current = '';
          setStatus(message.result === 'readonly' ? 'Read-only' : 'Refresh pending');
          pushToast(message.message, message.result === 'readonly' ? 'warning' : 'error');
        }
        return;
      }
      if (message.type !== 'documentUpdate') return;
      markDocumentReceived();
      panelIdRef.current = message.panelId;

      const incomingText = message.snapshot.text;
      const previousSyncedText = lastSyncedDocumentTextRef.current;
      const ownEditText = message.sourceEditId
        ? pendingEditTextByIdRef.current.get(message.sourceEditId)
        : undefined;
      const ownEcho = ownEditText !== undefined;
      const currentDraftText = textRef.current;
      const hasLocalDraft = !ownEcho
        && previousSyncedText !== null
        && currentDraftText !== previousSyncedText
        && currentDraftText !== incomingText;
      const keepCurrentDraft = (ownEcho && currentDraftText !== ownEditText)
        || reviewRef.current?.kind === 'external'
        || hasLocalDraft;

      if (ownEcho && message.sourceEditId) {
        pendingEditTextByIdRef.current.delete(message.sourceEditId);
      } else if (previousSyncedText !== null && previousSyncedText !== incomingText && message.reason === 'changed') {
        const plan = createReviewPlan(previousSyncedText, incomingText);
        const protectedHunkIds = new Set(detectProtectedChanges(previousSyncedText, plan.rawHunks).map((change) => change.hunkId));
        const protectedUnitIds = plan.units
          .filter((unit) => unit.rawHunkIds.some((id) => protectedHunkIds.has(id)))
          .map((unit) => unit.id);
        if (plan.rawHunks.length > 0 && (hasLocalDraft || protectedUnitIds.length > 0)) {
          setReview({
            kind: 'external',
            title: protectedUnitIds.length > 0 ? 'Review locked Markdown changes' : 'External Markdown changes',
            before: previousSyncedText,
            after: incomingText,
            plan,
            rejectedUnitIds: protectedUnitIds,
            protectedUnitIds,
          });
          setStatus('External changes pending');
          return;
        }
      }

      if (!ownEcho && reviewRef.current?.kind === 'external') {
        setStatus('External changes pending');
        return;
      }

      lastSyncedDocumentTextRef.current = incomingText;
      lastSentTextRef.current = latestPendingEditText(pendingEditTextByIdRef.current) ?? incomingText;
      setSnapshot(message.snapshot);
      if (!keepCurrentDraft) {
        setText(incomingText);
      }
      setStatus(message.snapshot.isReadonly
        ? 'Read-only'
        : keepCurrentDraft
          ? 'External changes pending'
          : message.snapshot.isDirty
            ? 'Unsaved'
            : message.reason === 'saved'
              ? 'Saved'
              : 'Synced');
    };

    window.addEventListener('message', listener);
    vscodeApi.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', listener);
  }, []);

  useEffect(() => {
    const state: SavedWebviewState = { mode, themeMode, visualStyle, dataSidebarOpen, dataSidebarWidth };
    vscodeApi.setState(state);
    writeSavedWebviewState(state);
  }, [dataSidebarOpen, dataSidebarWidth, mode, themeMode, visualStyle]);

  useEffect(() => {
    const handleUndoRedo = (event: KeyboardEvent) => {
      const modifierPressed = event.ctrlKey || event.metaKey;
      if (!modifierPressed || event.altKey) return;
      const key = event.key.toLowerCase();
      const undo = key === 'z' && !event.shiftKey;
      const redo = key === 'y' || (key === 'z' && event.shiftKey);
      if (!undo && !redo) return;
      event.preventDefault();
      event.stopPropagation();
      const pendingText = flushVisualEditorState() ?? textRef.current;
      textRef.current = pendingText;
      setText(pendingText);
      const syncedText = lastSyncedDocumentTextRef.current;
      if (!documentReadOnly && snapshot && syncedText !== null && pendingText !== syncedText) {
        const editId = createEditId();
        pendingEditTextByIdRef.current.set(editId, pendingText);
        lastSentTextRef.current = pendingText;
        vscodeApi.postMessage({
          type: undo ? 'undo' : 'redo',
          panelId: panelIdRef.current ?? undefined,
          editChainId: editChainIdRef.current,
          pendingText,
          editId,
          baseText: syncedText,
          baseVersion: snapshot.version,
        });
        return;
      }
      vscodeApi.postMessage({ type: undo ? 'undo' : 'redo', panelId: panelIdRef.current ?? undefined, editChainId: editChainIdRef.current });
    };
    window.addEventListener('keydown', handleUndoRedo, { capture: true });
    return () => window.removeEventListener('keydown', handleUndoRedo, { capture: true });
  }, [documentReadOnly, snapshot]);

  const flushPendingDocumentEdit = useCallback((options: { updateStatus?: boolean } = {}) => {
    const activeSnapshot = snapshotRef.current;
    if (!activeSnapshot || activeSnapshot.isReadonly || reviewRef.current?.kind === 'external') return false;
    const syncedText = lastSyncedDocumentTextRef.current;
    if (syncedText === null) return false;
    const pendingText = flushVisualEditorState() ?? textRef.current;
    textRef.current = pendingText;
    const hasPendingRejectedHunks = pendingRejectedHunkIdsRef.current.length > 0;
    if (pendingText === syncedText && !hasPendingRejectedHunks) return false;
    if (pendingText === lastSentTextRef.current && !hasPendingRejectedHunks) return false;

    const editId = createEditId();
    pendingEditTextByIdRef.current.set(editId, pendingText);
    lastSentTextRef.current = pendingText;
    vscodeApi.postMessage({
      type: 'replaceDocument',
      panelId: panelIdRef.current ?? undefined,
      editChainId: editChainIdRef.current,
      text: pendingText,
      editId,
      baseText: syncedText,
      baseVersion: activeSnapshot.version,
      rejectedHunkIds: pendingRejectedHunkIdsRef.current,
    });
    pendingRejectedHunkIdsRef.current = [];
    if (options.updateStatus !== false) setStatus('Editing');
    return true;
  }, []);

  useEffect(() => {
    if (!snapshot) return undefined;
    if (snapshot.isReadonly) return undefined;
    if (review?.kind === 'external') return undefined;
    const hasPendingRejectedHunks = pendingRejectedHunkIdsRef.current.length > 0;
    if (text === lastSyncedDocumentTextRef.current && !hasPendingRejectedHunks) return undefined;
    if (text === lastSentTextRef.current) return undefined;
    const handle = window.setTimeout(() => {
      textRef.current = text;
      flushPendingDocumentEdit();
    }, EDIT_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [flushPendingDocumentEdit, review?.kind, snapshot, text]);

  useEffect(() => {
    const flushWithoutStatus = () => {
      flushPendingDocumentEdit({ updateStatus: false });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushWithoutStatus();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', flushWithoutStatus);
    window.addEventListener('beforeunload', flushWithoutStatus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', flushWithoutStatus);
      window.removeEventListener('beforeunload', flushWithoutStatus);
    };
  }, [flushPendingDocumentEdit]);


  const pushToast = useCallback((message: string, tone: ToastState['tone'] = 'info') => {
    setToast({ text: message, tone });
    window.setTimeout(() => setToast(null), 3600);
  }, []);

  const switchToVisualMode = useCallback(() => {
    setMode('visual');
  }, []);

  const updateCurrentLine = useCallback((line: number) => {
    setCurrentLine(Math.max(1, Math.floor(line)));
  }, []);

  const commitMarkdown = useCallback((nextText: string) => {
    if (documentReadOnly) return;
    textRef.current = nextText;
    setText(nextText);
  }, [documentReadOnly]);

  const getEditorSelectionSnapshot = useCallback((): EditorSelectionSnapshot => {
    const snapshotValue = selectionGetterRef.current?.();
    if (snapshotValue) {
      return {
        ...snapshotValue,
        text: snapshotValue.text.trim(),
      };
    }
    return {
      text: (window.getSelection()?.toString() ?? '').trim(),
      line: currentLine,
      surface: 'unknown',
    };
  }, [currentLine]);

  const insertMarkdown = useCallback((snippet: string) => {
    if (documentReadOnly) return;
    if (activeMode === 'visual' && visualInsert) {
      visualInsert(snippet, { filePath });
      return;
    }
    if (sourceInsert) {
      sourceInsert(snippet);
      return;
    }
    const selection = getEditorSelectionSnapshot();
    commitMarkdown(insertStandaloneMarkdownBlockNearSelection(textRef.current, selection, snippet, currentLine));
  }, [activeMode, commitMarkdown, currentLine, documentReadOnly, filePath, getEditorSelectionSnapshot, sourceInsert, visualInsert]);

  const jumpToHeading = useCallback((heading: MarkdownHeading) => {
    updateCurrentLine(heading.line);
    if (activeMode === 'visual') {
      visualJumpRef.current?.(visualJumpTargetForHeading(headings, heading));
      return;
    }
    sourceJumpRef.current?.(heading.line);
  }, [activeMode, headings, updateCurrentLine]);

  const selectVariable = useCallback((name: string, usage?: VariableUsage) => {
    setSelectedVariableName(name);
    if (!usage) return;
    updateCurrentLine(usage.line);
    if (activeMode === 'source') {
      sourceJumpRef.current?.(usage.line);
    }
  }, [activeMode, updateCurrentLine]);

  const wrapSelectedEditorBlock = useCallback((selection: EditorSelectionSnapshot, wrap: (rawSelection: string) => string) => {
    const nextMarkdown = wrapMarkdownBlockSelection(textRef.current, selection, wrap, currentLine);
    if (!nextMarkdown) return false;
    commitMarkdown(nextMarkdown);
    return true;
  }, [commitMarkdown, currentLine]);

  const insertAnchoredSelectionBlock = useCallback((selection: EditorSelectionSnapshot, block: string) => {
    commitMarkdown(insertStandaloneMarkdownBlockNearSelection(textRef.current, selection, `${block.trimEnd()}\n\n`, currentLine));
  }, [commitMarkdown, currentLine]);

  const submitNote = useCallback((kind: EditorNoteKind, body: string) => {
    const selection = getEditorSelectionSnapshot();
    const result = insertEditorNote(textRef.current, {
      body,
      kind,
      selectedText: selection.text,
      prefix: selection.prefix,
      suffix: selection.suffix,
      selectionLine: selection.line,
      selectionEndLine: selection.endLine,
      preferredLine: currentLine,
    });
    commitMarkdown(result.markdown);
    pushToast(selection.text ? 'Note anchored to selected text.' : 'Note inserted.', 'success');
    setModal(null);
  }, [commitMarkdown, currentLine, getEditorSelectionSnapshot, pushToast]);

  const submitVariable = useCallback((name: string, value: string) => {
    const trimmedName = name.trim();
    if (!VARIABLE_NAME_PATTERN.test(trimmedName)) {
      pushToast('Variable names must start with a letter or underscore and use only letters, numbers, dots, dashes, and underscores.', 'error');
      return;
    }
    try {
      const withDefinition = upsertFrontmatterVariable(textRef.current, trimmedName, value);
      commitMarkdown(withDefinition);
      window.setTimeout(() => {
        insertMarkdown(`${createVariableToken(trimmedName)} `);
      }, 0);
      pushToast(`Variable {{ ${trimmedName} }} created.`, 'success');
      setModal(null);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Variable could not be created.', 'error');
    }
  }, [commitMarkdown, insertMarkdown, pushToast]);

  const editVariable = useCallback((originalName: string, nextName: string, value: string) => {
    const trimmedOriginalName = originalName.trim();
    const trimmedNextName = nextName.trim();
    if (!VARIABLE_NAME_PATTERN.test(trimmedOriginalName) || !VARIABLE_NAME_PATTERN.test(trimmedNextName)) {
      pushToast('Variable names must start with a letter or underscore and use only letters, numbers, dots, dashes, and underscores.', 'error');
      return;
    }
    try {
      commitMarkdown(renameVariableAndUpdateUsages(textRef.current, trimmedOriginalName, trimmedNextName, value));
      setSelectedVariableName(trimmedNextName);
      pushToast(`Variable {{ ${trimmedNextName} }} saved.`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Variable could not be saved.', 'error');
    }
  }, [commitMarkdown, pushToast]);

  const submitVersion = useCallback((groupId: string) => {
    const selection = getEditorSelectionSnapshot();
    const selectedText = selection.text.trim();
    const id = sanitizeVariantGroupId(groupId.trim() || nextVariantGroupId);
    if (selectedText) {
      const wrapped = wrapSelectedEditorBlock(selection, (rawSelection) => (
        createVariantGroupSnippet(id, 'v1').replace('Write the first version here.', rawSelection.trimEnd())
      ));
      if (!wrapped) {
        insertAnchoredSelectionBlock(selection, createAnchoredVariantGroupSnippet(id, selectedText, 'v1', {
          markdown: textRef.current,
          selectionLine: selection.line,
          preferredLine: currentLine,
          prefix: selection.prefix,
          suffix: selection.suffix,
        }));
      }
      pushToast('Selection stored as a text version.', 'success');
    } else {
      insertMarkdown(createVariantGroupSnippet(id));
      pushToast('Text version block inserted.', 'success');
    }
    setModal(null);
  }, [currentLine, getEditorSelectionSnapshot, insertAnchoredSelectionBlock, insertMarkdown, nextVariantGroupId, pushToast, wrapSelectedEditorBlock]);

  const applyExternalReview = useCallback(() => {
    if (!review) return;
    const rejectedUnitIds = new Set(review.rejectedUnitIds);
    const rejectedRawHunkIds = review.plan.units
      .filter((unit) => rejectedUnitIds.has(unit.id))
      .flatMap((unit) => unit.rawHunkIds);
    const acceptedText = applyReviewPlanDecisions(
      review.before,
      review.after,
      review.plan,
      rejectedUnitIds,
    );
    const currentDraft = textRef.current;
    const nextText = currentDraft !== review.after && currentDraft !== review.before
      ? applyThreeWayDiffDecisions(
          review.before,
          currentDraft,
          acceptedText,
          review.plan.rawHunks,
          new Set(rejectedRawHunkIds),
        )
      : acceptedText;
    pendingRejectedHunkIdsRef.current = rejectedRawHunkIds;
    lastSentTextRef.current = '';
    commitMarkdown(nextText);
    setReview(null);
    pushToast('External changes reviewed.', 'success');
  }, [commitMarkdown, pushToast, review]);

  const save = () => {
    const flushedText = flushVisualEditorState() ?? textRef.current;
    textRef.current = flushedText;
    if (flushedText !== text) setText(flushedText);
    const syncedText = lastSyncedDocumentTextRef.current;
    const hasPendingRejectedHunks = pendingRejectedHunkIdsRef.current.length > 0;
    if (!documentReadOnly && snapshot && syncedText !== null && (flushedText !== syncedText || hasPendingRejectedHunks)) {
      const editId = createEditId();
      pendingEditTextByIdRef.current.set(editId, flushedText);
      lastSentTextRef.current = flushedText;
      vscodeApi.postMessage({
        type: 'save',
        panelId: panelIdRef.current ?? undefined,
        editChainId: editChainIdRef.current,
        pendingText: flushedText,
        editId,
        baseText: syncedText,
        baseVersion: snapshot.version,
        rejectedHunkIds: pendingRejectedHunkIdsRef.current,
      });
      pendingRejectedHunkIdsRef.current = [];
      setStatus('Saving');
      return;
    }
    vscodeApi.postMessage({ type: 'save', panelId: panelIdRef.current ?? undefined, editChainId: editChainIdRef.current });
  };

  if (snapshot && isStructuredPreviewWebviewFormat(documentFormat)) {
    return (
      <StructuredPreviewWorkbench
        snapshot={snapshot}
        status={status}
        mode={structuredPreviewMode}
        onSelectTree={() => setMode('visual')}
        onSelectSource={() => setMode('source')}
      />
    );
  }

  return (
    <VscodeWorkbenchShell
      editorMode={activeMode}
      topbar={(
        <VscodeTopbar
          fileLabel={fileLabel}
          mode={activeMode}
          visualStyle={visualStyle}
          themeMode={themeMode}
          openMenu={openChromeMenu}
          status={status}
          dirty={Boolean(snapshot?.isDirty)}
          documentReadOnly={documentReadOnly}
          dataSidebarOpen={dataSidebarOpen}
          onSelectVisual={switchToVisualMode}
          onSelectSource={() => setMode('source')}
          onToggleDataSidebar={() => setDataSidebarOpen((open) => !open)}
          onOpenMenuChange={setOpenChromeMenu}
          onSelectStyle={setVisualStyle}
          onSelectTheme={setThemeMode}
          onSave={save}
        />
      )}
      readonlyBanner={snapshot?.isReadonly ? <VscodeReadOnlyBanner reason={snapshot.readonlyReason} /> : null}
      toolbar={(
        <VscodeMarkdownToolbar
          documentReadOnly={documentReadOnly}
          noteCount={noteCount.length}
          variableCount={variableIndex.definitions.length}
          variantCount={variantCount}
          onInsertNote={() => setModal({ type: 'note', kind: 'llm', body: 'Revise this text for clarity while preserving the scientific meaning.' })}
          onInsertVersion={() => setModal({ type: 'version', groupId: nextVariantGroupId })}
        />
      )}
      dataSidebarOpen={dataSidebarOpen}
      dataSidebarWidth={dataSidebarWidth}
      dataSidebar={(
        <VscodeDataSidebar
          variableDefinitions={variableIndex.definitions}
          variableUsages={variableIndex.usages}
          missingVariables={variableIndex.missingVariables}
          selectedVariableName={selectedVariableName}
          documentReadOnly={documentReadOnly}
          width={dataSidebarWidth}
          minWidth={DATA_SIDEBAR_MIN_WIDTH}
          maxWidth={DATA_SIDEBAR_MAX_WIDTH}
          widthStep={DATA_SIDEBAR_WIDTH_STEP}
          onInsertVariable={() => setModal({ type: 'variable', name: nextVariable, value: 'XXX' })}
          onEditVariable={editVariable}
          onSelectVariable={selectVariable}
          onClose={() => setDataSidebarOpen(false)}
          onWidthChange={(width) => setDataSidebarWidth(normalizeDataSidebarWidth(width))}
        />
      )}
      startupPanel={!snapshot ? <VscodeStartupPanel /> : null}
      reviewPanel={review ? (
        <ReviewPanel
          review={review}
          onRejectedUnitsChange={(rejectedUnitIds) => {
            setReview((current) => current
              ? {
                  ...current,
                  rejectedUnitIds,
                }
              : current);
          }}
          onApply={applyExternalReview}
          onClose={() => setReview(null)}
          disabled={documentReadOnly}
        />
      ) : null}
      editorStage={(
        <VscodeEditorStage
          mode={activeMode}
          quickOutline={(
            <QuickOutlineHover
              headings={headings}
              activeHeadingId={activeHeadingId}
              onJump={jumpToHeading}
            />
          )}
          visualEditor={(
            <VisualMarkdownEditor
              markdown={text}
              filePath={filePath}
              onChange={commitMarkdown}
              onEditorReady={() => undefined}
              onInsertReady={(handler) => setVisualInsert(() => handler)}
              onJumpReady={(handler) => {
                visualJumpRef.current = handler;
              }}
              onSelectionTextReady={(getter) => {
                selectionGetterRef.current = getter;
              }}
              onCursorLineChange={(line) => updateCurrentLine(line)}
              onViewportLineChange={updateCurrentLine}
              outlineHeadings={headings}
              onLockViolation={(message) => pushToast(message, 'warning')}
              onToast={pushToast}
              confirmText={async (state) => window.confirm(`${state.title}\n\n${state.message}`)}
              variableDefinitions={variableIndex.definitions}
              highlightedVariableName={selectedVariableName}
              onEditVariable={(name) => {
                setSelectedVariableName(name);
                setDataSidebarOpen(true);
              }}
              readOnly={documentReadOnly}
            />
          )}
          sourceEditor={(
            <SourceMarkdownEditor
              markdown={text}
              onChange={commitMarkdown}
              onInsertReady={(handler) => setSourceInsert(() => handler)}
              onJumpReady={(handler) => {
                sourceJumpRef.current = handler;
              }}
              onSelectionTextReady={(getter) => {
                selectionGetterRef.current = getter;
              }}
              onCursorLineChange={(line) => updateCurrentLine(line)}
              onViewportLineChange={updateCurrentLine}
              variableDefinitions={variableIndex.definitions}
              highlightedVariableName={selectedVariableName}
              protectedBlocks={protectedBlocks}
              onLockViolation={(message) => pushToast(message, 'warning')}
              readOnly={documentReadOnly}
            />
          )}
        />
      )}
      toast={toast ? <VscodeToast toast={toast} /> : null}
      modal={modal ? (
        <Modal state={modal} onClose={() => setModal(null)}>
          {modal.type === 'note' ? (
            <NoteForm state={modal} onSubmit={submitNote} onCancel={() => setModal(null)} />
          ) : modal.type === 'variable' ? (
            <VariableForm state={modal} onSubmit={submitVariable} onCancel={() => setModal(null)} />
          ) : (
            <VersionForm state={modal} onSubmit={submitVersion} onCancel={() => setModal(null)} />
          )}
        </Modal>
      ) : null}
    />
  );
}

function ReviewPanel({
  review,
  onRejectedUnitsChange,
  onApply,
  onClose,
  disabled,
}: {
  review: ReviewState;
  onRejectedUnitsChange: (unitIds: string[]) => void;
  onApply: () => void;
  onClose: () => void;
  disabled: boolean;
}) {
  const changedLines = useMemo(() => review.plan.units.reduce((total, unit) => (
    total + Math.max(unit.displayHunk.beforeLines.length, unit.displayHunk.afterLines.length)
  ), 0), [review.plan.units]);
  const largeReview = isLargeExternalReview(review.plan.units, changedLines);
  const [expandedId, setExpandedId] = useState<string | null>(() => largeReview ? null : review.plan.units[0]?.id ?? null);
  const rejectedUnitIds = useMemo(() => new Set(review.rejectedUnitIds), [review.rejectedUnitIds]);
  const protectedUnitIds = useMemo(() => new Set(review.protectedUnitIds), [review.protectedUnitIds]);

  useEffect(() => {
    setExpandedId(largeReview ? null : review.plan.units[0]?.id ?? null);
  }, [largeReview, review.plan.units]);

  const toggleRejected = (unitId: string) => {
    const nextRejected = new Set(rejectedUnitIds);
    if (nextRejected.has(unitId)) nextRejected.delete(unitId);
    else nextRejected.add(unitId);
    onRejectedUnitsChange([...nextRejected]);
  };

  const rejectAll = () => {
    onRejectedUnitsChange(review.plan.units.map((unit) => unit.id));
  };

  const acceptAll = () => {
    onRejectedUnitsChange([...protectedUnitIds]);
  };

  const rejectedCount = rejectedUnitIds.size;
  const acceptedCount = Math.max(0, review.plan.units.length - rejectedCount);

  return (
    <section className="vscode-scie-review-panel">
      <header className="vscode-scie-review-header">
        <div>
          <strong>{review.title}</strong>
          <span>Disk changed while this document was open. Choose which disk changes should be rejected before applying the review.</span>
          <small>{review.plan.units.length} change{review.plan.units.length === 1 ? '' : 's'} - {changedLines} changed line{changedLines === 1 ? '' : 's'}</small>
        </div>
        <button type="button" aria-label="Close external change review" onClick={onClose}>Close</button>
      </header>
      {review.protectedUnitIds.length > 0 && (
        <div className="vscode-scie-review-warning" role="alert">
          <strong>Locked content changed.</strong>
          <span>Those changes are rejected by default. Clear a rejection only if you intentionally want to accept the disk edit.</span>
        </div>
      )}
      <div className="vscode-scie-review-units">
        {largeReview && review.plan.units.length > 0 && (
          <div className="vscode-scie-review-large-note" role="status">
            <strong>Large external change set</strong>
            <span>Cards start collapsed so the review stays readable. Expand one change at a time to compare the open document with the disk version.</span>
          </div>
        )}
        {review.plan.units.length === 0 ? (
          <p className="vscode-scie-review-empty">Only review metadata changed.</p>
        ) : review.plan.units.map((unit, index) => {
          const rejected = rejectedUnitIds.has(unit.id);
          const protectedChange = protectedUnitIds.has(unit.id);
          const expanded = expandedId === unit.id;
          return (
            <section key={unit.id} className={`vscode-scie-review-unit ${rejected ? 'rejected' : ''} ${expanded ? 'expanded' : ''} ${protectedChange ? 'protected' : ''}`}>
              <div className="vscode-scie-review-card-shell">
                <label className="vscode-scie-review-selector">
                  <input type="checkbox" checked={rejected} disabled={disabled} onChange={() => toggleRejected(unit.id)} />
                  <span>Reject</span>
                </label>
                <button
                  type="button"
                  className="vscode-scie-review-summary"
                  aria-expanded={expanded}
                  onClick={() => setExpandedId((current) => current === unit.id ? null : unit.id)}
                >
                  <span className="vscode-scie-review-index">Change {index + 1}</span>
                  <span className="vscode-scie-review-title">{reviewUnitTitle(unit)}</span>
                  <span className="vscode-scie-review-preview">{summarizeMarkdown(unit.afterMarkdown || unit.beforeMarkdown)}</span>
                  {protectedChange && <em>locked content</em>}
                </button>
              </div>
              <div className="vscode-scie-review-detail" aria-hidden={!expanded}>
                {expanded && (
                  <ReviewUnitBody
                    unit={unit}
                    beforeLabel="Open document"
                    afterLabel="Disk version"
                  />
                )}
              </div>
            </section>
          );
        })}
      </div>
      <footer>
        <span>{acceptedCount} accepted - {rejectedCount} rejected</span>
        <div>
          <button type="button" onClick={rejectAll} disabled={disabled || review.plan.units.length === 0}>Reject all</button>
          <button type="button" onClick={acceptAll} disabled={disabled || review.plan.units.length === 0}>Accept all safe</button>
          <button type="button" className="primary" onClick={onApply} disabled={disabled}>Apply review</button>
        </div>
      </footer>
    </section>
  );
}

function Modal({ state, children, onClose }: { state: ModalState; children: ReactNode; onClose: () => void }) {
  const copy = dialogCopyForState(state);
  return (
    <div className="vscode-scie-modal-backdrop" role="presentation">
      <section className="vscode-scie-modal" role="dialog" aria-modal="true" aria-labelledby="vscode-scie-dialog-title" aria-describedby="vscode-scie-dialog-description">
        <header className="vscode-scie-dialog-header">
          <div>
            <span>{copy.eyebrow}</span>
            <h2 id="vscode-scie-dialog-title">{copy.title}</h2>
            <p id="vscode-scie-dialog-description">{copy.description}</p>
          </div>
          <button type="button" className="vscode-scie-modal-close" aria-label={`Close ${copy.title}`} onClick={onClose}>Close</button>
        </header>
        <div className="vscode-scie-dialog-body">
          {children}
        </div>
      </section>
    </div>
  );
}

function NoteForm({ state, onSubmit, onCancel }: { state: Extract<ModalState, { type: 'note' }>; onSubmit: (kind: EditorNoteKind, body: string) => void; onCancel: () => void }) {
  const [body, setBody] = useState(state.body);
  return (
    <form className="vscode-scie-dialog-form" onSubmit={(event) => { event.preventDefault(); onSubmit(state.kind, body); }}>
      <label>Note text<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={5} autoFocus /></label>
      <div className="vscode-scie-dialog-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit">Insert Note</button>
      </div>
    </form>
  );
}

function VariableForm({ state, onSubmit, onCancel }: { state: Extract<ModalState, { type: 'variable' }>; onSubmit: (name: string, value: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(state.name);
  const [value, setValue] = useState(state.value);
  return (
    <form className="vscode-scie-dialog-form" onSubmit={(event) => { event.preventDefault(); onSubmit(name, value); }}>
      <label>Name<input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></label>
      <label>Value<input value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <div className="vscode-scie-dialog-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit">Create Variable</button>
      </div>
    </form>
  );
}

function VersionForm({ state, onSubmit, onCancel }: { state: Extract<ModalState, { type: 'version' }>; onSubmit: (groupId: string) => void; onCancel: () => void }) {
  const [groupId, setGroupId] = useState(state.groupId);
  return (
    <form className="vscode-scie-dialog-form" onSubmit={(event) => { event.preventDefault(); onSubmit(groupId); }}>
      <label>Group ID<input value={groupId} onChange={(event) => setGroupId(event.target.value)} autoFocus /></label>
      <div className="vscode-scie-dialog-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit">Insert Version</button>
      </div>
    </form>
  );
}

function isLargeExternalReview(reviewUnits: ReviewUnit[], changedLines: number): boolean {
  return reviewUnits.length >= 12 || changedLines >= 160;
}

function reviewUnitTitle(unit: ReviewUnit): string {
  if (unit.beforeMarkdown.trim() && unit.afterMarkdown.trim()) return 'Text changed on disk';
  if (unit.afterMarkdown.trim()) return 'Text added on disk';
  if (unit.beforeMarkdown.trim()) return 'Text removed on disk';
  return 'Metadata changed on disk';
}

function summarizeMarkdown(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/[#*_`>\[\](){}|~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'No visible text.';
  return text.length > 170 ? `${text.slice(0, 167).trimEnd()}...` : text;
}

function dialogCopyForState(state: ModalState): { eyebrow: string; title: string; description: string } {
  if (state?.type === 'note') {
      return state.kind === 'human'
        ? {
          eyebrow: 'Review note',
          title: 'Note to Human',
          description: 'Add a human-facing review note at the current selection or cursor.',
        }
        : {
          eyebrow: 'Document note',
          title: 'Insert note',
          description: 'Add a note at the current selection or cursor.',
        };
  }
  if (state?.type === 'variable') {
    return {
      eyebrow: 'Document variable',
      title: 'Variable',
      description: 'Create or update a frontmatter variable and insert its token at the cursor.',
    };
  }
  return {
    eyebrow: 'Revision block',
    title: 'Text Version',
    description: 'Wrap selected text or insert a new version-choice block.',
  };
}

function activeHeadingIdForLine(headings: MarkdownHeading[], line: number): string | null {
  let activeHeading: MarkdownHeading | null = null;
  for (const heading of headings) {
    if (heading.line > line) break;
    activeHeading = heading;
  }
  return activeHeading?.id ?? headings[0]?.id ?? null;
}

function visualJumpTargetForHeading(headings: MarkdownHeading[], heading: MarkdownHeading): VisualMarkdownJumpTarget {
  const occurrence = headings
    .filter((candidate) => candidate.line <= heading.line && candidate.level === heading.level && candidate.text === heading.text)
    .length - 1;
  return {
    level: heading.level,
    text: heading.text,
    occurrence: Math.max(0, occurrence),
  };
}

function latestPendingEditText(pending: Map<string, string>): string | null {
  let latest: string | null = null;
  for (const value of pending.values()) latest = value;
  return latest;
}

function createEditId(): string {
  return `webview-${Date.now().toString(36)}-${randomToken(8)}`;
}

function createEditChainId(): string {
  return `chain-${Date.now().toString(36)}-${randomToken(8)}`;
}

function randomToken(length: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  const cryptoApi = (globalThis as unknown as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (typeof cryptoApi?.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = (Date.now() + index * 37) % 256;
  }
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function markDocumentReceived(): void {
  document.documentElement.dataset.scieMdBoot = 'document-received';
  const boot = document.getElementById('scie-md-boot');
  if (boot) {
    boot.textContent = 'ScieMD document loaded.';
    boot.classList.add('hidden');
  }
}

function sanitizeVariantGroupId(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || 'revision-choice';
}

function filePathFromUri(uri: string): string | null {
  if (!uri.startsWith('file://')) return null;
  try {
    const decoded = decodeURIComponent(uri.replace(/^file:\/\/\/?/, ''));
    return decoded.replace(/^([A-Za-z]):\//, '$1:/');
  } catch {
    return null;
  }
}

interface SavedWebviewState {
  mode: EditorMode;
  themeMode: VscodeThemeMode;
  visualStyle: VisualStyleId;
  dataSidebarOpen: boolean;
  dataSidebarWidth: number;
}

function readSavedWebviewState(): SavedWebviewState {
  const raw = mergeSavedWebviewState(readLocalWebviewState(), vscodeApi.getState());
  const mode = normalizeEditorMode(raw?.mode);
  const themeMode = normalizeThemeMode(raw?.themeMode);
  const visualStyle = isVisualStyleId(raw?.visualStyle) ? raw.visualStyle : 'science';
  const legacyState = raw as (Partial<SavedWebviewState> & { outlineSidebarOpen?: unknown; outlineSidebarWidth?: unknown }) | null;
  const dataSidebarOpen = typeof raw?.dataSidebarOpen === 'boolean'
    ? raw.dataSidebarOpen
    : typeof legacyState?.outlineSidebarOpen === 'boolean'
      ? legacyState.outlineSidebarOpen
      : false;
  const dataSidebarWidth = normalizeDataSidebarWidth(raw?.dataSidebarWidth ?? legacyState?.outlineSidebarWidth);
  return { mode, themeMode, visualStyle, dataSidebarOpen, dataSidebarWidth };
}

function mergeSavedWebviewState(...states: Array<unknown>): Partial<SavedWebviewState> | null {
  let merged: Partial<SavedWebviewState> | null = null;
  for (const state of states) {
    if (!state || typeof state !== 'object') continue;
    merged = { ...(merged ?? {}), ...(state as Partial<SavedWebviewState>) };
  }
  return merged;
}

function readLocalWebviewState(): unknown {
  try {
    const raw = window.localStorage.getItem(WEBVIEW_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSavedWebviewState(state: SavedWebviewState): void {
  try {
    window.localStorage.setItem(WEBVIEW_SETTINGS_KEY, JSON.stringify(state));
  } catch {
    // Appearance settings are convenience state; storage failures must not interrupt editing.
  }
}

function normalizeEditorMode(value: unknown): EditorMode {
  if (value === 'visual' || value === 'source') return value;
  if (value === 'preview') return 'visual';
  return 'visual';
}

function normalizeDataSidebarWidth(value: unknown): number {
  const width = typeof value === 'number' && Number.isFinite(value)
    ? value
    : DATA_SIDEBAR_DEFAULT_WIDTH;
  return Math.max(DATA_SIDEBAR_MIN_WIDTH, Math.min(DATA_SIDEBAR_MAX_WIDTH, Math.round(width)));
}
