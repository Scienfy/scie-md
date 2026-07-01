import type {
  DocumentFormat,
  SourceSpan,
  StructuredNodeRef,
  StructuredPathSegment,
  StructuredSourceMap,
  StructuredValueType,
} from '../documentFormat.js';

export function sourceSpanFromOffset(text: string, offset: number, length: number): SourceSpan {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const safeLength = Math.max(0, Math.min(length, text.length - safeOffset));
  const location = lineColumnFromOffset(text, safeOffset);
  return {
    offset: safeOffset,
    length: safeLength,
    line: location.line,
    column: location.column,
  };
}

export function lineColumnFromOffset(text: string, offset: number): { line: number; column: number } {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  let index = 0;
  while (index < safeOffset) {
    const char = text[index];
    if (char === '\r') {
      line += 1;
      if (text[index + 1] === '\n' && index + 1 < safeOffset) {
        index += 2;
      } else {
        index += 1;
      }
      lineStart = index;
      continue;
    }
    if (char === '\n') {
      line += 1;
      index += 1;
      lineStart = index;
      continue;
    }
    index += 1;
  }
  return { line, column: safeOffset - lineStart + 1 };
}

export function pointerFromPath(path: readonly StructuredPathSegment[]): string {
  if (path.length === 0) return '';
  return path.map((segment) => `/${escapePointerSegment(String(segment))}`).join('');
}

export function pathFromPointer(pointer: string): StructuredPathSegment[] {
  if (!pointer) return [];
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => {
      const decoded = segment.replace(/~1/g, '/').replace(/~0/g, '~');
      return /^\d+$/.test(decoded) ? Number(decoded) : decoded;
    });
}

export function displayPathFromPath(path: readonly StructuredPathSegment[]): string {
  if (path.length === 0) return '$';
  return path.reduce<string>((displayPath, segment) => {
    if (typeof segment === 'number') return `${displayPath}[${segment}]`;
    return /^[A-Za-z_$][\w$]*$/.test(segment)
      ? `${displayPath}.${segment}`
      : `${displayPath}[${JSON.stringify(segment)}]`;
  }, '$');
}

export function structuredValueType(value: unknown): StructuredValueType {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  return 'boolean';
}

export function createStructuredSourceMap(
  format: DocumentFormat,
  nodes: readonly StructuredNodeRef[],
): StructuredSourceMap {
  const nodesByPointer: Record<string, StructuredNodeRef> = {};
  const nodesByDisplayPath: Record<string, StructuredNodeRef> = {};
  for (const node of nodes) {
    nodesByPointer[node.pointer] = node;
    nodesByDisplayPath[node.displayPath] = node;
  }
  return {
    format,
    root: nodes[0] ?? null,
    nodes: [...nodes],
    nodesByPointer,
    nodesByDisplayPath,
  };
}

export function createLossyStructuredSourceMap(
  format: Extract<DocumentFormat, 'yaml' | 'toml'>,
  value: unknown,
): StructuredSourceMap {
  const nodes: StructuredNodeRef[] = [];
  const visit = (current: unknown, path: StructuredPathSegment[], seen: WeakSet<object>) => {
    const type = structuredValueType(current);
    const node: StructuredNodeRef = {
      format,
      path,
      pointer: pointerFromPath(path),
      displayPath: displayPathFromPath(path),
      type,
      span: null,
      valueSpan: null,
      keySpan: null,
      lossy: true,
      editable: false,
      unsupportedReason: `${format.toUpperCase()} visual editing is disabled until source-preserving syntax support exists.`,
      childCount: childCount(current),
    };
    nodes.push(node);
    if (!current || typeof current !== 'object') return;
    if (seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) {
      current.forEach((child, index) => visit(child, [...path, index], seen));
    } else {
      for (const [key, child] of Object.entries(current)) visit(child, [...path, key], seen);
    }
    seen.delete(current);
  };
  visit(value, [], new WeakSet<object>());
  return createStructuredSourceMap(format, nodes);
}

function childCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value !== null && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

function escapePointerSegment(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}
