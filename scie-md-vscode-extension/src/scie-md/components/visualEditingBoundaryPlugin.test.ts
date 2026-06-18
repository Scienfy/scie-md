import { describe, expect, it } from 'vitest';
import type { Node as ProseNode } from '@milkdown/prose/model';
import { isEditableVisualAtomName, visualInsertionBoundaryPositions } from './visualEditingBoundaryPlugin';

describe('visualEditingBoundaryPlugin helpers', () => {
  it('marks only rendered visual atoms as editable atom boundaries', () => {
    expect(isEditableVisualAtomName('scie_directive_block')).toBe(true);
    expect(isEditableVisualAtomName('scie_comment')).toBe(true);
    expect(isEditableVisualAtomName('scie_lock_anchor')).toBe(true);
    expect(isEditableVisualAtomName('scie_variant_group')).toBe(true);
    expect(isEditableVisualAtomName('scie_lock_start')).toBe(false);
    expect(isEditableVisualAtomName('paragraph')).toBe(false);
  });

  it('adds insertion affordances only between adjacent visual atoms', () => {
    const doc = fakeDoc([
      ['paragraph', 4],
      ['scie_directive_block', 1],
      ['scie_comment', 1],
      ['paragraph', 2],
      ['scie_svg_block', 1],
      ['scie_mermaid_block', 1],
    ]);

    expect(visualInsertionBoundaryPositions(doc)).toEqual([5, 9]);
  });

  it('does not add insertion affordances around lock boundaries', () => {
    const doc = fakeDoc([
      ['scie_lock_start', 1],
      ['scie_directive_block', 1],
      ['scie_lock_end', 1],
    ]);

    expect(visualInsertionBoundaryPositions(doc)).toEqual([]);
  });
});

function fakeDoc(nodes: Array<[typeName: string, nodeSize: number]>): ProseNode {
  return {
    forEach(callback: (node: ProseNode, offset: number, index: number) => void) {
      let offset = 0;
      nodes.forEach(([typeName, nodeSize], index) => {
        callback(fakeNode(typeName, nodeSize), offset, index);
        offset += nodeSize;
      });
    },
  } as unknown as ProseNode;
}

function fakeNode(typeName: string, nodeSize: number): ProseNode {
  return {
    type: { name: typeName },
    nodeSize,
  } as unknown as ProseNode;
}
