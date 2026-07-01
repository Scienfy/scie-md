import {
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
  Scalar,
  type ParsedNode,
  type Range,
} from 'yaml';
import type {
  FormatDiagnostic,
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
  structuredValueType,
} from '../structured/sourceMap.js';
import { lineHasUnquotedHash } from '../structured/structuredValue.js';

export type YamlSourceMapUnsupportedKind =
  | 'alias'
  | 'anchor'
  | 'block-scalar'
  | 'comment'
  | 'complex-key'
  | 'flow-collection'
  | 'merge-key'
  | 'tag';

export interface YamlSourceMapUnsupportedFeature {
  kind: YamlSourceMapUnsupportedKind;
  code: string;
  message: string;
  path: StructuredPathSegment[];
  pointer: string;
  displayPath: string;
  span: SourceSpan | null;
}

export interface YamlSourceMapInspection {
  nodeCount: number;
  spannedNodeCount: number;
  unmappedVisualNodeCount: number;
  sourceTokenNodeCount: number;
  editableNodeCount: 0;
  editableCandidateCount: number;
  unsupportedFeatureCount: number;
  unsupportedKinds: YamlSourceMapUnsupportedKind[];
  spanCoverage: 'none' | 'partial' | 'complete';
  visualWritesEnabled: false;
}

export interface YamlSourceMapResult {
  sourceMap: StructuredSourceMap;
  inspection: YamlSourceMapInspection;
  unsupportedFeatures: YamlSourceMapUnsupportedFeature[];
}

interface YamlDocumentLike {
  contents: ParsedNode | null;
}

interface NodeEvidence {
  path: StructuredPathSegment[];
  span: SourceSpan | null;
  valueSpan: SourceSpan | null;
  keySpan: SourceSpan | null;
  hasSourceToken: boolean;
  unsupportedFeatures: YamlSourceMapUnsupportedFeature[];
}

const YAML_VISUAL_WRITE_BLOCKER = 'YAML visual writes remain disabled until ScieMD has a fixture-backed source-preserving edit planner.';

export function createYamlSourceMap(
  text: string,
  document: YamlDocumentLike = parseDocument(text, {
    keepSourceTokens: true,
    strict: true,
    uniqueKeys: true,
  }),
  visualValue?: unknown,
): YamlSourceMapResult {
  return withCurrentSourceText(text, () => createYamlSourceMapForCurrentText(text, document, visualValue));
}

