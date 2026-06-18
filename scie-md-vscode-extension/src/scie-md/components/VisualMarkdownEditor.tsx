import { useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core';
import type { Editor as MilkdownEditor } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/prose/state';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import type { EditorView } from '@milkdown/prose/view';
import { nord } from '@milkdown/theme-nord';
import { fromVisualImagePaths, toVisualImagePaths } from '../markdown/imagePaths';
import { quoteAnchorPrefix, quoteAnchorSuffix } from '../markdown/quoteAnchors';
import { getMarkdown, insert, replaceAll } from '@milkdown/kit/utils';
import type { EditorHistoryControls } from './editorControls';
import type { EditorSelectionGetter } from './editorSelection';
import { visualSourceLineForPosition } from './visualSourceMapping';
import { parseFrontmatter } from '../domain/document/frontmatter';
import { mathPreviewPlugin } from './mathPreviewPlugin';
import { createVariablePreviewPlugin } from './variablePreviewPlugin';
import { createCitationHoverPlugin } from './citationHoverPlugin';
import { blockHandlePlugin } from './blockHandlePlugin';
import { editableTailPlugin } from './editableTailPlugin';
import { focusModePlugin } from './focusModePlugin';
import { visualEditingBoundaryPlugin } from './visualEditingBoundaryPlugin';
import { flushScieMetadataNodeViews, isScieMetadataNode, scieMetadataPlugins, setScieMetadataCitationEntries, setScieMetadataDocumentPath, setScieMetadataUiCallbacks } from './milkdown/scieMetadataNodes';
import { setVisualEditorStateReader } from './visualEditorStateSync';
import '@milkdown/theme-nord/style.css';
import 'katex/dist/katex.min.css';
import { canonicalizeVariableTokens } from '../domain/variables/variableIndex';
import type { VariableDefinition } from '../domain/variables/variableIndex';
import type { BibtexEntry } from '../domain/citations/bibtex';
import type { MarkdownHeading } from '../markdown/outline';

export type VisualMarkdownInsert = (markdown: string, options?: { filePath?: string | null }) => void;
export interface VisualMarkdownJumpTarget {
  level: number;
  text: string;
  occurrence: number;
}
export type VisualMarkdownJump = (target: VisualMarkdownJumpTarget) => void;
export type VisualMarkdownFind = (query: string, occurrence: number, caseSensitive: boolean) => void;
export type VisualMarkdownSelection = EditorSelectionGetter;

interface VisualMarkdownEditorProps {
  markdown: string;
  filePath: string | null;
  onChange: (markdown: string) => void;
  onEditorReady: (editor: MilkdownEditor | undefined) => void;
  onInsertReady?: (insert: VisualMarkdownInsert | undefined) => void;
  onJumpReady?: (jump: VisualMarkdownJump | undefined) => void;
  onFindReady?: (find: VisualMarkdownFind | undefined) => void;
  onHistoryReady?: (history: EditorHistoryControls | undefined) => void;
  onSelectionTextReady?: (selection: VisualMarkdownSelection | undefined) => void;
  onCursorLineChange?: (line: number, column: number) => void;
  onViewportLineChange?: (line: number) => void;
  outlineHeadings?: MarkdownHeading[];
  onLockViolation?: (message: string) => void;
  onToast?: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  confirmText?: (state: { title: string; message: string; okLabel: string; cancelLabel: string }) => Promise<boolean>;
  referenceLabels?: string[];
  citationKeys?: string[];
  citationEntries?: BibtexEntry[];
  variableDefinitions?: VariableDefinition[];
  highlightedVariableName?: string | null;
  onEditCitation?: (key: string) => void;
  onEditVariable?: (name: string) => void;
}

function MilkdownSurface({ markdown, filePath, onChange, onEditorReady, onInsertReady, onJumpReady, onFindReady, onHistoryReady, onSelectionTextReady, onCursorLineChange, onViewportLineChange, outlineHeadings = [], onLockViolation, onToast, confirmText, citationKeys = [], citationEntries = [], variableDefinitions = [], highlightedVariableName = null, onEditCitation, onEditVariable }: VisualMarkdownEditorProps) {
  setScieMetadataDocumentPath(filePath);
  setScieMetadataCitationEntries(citationEntries);
  const initialSplit = useRef(splitVisualMarkdown(markdown));
  const citationKeysRef = useRef(citationKeys);
  const citationEntriesRef = useRef(citationEntries);
  const onEditCitationRef = useRef(onEditCitation);
  const variableDefinitionsRef = useRef(variableDefinitions);
  const highlightedVariableNameRef = useRef(highlightedVariableName);
  const onEditVariableRef = useRef(onEditVariable);
  const visualPaths = useRef(toVisualImagePaths(initialSplit.current.visualMarkdown, filePath));
  const initialMarkdown = useRef(visualPaths.current.markdown);
  const onChangeRef = useRef(onChange);
  const onCursorLineChangeRef = useRef(onCursorLineChange);
  const onViewportLineChangeRef = useRef(onViewportLineChange);
  const outlineHeadingsRef = useRef(outlineHeadings);
  const onLockViolationRef = useRef(onLockViolation);
  const editorRef = useRef<MilkdownEditor | undefined>(undefined);
  const filePathRef = useRef(filePath);
  const sourceMarkdownRef = useRef(markdown);
  const frontmatterPrefixRef = useRef(initialSplit.current.frontmatterPrefix);
  const lastEmittedMarkdown = useRef(markdown);
  const applyingExternalUpdate = useRef(false);
  const initialEmissionHandled = useRef(false);
  const visualContentMutated = useRef(false);
  const visualEditorRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onCursorLineChangeRef.current = onCursorLineChange;
  }, [onCursorLineChange]);

  useEffect(() => {
    onViewportLineChangeRef.current = onViewportLineChange;
  }, [onViewportLineChange]);

  useEffect(() => {
    outlineHeadingsRef.current = outlineHeadings;
  }, [outlineHeadings]);

  useEffect(() => {
    onLockViolationRef.current = onLockViolation;
  }, [onLockViolation]);

  useEffect(() => {
    setScieMetadataUiCallbacks({
      pushToast: onToast,
      confirmText,
    });
  }, [confirmText, onToast]);

  useEffect(() => {
    sourceMarkdownRef.current = markdown;
  }, [markdown]);

  useEffect(() => {
    filePathRef.current = filePath;
    setScieMetadataDocumentPath(filePath);
  }, [filePath]);

  useEffect(() => {
    variableDefinitionsRef.current = variableDefinitions;
    refreshVariablePreviewDecorations(editorRef.current);
  }, [variableDefinitions]);

  useEffect(() => {
    highlightedVariableNameRef.current = highlightedVariableName;
    refreshVariablePreviewDecorations(editorRef.current);
  }, [highlightedVariableName]);

  useEffect(() => {
    onEditVariableRef.current = onEditVariable;
  }, [onEditVariable]);

  useEffect(() => {
    citationKeysRef.current = citationKeys;
  }, [citationKeys]);

  useEffect(() => {
    citationEntriesRef.current = citationEntries;
    setScieMetadataCitationEntries(citationEntries);
  }, [citationEntries]);

  useEffect(() => {
    onEditCitationRef.current = onEditCitation;
  }, [onEditCitation]);

  useEffect(() => {
    const handleLockViolation = (event: Event) => {
      const custom = event as CustomEvent<{ message?: string }>;
      onLockViolationRef.current?.(custom.detail?.message ?? 'This section is locked. Unlock it before editing.');
    };
    window.addEventListener('scie-md-lock-violation', handleLockViolation);
    return () => window.removeEventListener('scie-md-lock-violation', handleLockViolation);
  }, []);

  const { loading, get } = useEditor(
    (root) =>
      Editor.make()
        .config(nord)
        .use(scieMetadataPlugins)
        .use(commonmark)
        .use(gfm)
        .use(mathPreviewPlugin)
        .use(createCitationHoverPlugin(() => citationEntriesRef.current, () => citationKeysRef.current, () => onEditCitationRef.current))
        .use(createVariablePreviewPlugin(
          () => variableDefinitionsRef.current,
          () => highlightedVariableNameRef.current,
          (name) => onEditVariableRef.current?.(name),
        ))
        .use(blockHandlePlugin)
        .use(visualEditingBoundaryPlugin)
        .use(editableTailPlugin)
        .use(focusModePlugin)
        .use(listener)
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, initialMarkdown.current);
          ctx.get(listenerCtx).markdownUpdated((listenerCtxValue, markdownValue) => {
            if (applyingExternalUpdate.current) return;
            cleanupDisplayPathMap(visualPaths.current.displayToOriginal, markdownValue);
            const restored = fromVisualImagePaths(markdownValue, visualPaths.current.displayToOriginal);
            const fullMarkdown = canonicalizeVariableTokens(`${frontmatterPrefixRef.current}${restored}`);
            if (!initialEmissionHandled.current) {
              initialEmissionHandled.current = true;
              lastEmittedMarkdown.current = sourceMarkdownRef.current;
              return;
            }
            if (!visualContentMutated.current) {
              lastEmittedMarkdown.current = sourceMarkdownRef.current;
              return;
            }
            lastEmittedMarkdown.current = fullMarkdown;
            onChangeRef.current(fullMarkdown);
          });
        }),
    [],
  );

  useEffect(() => {
    if (loading) {
      if (editorRef.current) {
        editorRef.current = undefined;
        onEditorReady(undefined);
        onInsertReady?.(undefined);
        onJumpReady?.(undefined);
        onFindReady?.(undefined);
        onHistoryReady?.(undefined);
        onSelectionTextReady?.(undefined);
      }
      return undefined;
    }

    const editor = get();
    if (editorRef.current === editor) return undefined;
    editorRef.current = editor;
    onEditorReady(editor);
    if (!editor) {
      onInsertReady?.(undefined);
      onJumpReady?.(undefined);
      onFindReady?.(undefined);
      onHistoryReady?.(undefined);
      onSelectionTextReady?.(undefined);
      return undefined;
    }

    onInsertReady?.((markdownSnippet, options) => {
      visualContentMutated.current = true;
      const visualMarkdown = markdownSnippet;
      const nextVisualPaths = toVisualImagePaths(visualMarkdown, options?.filePath ?? filePathRef.current);
      for (const [displayUrl, originalUrl] of nextVisualPaths.displayToOriginal.entries()) {
        visualPaths.current.displayToOriginal.set(displayUrl, originalUrl);
      }
      editor.action(insert(nextVisualPaths.markdown));
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        appendWritableTailIfNeeded(view);
        view.focus();
      });
    });
    onJumpReady?.((target) => {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const position = findHeadingPosition(view.state.doc, target);
        if (position === null) return;
        const selection = TextSelection.near(view.state.doc.resolve(Math.min(position + 1, view.state.doc.content.size)));
        view.dispatch(view.state.tr.setSelection(selection));
        view.focus();
        scrollEditorPositionToTop(view, position);
      });
    });
    onFindReady?.((query, occurrence, caseSensitive) => {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const match = findTextMatchPosition(view.state.doc, query, occurrence, caseSensitive);
        if (!match) return;
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, match.from, match.to)));
        view.focus();
        scrollEditorPositionToCenter(view, match.from);
      });
    });
    onHistoryReady?.(undefined);
    onSelectionTextReady?.(() => {
      let selectedText = '';
      let line: number | undefined;
      let endLine: number | undefined;
      let from: number | undefined;
      let to: number | undefined;
      let prefix: string | undefined;
      let suffix: string | undefined;
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const selection = view.state.selection;
        const slice = view.state.selection.content();
        selectedText = restoreSelectedVisualMarkdown(slice.content.textBetween(0, slice.content.size, '\n'), visualPaths.current.displayToOriginal);
        line = visualSourceLineForPosition(view.state.doc, selection.from, sourceMarkdownRef.current)
          ?? visualLineForPosition(view, selection.from, frontmatterPrefixRef.current);
        const selectionEndPosition = Math.max(selection.from, selection.to - 1);
        endLine = visualSourceLineForPosition(view.state.doc, selectionEndPosition, sourceMarkdownRef.current)
          ?? visualLineForPosition(view, selectionEndPosition, frontmatterPrefixRef.current);
        from = selection.from;
        to = selection.to;
        const beforeText = restoreSelectedVisualMarkdown(view.state.doc.textBetween(0, selection.from, '\n', '\n'), visualPaths.current.displayToOriginal);
        const afterText = restoreSelectedVisualMarkdown(view.state.doc.textBetween(selection.to, view.state.doc.content.size, '\n', '\n'), visualPaths.current.displayToOriginal);
        prefix = quoteAnchorPrefix(beforeText);
        suffix = quoteAnchorSuffix(afterText);
      });
      return {
        text: selectedText || restoreSelectedVisualMarkdown(window.getSelection()?.toString() ?? '', visualPaths.current.displayToOriginal),
        line,
        endLine,
        from,
        to,
        prefix,
        suffix,
        surface: 'visual',
      };
    });
    let disposeCursorListeners: (() => void) | undefined;
    let disposeViewportListeners: (() => void) | undefined;
    if (onCursorLineChangeRef.current) {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const emitCursorLocation = () => {
          const textBefore = view.state.doc.textBetween(0, view.state.selection.from, '\n', '\n');
          const lines = textBefore.split('\n');
          const line = visualLineForPosition(view, view.state.selection.from, frontmatterPrefixRef.current);
          const column = (lines.at(-1) ?? '').length + 1;
          onCursorLineChangeRef.current?.(line, column);
        };
        view.dom.addEventListener('keyup', emitCursorLocation);
        view.dom.addEventListener('mouseup', emitCursorLocation);
        view.dom.addEventListener('focus', emitCursorLocation);
        emitCursorLocation();
        disposeCursorListeners = () => {
          view.dom.removeEventListener('keyup', emitCursorLocation);
          view.dom.removeEventListener('mouseup', emitCursorLocation);
          view.dom.removeEventListener('focus', emitCursorLocation);
        };
      });
    }
    if (onViewportLineChangeRef.current) {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const scroller = findScrollContainer(view.dom);
        const scrollTarget = scroller instanceof Window ? window : scroller;
        let animationFrame: number | null = null;
        let lastViewportLine = 0;
        const emitViewportLocation = () => {
          animationFrame = null;
          const line = visualViewportTopLine(view, outlineHeadingsRef.current, scroller);
          if (line === null || line === lastViewportLine) return;
          lastViewportLine = line;
          onViewportLineChangeRef.current?.(line);
        };
        const scheduleViewportLocation = () => {
          if (animationFrame !== null) return;
          animationFrame = window.requestAnimationFrame(emitViewportLocation);
        };
        scrollTarget.addEventListener('scroll', scheduleViewportLocation, { passive: true });
        window.addEventListener('resize', scheduleViewportLocation);
        scheduleViewportLocation();
        disposeViewportListeners = () => {
          scrollTarget.removeEventListener('scroll', scheduleViewportLocation);
          window.removeEventListener('resize', scheduleViewportLocation);
          if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
        };
      });
    }
    let disposeMutationListeners: (() => void) | undefined;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const markMutation = () => {
        visualContentMutated.current = true;
      };
      const markKeyMutation = (event: KeyboardEvent) => {
        if (
          event.key.length === 1
          || event.key === 'Backspace'
          || event.key === 'Delete'
          || event.key === 'Enter'
          || event.key === 'Tab'
        ) {
          visualContentMutated.current = true;
        }
      };
      view.dom.addEventListener('beforeinput', markMutation);
      view.dom.addEventListener('paste', markMutation);
      view.dom.addEventListener('drop', markMutation);
      view.dom.addEventListener('keydown', markKeyMutation);
      disposeMutationListeners = () => {
        view.dom.removeEventListener('beforeinput', markMutation);
        view.dom.removeEventListener('paste', markMutation);
        view.dom.removeEventListener('drop', markMutation);
        view.dom.removeEventListener('keydown', markKeyMutation);
      };
    });
    editor.action((ctx) => {
      appendWritableTailIfNeeded(ctx.get(editorViewCtx));
    });
    let idleSyncHandle: number | null = null;
    let timeoutSyncHandle: ReturnType<typeof setTimeout> | null = null;
    const readFullMarkdownFromEditor = (): string | null => {
      const currentEditor = editorRef.current;
      if (
        !currentEditor
        || applyingExternalUpdate.current
      ) return null;
      try {
        flushScieMetadataNodeViews();
        const markdownValue = currentEditor.action(getMarkdown());
        cleanupDisplayPathMap(visualPaths.current.displayToOriginal, markdownValue);
        const restored = fromVisualImagePaths(markdownValue, visualPaths.current.displayToOriginal);
        return canonicalizeVariableTokens(`${frontmatterPrefixRef.current}${restored}`);
      } catch (error) {
        console.warn('Could not read visual editor state.', error);
        return null;
      }
    };
    const synchronizeEditorState = (force = false) => {
      idleSyncHandle = null;
      timeoutSyncHandle = null;
      if (!force && (document.visibilityState === 'hidden' || !document.hasFocus())) return;
      if (!visualContentMutated.current) return;
      const fullMarkdown = readFullMarkdownFromEditor();
      if (fullMarkdown === null || equivalentVisualMarkdown(fullMarkdown, lastEmittedMarkdown.current)) return;
      try {
        console.warn('Visual editor state diverged from React markdown state; synchronizing from editor state.');
        lastEmittedMarkdown.current = fullMarkdown;
        onChangeRef.current(fullMarkdown);
      } catch (error) {
        console.warn('Could not validate visual editor state synchronization.', error);
      }
    };
    setVisualEditorStateReader(() => {
      if (!visualContentMutated.current) return sourceMarkdownRef.current;
      const fullMarkdown = readFullMarkdownFromEditor();
      if (fullMarkdown === null) return null;
      if (!equivalentVisualMarkdown(fullMarkdown, lastEmittedMarkdown.current)) {
        lastEmittedMarkdown.current = fullMarkdown;
        onChangeRef.current(fullMarkdown);
      }
      return fullMarkdown;
    });
    const scheduleStateSynchronization = () => {
      if (idleSyncHandle !== null || timeoutSyncHandle !== null || document.visibilityState === 'hidden' || !document.hasFocus()) return;
      if ('requestIdleCallback' in window) {
        idleSyncHandle = window.requestIdleCallback(() => synchronizeEditorState(), { timeout: 1000 });
      } else {
        timeoutSyncHandle = setTimeout(() => synchronizeEditorState(), 0);
      }
    };
    const handleVisibilityOrFocus = () => scheduleStateSynchronization();
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      if (idleSyncHandle !== null) {
        if ('cancelIdleCallback' in window) window.cancelIdleCallback(idleSyncHandle);
        else globalThis.clearTimeout(idleSyncHandle);
      }
      if (timeoutSyncHandle !== null) clearTimeout(timeoutSyncHandle);
      synchronizeEditorState(true);
      setVisualEditorStateReader(null);
      if (editorRef.current === editor) {
        editorRef.current = undefined;
        onEditorReady(undefined);
        onInsertReady?.(undefined);
        onJumpReady?.(undefined);
        onFindReady?.(undefined);
        onHistoryReady?.(undefined);
        onSelectionTextReady?.(undefined);
        disposeCursorListeners?.();
        disposeViewportListeners?.();
        disposeMutationListeners?.();
      }
    };
  }, [loading, onEditorReady, onInsertReady, onJumpReady, onFindReady, onHistoryReady, onSelectionTextReady]);

  useEffect(() => {
    const editor = editorRef.current;
    if (loading || !editor || markdown === lastEmittedMarkdown.current) return;

    const split = splitVisualMarkdown(markdown);
    initialEmissionHandled.current = true;
    visualContentMutated.current = false;
    frontmatterPrefixRef.current = split.frontmatterPrefix;
    const nextVisualPaths = toVisualImagePaths(split.visualMarkdown, filePath);
    visualPaths.current = nextVisualPaths;
    applyingExternalUpdate.current = true;
    editor.action(replaceAll(nextVisualPaths.markdown, true));
    queueMicrotask(() => {
      applyingExternalUpdate.current = false;
      lastEmittedMarkdown.current = markdown;
    });
  }, [filePath, loading, markdown]);

  const handleVisualEditorMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const clickedWritableSurface = target === event.currentTarget;
    if (!clickedWritableSurface) return;
    event.preventDefault();
    editorRef.current?.action((ctx) => {
      focusAtWritableEnd(ctx.get(editorViewCtx), true);
    });
  };

  return (
    <div ref={visualEditorRootRef} className="visual-editor" spellCheck={false} onMouseDown={handleVisualEditorMouseDown}>
      <Milkdown />
    </div>
  );
}

