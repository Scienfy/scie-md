import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { VisualMarkdownEditor } from '../scie-md/components/VisualMarkdownEditor';
import type { VisualMarkdownInsert, VisualMarkdownSelection } from '../scie-md/components/VisualMarkdownEditor';
import { SourceMarkdownEditor } from '../scie-md/components/SourceMarkdownEditor';
import type { SourceMarkdownInsert, SourceMarkdownSelection } from '../scie-md/components/SourceMarkdownEditor';
import type { EditorSelectionSnapshot } from '../scie-md/components/editorSelection';
import { flushVisualEditorState } from '../scie-md/components/visualEditorStateSync';
import { buildVariableIndex } from '../scie-md/domain/variables/variableIndex';
import { createVariableToken, nextVariableName, upsertFrontmatterVariable, VARIABLE_NAME_PATTERN } from '../scie-md/domain/variables/variableEditing';
import { parseFrontmatter } from '../scie-md/domain/document/frontmatter';
import { insertEditorNote, parseEditorComments } from '../scie-md/markdown/editorComments';
import type { EditorNoteKind } from '../scie-md/markdown/editorComments';
import { detectProtectedChanges, parseProtectedBlocks } from '../scie-md/markdown/protectedBlocks';
import { insertStandaloneMarkdownBlockNearSelection, wrapMarkdownBlockSelection } from '../scie-md/markdown/selectionWrapping';
import { createAnchoredVariantGroupSnippet, createVariantGroupSnippet, parseVariantGroups } from '../scie-md/markdown/variants';
import { createReviewPlan, applyReviewPlanDecisions } from '../scie-md/markdown/reviewPlan';
import type { ReviewPlan } from '../scie-md/markdown/reviewPlan';
import { applyThreeWayDiffDecisions } from '../scie-md/markdown/diffReview';
import { extractHeadings } from '../scie-md/markdown/outline';
import { VISUAL_STYLE_OPTIONS, getVisualStyleOption, isVisualStyleId } from '../scie-md/services/visualStyleService';
import type { VisualStyleId } from '../scie-md/services/visualStyleService';
import type { ExtensionToWebviewMessage, ScieMDDocumentSnapshot } from '../shared/webviewProtocol';
import { vscodeApi } from './vscodeApi';

type EditorMode = 'visual' | 'source';
type VscodeThemeMode = 'vscode' | 'light' | 'dark' | 'sepia';

