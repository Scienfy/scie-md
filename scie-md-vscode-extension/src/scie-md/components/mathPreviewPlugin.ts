import katex from 'katex';
import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import type { Node as ProseNode } from '@milkdown/prose/model';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import type { EditorView } from '@milkdown/prose/view';
import { findBlockMathRange, findInlineMathRanges } from '../markdown/mathPreview';
import { setSanitizedHtml } from '../services/htmlSanitizer';

const mathPreviewPluginKey = new PluginKey<DecorationSet>('scie-md-math-preview');
interface MathRenderResult {
  html: string | null;
  error?: string;
}

const mathRenderCache = new Map<string, MathRenderResult>();
const pendingMathRenders = new Map<string, Array<(result: MathRenderResult) => void>>();
const MAX_MATH_RENDER_CACHE_SIZE = 500;
const MAX_MATH_DECORATIONS = 500;

export const mathPreviewPlugin = $prose(() => new Plugin({
  key: mathPreviewPluginKey,
  state: {
    init(_config, state) {
      return createMathDecorations(state.doc);
    },
    apply(transaction, decorations, oldState, newState) {
      if (!transaction.docChanged) return decorations.map(transaction.mapping, transaction.doc);
      if (!transactionCouldAffectMath(transaction, oldState.doc, newState.doc)) {
        return decorations.map(transaction.mapping, transaction.doc);
      }
      return createMathDecorations(newState.doc);
    },
  },
  props: {
    decorations(state) {
      return mathPreviewPluginKey.getState(state) ?? DecorationSet.empty;
    },
  },
}));

function createMathDecorations(doc: ProseNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, position, parent) => {
    if (decorations.length >= MAX_MATH_DECORATIONS) return false;
    if (node.type.name === 'code_block') return false;

    if (node.isTextblock) {
      const blockRange = findBlockMathRange(node.textContent, position + 1);
      if (blockRange) {
        if (decorations.length > MAX_MATH_DECORATIONS - 2) return false;
        decorations.push(Decoration.inline(blockRange.from, blockRange.to, { class: 'math-source-hidden' }));
        decorations.push(Decoration.widget(blockRange.from, (view) => createMathElement(blockRange.content, true, (nextContent) => {
          replaceMathSource(view, blockRange.from, blockRange.to, nextContent, true);
        }), { side: -1, key: mathWidgetKey('block', blockRange.from, blockRange.to, blockRange.content) }));
        return false;
      }
    }

    if (node.isText && parent?.type.name !== 'code_block') {
      for (const range of findInlineMathRanges(node.text ?? '', position)) {
        if (decorations.length > MAX_MATH_DECORATIONS - 2) break;
        decorations.push(Decoration.inline(range.from, range.to, { class: 'math-source-hidden' }));
        decorations.push(Decoration.widget(range.from, (view) => createMathElement(range.content, false, (nextContent) => {
          replaceMathSource(view, range.from, range.to, nextContent, false);
        }), { side: -1, key: mathWidgetKey('inline', range.from, range.to, range.content) }));
      }
    }

    return true;
  });

  return DecorationSet.create(doc, decorations);
}

function mathWidgetKey(kind: 'inline' | 'block', from: number, to: number, content: string): string {
  return `math-${kind}-${from}-${to}-${stableStringHash(content)}`;
}

function stableStringHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createMathElement(content: string, displayMode: boolean, applyEdit: (content: string) => void): HTMLElement {
  const element = document.createElement(displayMode ? 'div' : 'span');
  element.className = displayMode ? 'math-preview math-preview-block' : 'math-preview math-preview-inline';
  element.dataset.mathSource = content;
  element.contentEditable = 'false';

  const rendered = document.createElement(displayMode ? 'div' : 'span');
  rendered.className = 'math-preview-rendered';

  const applyRenderResult = (result: MathRenderResult) => {
    rendered.replaceChildren();
    element.classList.toggle('math-preview-pending', false);
    if (result.html) {
      element.classList.remove('math-preview-error');
      setSanitizedHtml(rendered, result.html);
      return;
    }
    element.classList.add('math-preview-error');
    rendered.textContent = content;
    const badge = document.createElement('span');
    badge.className = 'render-error-badge';
    badge.textContent = 'Math error';
    badge.title = result.error || 'KaTeX could not render this equation.';
    rendered.append(document.createTextNode(' '), badge);
  };

  const cached = getCachedMathRender(content, displayMode);
  if (cached) {
    applyRenderResult(cached);
  } else {
    element.classList.add('math-preview-pending');
    rendered.textContent = displayMode ? 'Rendering equation...' : '...';
    scheduleMathRender(content, displayMode, (result) => {
      if (element.isConnected) applyRenderResult(result);
    });
  }

  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.className = 'math-edit-button';
  editButton.textContent = 'Edit';
  editButton.setAttribute('aria-label', displayMode ? 'Edit block math' : 'Edit inline math');

  const editor = document.createElement(displayMode ? 'textarea' : 'input');
  editor.className = 'math-edit-input';
  if (editor instanceof HTMLTextAreaElement) {
    editor.rows = Math.min(8, Math.max(3, content.split(/\r?\n/).length + 1));
    editor.value = content;
  } else {
    editor.value = content;
  }
  editor.setAttribute('aria-label', displayMode ? 'Block math source' : 'Inline math source');
  editor.hidden = true;

  const apply = () => {
    const value = editor instanceof HTMLTextAreaElement ? editor.value : editor.value;
    applyEdit(value.trim());
  };

  editButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    editor.hidden = !editor.hidden;
    if (!editor.hidden) editor.focus();
  });
  editor.addEventListener('keydown', (event) => {
    const keyboardEvent = event as KeyboardEvent;
    event.stopPropagation();
    if ((keyboardEvent.ctrlKey || keyboardEvent.metaKey) && keyboardEvent.key === 'Enter') {
      event.preventDefault();
      apply();
    }
    if (keyboardEvent.key === 'Escape') {
      event.preventDefault();
      editor.hidden = true;
    }
  });
  editor.addEventListener('blur', () => {
    if (!editor.hidden) apply();
  });
  editor.addEventListener('mousedown', (event) => event.stopPropagation());
  editor.addEventListener('click', (event) => event.stopPropagation());

  element.append(rendered, editButton, editor);
  return element;
}

