import type { Node as JsonNode } from 'jsonc-parser';
import type {
  SourceSpan,
  StructuredNodeRef,
  StructuredPathSegment,
  StructuredSourceMap,
  StructuredValueType,
} from '../documentFormat.js';
import {
  createStructuredSourceMap,
  displayPathFromPath,
  pointerFromPath,
  sourceSpanFromOffset,
} from '../structured/sourceMap.js';

export function createJsonSourceMap(root: JsonNode, text: string): StructuredSourceMap {
  const nodes: StructuredNodeRef[] = [];
  visitJsonValueNode({
    node: root,
    text,
    path: [],
    nodes,
    propertyNode: null,
    keyNode: null,
  });
  return createStructuredSourceMap('json', nodes);
}

export function findStructuredNodeByPath(
  sourceMap: StructuredSourceMap,
  path: readonly StructuredPathSegment[],
): StructuredNodeRef | null {
  return sourceMap.nodesByPointer[pointerFromPath(path)] ?? null;
}

export function findStructuredNodeByPointer(
  sourceMap: StructuredSourceMap,
  pointer: string,
): StructuredNodeRef | null {
  return sourceMap.nodesByPointer[pointer] ?? null;
}

function visitJsonValueNode({
  node,
  text,
  path,
  nodes,
  propertyNode,
  keyNode,
}: {
  node: JsonNode;
  text: string;
  path: StructuredPathSegment[];
  nodes: StructuredNodeRef[];
  propertyNode: JsonNode | null;
  keyNode: JsonNode | null;
}): void {
  const valueSpan = spanForNode(node, text);
  const span = propertyNode ? spanForNode(propertyNode, text) : valueSpan;
  const nodeRef: StructuredNodeRef = {
    format: 'json',
    path,
    pointer: pointerFromPath(path),
    displayPath: displayPathFromPath(path),
    type: jsonNodeType(node),
    span,
    valueSpan,
    keySpan: keyNode ? spanForNode(keyNode, text) : null,
    lossy: false,
    editable: true,
    childCount: childCount(node),
  };
  nodes.push(nodeRef);

  if (node.type === 'object') {
    for (const property of node.children ?? []) {
      const childKeyNode = property.children?.[0];
      const childValueNode = property.children?.[1];
      const key = typeof childKeyNode?.value === 'string' ? childKeyNode.value : null;
      if (!key || !childValueNode) continue;
      visitJsonValueNode({
        node: childValueNode,
        text,
        path: [...path, key],
        nodes,
        propertyNode: property,
        keyNode: childKeyNode ?? null,
      });
    }
    return;
  }

  if (node.type === 'array') {
    (node.children ?? []).forEach((child, index) => {
      visitJsonValueNode({
        node: child,
        text,
        path: [...path, index],
        nodes,
        propertyNode: null,
        keyNode: null,
      });
    });
  }
}

function spanForNode(node: JsonNode, text: string): SourceSpan {
  return sourceSpanFromOffset(text, node.offset, Math.max(1, node.length));
}

function jsonNodeType(node: JsonNode): StructuredValueType {
  if (node.type === 'property') {
    const valueNode = node.children?.[1];
    return valueNode ? jsonNodeType(valueNode) : 'null';
  }
  return node.type as StructuredValueType;
}

function childCount(node: JsonNode): number {
  if (node.type === 'object' || node.type === 'array') return node.children?.length ?? 0;
  return 0;
}