interface ReviewState {
  kind: 'external';
  title: string;
  before: string;
  after: string;
  plan: ReviewPlan;
  rejectedUnitIds: string[];
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
const THEME_OPTIONS: Array<{ id: VscodeThemeMode; label: string; detail: string }> = [
  { id: 'vscode', label: 'VS Code', detail: 'Match the active VS Code light or dark theme.' },
  { id: 'light', label: 'Light', detail: 'Use ScieMD light document colors.' },
  { id: 'dark', label: 'Dark', detail: 'Use ScieMD dark document colors.' },
  { id: 'sepia', label: 'Sepia', detail: 'Use ScieMD warm sepia document colors.' },
];

export function App() {
  const [snapshot, setSnapshot] = useState<ScieMDDocumentSnapshot | null>(null);
  const savedState = useMemo(readSavedWebviewState, []);
  const [mode, setMode] = useState<EditorMode>(savedState.mode);
  const [themeMode, setThemeMode] = useState<VscodeThemeMode>(savedState.themeMode);
  const [visualStyle, setVisualStyle] = useState<VisualStyleId>(savedState.visualStyle);
  const [text, setText] = useState('');
  const [status, setStatus] = useState('Loading');
  const [modal, setModal] = useState<ModalState>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [currentLine, setCurrentLine] = useState(1);
  const [visualInsert, setVisualInsert] = useState<VisualMarkdownInsert | undefined>();
  const [sourceInsert, setSourceInsert] = useState<SourceMarkdownInsert | undefined>();
  const selectionGetterRef = useRef<VisualMarkdownSelection | SourceMarkdownSelection | undefined>(undefined);
  const textRef = useRef('');
  const snapshotRef = useRef<ScieMDDocumentSnapshot | null>(null);
  const reviewRef = useRef<ReviewState | null>(null);
  const lastSyncedDocumentTextRef = useRef<string | null>(null);
  const pendingEditTextByIdRef = useRef(new Map<string, string>());
  const lastSentTextRef = useRef('');
  const pendingRejectedHunkIdsRef = useRef<string[]>([]);

  const documentReadOnly = Boolean(snapshot?.isReadonly);
  const fileLabel = snapshot?.fileName ?? 'Markdown';
  const filePath = snapshot ? filePathFromUri(snapshot.uri) : null;
  const frontmatter = useMemo(() => parseFrontmatter(text), [text]);
  const variableIndex = useMemo(() => buildVariableIndex(text, frontmatter), [frontmatter, text]);
  const protectedBlocks = useMemo(() => parseProtectedBlocks(text), [text]);
  const headings = useMemo(() => extractHeadings(text), [text]);
  const noteCount = useMemo(() => parseEditorComments(text), [text]);
  const variantCount = useMemo(() => parseVariantGroups(text).length, [text]);
  const nextVariantGroupId = useMemo(() => `revision-${variantCount + 1}`, [variantCount]);
  const nextVariable = useMemo(() => nextVariableName(variableIndex.definitions), [variableIndex.definitions]);
  const currentVisualStyle = useMemo(() => getVisualStyleOption(visualStyle), [visualStyle]);
  const activeMode: EditorMode = mode;
  const resolvedTheme = useResolvedVscodeTheme(themeMode);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

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
      if (message.type !== 'documentUpdate') return;
      markDocumentReceived();

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
    const state: SavedWebviewState = { mode, themeMode, visualStyle };
    vscodeApi.setState(state);
    writeSavedWebviewState(state);
  }, [mode, themeMode, visualStyle]);

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
          pendingText,
          editId,
          baseText: syncedText,
          baseVersion: snapshot.version,
        });
        return;
      }
      vscodeApi.postMessage({ type: undo ? 'undo' : 'redo' });
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
    vscodeApi.postMessage({ type: 'save' });
  };

  return (
    <div className="vscode-scie-shell app-shell" data-editor-mode={activeMode}>
      <header className="vscode-scie-topbar">
        <div className="vscode-scie-identity">
          <ScieMDWebviewMark />
          <strong>ScieMD</strong>
          <span>{fileLabel}</span>
        </div>
        <div className="vscode-scie-mode-toggle" role="tablist" aria-label="Editor mode">
          <button
            type="button"
            className={activeMode === 'visual' ? 'selected' : ''}
            onClick={switchToVisualMode}
            title="Visual"
          >
            Visual
          </button>
          <button type="button" className={activeMode === 'source' ? 'selected' : ''} onClick={() => setMode('source')}>Source</button>
        </div>
        <label className="vscode-scie-select">
          <span>Style</span>
          <select
            value={visualStyle}
            title={currentVisualStyle.detail}
            onChange={(event) => setVisualStyle(event.target.value as VisualStyleId)}
          >
            {VISUAL_STYLE_OPTIONS.map((style) => (
              <option key={style.id} value={style.id}>{style.label}</option>
            ))}
          </select>
        </label>
        <label className="vscode-scie-select">
          <span>Theme</span>
          <select
            value={themeMode}
            title={THEME_OPTIONS.find((option) => option.id === themeMode)?.detail}
            onChange={(event) => setThemeMode(event.target.value as VscodeThemeMode)}
          >
            {THEME_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={save} disabled={documentReadOnly}>Save</button>
        <span className={`vscode-scie-status ${snapshot?.isDirty ? 'dirty' : ''}`}>{status}</span>
      </header>

      {snapshot?.isReadonly && (
        <div className="vscode-scie-banner" role="status">
          {snapshot.readonlyReason ?? 'This document is read-only.'}
        </div>
      )}

      <div className="vscode-scie-toolbar">
        <button type="button" onClick={() => setModal({ type: 'note', kind: 'llm', body: 'Revise this text for clarity while preserving the scientific meaning.' })} disabled={documentReadOnly}>Note to LLM</button>
        <button type="button" onClick={() => setModal({ type: 'note', kind: 'human', body: 'Review note: summarize what changed and why.' })} disabled={documentReadOnly}>Note to Human</button>
        <button type="button" onClick={() => setModal({ type: 'variable', name: nextVariable, value: 'XXX' })} disabled={documentReadOnly}>Variable</button>
        <button type="button" onClick={() => setModal({ type: 'version', groupId: nextVariantGroupId })} disabled={documentReadOnly}>Text Version</button>
        <div className="vscode-scie-metrics" aria-label="Document summary">
          <span>{noteCount.length} notes</span>
          <span>{variableIndex.definitions.length} variables</span>
          <span>{variantCount} versions</span>
        </div>
      </div>

      {!snapshot && (
        <section className="startup-panel" role="status">
          <strong>Waiting for Markdown document from VS Code</strong>
          <span>The ScieMD webview has mounted and asked the extension host for the active file.</span>
        </section>
      )}

      {review && (
        <ReviewPanel
          review={review}
          onToggleReject={(unitId) => {
            setReview((current) => current
              ? {
                  ...current,
                  rejectedUnitIds: current.rejectedUnitIds.includes(unitId)
                    ? current.rejectedUnitIds.filter((id) => id !== unitId)
                    : [...current.rejectedUnitIds, unitId],
                }
              : current);
          }}
          onApply={applyExternalReview}
          onClose={() => setReview(null)}
          disabled={documentReadOnly}
        />
      )}

      <main className="vscode-scie-editor-stage">
        {activeMode === 'visual' ? (
          <VisualMarkdownEditor
            markdown={text}
            filePath={filePath}
            onChange={commitMarkdown}
            onEditorReady={() => undefined}
            onInsertReady={(handler) => setVisualInsert(() => handler)}
            onSelectionTextReady={(getter) => {
              selectionGetterRef.current = getter;
            }}
            onCursorLineChange={(line) => setCurrentLine(line)}
            onViewportLineChange={() => undefined}
            outlineHeadings={headings}
            onLockViolation={(message) => pushToast(message, 'warning')}
            onToast={pushToast}
            confirmText={async (state) => window.confirm(`${state.title}\n\n${state.message}`)}
            variableDefinitions={variableIndex.definitions}
          />
        ) : (
          <SourceMarkdownEditor
            markdown={text}
            onChange={commitMarkdown}
            onInsertReady={(handler) => setSourceInsert(() => handler)}
            onSelectionTextReady={(getter) => {
              selectionGetterRef.current = getter;
            }}
            onCursorLineChange={(line) => setCurrentLine(line)}
            onViewportLineChange={() => undefined}
            variableDefinitions={variableIndex.definitions}
            protectedBlocks={protectedBlocks}
            onLockViolation={(message) => pushToast(message, 'warning')}
          />
        )}
      </main>

      {toast && <div className={`vscode-scie-toast ${toast.tone}`}>{toast.text}</div>}

      {modal && (
        <Modal state={modal} onClose={() => setModal(null)}>
          {modal.type === 'note' ? (
            <NoteForm state={modal} onSubmit={submitNote} />
          ) : modal.type === 'variable' ? (
            <VariableForm state={modal} onSubmit={submitVariable} />
          ) : (
            <VersionForm state={modal} onSubmit={submitVersion} />
          )}
        </Modal>
      )}
    </div>
  );
}