function createYamlSourceMapForCurrentText(
  text: string,
  document: YamlDocumentLike,
  visualValue: unknown,
): YamlSourceMapResult {
  const unsupportedFeatures: YamlSourceMapUnsupportedFeature[] = [];
  const evidenceByPointer = new Map<string, NodeEvidence>();
  const seenFeatures = new Set<string>();

  for (const commentFeature of collectSourceCommentFeatures(text)) {
    registerUnsupportedFeature(commentFeature);
  }

  if (document.contents) {
    collectNodeEvidence(document.contents, [], null);
  }

  const nodes = buildVisualNodes(
    visualValue === undefined ? document.contents?.toJSON?.() : visualValue,
    [],
    new WeakSet<object>(),
  );
  const spannedNodeCount = nodes.filter((node) => node.span).length;
  const sourceTokenNodeCount = Array.from(evidenceByPointer.values()).filter((evidence) => evidence.hasSourceToken).length;
  const unsupportedKinds = Array.from(new Set(unsupportedFeatures.map((feature) => feature.kind))).sort();
  const spanCoverage = nodes.length === 0 || spannedNodeCount === 0
    ? 'none'
    : spannedNodeCount === nodes.length
      ? 'complete'
      : 'partial';

  return {
    sourceMap: createStructuredSourceMap('yaml', nodes),
    inspection: {
      nodeCount: nodes.length,
      spannedNodeCount,
      unmappedVisualNodeCount: Math.max(0, nodes.length - spannedNodeCount),
      sourceTokenNodeCount,
      editableNodeCount: 0,
      editableCandidateCount: nodes.filter((node) => node.span && !hasUnsupportedFeature(node, evidenceByPointer)).length,
      unsupportedFeatureCount: unsupportedFeatures.length,
      unsupportedKinds,
      spanCoverage,
      visualWritesEnabled: false,
    },
    unsupportedFeatures,
  };

  function collectNodeEvidence(
    node: ParsedNode | null,
    path: StructuredPathSegment[],
    keyNode: ParsedNode | null,
  ): void {
    const pointer = pointerFromPath(path);
    const localFeatures: YamlSourceMapUnsupportedFeature[] = [];
    if (!node) {
      evidenceByPointer.set(pointer, {
        path,
        span: keyNode ? spanFromRange(keyNode.range) : null,
        valueSpan: null,
        keySpan: keyNode ? valueSpanFromRange(keyNode.range) : null,
        hasSourceToken: false,
        unsupportedFeatures: localFeatures,
      });
      return;
    }

    collectUnsupportedFeaturesForNode(node, path, localFeatures);
    evidenceByPointer.set(pointer, {
      path,
      span: spanFromRange(node.range),
      valueSpan: valueSpanFromRange(node.range),
      keySpan: keyNode ? valueSpanFromRange(keyNode.range) : null,
      hasSourceToken: Boolean(node.srcToken),
      unsupportedFeatures: localFeatures,
    });

    if (isMap(node)) {
      for (const pair of node.items) {
        if (!isPair(pair)) continue;
        if (!isSupportedScalarKey(pair.key)) {
          registerUnsupportedFeature(createUnsupportedFeature(
            'complex-key',
            'yaml-complex-key-readonly',
            'YAML complex mapping keys cannot be mapped to stable visual edit paths.',
            path,
            rangeSpan(pair.key),
          ));
          continue;
        }
        const key = String(pair.key.value);
        const childPath = [...path, key];
        const childPointer = pointerFromPath(childPath);
        let mergeFeature: YamlSourceMapUnsupportedFeature | null = null;
        if (key === '<<') {
          mergeFeature = registerUnsupportedFeature(createUnsupportedFeature(
            'merge-key',
            'yaml-merge-key-readonly',
            'YAML merge keys can change effective values without a local editable source span.',
            childPath,
            rangeSpan(pair.key),
          ));
        }
        collectNodeEvidence(pair.value as ParsedNode | null, childPath, pair.key);
        if (mergeFeature) evidenceByPointer.get(childPointer)?.unsupportedFeatures.push(mergeFeature);
      }
      return;
    }

    if (isSeq(node)) {
      node.items.forEach((item, index) => {
        if (isPair(item)) {
          registerUnsupportedFeature(createUnsupportedFeature(
            'complex-key',
            'yaml-sequence-pair-readonly',
            'YAML sequence pair items cannot be mapped to stable visual edit paths.',
            [...path, index],
            null,
          ));
          return;
        }
        collectNodeEvidence(item as ParsedNode | null, [...path, index], null);
      });
    }
  }

  function collectUnsupportedFeaturesForNode(
    node: ParsedNode,
    path: StructuredPathSegment[],
    localFeatures: YamlSourceMapUnsupportedFeature[],
  ): void {
    if (isAlias(node)) {
      localFeatures.push(registerUnsupportedFeature(createUnsupportedFeature(
        'alias',
        'yaml-alias-readonly',
        'YAML aliases resolve through another source location and cannot be edited from the visual projection.',
        path,
        rangeSpan(node),
      )));
    }
    const anchor = nodeAnchor(node);
    if (anchor) {
      localFeatures.push(registerUnsupportedFeature(createUnsupportedFeature(
        'anchor',
        'yaml-anchor-readonly',
        `YAML anchor "${anchor}" must be preserved in source and is not safe for visual rewrites yet.`,
        path,
        rangeSpan(node),
      )));
    }
    if (hasExplicitTag(node)) {
      localFeatures.push(registerUnsupportedFeature(createUnsupportedFeature(
        'tag',
        'yaml-tag-readonly',
        'YAML tags may carry source-level type information that the visual value cannot safely rewrite.',
        path,
        rangeSpan(node),
      )));
    }
    if (isBlockScalar(node)) {
      localFeatures.push(registerUnsupportedFeature(createUnsupportedFeature(
        'block-scalar',
        'yaml-block-scalar-readonly',
        'YAML block scalar style, chomping, and indentation must be preserved before visual edits can be safe.',
        path,
        rangeSpan(node),
      )));
    }
    if (isFlowCollection(node)) {
      localFeatures.push(registerUnsupportedFeature(createUnsupportedFeature(
        'flow-collection',
        'yaml-flow-collection-readonly',
        'YAML flow collection punctuation and spacing require a dedicated patch planner.',
        path,
        rangeSpan(node),
      )));
    }
    if (hasNodeComment(node)) {
      localFeatures.push(registerUnsupportedFeature(createUnsupportedFeature(
        'comment',
        'yaml-comment-readonly',
        'YAML comments are attached to source tokens and are not safe for value-only rewrites.',
        path,
        rangeSpan(node),
      )));
    }
  }

  function buildVisualNodes(
    value: unknown,
    path: StructuredPathSegment[],
    seen: WeakSet<object>,
  ): StructuredNodeRef[] {
    const pointer = pointerFromPath(path);
    const displayPath = displayPathFromPath(path);
    const evidence = evidenceByPointer.get(pointer);
    const unsupportedReason = unsupportedReasonForEvidence(evidence);
    const node: StructuredNodeRef = {
      format: 'yaml',
      path,
      pointer,
      displayPath,
      type: structuredValueType(value),
      span: evidence?.span ?? null,
      valueSpan: evidence?.valueSpan ?? null,
      keySpan: evidence?.keySpan ?? null,
      lossy: true,
      editable: false,
      unsupportedReason,
      childCount: childCount(value),
    };
    const nodes: StructuredNodeRef[] = [node];
    if (!value || typeof value !== 'object') return nodes;
    if (seen.has(value)) return nodes;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, index) => nodes.push(...buildVisualNodes(item, [...path, index], seen)));
    } else {
      for (const [key, child] of Object.entries(value)) nodes.push(...buildVisualNodes(child, [...path, key], seen));
    }
    seen.delete(value);
    return nodes;
  }

  function registerUnsupportedFeature(feature: YamlSourceMapUnsupportedFeature): YamlSourceMapUnsupportedFeature {
    const key = `${feature.kind}:${feature.pointer}:${feature.span?.offset ?? 'global'}:${feature.code}`;
    const existing = seenFeatures.has(key)
      ? unsupportedFeatures.find((candidate) => (
          candidate.kind === feature.kind
          && candidate.pointer === feature.pointer
          && candidate.code === feature.code
          && candidate.span?.offset === feature.span?.offset
        ))
      : null;
    if (existing) return existing;
    seenFeatures.add(key);
    unsupportedFeatures.push(feature);
    return feature;
  }
}

