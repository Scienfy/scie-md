import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import type { Node as ProseNode } from '@milkdown/prose/model';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import type { EditorView } from '@milkdown/prose/view';

interface FocusModeState {
  decorations: DecorationSet;
  activeBlockPos: number;
}

const focusModePluginKey = new PluginKey<FocusModeState>('scieMdFocusMode');
const MAX_FOCUS_DECORATIONS = 1000;

export const focusModePlugin = $prose(() => new Plugin({
  key: focusModePluginKey,
  state: {
    init: (_config, state) => buildFocusModeState(state.doc, state.selection.from),
    apply(transaction, previous, _oldState, newState) {
      if (!transaction.docChanged && !transaction.selectionSet) return previous;
      return buildFocusModeState(newState.doc, newState.selection.from);
    },
  },
  props: {
    decorations(state) {
      return focusModePluginKey.getState(state)?.decorations ?? DecorationSet.empty;
    },
  },
  view(view) {
    let lastSelection = view.state.selection.from;
    return {
      update(nextView) {
        const currentSelection = nextView.state.selection.from;
        if (currentSelection === lastSelection) return;
        lastSelection = currentSelection;
        maybeTypewriterScroll(nextView);
      },
    };
  },
}));

function buildFocusModeState(doc: ProseNode, selectionFrom: number): FocusModeState {
  const activeBlockPos = findTopLevelBlockPosition(doc, selectionFrom);
  const decorations: Decoration[] = [];

  doc.forEach((node, offset) => {
    if (decorations.length >= MAX_FOCUS_DECORATIONS) return;
    const from = offset;
    const to = offset + node.nodeSize;
    decorations.push(Decoration.node(from, to, {
      class: offset === activeBlockPos ? 'focus-active-block' : 'focus-dimmed-block',
    }));
  });

  return {
    decorations: DecorationSet.create(doc, decorations),
    activeBlockPos,
  };
}

function findTopLevelBlockPosition(doc: ProseNode, position: number): number {
  let currentOffset = 0;
  for (let index = 0; index < doc.childCount; index += 1) {
    const child = doc.child(index);
    const from = currentOffset;
    const to = currentOffset + child.nodeSize;
    if (position >= from && position <= to + 1) return from;
    currentOffset = to;
  }
  return 0;
}

function maybeTypewriterScroll(view: EditorView): void {
  if (!document.querySelector('.app-shell.focus-mode')) return;
  window.requestAnimationFrame(() => {
    const coords = view.coordsAtPos(view.state.selection.from);
    const scroller = nearestScrollableAncestor(view.dom);
    if (!scroller) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const target = scroller.scrollTop + coords.top - scrollerRect.top - scroller.clientHeight * 0.42;
    scroller.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  });
}

function nearestScrollableAncestor(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current) {
    const style = window.getComputedStyle(current);
    if (/(auto|scroll)/.test(`${style.overflowY}${style.overflow}`) && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
}