function ScieMDWebviewMark() {
  const [reacting, setReacting] = useState(false);
  const react = () => {
    setReacting(false);
    window.requestAnimationFrame(() => {
      setReacting(true);
      window.setTimeout(() => setReacting(false), 760);
    });
  };
  return (
    <button
      type="button"
      className={`vscode-scie-logo ${reacting ? 'is-reacting' : ''}`}
      aria-label="ScieMD mark"
      onClick={react}
    >
      <span className="vscode-scie-logo-circle left" aria-hidden="true" />
      <span className="vscode-scie-logo-circle right" aria-hidden="true" />
    </button>
  );
}

function ReviewPanel({
  review,
  onToggleReject,
  onApply,
  onClose,
  disabled,
}: {
  review: ReviewState;
  onToggleReject: (unitId: string) => void;
  onApply: () => void;
  onClose: () => void;
  disabled: boolean;
}) {
  return (
    <section className="vscode-scie-review-panel">
      <header>
        <strong>{review.title}</strong>
        <span>{review.plan.units.length} review unit(s)</span>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <div className="vscode-scie-review-units">
        {review.plan.units.map((unit) => {
          const rejected = review.rejectedUnitIds.includes(unit.id);
          return (
            <div key={unit.id} className={`vscode-scie-review-unit ${rejected ? 'rejected' : ''}`}>
              <label>
                <input type="checkbox" checked={rejected} disabled={disabled} onChange={() => onToggleReject(unit.id)} />
                Reject this external change
              </label>
              <div className="vscode-scie-review-grid">
                <pre>{unit.beforeMarkdown || '(empty)'}</pre>
                <pre>{unit.afterMarkdown || '(empty)'}</pre>
              </div>
            </div>
          );
        })}
      </div>
      <footer>
        <button type="button" onClick={onApply} disabled={disabled}>Apply Review</button>
      </footer>
    </section>
  );
}