export function yamlSourceMapDiagnostics(result: YamlSourceMapResult): FormatDiagnostic[] {
  return result.unsupportedFeatures.map((feature) => ({
    severity: 'warning',
    code: feature.code,
    message: feature.message,
    source: 'yaml',
    category: 'preservation',
    path: feature.path,
    pointer: feature.pointer,
    displayPath: feature.displayPath,
    span: feature.span ?? undefined,
    line: feature.span?.line,
    column: feature.span?.column,
    offset: feature.span?.offset,
    length: feature.span?.length,
    blocking: false,
  }));
}

function createUnsupportedFeature(
  kind: YamlSourceMapUnsupportedKind,
  code: string,
  message: string,
  path: StructuredPathSegment[],
  span: SourceSpan | null,
): YamlSourceMapUnsupportedFeature {
  return {
    kind,
    code,
    message,
    path,
    pointer: pointerFromPath(path),
    displayPath: displayPathFromPath(path),
    span,
  };
}

function collectSourceCommentFeatures(text: string): YamlSourceMapUnsupportedFeature[] {
  return splitLinesWithOffsets(text)
    .filter(({ line }) => lineHasUnquotedHash(line))
    .map(({ offset, line }) => {
      const commentOffset = line.indexOf('#');
      return createUnsupportedFeature(
        'comment',
        'yaml-comment-readonly',
        'YAML comments are source-only and must be preserved by targeted source patches.',
        [],
        sourceSpanFromOffset(text, offset + Math.max(0, commentOffset), Math.max(1, line.length - Math.max(0, commentOffset))),
      );
    });
}