function cleanupDisplayPathMap(displayToOriginal: Map<string, string>, visualMarkdown: string): void {
  if (displayToOriginal.size === 0) return;
  for (const displayUrl of Array.from(displayToOriginal.keys())) {
    if (!visualMarkdown.includes(displayUrl)) {
      displayToOriginal.delete(displayUrl);
    }
  }
}

function restoreSelectedVisualMarkdown(
  selectedText: string,
  displayToOriginal: Map<string, string>,
): string {
  if (!selectedText.trim()) return '';
  return fromVisualImagePaths(selectedText, displayToOriginal).trim();
}

function visualLineForPosition(view: EditorView, position: number, frontmatterPrefix: string): number {
  const safePosition = Math.max(0, Math.min(position, view.state.doc.content.size));
  const textBefore = view.state.doc.textBetween(0, safePosition, '\n', '\n');
  const frontmatterLineOffset = frontmatterPrefix
    ? frontmatterPrefix.split('\n').length - 1
    : 0;
  return frontmatterLineOffset + textBefore.split('\n').length;
}

function splitVisualMarkdown(markdown: string): { visualMarkdown: string; frontmatterPrefix: string } {
  const frontmatter = parseFrontmatter(markdown);
  if (!frontmatter.hasFrontmatter || frontmatter.error) {
    return { visualMarkdown: markdown, frontmatterPrefix: '' };
  }
  return {
    visualMarkdown: frontmatter.body,
    frontmatterPrefix: `${frontmatter.openingFence || '---'}\n${frontmatter.raw}\n${frontmatter.closingFence || '---'}\n`,
  };
}

