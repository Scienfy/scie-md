import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import type { Node as ProseNode } from '@milkdown/prose/model';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import type { EditorView } from '@milkdown/prose/view';
import { isScieMetadataNode } from './milkdown/scieMetadataNodes';

interface BlockHandleState {
  activeIndex: number | null;
}

const blockHandlePluginKey = new PluginKey<BlockHandleState>('scienfyBlockHandle');

export const blockHandlePlugin = $prose(() => new Plugin({
  key: blockHandlePluginKey,
  state: {
    init: (): BlockHandleState => ({ activeIndex: null }),
    apply(transaction, value, oldState, newState) {
      const meta = transaction.getMeta(blockHandlePluginKey) as Partial<BlockHandleState> | undefined;
      let activeIndex = meta && 'activeIndex' in meta ? meta.activeIndex ?? null : value.activeIndex;
      if (activeIndex !== null && activeIndex >= newState.doc.childCount) {
        activeIndex = null;
      }
      if (transaction.docChanged && activeIndex !== null) {
        activeIndex = remapTopLevelIndex(oldState.doc, newState.doc, activeIndex);
      }
      return { activeIndex };
    },
  },
  props: {
    handleDOMEvents: {
      mousedown(view, event) {
        const target = event.target as HTMLElement | null;
        if (target?.closest('[data-block-handle-action]')) return false;
        const state = blockHandlePluginKey.getState(view.state);
        if (state?.activeIndex !== null) {
          view.dispatch(view.state.tr.setMeta(blockHandlePluginKey, { activeIndex: null }));
        }
        return false;
      },
      dblclick(view, event) {
        const target = event.target as HTMLElement | null;
        if (target?.closest('button, input, textarea, select, a, [data-block-handle-action]')) return false;
        const coords = { left: event.clientX, top: event.clientY };
        const position = view.posAtCoords(coords);
        if (!position) return false;
        const index = topLevelIndexAtPosition(view.state.doc, position.pos);
        if (index === null) return false;
        const node = view.state.doc.child(index);
        if (isScieMetadataNode(node)) return false;
        view.dispatch(view.state.tr.setMeta(blockHandlePluginKey, { activeIndex: index }));
        return false;
      },
      keydown(view, event) {
        if (event.key !== 'Escape') return false;
        const state = blockHandlePluginKey.getState(view.state);
        if (state?.activeIndex === null) return false;
        view.dispatch(view.state.tr.setMeta(blockHandlePluginKey, { activeIndex: null }));
        return true;
      },
    },
    decorations(state) {
      const decorations: Decoration[] = [];
      const activeIndex = blockHandlePluginKey.getState(state)?.activeIndex ?? null;
      if (activeIndex === null) return DecorationSet.empty;
      state.doc.forEach((node, offset, index) => {
        if (!node.isBlock || index !== activeIndex) return;
        if (isScieMetadataNode(node)) return;
        decorations.push(Decoration.widget(offset, (view) => createBlockHandle(view, index), {
          side: -1,
          key: `scienfy-block-handle-${index}-${offset}`,
        }));
      });
      return decorations.length > 0 ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty;
    },
  },
}));

function createBlockHandle(view: EditorView, index: number): HTMLElement {
  const handle = document.createElement('div');
  handle.className = 'block-handle';
  handle.contentEditable = 'false';
  handle.setAttribute('aria-label', `Block ${index + 1} actions`);
  handle.dataset.blockHandleAction = 'true';

  const grip = document.createElement('span');
  grip.className = 'block-handle-grip';
  grip.textContent = '::';
  grip.title = 'Block handle';

  const duplicate = document.createElement('button');
  duplicate.type = 'button';
  duplicate.textContent = '+';
  duplicate.title = 'Duplicate block';
  duplicate.setAttribute('aria-label', 'Duplicate block');
  duplicate.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    duplicateTopLevelBlock(view, index);
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = '-';
  remove.title = 'Delete block';
  remove.setAttribute('aria-label', 'Delete block');
  remove.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    deleteTopLevelBlock(view, index);
  });

  handle.addEventListener('mousedown', (event) => event.preventDefault());
  handle.append(grip, duplicate, remove);
  return handle;
}

function duplicateTopLevelBlock(view: EditorView, index: number): void {
  const doc = view.state.doc;
  const node = doc.child(index);
  if (!node) return;
  const insertPos = topLevelPositionAt(doc, index + 1);
  view.dispatch(view.state.tr.insert(insertPos, node.copy(node.content)).scrollIntoView());
  view.focus();
}

function deleteTopLevelBlock(view: EditorView, index: number): void {
  const doc = view.state.doc;
  if (doc.childCount <= 1) return;
  const from = topLevelPositionAt(doc, index);
  const to = from + doc.child(index).nodeSize;
  view.dispatch(view.state.tr.delete(from, to).scrollIntoView());
  view.focus();
}

function topLevelPositionAt(doc: ProseNode, targetIndex: number): number {
  let position = 0;
  for (let index = 0; index < targetIndex && index < doc.childCount; index += 1) {
    position += doc.child(index).nodeSize;
  }
  return position;
}

function topLevelIndexAtPosition(doc: ProseNode, position: number): number | null {
  let offset = 0;
  for (let index = 0; index < doc.childCount; index += 1) {
    const node = doc.child(index);
    const end = offset + node.nodeSize;
    if (position >= offset && position <= end) return index;
    offset = end;
  }
  return doc.childCount > 0 ? doc.childCount - 1 : null;
}

function remapTopLevelIndex(oldDoc: ProseNode, newDoc: ProseNode, activeIndex: number): number | null {
  if (activeIndex >= oldDoc.childCount) return null;
  const oldPosition = topLevelPositionAt(oldDoc, activeIndex);
  const mappedPosition = Math.min(oldPosition, newDoc.content.size);
  return topLevelIndexAtPosition(newDoc, mappedPosition);
}