function splitLinesWithOffsets(text: string): Array<{ line: string; offset: number }> {
  if (text.length === 0) return [];
  const lines: Array<{ line: string; offset: number }> = [];
  let lineStart = 0;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '\r' || char === '\n') {
      lines.push({ line: text.slice(lineStart, index), offset: lineStart });
      if (char === '\r' && text[index + 1] === '\n') {
        index += 2;
      } else {
        index += 1;
      }
      lineStart = index;
      continue;
    }
    index += 1;
  }
  lines.push({ line: text.slice(lineStart), offset: lineStart });
  return lines;
}

function isSupportedScalarKey(key: unknown): key is Scalar {
  return isScalar(key) && typeof key.value !== 'object';
}

function hasUnsupportedFeature(node: StructuredNodeRef, evidenceByPointer: Map<string, NodeEvidence>): boolean {
  return (evidenceByPointer.get(node.pointer)?.unsupportedFeatures.length ?? 0) > 0;
}

function unsupportedReasonForEvidence(evidence: NodeEvidence | undefined): string {
  if (!evidence) {
    return `${YAML_VISUAL_WRITE_BLOCKER} This visual node has no local YAML source span, often because it is resolved from an alias, merge key, or normalized parser value.`;
  }
  if (evidence.unsupportedFeatures.length === 0) return YAML_VISUAL_WRITE_BLOCKER;
  const kinds = Array.from(new Set(evidence.unsupportedFeatures.map((feature) => feature.kind))).join(', ');
  return `${YAML_VISUAL_WRITE_BLOCKER} Unsupported source syntax at this node: ${kinds}.`;
}

function childCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value !== null && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

function rangeSpan(node: { range?: Range | null } | null | undefined): SourceSpan | null {
  return spanFromRange(node?.range);
}

function spanFromRange(range: Range | null | undefined): SourceSpan | null {
  if (!range) return null;
  const [start, , nodeEnd] = range;
  return sourceSpanFromOffset(currentSourceText, start, Math.max(1, nodeEnd - start));
}

function valueSpanFromRange(range: Range | null | undefined): SourceSpan | null {
  if (!range) return null;
  const [start, valueEnd] = range;
  return sourceSpanFromOffset(currentSourceText, start, Math.max(1, valueEnd - start));
}

let currentSourceText = '';

function withCurrentSourceText<T>(text: string, callback: () => T): T {
  const previous = currentSourceText;
  currentSourceText = text;
  try {
    return callback();
  } finally {
    currentSourceText = previous;
  }
}

function nodeAnchor(node: ParsedNode): string | null {
  const anchor = (node as { anchor?: unknown }).anchor;
  return typeof anchor === 'string' && anchor.length > 0 ? anchor : null;
}

function hasExplicitTag(node: ParsedNode): boolean {
  const tag = (node as { tag?: unknown }).tag;
  return typeof tag === 'string' && tag.length > 0;
}

function isBlockScalar(node: ParsedNode): boolean {
  if (!isScalar(node)) return false;
  if (node.type === Scalar.BLOCK_FOLDED || node.type === Scalar.BLOCK_LITERAL) return true;
  return sourceTokenType(node) === 'block-scalar';
}

function isFlowCollection(node: ParsedNode): boolean {
  return sourceTokenType(node) === 'flow-collection';
}

function sourceTokenType(node: ParsedNode): string | null {
  const token = (node as { srcToken?: { type?: unknown } }).srcToken;
  return typeof token?.type === 'string' ? token.type : null;
}

function hasNodeComment(node: ParsedNode): boolean {
  const comment = (node as { comment?: unknown }).comment;
  const commentBefore = (node as { commentBefore?: unknown }).commentBefore;
  return (typeof comment === 'string' && comment.trim().length > 0)
    || (typeof commentBefore === 'string' && commentBefore.trim().length > 0);
}

export function yamlStructuredValueType(value: unknown): StructuredValueType {
  return structuredValueType(value);
}