export function equivalentVisualMarkdown(left: string, right: string): boolean {
  return normalizeVisualMarkdownEmission(left) === normalizeVisualMarkdownEmission(right);
}

function normalizeVisualMarkdownEmission(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n+$/g, '\n');
}

function refreshVariablePreviewDecorations(editor: MilkdownEditor | undefined): void {
  editor?.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.setMeta('scie-md-variable-preview-refresh', true));
  });
}

function findHeadingPosition(doc: { descendants: (callback: (node: { type: { name: string }; attrs?: { level?: number }; textContent: string }, pos: number) => boolean | void) => void; content: { size: number } }, target: VisualMarkdownJumpTarget): number | null {
  let seen = 0;
  let found: number | null = null;
  const targetText = normalizeHeadingText(target.text);

  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name !== 'heading' || node.attrs?.level !== target.level) return true;
    if (normalizeHeadingText(node.textContent) !== targetText) return false;
    if (seen === target.occurrence) {
      found = pos;
      return false;
    }
    seen += 1;
    return false;
  });

  return found;
}

function findTextMatchPosition(
  doc: {
    descendants: (callback: (node: { type: { name: string }; text?: string; textContent: string }, pos: number) => boolean | void) => void;
  },
  query: string,
  occurrence: number,
  caseSensitive: boolean,
): { from: number; to: number } | null {
  if (!query) return null;
  const needle = caseSensitive ? query : query.toLowerCase();
  let seen = 0;
  let found: { from: number; to: number } | null = null;

  doc.descendants((node, pos) => {
    if (found) return false;
    const text = node.type.name === 'text' ? node.text ?? node.textContent : '';
    if (!text) return true;
    const haystack = caseSensitive ? text : text.toLowerCase();
    let index = haystack.indexOf(needle);
    while (index >= 0) {
      if (seen === occurrence) {
        found = { from: pos + index, to: pos + index + query.length };
        return false;
      }
      seen += 1;
      index = haystack.indexOf(needle, index + Math.max(1, needle.length));
    }
    return true;
  });

  return found;
}