function replaceMathSource(view: EditorView, from: number, to: number, content: string, displayMode: boolean): void {
  if (!content) return;
  const nextSource = displayMode ? `$$\n${content}\n$$` : `$${content}$`;
  view.dispatch(view.state.tr.insertText(nextSource, from, to).scrollIntoView());
  view.focus();
}

function getCachedMathRender(content: string, displayMode: boolean): MathRenderResult | null {
  return mathRenderCache.get(mathRenderKey(content, displayMode)) ?? null;
}

function scheduleMathRender(
  content: string,
  displayMode: boolean,
  callback: (result: MathRenderResult) => void,
): void {
  const key = mathRenderKey(content, displayMode);
  const cached = mathRenderCache.get(key);
  if (cached) {
    callback(cached);
    return;
  }
  const pending = pendingMathRenders.get(key);
  if (pending) {
    pending.push(callback);
    return;
  }
  pendingMathRenders.set(key, [callback]);
  const run = () => {
    const result = renderMathHtml(content, displayMode);
    const callbacks = pendingMathRenders.get(key) ?? [];
    pendingMathRenders.delete(key);
    for (const queuedCallback of callbacks) queuedCallback(result);
  };
  const maybeWindow = typeof window === 'undefined' ? null : window as Window & {
    requestIdleCallback?: (handler: () => void, options?: { timeout?: number }) => number;
  };
  if (maybeWindow?.requestIdleCallback) {
    maybeWindow.requestIdleCallback(run, { timeout: 200 });
  } else {
    setTimeout(run, 0);
  }
}

function renderMathHtml(content: string, displayMode: boolean): MathRenderResult {
  const key = mathRenderKey(content, displayMode);
  try {
    const html = katex.renderToString(content, {
      displayMode,
      output: 'htmlAndMathml',
      strict: 'warn',
      throwOnError: true,
      trust: false,
    });
    const result = { html };
    mathRenderCache.set(key, result);
    if (mathRenderCache.size > MAX_MATH_RENDER_CACHE_SIZE) {
      const oldest = mathRenderCache.keys().next().value;
      if (oldest) mathRenderCache.delete(oldest);
    }
    return result;
  } catch (error) {
    const result = { html: null, error: error instanceof Error ? error.message : 'KaTeX could not render this equation.' };
    mathRenderCache.set(key, result);
    return result;
  }
}

function mathRenderKey(content: string, displayMode: boolean): string {
  return `${displayMode ? 'block' : 'inline'}:${content}`;
}

function transactionCouldAffectMath(
  transaction: { mapping: { maps: readonly { forEach: (callback: (oldStart: number, oldEnd: number, newStart: number, newEnd: number) => void) => void }[] } },
  oldDoc: ProseNode,
  newDoc: ProseNode,
): boolean {
  let couldAffect = false;
  for (const map of transaction.mapping.maps) {
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      if (couldAffect) return;
      couldAffect = textAroundChange(oldDoc, oldStart, oldEnd, 2).includes('$')
        || textAroundChange(newDoc, newStart, newEnd, 2).includes('$');
    });
    if (couldAffect) break;
  }
  return couldAffect;
}

function textAroundChange(doc: ProseNode, fromPosition: number, toPosition: number, padding: number): string {
  const from = Math.max(0, fromPosition - padding);
  const to = Math.min(doc.content.size, Math.max(toPosition, fromPosition) + padding);
  return doc.textBetween(from, to, '\n', '\n');
}
