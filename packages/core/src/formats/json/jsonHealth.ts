import type { Node as JsonNode } from 'jsonc-parser';
import { getNodeValue } from 'jsonc-parser';
import type { FormatDiagnostic, StructuredPathSegment } from '../documentFormat.js';
import {
  displayPathFromPath,
  pointerFromPath,
  sourceSpanFromOffset,
} from '../structured/sourceMap.js';

export type JsonTopLevelType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export interface JsonArraySummary {
  path: string;
  length: number;
}

export interface JsonHealthSummary {
  objectCount: number;
  arrayCount: number;
  scalarCount: number;
  maxDepth: number;
  topLevelType: JsonTopLevelType | null;
  largestArrays: JsonArraySummary[];
}

export interface JsonHealthResult {
  health: JsonHealthSummary;
  diagnostics: FormatDiagnostic[];
}

const MAX_SAFE_JSON_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

export function analyzeJsonHealth(root: JsonNode | undefined, text: string): JsonHealthResult {
  const largestArrays: JsonArraySummary[] = [];
  const diagnostics: FormatDiagnostic[] = [];
  const health: JsonHealthSummary = {
    objectCount: 0,
    arrayCount: 0,
    scalarCount: 0,
    maxDepth: 0,
    topLevelType: root ? nodeTypeForHealth(root) : null,
    largestArrays,
  };

  if (!root) return { health, diagnostics };

  visitJsonNode(root, [], 1, health, diagnostics, text, largestArrays);
  largestArrays.sort((left, right) => right.length - left.length);
  health.largestArrays = largestArrays.slice(0, 5);

  return { health, diagnostics };
}

function visitJsonNode(
  node: JsonNode,
  path: StructuredPathSegment[],
  depth: number,
  health: JsonHealthSummary,
  diagnostics: FormatDiagnostic[],
  text: string,
  largestArrays: JsonArraySummary[],
): void {
  health.maxDepth = Math.max(health.maxDepth, depth);

  if (node.type === 'object') {
    health.objectCount += 1;
    const seenProperties = new Map<string, JsonNode>();
    for (const property of node.children ?? []) {
      const keyNode = property.children?.[0];
      const valueNode = property.children?.[1];
      const key = typeof keyNode?.value === 'string' ? keyNode.value : null;
      if (!key || !valueNode) continue;
      const childPath = [...path, key];
      if (seenProperties.has(key)) {
        diagnostics.push(createNodeDiagnostic(
          'json-duplicate-key',
          `Duplicate JSON object key "${key}" at ${displayPathFromPath(path)}. The last value wins in JavaScript parsers.`,
          property,
          text,
          childPath,
        ));
      } else {
        seenProperties.set(key, property);
      }
      visitJsonNode(valueNode, childPath, depth + 1, health, diagnostics, text, largestArrays);
    }
    return;
  }

  if (node.type === 'array') {
    health.arrayCount += 1;
    const children = node.children ?? [];
    largestArrays.push({ path: displayPathFromPath(path), length: children.length });
    const childTypes = new Set(children.map(arrayElementType));
    if (childTypes.size > 1) {
      diagnostics.push(createNodeDiagnostic(
        'json-mixed-array-types',
        `Array at ${displayPathFromPath(path)} contains mixed value types (${Array.from(childTypes).sort().join(', ')}).`,
        node,
        text,
        path,
      ));
    }
    children.forEach((child, index) => {
      visitJsonNode(child, [...path, index], depth + 1, health, diagnostics, text, largestArrays);
    });
    return;
  }

  health.scalarCount += 1;
  if (node.type === 'number') {
    analyzeJsonNumberToken(node, path, diagnostics, text);
  }
}

function analyzeJsonNumberToken(
  node: JsonNode,
  path: StructuredPathSegment[],
  diagnostics: FormatDiagnostic[],
  text: string,
): void {
  const raw = text.slice(node.offset, node.offset + node.length);
  const value = getNodeValue(node);

  if (raw === '-0') {
    diagnostics.push(createNodeDiagnostic(
      'json-number-negative-zero',
      `JSON number at ${displayPathFromPath(path)} is -0; JavaScript number serialization would write it as 0.`,
      node,
      text,
      path,
    ));
  }

  if (isUnsafeIntegerToken(raw)) {
    diagnostics.push(createNodeDiagnostic(
      'json-number-unsafe-integer',
      `JSON integer at ${displayPathFromPath(path)} is outside JavaScript's safe integer range and should be preserved as a raw source token.`,
      node,
      text,
      path,
    ));
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const canonical = Object.is(value, -0) ? '0' : String(value);
    if (canonical !== raw) {
      diagnostics.push(createNodeDiagnostic(
        'json-number-token-canonicalizes',
        `JSON number token at ${displayPathFromPath(path)} would serialize as ${canonical}; preserve the original token "${raw}" when editing visually.`,
        node,
        text,
        path,
      ));
    }
  }
}

function isUnsafeIntegerToken(raw: string): boolean {
  if (!/^-?(?:0|[1-9]\d*)$/.test(raw)) return false;
  const unsigned = raw.startsWith('-') ? raw.slice(1) : raw;
  try {
    return BigInt(unsigned) > MAX_SAFE_JSON_INTEGER;
  } catch {
    return false;
  }
}

function createNodeDiagnostic(
  code: string,
  message: string,
  node: JsonNode,
  text: string,
  path: StructuredPathSegment[],
): FormatDiagnostic {
  const location = offsetToLineColumn(text, node.offset);
  const span = sourceSpanFromOffset(text, node.offset, Math.max(1, node.length));
  return {
    severity: 'warning',
    code,
    message,
    line: location.line,
    column: location.column,
    offset: node.offset,
    length: Math.max(1, node.length),
    source: 'json',
    category: 'health',
    path,
    pointer: pointerFromPath(path),
    displayPath: displayPathFromPath(path),
    span,
  };
}

export function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < safeOffset; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: safeOffset - lineStart + 1 };
}

function nodeTypeForHealth(node: JsonNode): JsonTopLevelType {
  if (node.type === 'property') {
    const valueNode = node.children?.[1];
    return valueNode ? nodeTypeForHealth(valueNode) : 'null';
  }
  return node.type as JsonTopLevelType;
}

function arrayElementType(node: JsonNode): string {
  if (node.type === 'object' || node.type === 'array') return node.type;
  const value = getNodeValue(node);
  if (value === null) return 'null';
  return typeof value;
}