function Modal({ state, children, onClose }: { state: ModalState; children: ReactNode; onClose: () => void }) {
  const title = state?.type ?? 'Dialog';
  return (
    <div className="vscode-scie-modal-backdrop" role="presentation">
      <section className="vscode-scie-modal" role="dialog" aria-modal="true" aria-label={title}>
        <button type="button" className="vscode-scie-modal-close" onClick={onClose}>Close</button>
        {children}
      </section>
    </div>
  );
}

function NoteForm({ state, onSubmit }: { state: Extract<ModalState, { type: 'note' }>; onSubmit: (kind: EditorNoteKind, body: string) => void }) {
  const [body, setBody] = useState(state.body);
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(state.kind, body); }}>
      <h2>{state.kind === 'human' ? 'Note to Human' : 'Note to LLM'}</h2>
      <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={5} autoFocus />
      <div className="vscode-scie-dialog-actions">
        <button type="submit">Insert Note</button>
      </div>
    </form>
  );
}

function VariableForm({ state, onSubmit }: { state: Extract<ModalState, { type: 'variable' }>; onSubmit: (name: string, value: string) => void }) {
  const [name, setName] = useState(state.name);
  const [value, setValue] = useState(state.value);
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(name, value); }}>
      <h2>Variable</h2>
      <label>Name<input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></label>
      <label>Value<input value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <div className="vscode-scie-dialog-actions">
        <button type="submit">Create Variable</button>
      </div>
    </form>
  );
}

function VersionForm({ state, onSubmit }: { state: Extract<ModalState, { type: 'version' }>; onSubmit: (groupId: string) => void }) {
  const [groupId, setGroupId] = useState(state.groupId);
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(groupId); }}>
      <h2>Text Version</h2>
      <label>Group ID<input value={groupId} onChange={(event) => setGroupId(event.target.value)} autoFocus /></label>
      <div className="vscode-scie-dialog-actions">
        <button type="submit">Insert Version</button>
      </div>
    </form>
  );
}

function latestPendingEditText(pending: Map<string, string>): string | null {
  let latest: string | null = null;
  for (const value of pending.values()) latest = value;
  return latest;
}

function createEditId(): string {
  return `webview-${Date.now().toString(36)}-${randomToken(8)}`;
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
}

function readSavedWebviewState(): SavedWebviewState {
  const raw = mergeSavedWebviewState(readLocalWebviewState(), vscodeApi.getState());
  const mode = normalizeEditorMode(raw?.mode);
  const themeMode = normalizeThemeMode(raw?.themeMode);
  const visualStyle = isVisualStyleId(raw?.visualStyle) ? raw.visualStyle : 'science';
  return { mode, themeMode, visualStyle };
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

function normalizeThemeMode(value: unknown): VscodeThemeMode {
  return value === 'light' || value === 'dark' || value === 'sepia' || value === 'vscode'
    ? value
    : 'dark';
}

function useResolvedVscodeTheme(themeMode: VscodeThemeMode): 'light' | 'dark' | 'sepia' {
  const [vscodeTheme, setVscodeTheme] = useState(resolveVscodeWorkbenchTheme);

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(() => setVscodeTheme(resolveVscodeWorkbenchTheme()));
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  if (themeMode === 'vscode') return vscodeTheme;
  return themeMode;
}

function resolveVscodeWorkbenchTheme(): 'light' | 'dark' {
  const classList = document.body.classList;
  if (classList.contains('vscode-light')) return 'light';
  if (classList.contains('vscode-dark') || classList.contains('vscode-high-contrast')) return 'dark';
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
