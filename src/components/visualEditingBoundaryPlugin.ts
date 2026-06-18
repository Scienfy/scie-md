import { $prose } from '@milkdown/kit/utils';
import type { Node as ProseNode } from '@milkdown/prose/model';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import type { EditorView } from '@milkdown/prose/view';

const visualEditingBoundaryPluginKey = new PluginKey('scienfyVisualEditingBoundary');

const editableAtomNames = new Set([
  'scie_comment',
  'scie_lock_anchor',
  'scie_instruction',
  'scie_variant_group',
  'scie_directive_block',
  'scie_mermaid_block',
  'scie_svg_block',
]);

export const visualEditingBoundaryPlugin = $prose(() => new Plugin({
  key: visualEditingBoundaryPluginKey,
  props: {
    handleKeyDown(view, event) {
      return handleVisualBoundaryKeyDown(view, event);
    },
    decorations(state) {
      const decorations = visualInsertionBoundaryPositions(state.doc)
        .map((position) => Decoration.widget(position, (view) => createInsertionGap(view, position), {
          key: `scienfy-visual-insertion-gap-${position}`,
          side: -1,
        }));
      return decorations.length > 0 ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty;
    },
  },
}));

export function isEditableVisualAtomName(typeName: string): boolean {
  return editableAtomNames.has(typeName);
}

export function visualInsertionBoundaryPositions(doc: ProseNode): number[] {
  const positions: number[] = [];
  let previous: ProseNode | null = null;
  doc.forEach((node, offset) => {
    if (previous && isEditableVisualAtomName(previous.type.name) && isEditableVisualAtomName(node.type.name)) {
      positions.push(offset);
    }
    previous = node;
  });
  return positions;
}

function handleVisualBoundaryKeyDown(view: EditorView, event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false;
  const { state } = view;
  const { selection } = state;

  if (selection instanceof NodeSelection && isEditableVisualAtomName(selection.node.type.name)) {
    if (event.key === 'Enter') {
      event.preventDefault();
      insertParagraphAt(view, event.shiftKey ? selection.from : selection.to);
      return true;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      deleteSelectedVisualAtom(view);
      return true;
    }
  }

  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const paragraphRange = topLevelEmptyParagraphRange(state.doc, selection.from);
  if (!paragraphRange) return false;

  if (event.key === 'Backspace') {
    const previous = topLevelNodeBefore(state.doc, paragraphRange.from);
    if (!previous || !isEditableVisualAtomName(previous.node.type.name)) return false;
    event.preventDefault();
    view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, previous.from)));
    view.focus();
    return true;
  }

  if (event.key === 'Delete') {
    const next = topLevelNodeAfter(state.doc, paragraphRange.to);
    if (!next || !isEditableVisualAtomName(next.node.type.name)) return false;
    event.preventDefault();
    view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, next.from)));
    view.focus();
    return true;
  }

  return false;
}

function createInsertionGap(view: EditorView, position: number): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'visual-insertion-gap';
  wrapper.contentEditable = 'false';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'visual-insertion-gap-button';
  button.textContent = 'Add text here';
  button.title = 'Insert a paragraph between these visual blocks';
  button.setAttribute('aria-label', button.title);
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    insertParagraphAt(view, position);
  });

  wrapper.append(button);
  return wrapper;
}

function insertParagraphAt(view: EditorView, position: number): void {
  const paragraph = view.state.schema.nodes.paragraph;
  if (!paragraph) return;
  let transaction = view.state.tr.insert(position, paragraph.create());
  const textPosition = Math.min(position + 1, transaction.doc.content.size);
  transaction = transaction.setSelection(TextSelection.create(transaction.doc, textPosition));
  view.dispatch(transaction.scrollIntoView());
  view.focus();
}

function deleteSelectedVisualAtom(view: EditorView): void {
  const selection = view.state.selection;
  if (!(selection instanceof NodeSelection)) return;
  const paragraph = view.state.schema.nodes.paragraph;
  let transaction = view.state.tr.delete(selection.from, selection.to);
  if (transaction.doc.childCount === 0 && paragraph) {
    transaction = transaction.insert(0, paragraph.create());
  }
  const selectionPosition = Math.min(selection.from + 1, transaction.doc.content.size);
  transaction = transaction.setSelection(TextSelection.near(transaction.doc.resolve(selectionPosition), -1));
  view.dispatch(transaction.scrollIntoView());
  view.focus();
}

interface TopLevelNodeRange {
  node: ProseNode;
  from: number;
  to: number;
}

function topLevelEmptyParagraphRange(doc: ProseNode, position: number): TopLevelNodeRange | null {
  let found: TopLevelNodeRange | null = null;
  doc.forEach((node, offset) => {
    if (found) return;
    const from = offset;
    const to = offset + node.nodeSize;
    if (position <= from || position >= to) return;
    if (node.type.name === 'paragraph' && node.content.size === 0) {
      found = { node, from, to };
    }
  });
  return found;
}

function topLevelNodeBefore(doc: ProseNode, position: number): TopLevelNodeRange | null {
  let previous: TopLevelNodeRange | null = null;
  doc.forEach((node, offset) => {
    if (offset >= position) return;
    previous = { node, from: offset, to: offset + node.nodeSize };
  });
  return previous;
}

function topLevelNodeAfter(doc: ProseNode, position: number): TopLevelNodeRange | null {
  let found: TopLevelNodeRange | null = null;
  doc.forEach((node, offset) => {
    if (found || offset < position) return;
    found = { node, from: offset, to: offset + node.nodeSize };
  });
  return found;
}