function scrollEditorPositionToTop(view: EditorView, position: number): void {
  scrollEditorPosition(view, position, 18);
}

function scrollEditorPositionToCenter(view: EditorView, position: number): void {
  const scroller = findScrollContainer(view.dom);
  const height = scroller instanceof Window
    ? window.innerHeight
    : scroller.clientHeight;
  scrollEditorPosition(view, position, Math.max(24, height * 0.42));
}

function scrollEditorPosition(view: EditorView, position: number, topOffset: number): void {
  window.requestAnimationFrame(() => {
    const coords = view.coordsAtPos(Math.max(0, Math.min(position, view.state.doc.content.size)));
    if (!coords) return;
    const scroller = findScrollContainer(view.dom);
    if (scroller instanceof Window) {
      window.scrollTo({ top: Math.max(0, window.scrollY + coords.top - topOffset), behavior: 'smooth' });
      return;
    }
    const scrollerRect = scroller.getBoundingClientRect();
    scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + coords.top - scrollerRect.top - topOffset), behavior: 'smooth' });
  });
}

function visualViewportTopLine(view: EditorView, headings: MarkdownHeading[], scroller: HTMLElement | Window): number | null {
  if (headings.length === 0) return 1;
  const headingElements = Array.from(view.dom.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'))
    .filter((element) => !element.closest('.scie-md-visual-atom'));
  if (headingElements.length === 0) return headings[0]?.line ?? 1;

  const lineByElement = mapVisualHeadingElementsToLines(headingElements, headings);
  const viewportTop = scroller instanceof Window ? 0 : scroller.getBoundingClientRect().top;
  const activationY = viewportTop + 96;
  let activeLine: number | null = null;
  let nextLine: number | null = null;

  for (const element of headingElements) {
    const line = lineByElement.get(element);
    if (!line) continue;
    const top = element.getBoundingClientRect().top;
    if (top <= activationY) {
      activeLine = line;
    } else {
      nextLine = line;
      break;
    }
  }

  return activeLine ?? nextLine ?? headings[0]?.line ?? 1;
}

function mapVisualHeadingElementsToLines(elements: HTMLElement[], headings: MarkdownHeading[]): Map<HTMLElement, number> {
  const headingsByKey = new Map<string, MarkdownHeading[]>();
  for (const heading of headings) {
    const key = headingKey(heading.level, heading.text);
    const list = headingsByKey.get(key) ?? [];
    list.push(heading);
    headingsByKey.set(key, list);
  }

  const occurrenceByKey = new Map<string, number>();
  const lineByElement = new Map<HTMLElement, number>();
  for (const element of elements) {
    const level = Number(element.tagName.slice(1));
    const key = headingKey(level, element.textContent ?? '');
    const occurrence = occurrenceByKey.get(key) ?? 0;
    occurrenceByKey.set(key, occurrence + 1);
    const heading = headingsByKey.get(key)?.[occurrence];
    if (heading) lineByElement.set(element, heading.line);
  }
  return lineByElement;
}

function headingKey(level: number, text: string): string {
  return `${level}:${normalizeHeadingText(text).toLowerCase()}`;
}

function findScrollContainer(element: HTMLElement): HTMLElement | Window {
  let current: HTMLElement | null = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    const scrollable = /(auto|scroll|overlay)/.test(style.overflowY);
    if (scrollable && current.scrollHeight > current.clientHeight) return current;
    current = current.parentElement;
  }
  return window;
}

