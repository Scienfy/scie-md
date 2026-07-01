import {
  structuredSourceRevealTargetForNode,
  type StructuredNodeRef,
} from '@sciemd/core';

export interface StructuredSourceSelection {
  from: number;
  to: number;
  line: number;
  column: number;
  displayPath: string;
  label: string;
}

export function sourceSelectionForStructuredNode(node: StructuredNodeRef | null | undefined): StructuredSourceSelection | null {
  const target = structuredSourceRevealTargetForNode(node);
  if (!target) return null;
  return {
    from: target.from,
    to: target.to,
    line: target.line,
    column: target.column,
    displayPath: target.displayPath,
    label: target.label,
  };
}
