import { $prose } from '@milkdown/kit/utils';
import { Plugin } from '@milkdown/prose/state';
import type { Node as ProseNode } from '@milkdown/prose/model';
import { isScieMetadataNode } from './milkdown/scieMetadataNodes';

export const editableTailPlugin = $prose(() => new Plugin({
  appendTransaction(transactions, _oldState, newState) {
    if (!transactions.some((transaction) => transaction.docChanged)) return null;
    if (!documentNeedsEditableTail(newState.doc)) return null;
    const paragraph = newState.schema.nodes.paragraph;
    if (!paragraph) return null;
    return newState.tr.insert(newState.doc.content.size, paragraph.create());
  },
}));

export function documentNeedsEditableTail(doc: ProseNode): boolean {
  if (doc.childCount === 0) return false;
  const lastChild = doc.child(doc.childCount - 1);
  return isScieMetadataNode(lastChild);
}