function normalizeHeadingText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function focusAtWritableEnd(view: EditorView, scrollIntoView: boolean): void {
  appendWritableTailIfNeeded(view);
  const nextState = view.state;
  let transaction = nextState.tr;
  const lastChild = nextState.doc.childCount > 0 ? nextState.doc.child(nextState.doc.childCount - 1) : null;
  let selectionPosition = Math.max(0, nextState.doc.content.size);

  if (lastChild?.type.name === 'paragraph' && lastChild.content.size === 0) {
    selectionPosition = Math.max(1, nextState.doc.content.size - 1);
  }

  const resolvedPosition = transaction.doc.resolve(Math.min(selectionPosition, transaction.doc.content.size));
  transaction = transaction.setSelection(TextSelection.near(resolvedPosition, -1));
  if (scrollIntoView) transaction = transaction.scrollIntoView();
  view.dispatch(transaction);
  view.focus();
}

function appendWritableTailIfNeeded(view: EditorView): void {
  const { state } = view;
  const paragraph = state.schema.nodes.paragraph;
  const lastChild = state.doc.childCount > 0 ? state.doc.child(state.doc.childCount - 1) : null;
  if (!paragraph || !lastChild || !isScieMetadataNode(lastChild)) return;
  view.dispatch(state.tr.insert(state.doc.content.size, paragraph.create()));
}

export function VisualMarkdownEditor(props: VisualMarkdownEditorProps) {
  return (
    <MilkdownProvider>
      <MilkdownSurface {...props} />
    </MilkdownProvider>
  );
}
