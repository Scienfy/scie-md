import { $nodeSchema, $prose, $remark, $view } from '@milkdown/kit/utils';
import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import type { Node as ProseNode } from '@milkdown/prose/model';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import type { Transaction } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import type { EditorView, NodeView, NodeViewConstructor } from '@milkdown/prose/view';
import { directiveBody, parseDirectiveBlocks } from '../../domain/blocks/directiveParser';
import type { DirectiveBlock } from '../../domain/blocks/directiveParser';
import { createEditorCommentSnippet, createEditorNoteSnippet, parseEditorCommentRaw } from '../../markdown/editorComments';
import { toVisualImagePaths } from '../../markdown/imagePaths';
import { changeTouchesLockRange, collectLockRangesFromBoundaries } from '../../markdown/lockRanges';
import type { LockBoundary, LockRange } from '../../markdown/lockRanges';
import { findQuoteSelectorRangeInTextIndex } from '../../markdown/quoteAnchors';
import type { QuoteAnchorSelector } from '../../markdown/quoteAnchors';
import { findMermaidFenceBlocks, mermaidFenceBody } from '../../markdown/mermaidBlocks';
import { findSvgFenceBlocks, svgFenceBody } from '../../markdown/svgBlocks';
import { optimizeSvgSource } from '../../markdown/svgSanitizer';
import { createTargetedInstructionSnippet, parseTargetedInstructionRaw } from '../../markdown/targetedInstructions';
import { lineStartOffsets } from '../../markdown/textOffsets';
import { parseVariantGroups } from '../../markdown/variants';
import {
  checkInkscapeAvailable,
  cleanupInkscapeSvgSession,
  exportSvgWithInkscape,
  openSvgInInkscape,
  readInkscapeSvgSession,
  statInkscapeSvgSession,
} from '../../services/inkscapeService';
import type { InkscapeSession, SvgExportFormat } from '../../services/inkscapeService';
import { setSanitizedHtml } from '../../services/htmlSanitizer';
import {
  getScieMetadataDocumentPath,
  getScieMetadataCitationEntries,
  setScieMetadataCitationEntries,
  setScieMetadataDocumentPath,
  setScieMetadataUiCallbacks,
  visualAtomConfirm,
  visualAtomToast,
} from './scieMetadataRuntime';

export { setScieMetadataCitationEntries, setScieMetadataDocumentPath, setScieMetadataUiCallbacks } from './scieMetadataRuntime';

type MetadataNodeKind =
  | 'scie_lock_start'
  | 'scie_lock_end'
  | 'scie_lock_anchor'
  | 'scie_comment'
  | 'scie_comment_end'
  | 'scie_instruction'
  | 'scie_variant_group'
  | 'scie_directive_block'
  | 'scie_mermaid_block'
  | 'scie_svg_block';

interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
  [key: string]: unknown;
}

interface LockStartAttrs {
  raw: string;
  reason: string;
}

interface LockAnchorAttrs {
  raw: string;
  lockId: string;
  reason: string;
  target: string;
  quote: string;
  prefix: string;
  suffix: string;
}

interface RawAttrs {
  raw: string;
}

interface CommentAttrs {
  raw: string;
  audience: string;
  body: string;
  noteId: string;
  kind: string;
  target: string;
  quote: string;
  prefix: string;
  suffix: string;
  sourceNoteId: string;
}

interface InstructionAttrs {
  raw: string;
  target: string;
  prompt: string;
}

interface VariantAttrs {
  raw: string;
  groupId: string;
  active: string;
  target: string;
  quote: string;
  prefix: string;
  suffix: string;
  itemsJson: string;
}

interface DirectiveAttrs {
  raw: string;
  name: string;
  label: string;
  detail: string;
  body: string;
}

interface MermaidAttrs {
  raw: string;
  body: string;
}

interface SvgAttrs {
  raw: string;
  body: string;
}

interface VariantItemViewModel {
  id: string;
  name: string;
  markdown: string;
}

const lockOperationMeta = 'scie-md-lock-operation';
const lockViolationEvent = 'scie-md-lock-violation';
const activeVariantNodeViews = new Set<VariantNodeView>();

export function flushScieMetadataNodeViews(): boolean {
  let changed = false;
  for (const nodeView of Array.from(activeVariantNodeViews)) {
    changed = nodeView.flushPendingEditForSync() || changed;
  }
  return changed;
}

const lockStartPattern = /^\s*<!--\s*scie_md:lock:start(?:\s+reason=(?:"([^"]*)"|'([^']*)'|([^\s-][^>]*?)))?\s*-->\s*$/i;
const lockEndPattern = /^\s*<!--\s*scie_md:lock:end\s*-->\s*$/i;
const lockAnchorPattern = /^\s*<!--\s*scie_md:lock(?!:)\b([^>]*)-->\s*$/i;
const commentStartPattern = /^\s*<!--\s*scie_md:comment(?!:)(?:\s+audience=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?\s*-->\s*$/i;
const commentEndPattern = /^\s*<!--\s*scie_md:comment:end\s*-->\s*$/i;
const variantGroupPattern = /^\s*<!--\s*scie_md:variant:group\b/i;
const variantEndPattern = /^\s*<!--\s*scie_md:variant:end\s*-->\s*$/i;
const metadataNodeNames = new Set<MetadataNodeKind>([
  'scie_lock_start',
  'scie_lock_end',
  'scie_lock_anchor',
  'scie_comment',
  'scie_comment_end',
  'scie_instruction',
  'scie_variant_group',
  'scie_directive_block',
  'scie_mermaid_block',
  'scie_svg_block',
]);

async function renderMarkdownHtmlFragmentLazy(
  markdown: string,
  documentPath: string | null,
  options: { embedImages: boolean; citationEntries?: import('../../domain/citations/bibtex').BibtexEntry[] },
): Promise<string> {
  const module = await import('../../markdown/htmlExport');
  return module.renderMarkdownHtmlFragment(markdown, documentPath, options);
}

export function isScieMetadataNode(node: ProseNode): boolean {
  return metadataNodeNames.has(node.type.name as MetadataNodeKind);
}

export function transformScieMetadataAst(tree: MdastNode, sourceMarkdown = ''): MdastNode {
  transformChildren(tree, sourceMarkdown);
  return tree;
}

export function metadataNodeFromHtml(raw: string): MdastNode | null {
  const normalizedRaw = raw.trim();
  const lockStart = normalizedRaw.match(lockStartPattern);
  if (lockStart) {
    return {
      type: 'scie_lock_start',
      raw: normalizedRaw,
      reason: decodeHtmlAttribute((lockStart[1] ?? lockStart[2] ?? lockStart[3] ?? '').trim()),
    };
  }
  if (lockEndPattern.test(normalizedRaw)) {
    return { type: 'scie_lock_end', raw: normalizedRaw };
  }
  const lockAnchor = normalizedRaw.match(lockAnchorPattern);
  if (lockAnchor) {
    const attrs = parseMetadataAttributes(lockAnchor[1] ?? '');
    const quote = decodeHtmlAttribute(attrs.quote ?? '').trim();
    if (quote) {
      return {
        type: 'scie_lock_anchor',
        raw: normalizedRaw,
        lockId: decodeHtmlAttribute(attrs.id ?? '').trim(),
        reason: decodeHtmlAttribute(attrs.reason ?? '').trim(),
        target: decodeHtmlAttribute(attrs.target ?? 'quote').trim() || 'quote',
        quote,
        prefix: decodeHtmlAttribute(attrs.prefix ?? '').trim(),
        suffix: decodeHtmlAttribute(attrs.suffix ?? '').trim(),
      };
    }
  }
  if (commentEndPattern.test(normalizedRaw)) {
    return { type: 'scie_comment_end', raw: normalizedRaw };
  }
  const comment = parseEditorCommentRaw(normalizedRaw);
  if (comment) {
    return {
      type: 'scie_comment',
      raw: normalizedRaw,
      audience: comment.audience,
      body: comment.body,
      noteId: comment.id ?? '',
      kind: comment.kind ?? comment.audience,
      target: comment.target ?? '',
      quote: comment.quote ?? '',
      prefix: comment.prefix ?? '',
      suffix: comment.suffix ?? '',
      sourceNoteId: comment.sourceNoteId ?? '',
    };
  }
  const instruction = parseTargetedInstructionRaw(normalizedRaw);
  if (instruction) {
    return {
      type: 'scie_instruction',
      raw: normalizedRaw,
      target: instruction.target,
      prompt: instruction.prompt,
    };
  }
  return null;
}

export function replaceVariantActive(raw: string, active: string): string {
  const escaped = escapeHtmlAttribute(active);
  const opening = raw.match(/<!--\s*scie_md:variant:group\b[^>]*-->/i);
  if (!opening || opening.index === undefined) return raw;
  const nextOpening = /\sactive=(?:"[^"]*"|'[^']*'|[^\s>]+)/i.test(opening[0])
    ? opening[0].replace(/\sactive=(?:"[^"]*"|'[^']*'|[^\s>]+)/i, ` active="${escaped}"`)
    : opening[0].replace(/\s*-->\s*$/i, ` active="${escaped}" -->`);
  return `${raw.slice(0, opening.index)}${nextOpening}${raw.slice(opening.index + opening[0].length)}`;
}

export function buildVariantGroupRaw(
  groupId: string,
  active: string,
  items: VariantItemViewModel[],
  options: { target?: string; quote?: string; prefix?: string; suffix?: string } = {},
): string {
  const normalizedItems = items.filter((item) => item.id.trim());
  const normalizedActive = normalizedItems.some((item) => item.id === active)
    ? active
    : normalizedItems[0]?.id ?? '';
  const attrs = [
    `id="${escapeHtmlAttribute(groupId || 'draft')}"`,
    `active="${escapeHtmlAttribute(normalizedActive)}"`,
  ];
  if (options.target) attrs.push(`target="${escapeHtmlAttribute(options.target)}"`);
  if (options.quote) attrs.push(`quote="${escapeHtmlAttribute(options.quote)}"`);
  if (options.prefix) attrs.push(`prefix="${escapeHtmlAttribute(options.prefix)}"`);
  if (options.suffix) attrs.push(`suffix="${escapeHtmlAttribute(options.suffix)}"`);
  return [
    `<!-- scie_md:variant:group ${attrs.join(' ')} -->`,
    ...normalizedItems.flatMap((item) => [
      `<!-- scie_md:variant:item id="${escapeHtmlAttribute(item.id)}" name="${escapeHtmlAttribute(item.name || item.id)}" -->`,
      normalizeVariantMarkdown(item.markdown),
    ]),
    '<!-- scie_md:variant:end -->',
  ].join('\n');
}

function parseMetadataAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([A-Za-z_][A-Za-z0-9_.:-]*)=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

function buildLockAnchorRaw(id: string, quote: string, reason: string, target = 'quote', prefix = '', suffix = ''): string {
  const attrs = [
    `id="${escapeHtmlAttribute(id || 'lock')}"`,
    `target="${escapeHtmlAttribute(target || 'quote')}"`,
    `quote="${escapeHtmlAttribute(quote)}"`,
  ];
  if (prefix) attrs.push(`prefix="${escapeHtmlAttribute(prefix)}"`);
  if (suffix) attrs.push(`suffix="${escapeHtmlAttribute(suffix)}"`);
  if (reason) attrs.push(`reason="${escapeHtmlAttribute(reason)}"`);
  return `<!-- scie_md:lock ${attrs.join(' ')} -->`;
}

export function updateVariantItemMarkdown(
  groupId: string,
  active: string,
  items: VariantItemViewModel[],
  itemId: string,
  markdown: string,
): { raw: string; active: string; items: VariantItemViewModel[] } {
  const nextItems = items.map((item) => item.id === itemId ? { ...item, markdown: normalizeVariantMarkdown(markdown) } : item);
  const nextActive = nextItems.some((item) => item.id === active) ? active : nextItems[0]?.id ?? '';
  return {
    raw: buildVariantGroupRaw(groupId, nextActive, nextItems),
    active: nextActive,
    items: nextItems,
  };
}

export function deleteVariantItem(
  groupId: string,
  active: string,
  items: VariantItemViewModel[],
  itemId: string,
): { raw: string; active: string; items: VariantItemViewModel[] } | null {
  const nextItems = items.filter((item) => item.id !== itemId);
  if (nextItems.length === 0) return null;
  const nextActive = active === itemId || !nextItems.some((item) => item.id === active)
    ? nextItems[0].id
    : active;
  return {
    raw: buildVariantGroupRaw(groupId, nextActive, nextItems),
    active: nextActive,
    items: nextItems,
  };
}

const scieMetadataRemarkPlugin = $remark(
  'scie-md-metadata-comments',
  () => () => (tree: unknown, file?: { value?: unknown }) => {
    const source = typeof file?.value === 'string' ? file.value : '';
    transformScieMetadataAst(tree as MdastNode, source);
  },
);

const scieLockStartSchema = $nodeSchema('scie_lock_start', () => metadataSchema('scie_lock_start', {
  raw: { default: '', validate: 'string' },
  reason: { default: '', validate: 'string' },
}));

const scieLockEndSchema = $nodeSchema('scie_lock_end', () => metadataSchema('scie_lock_end', {
  raw: { default: '<!-- scie_md:lock:end -->', validate: 'string' },
}));

const scieLockAnchorSchema = $nodeSchema('scie_lock_anchor', () => metadataSchema('scie_lock_anchor', {
  raw: { default: '', validate: 'string' },
  lockId: { default: '', validate: 'string' },
  reason: { default: '', validate: 'string' },
  target: { default: 'quote', validate: 'string' },
  quote: { default: '', validate: 'string' },
  prefix: { default: '', validate: 'string' },
  suffix: { default: '', validate: 'string' },
}));

const scieCommentSchema = $nodeSchema('scie_comment', () => metadataSchema('scie_comment', {
  raw: { default: '', validate: 'string' },
  audience: { default: 'llm', validate: 'string' },
  body: { default: '', validate: 'string' },
  noteId: { default: '', validate: 'string' },
  kind: { default: 'llm', validate: 'string' },
  target: { default: '', validate: 'string' },
  quote: { default: '', validate: 'string' },
  prefix: { default: '', validate: 'string' },
  suffix: { default: '', validate: 'string' },
  sourceNoteId: { default: '', validate: 'string' },
}));

const scieCommentEndSchema = $nodeSchema('scie_comment_end', () => metadataSchema('scie_comment_end', {
  raw: { default: '<!-- scie_md:comment:end -->', validate: 'string' },
}));

const scieInstructionSchema = $nodeSchema('scie_instruction', () => metadataSchema('scie_instruction', {
  raw: { default: '', validate: 'string' },
  target: { default: 'next-block', validate: 'string' },
  prompt: { default: '', validate: 'string' },
}));

const scieVariantGroupSchema = $nodeSchema('scie_variant_group', () => metadataSchema('scie_variant_group', {
  raw: { default: '', validate: 'string' },
  groupId: { default: '', validate: 'string' },
  active: { default: '', validate: 'string' },
  target: { default: '', validate: 'string' },
  quote: { default: '', validate: 'string' },
  prefix: { default: '', validate: 'string' },
  suffix: { default: '', validate: 'string' },
  itemsJson: { default: '[]', validate: 'string' },
}));

const scieDirectiveBlockSchema = $nodeSchema('scie_directive_block', () => metadataSchema('scie_directive_block', {
  raw: { default: '', validate: 'string' },
  name: { default: 'note', validate: 'string' },
  label: { default: '', validate: 'string' },
  detail: { default: '', validate: 'string' },
  body: { default: '', validate: 'string' },
}));

const scieMermaidBlockSchema = $nodeSchema('scie_mermaid_block', () => metadataSchema('scie_mermaid_block', {
  raw: { default: '', validate: 'string' },
  body: { default: '', validate: 'string' },
}));

const scieSvgBlockSchema = $nodeSchema('scie_svg_block', () => metadataSchema('scie_svg_block', {
  raw: { default: '', validate: 'string' },
  body: { default: '', validate: 'string' },
}));

const scieLockStartView = $view(scieLockStartSchema.node, (): NodeViewConstructor => (node, view, getPos) =>
  new LockStartNodeView(node, view, getPos));

const scieLockEndView = $view(scieLockEndSchema.node, (): NodeViewConstructor => () => {
  const dom = document.createElement('div');
  dom.className = 'scie-md-lock-boundary scie-md-lock-end';
  dom.contentEditable = 'false';
  dom.setAttribute('aria-label', 'Locked section ends');
  dom.dataset.scieMdNode = 'lock-end';
  return selectableNodeView(dom);
});

const scieLockAnchorView = $view(scieLockAnchorSchema.node, (): NodeViewConstructor => (node, view, getPos) =>
  new LockAnchorNodeView(node, view, getPos));

const scieCommentEndView = $view(scieCommentEndSchema.node, (): NodeViewConstructor => () => {
  const dom = document.createElement('div');
  dom.className = 'scie-md-note-boundary scie-md-note-end';
  dom.contentEditable = 'false';
  dom.setAttribute('aria-label', 'LLM note target ends');
  dom.dataset.scieMdNode = 'comment-end';
  return selectableNodeView(dom);
});

const scieCommentView = $view(scieCommentSchema.node, (): NodeViewConstructor => (node, view, getPos) =>
  new NoteNodeView(node, view, getPos, 'comment'));

const scieInstructionView = $view(scieInstructionSchema.node, (): NodeViewConstructor => (node, view, getPos) =>
  new NoteNodeView(node, view, getPos, 'instruction'));

const scieVariantGroupView = $view(scieVariantGroupSchema.node, (): NodeViewConstructor => (node, view, getPos) =>
  new VariantNodeView(node, view, getPos));

const scieDirectiveBlockView = $view(scieDirectiveBlockSchema.node, (): NodeViewConstructor => (node, view, getPos) =>
  new RenderedMarkdownAtomNodeView(node, view, getPos, 'directive'));

const scieMermaidBlockView = $view(scieMermaidBlockSchema.node, (): NodeViewConstructor => (node, view, getPos) =>
  new RenderedMarkdownAtomNodeView(node, view, getPos, 'mermaid'));

const scieSvgBlockView = $view(scieSvgBlockSchema.node, (): NodeViewConstructor => (node, view, getPos) =>
  new RenderedMarkdownAtomNodeView(node, view, getPos, 'svg'));

const scieMetadataDecorationPluginKey = new PluginKey<DecorationSet>('scie-md-metadata-decorations');
const MAX_SCIE_METADATA_DECORATIONS = 1000;

const scieMetadataDecorationPlugin = $prose(() => new Plugin({
  key: scieMetadataDecorationPluginKey,
  filterTransaction(transaction, state) {
    if (!transaction.docChanged) return true;
    if (transaction.getMeta(lockOperationMeta)) return true;
    const lockedRanges = collectLockedRanges(state.doc);
    if (lockedRanges.length === 0) return true;
    const blockedRange = transactionTouchedLockedRange(transaction, lockedRanges);
    if (!blockedRange) return true;
    emitLockViolation(blockedRange);
    return false;
  },
  state: {
    init(_config, state) {
      return createScieMetadataDecorations(state.doc);
    },
    apply(transaction, decorations, _oldState, newState) {
      if (!transaction.docChanged) return decorations.map(transaction.mapping, transaction.doc);
      return createScieMetadataDecorations(newState.doc);
    },
  },
  props: {
    decorations(state) {
      return scieMetadataDecorationPluginKey.getState(state) ?? DecorationSet.empty;
    },
  },
}));

export const scieMetadataPlugins = [
  scieMetadataRemarkPlugin,
  scieLockStartSchema,
  scieLockEndSchema,
  scieLockAnchorSchema,
  scieCommentSchema,
  scieCommentEndSchema,
  scieInstructionSchema,
  scieVariantGroupSchema,
  scieDirectiveBlockSchema,
  scieMermaidBlockSchema,
  scieSvgBlockSchema,
  scieLockStartView,
  scieLockEndView,
  scieLockAnchorView,
  scieCommentView,
  scieCommentEndView,
  scieInstructionView,
  scieVariantGroupView,
  scieDirectiveBlockView,
  scieMermaidBlockView,
  scieSvgBlockView,
  scieMetadataDecorationPlugin,
] as unknown as MilkdownPlugin[];

function metadataSchema(
  name: MetadataNodeKind,
  attrs: Record<string, { default: unknown; validate: string }>,
): any {
  return {
    group: 'block',
    atom: true,
    selectable: true,
    isolating: true,
    marks: '',
    attrs,
    parseDOM: [
      {
        tag: `div[data-scie-md-node="${name}"]`,
        getAttrs: (dom: HTMLElement) => {
          const raw = dom.dataset.raw ?? '';
          return metadataAttrsFromRaw(name, raw);
        },
      },
    ],
    toDOM: (node: ProseNode) => ['div', {
      'data-scie-md-node': name,
      'data-raw': node.attrs.raw,
    }],
    parseMarkdown: {
      match: (node: MdastNode) => node.type === name,
      runner: (state: { addNode: (type: string, attrs?: Record<string, unknown>) => void }, node: MdastNode, type: string) => {
        state.addNode(type, mdastAttrsFor(name, node));
      },
    },
    toMarkdown: {
      match: (node: ProseNode) => node.type.name === name,
      runner: (state: { addNode: (type: string, children?: unknown, value?: string) => void }, node: ProseNode) => {
        state.addNode('html', undefined, node.attrs.raw || defaultRawForNode(node));
      },
    },
  };
}

export function metadataAttrsFromRaw(name: MetadataNodeKind, raw: string): Record<string, unknown> {
  const metadata = metadataNodeFromHtml(raw);
  if (metadata?.type === name) return mdastAttrsFor(name, metadata);
  if (name === 'scie_variant_group') {
    const group = parseVariantGroups(raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n'))[0];
    if (group) {
      return {
        raw,
        groupId: group.id,
        active: group.active,
        target: group.target ?? '',
        quote: group.quote ?? '',
        itemsJson: JSON.stringify(group.items.map((item) => ({
          id: item.id,
          name: item.name,
          markdown: item.markdown,
        } satisfies VariantItemViewModel))),
      };
    }
  }
  if (name === 'scie_directive_block') return { ...attrsForDirectiveRaw(raw) };
  if (name === 'scie_mermaid_block') return { ...attrsForMermaidRaw(raw) };
  if (name === 'scie_svg_block') return { ...attrsForSvgRaw(raw) };
  return { raw };
}

function mdastAttrsFor(name: MetadataNodeKind, node: MdastNode): Record<string, unknown> {
  if (name === 'scie_lock_start') return {
    raw: String(node.raw ?? ''),
    reason: String(node.reason ?? ''),
  };
  if (name === 'scie_lock_anchor') return {
    raw: String(node.raw ?? ''),
    lockId: String(node.lockId ?? ''),
    reason: String(node.reason ?? ''),
    target: String(node.target ?? 'quote'),
    quote: String(node.quote ?? ''),
    prefix: String(node.prefix ?? ''),
    suffix: String(node.suffix ?? ''),
  };
  if (name === 'scie_comment') return {
    raw: String(node.raw ?? ''),
    audience: String(node.audience ?? 'llm'),
    body: String(node.body ?? ''),
    noteId: String(node.noteId ?? ''),
    kind: String(node.kind ?? node.audience ?? 'llm'),
    target: String(node.target ?? ''),
    quote: String(node.quote ?? ''),
    prefix: String(node.prefix ?? ''),
    suffix: String(node.suffix ?? ''),
    sourceNoteId: String(node.sourceNoteId ?? ''),
  };
  if (name === 'scie_instruction') return {
    raw: String(node.raw ?? ''),
    target: String(node.target ?? 'next-block'),
    prompt: String(node.prompt ?? ''),
  };
  if (name === 'scie_variant_group') return {
    raw: String(node.raw ?? ''),
    groupId: String(node.groupId ?? ''),
    active: String(node.active ?? ''),
    target: String(node.target ?? ''),
    quote: String(node.quote ?? ''),
    prefix: String(node.prefix ?? ''),
    suffix: String(node.suffix ?? ''),
    itemsJson: String(node.itemsJson ?? '[]'),
  };
  if (name === 'scie_directive_block') return {
    raw: String(node.raw ?? ''),
    name: String(node.name ?? 'note'),
    label: String(node.label ?? ''),
    detail: String(node.detail ?? ''),
    body: String(node.body ?? ''),
  };
  if (name === 'scie_mermaid_block') return {
    raw: String(node.raw ?? ''),
    body: String(node.body ?? ''),
  };
  if (name === 'scie_svg_block') return {
    raw: String(node.raw ?? ''),
    body: String(node.body ?? ''),
  };
  return { raw: String(node.raw ?? '') };
}

function defaultRawForNode(node: ProseNode): string {
  if (node.type.name === 'scie_lock_end') return '<!-- scie_md:lock:end -->';
  if (node.type.name === 'scie_lock_anchor') {
    return buildLockAnchorRaw(
      String(node.attrs.lockId ?? ''),
      String(node.attrs.quote ?? ''),
      String(node.attrs.reason ?? ''),
      String(node.attrs.target ?? 'quote'),
      String(node.attrs.prefix ?? ''),
      String(node.attrs.suffix ?? ''),
    );
  }
  if (node.type.name === 'scie_comment_end') return '<!-- scie_md:comment:end -->';
  if (node.type.name === 'scie_comment') {
    const noteId = String(node.attrs.noteId ?? '');
    const raw = String(node.attrs.raw ?? '');
    if (noteId || raw.includes('scie_md:note')) {
      return createEditorNoteSnippet(String(node.attrs.body ?? ''), {
        id: noteId || undefined,
        kind: normalizeNoteKind(String(node.attrs.kind ?? node.attrs.audience ?? 'llm')),
        target: String(node.attrs.target ?? '') || undefined,
        quote: String(node.attrs.quote ?? '') || undefined,
        prefix: String(node.attrs.prefix ?? '') || undefined,
        suffix: String(node.attrs.suffix ?? '') || undefined,
        sourceNoteId: String(node.attrs.sourceNoteId ?? '') || undefined,
      });
    }
    return createEditorCommentSnippet(String(node.attrs.body ?? ''), normalizeAudience(String(node.attrs.audience ?? 'llm')));
  }
  if (node.type.name === 'scie_instruction') return createTargetedInstructionSnippet(String(node.attrs.prompt ?? ''), normalizeTarget(String(node.attrs.target ?? 'next-block'))).trim();
  return String(node.attrs.raw ?? '');
}

function transformChildren(node: MdastNode, sourceMarkdown: string): void {
  if (!node.children) return;
  const children = node.children;
  replaceDirectiveAndMermaidNodes(children, sourceMarkdown);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    transformChildren(child, sourceMarkdown);
    if (child.type !== 'html' || typeof child.value !== 'string') continue;
    if (variantGroupPattern.test(child.value.trim())) {
      const variant = buildVariantNode(children, index, sourceMarkdown);
      if (variant) {
        children.splice(index, variant.removeCount, variant.node);
      }
      continue;
    }
    if (commentStartPattern.test(child.value.trim())) {
      const comment = buildDelimitedCommentNode(children, index, sourceMarkdown);
      if (comment) {
        children.splice(index, comment.removeCount, comment.node);
      }
      continue;
    }
    const metadata = metadataNodeFromHtml(child.value);
    if (metadata) {
      children[index] = withPosition(metadata, child);
    }
  }
}

function buildDelimitedCommentNode(children: MdastNode[], startIndex: number, sourceMarkdown: string): { node: MdastNode; removeCount: number } | null {
  const start = children[startIndex];
  if (start.type !== 'html' || typeof start.value !== 'string') return null;
  const startMatch = start.value.trim().match(commentStartPattern);
  if (!startMatch) return null;

  let endIndex = -1;
  for (let index = startIndex + 1; index < children.length; index += 1) {
    const child = children[index];
    if (child.type === 'html' && typeof child.value === 'string' && commentEndPattern.test(child.value.trim())) {
      endIndex = index;
      break;
    }
  }

  const end = endIndex >= 0 ? children[endIndex] : start;
  const requestedAudience = (startMatch[1] ?? startMatch[2] ?? startMatch[3] ?? 'both').toLowerCase();
  const audience = normalizeAudience(requestedAudience);
  const body = delimitedCommentBody(children, startIndex, endIndex, sourceMarkdown);
  return {
    removeCount: Math.max(1, (endIndex >= 0 ? endIndex : startIndex) - startIndex + 1),
    node: withPosition({
      type: 'scie_comment',
      raw: createEditorCommentSnippet(body, audience),
      audience,
      body,
      noteId: '',
      kind: audience,
      target: 'block-range',
      quote: '',
      sourceNoteId: '',
    }, start, end),
  };
}

function delimitedCommentBody(children: MdastNode[], startIndex: number, endIndex: number, sourceMarkdown: string): string {
  if (endIndex > startIndex) {
    const startEnd = children[startIndex].position?.end?.offset;
    const endStart = children[endIndex].position?.start?.offset;
    if (typeof startEnd === 'number' && typeof endStart === 'number' && sourceMarkdown) {
      return sourceMarkdown.slice(startEnd, endStart).trim();
    }
    return fallbackRawForNodes(children.slice(startIndex + 1, endIndex)).trim();
  }
  return '';
}

function buildVariantNode(children: MdastNode[], startIndex: number, sourceMarkdown: string): { node: MdastNode; removeCount: number } | null {
  let endIndex = -1;
  for (let index = startIndex + 1; index < children.length; index += 1) {
    const child = children[index];
    if (child.type === 'html' && typeof child.value === 'string' && variantEndPattern.test(child.value.trim())) {
      endIndex = index;
      break;
    }
  }
  if (endIndex === -1) return null;
  const raw = markdownSliceForNodes(children[startIndex], children[endIndex], sourceMarkdown)
    ?? fallbackRawForNodes(children.slice(startIndex, endIndex + 1));
  const group = parseVariantGroups(raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n'))[0];
  if (!group) return null;
  return {
    removeCount: endIndex - startIndex + 1,
    node: withPosition({
      type: 'scie_variant_group',
      raw,
      groupId: group.id,
      active: group.active,
      target: group.target ?? '',
      quote: group.quote ?? '',
      prefix: group.prefix ?? '',
      suffix: group.suffix ?? '',
      itemsJson: JSON.stringify(group.items.map((item) => ({
        id: item.id,
        name: item.name,
        markdown: item.markdown,
      } satisfies VariantItemViewModel))),
    }, children[startIndex], children[endIndex]),
  };
}

interface SourceRangeNode {
  start: number;
  end: number;
  node: MdastNode;
}

function replaceDirectiveAndMermaidNodes(children: MdastNode[], sourceMarkdown: string): void {
  if (!sourceMarkdown || children.length === 0) return;
  const ranges = collectDirectiveAndMermaidNodes(sourceMarkdown);
  if (ranges.length === 0) return;

  for (const range of ranges) {
    const span = childSpanForSourceRange(children, range.start, range.end);
    if (!span) continue;
    children.splice(span.startIndex, span.removeCount, withPosition(range.node, children[span.startIndex], children[span.endIndex]));
  }
}

function collectDirectiveAndMermaidNodes(sourceMarkdown: string): SourceRangeNode[] {
  const ranges = removeOverlappingSourceRanges([
    ...collectDirectiveNodes(sourceMarkdown),
    ...collectMermaidNodes(sourceMarkdown),
    ...collectSvgNodes(sourceMarkdown),
  ].sort((a, b) => a.start - b.start || b.end - a.end));
  return ranges.sort((a, b) => b.start - a.start);
}

function collectDirectiveNodes(sourceMarkdown: string): SourceRangeNode[] {
  const starts = lineStartOffsets(sourceMarkdown);
  return parseDirectiveBlocks(sourceMarkdown)
    .filter((directive) => directive.known && directive.endLine !== null)
    .map((directive) => {
      const start = starts[directive.line - 1] ?? 0;
      const end = lineEndOffset(starts, sourceMarkdown, directive.endLine ?? directive.line);
      return {
        start,
        end,
        node: directiveNodeFromBlock(directive),
      };
    });
}

function collectMermaidNodes(sourceMarkdown: string): SourceRangeNode[] {
  return findMermaidFenceBlocks(sourceMarkdown).map((block) => ({
    start: block.start,
    end: block.end,
    node: mermaidNodeFromRaw(block.raw),
  }));
}

function collectSvgNodes(sourceMarkdown: string): SourceRangeNode[] {
  return findSvgFenceBlocks(sourceMarkdown).map((block) => ({
    start: block.start,
    end: block.end,
    node: svgNodeFromRaw(block.raw),
  }));
}

function directiveNodeFromBlock(directive: DirectiveBlock): MdastNode {
  return {
    type: 'scie_directive_block',
    ...attrsForDirectiveBlock(directive),
  };
}

function attrsForDirectiveBlock(directive: DirectiveBlock): DirectiveAttrs {
  return {
    raw: directive.raw,
    name: directive.name,
    label: directive.label ?? '',
    detail: directiveDetail(directive),
    body: directiveBody(directive.raw),
  };
}

function mermaidNodeFromRaw(raw: string): MdastNode {
  return {
    type: 'scie_mermaid_block',
    ...attrsForMermaidRaw(raw),
  };
}

function svgNodeFromRaw(raw: string): MdastNode {
  return {
    type: 'scie_svg_block',
    ...attrsForSvgRaw(raw),
  };
}

function attrsForDirectiveRaw(raw: string): DirectiveAttrs {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const directive = parseDirectiveBlocks(normalized).find((item) => item.known && item.endLine !== null && item.line === 1);
  if (directive) return attrsForDirectiveBlock(directive);
  return {
    raw: normalized || ':::note\nWrite the note here.\n:::',
    name: 'note',
    label: '',
    detail: 'Invalid directive syntax',
    body: normalized,
  };
}

function attrsForMermaidRaw(raw: string): MermaidAttrs {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const body = mermaidFenceBody(raw);
  return {
    raw: normalized || '```mermaid\nflowchart LR\n  A --> B\n```',
    body,
  };
}

function childSpanForSourceRange(
  children: MdastNode[],
  start: number,
  end: number,
): { startIndex: number; endIndex: number; removeCount: number } | null {
  let startIndex = -1;
  let endIndex = -1;

  for (let index = 0; index < children.length; index += 1) {
    const childStart = children[index].position?.start?.offset;
    const childEnd = children[index].position?.end?.offset;
    if (typeof childStart !== 'number' || typeof childEnd !== 'number') continue;
    if (childEnd <= start || childStart >= end) continue;
    if (startIndex === -1) startIndex = index;
    endIndex = index;
  }

  if (startIndex < 0 || endIndex < startIndex) return null;
  return { startIndex, endIndex, removeCount: endIndex - startIndex + 1 };
}

function lineEndOffset(starts: number[], sourceMarkdown: string, line: number): number {
  const nextLineStart = starts[line];
  if (typeof nextLineStart === 'number') {
    const maybeCarriageReturn = sourceMarkdown[nextLineStart - 2] === '\r' ? 2 : 1;
    return Math.max(starts[line - 1] ?? 0, nextLineStart - maybeCarriageReturn);
  }
  return sourceMarkdown.length;
}

function removeOverlappingSourceRanges(ranges: SourceRangeNode[]): SourceRangeNode[] {
  const accepted: SourceRangeNode[] = [];
  for (const range of ranges) {
    if (accepted.some((item) => range.start < item.end && item.start < range.end)) continue;
    accepted.push(range);
  }
  return accepted;
}

function directiveDetail(directive: DirectiveBlock): string {
  const parts = [
    directive.label ? `#${directive.label}` : '',
    directive.classes.length > 0 ? directive.classes.map((item) => `.${item}`).join(' ') : '',
  ].filter(Boolean);
  return parts.join(' - ') || directive.opening;
}

function autoResizeTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(520, Math.max(120, textarea.scrollHeight))}px`;
}

function normalizeVariantMarkdown(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function insertPlainTextAtSelection(container: HTMLElement, text: string): void {
  const selection = container.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || !container.contains(selection.anchorNode)) {
    container.append(document.createTextNode(text));
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function nextVariantNumber(items: VariantItemViewModel[]): number {
  const used = new Set<number>();
  for (const item of items) {
    const match = item.id.match(/^v(\d+)$/i);
    if (match) used.add(Number(match[1]));
  }
  let next = items.length + 1;
  while (used.has(next)) next += 1;
  return next;
}

function markdownSliceForNodes(startNode: MdastNode, endNode: MdastNode, sourceMarkdown: string): string | null {
  const start = startNode.position?.start?.offset;
  const end = endNode.position?.end?.offset;
  if (typeof start !== 'number' || typeof end !== 'number' || !sourceMarkdown) return null;
  return sourceMarkdown.slice(start, end);
}

function fallbackRawForNodes(nodes: MdastNode[]): string {
  return nodes.map((node) => typeof node.value === 'string' ? node.value : '').join('\n');
}

function withPosition(node: MdastNode, startFrom: MdastNode, endFrom = startFrom): MdastNode {
  return {
    ...node,
    position: {
      start: startFrom.position?.start,
      end: endFrom.position?.end,
    },
  };
}

function selectableNodeView(dom: HTMLElement): NodeView {
  return {
    dom,
    selectNode: () => dom.classList.add('selected'),
    deselectNode: () => dom.classList.remove('selected'),
    stopEvent: () => true,
    ignoreMutation: () => true,
  };
}

class LockStartNodeView implements NodeView {
  dom: HTMLElement;
  private node: ProseNode;

  constructor(
    node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.node = node;
    this.dom = document.createElement('div');
    this.dom.className = 'scie-md-lock-boundary scie-md-lock-start';
    this.dom.contentEditable = 'false';
    this.dom.dataset.scieMdNode = 'lock-start';
    this.render();
  }

  update(node: ProseNode): boolean {
    if (node.type.name !== this.node.type.name) return false;
    this.node = node;
    this.render();
    return true;
  }

  stopEvent(event: Event): boolean {
    return this.dom.contains(event.target as Node);
  }

  ignoreMutation(): boolean {
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('selected');
  }

  private render(): void {
    const reason = String(this.node.attrs.reason ?? '');
    this.dom.setAttribute('aria-label', reason ? `Locked section starts: ${reason}` : 'Locked section starts');
    this.dom.replaceChildren();

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'scie-md-lock-unlock';
    button.textContent = 'Unlock';
    button.title = reason ? `Unlock this protected section: ${reason}` : 'Unlock this protected section';
    button.setAttribute('aria-label', button.title);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.unlock();
    });
    this.dom.append(button);
  }

  private unlock(): void {
    const position = this.getPos();
    if (typeof position !== 'number') return;
    const match = findMatchingLockEnd(this.view.state.doc, position);
    if (!match) {
      const transaction = this.view.state.tr
        .delete(position, position + this.node.nodeSize)
        .setMeta(lockOperationMeta, true);
      this.view.dispatch(transaction);
      this.view.focus();
      return;
    }

    const transaction = this.view.state.tr
      .delete(match.from, match.to)
      .delete(position, position + this.node.nodeSize)
      .setMeta(lockOperationMeta, true);
    this.view.dispatch(transaction);
    this.view.focus();
  }
}

class LockAnchorNodeView implements NodeView {
  dom: HTMLElement;
  private node: ProseNode;

  constructor(
    node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.node = node;
    this.dom = document.createElement('div');
    this.dom.className = 'scie-md-lock-anchor';
    this.dom.contentEditable = 'false';
    this.dom.dataset.scieMdNode = 'lock-anchor';
    this.render();
  }

  update(node: ProseNode): boolean {
    if (node.type.name !== this.node.type.name) return false;
    this.node = node;
    this.render();
    return true;
  }

  stopEvent(event: Event): boolean {
    return this.dom.contains(event.target as Node);
  }

  ignoreMutation(): boolean {
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('selected');
  }

  private render(): void {
    const reason = String(this.node.attrs.reason ?? '');
    this.dom.setAttribute('aria-label', reason ? `Locked quote: ${reason}` : 'Locked quote');
    this.dom.replaceChildren();

    const card = document.createElement('aside');
    card.className = 'scie-md-lock-card';
    const header = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = 'Locked quote';
    const meta = document.createElement('span');
    meta.textContent = reason || 'human-approved';
    header.append(title, meta);

    const quote = document.createElement('p');
    quote.textContent = shortDisplayText(String(this.node.attrs.quote ?? ''), 120);

    const actions = document.createElement('div');
    actions.className = 'scie-md-note-actions';
    const unlock = document.createElement('button');
    unlock.type = 'button';
    unlock.className = 'danger';
    unlock.textContent = 'Unlock';
    unlock.title = reason ? `Unlock this quote: ${reason}` : 'Unlock this quote';
    unlock.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.unlock();
    });
    actions.append(unlock);
    card.append(header, quote, actions);
    this.dom.append(card);
  }

  private unlock(): void {
    const position = this.getPos();
    if (typeof position !== 'number') return;
    const transaction = this.view.state.tr
      .delete(position, position + this.node.nodeSize)
      .setMeta(lockOperationMeta, true);
    this.view.dispatch(transaction);
    this.view.focus();
  }
}

class NoteNodeView implements NodeView {
  dom: HTMLElement;
  private node: ProseNode;
  private mode: 'rendered' | 'editing' = 'rendered';

  constructor(
    node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly noteType: 'comment' | 'instruction',
  ) {
    this.node = node;
    this.dom = document.createElement('div');
    this.dom.className = `scie-md-note-anchor scie-md-${noteType}-anchor`;
    this.dom.contentEditable = 'false';
    this.dom.dataset.scieMdNode = noteType === 'comment' ? 'comment' : 'instruction';
    this.render();
  }

  update(node: ProseNode): boolean {
    if (node.type.name !== this.node.type.name) return false;
    this.node = node;
    this.render();
    return true;
  }

  stopEvent(event: Event): boolean {
    return this.dom.contains(event.target as Node);
  }

  ignoreMutation(): boolean {
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('selected');
  }

  private render(): void {
    this.dom.replaceChildren(this.mode === 'editing' ? this.createEditor() : this.createRendered());
  }

  private createRendered(): HTMLElement {
    const card = document.createElement('aside');
    card.className = `scie-md-note-card ${this.noteType === 'instruction' ? 'is-instruction' : `is-comment is-${normalizeNoteKind(String(this.node.attrs.kind ?? this.node.attrs.audience ?? 'llm'))}-note`}`;
    card.setAttribute('aria-label', this.noteType === 'instruction' ? 'Targeted LLM instruction' : this.commentTitle());

    const header = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = this.noteType === 'instruction' ? 'LLM instruction' : this.commentTitle();
    const meta = document.createElement('span');
    meta.textContent = this.noteType === 'instruction'
      ? `target: ${String(this.node.attrs.target ?? 'next-block')}`
      : this.commentMeta();
    header.append(title, meta);

    const body = document.createElement('p');
    body.textContent = this.noteType === 'instruction'
      ? String(this.node.attrs.prompt ?? '')
      : String(this.node.attrs.body ?? '');

    const actions = document.createElement('div');
    actions.className = 'scie-md-note-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = 'Edit';
    edit.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.mode = 'editing';
      this.render();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = 'Remove';
    remove.title = this.noteType === 'instruction' ? 'Remove this LLM instruction' : 'Remove this LLM note';
    remove.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.removeNote();
    });
    actions.append(edit, remove);
    card.append(header, body, actions);
    return card;
  }

  private createEditor(): HTMLElement {
    const card = document.createElement('aside');
    card.className = `scie-md-note-card is-editing ${this.noteType === 'instruction' ? 'is-instruction' : `is-comment is-${normalizeNoteKind(String(this.node.attrs.kind ?? this.node.attrs.audience ?? 'llm'))}-note`}`;
    const label = document.createElement('label');
    label.textContent = this.noteType === 'instruction' ? 'Instruction for the LLM' : this.commentTitle();
    const textarea = document.createElement('textarea');
    textarea.value = this.noteType === 'instruction'
      ? String(this.node.attrs.prompt ?? '')
      : String(this.node.attrs.body ?? '');
    textarea.rows = 4;

    const actions = document.createElement('div');
    actions.className = 'scie-md-note-actions';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.textContent = 'Apply';
    apply.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.applyEdit(textarea.value);
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.mode = 'rendered';
      this.render();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = 'Remove';
    remove.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.removeNote();
    });
    actions.append(apply, cancel, remove);
    card.append(label, textarea, actions);
    queueMicrotask(() => textarea.focus());
    return card;
  }

  private applyEdit(value: string): void {
    const position = this.getPos();
    if (typeof position !== 'number') return;
    if (nodeTouchesProtectedBlock(this.view.state.doc, position, this.node.nodeSize)) {
      visualAtomToast(`Cannot edit ${this.commentTitle()} inside a locked section. Unlock the section first.`, 'warning');
      return;
    }
    const attrs = this.noteType === 'instruction'
      ? {
          ...this.node.attrs,
          prompt: value.trim(),
          raw: createTargetedInstructionSnippet(value.trim(), normalizeTarget(String(this.node.attrs.target ?? 'next-block'))).trim(),
        }
      : {
          ...this.node.attrs,
          body: value.trim(),
          raw: this.commentRawForEdit(value.trim()),
        };
    const transaction = this.view.state.tr.setNodeMarkup(position, undefined, attrs);
    this.view.dispatch(transaction);
    this.mode = 'rendered';
    this.render();
    this.view.focus();
  }

  private commentTitle(): string {
    return normalizeNoteKind(String(this.node.attrs.kind ?? this.node.attrs.audience ?? 'llm')) === 'human'
      ? 'Note to Human'
      : 'Note to LLM';
  }

  private commentMeta(): string {
    const source = String(this.node.attrs.sourceNoteId ?? '');
    if (source) return `source: ${source}`;
    const target = String(this.node.attrs.target ?? '');
    const quote = String(this.node.attrs.quote ?? '');
    if (target === 'quote' && quote) return `quote: ${quote.length > 80 ? `${quote.slice(0, 79).trimEnd()}...` : quote}`;
    if (target) return `target: ${target}`;
    return String(this.node.attrs.audience ?? 'llm');
  }

  private commentRawForEdit(body: string): string {
    const raw = String(this.node.attrs.raw ?? '');
    const noteId = String(this.node.attrs.noteId ?? '');
    if (noteId || raw.includes('scie_md:note')) {
      return createEditorNoteSnippet(body, {
        id: noteId || undefined,
        kind: normalizeNoteKind(String(this.node.attrs.kind ?? this.node.attrs.audience ?? 'llm')),
        target: String(this.node.attrs.target ?? '') || undefined,
        quote: String(this.node.attrs.quote ?? '') || undefined,
        prefix: String(this.node.attrs.prefix ?? '') || undefined,
        suffix: String(this.node.attrs.suffix ?? '') || undefined,
        sourceNoteId: String(this.node.attrs.sourceNoteId ?? '') || undefined,
      });
    }
    return createEditorCommentSnippet(body, normalizeAudience(String(this.node.attrs.audience ?? 'llm')));
  }

  private removeNote(): void {
    const position = this.getPos();
    if (typeof position !== 'number') return;
    if (nodeTouchesProtectedBlock(this.view.state.doc, position, this.node.nodeSize)) {
      visualAtomToast(`Cannot remove ${this.commentTitle()} inside a locked section. Unlock the section first.`, 'warning');
      return;
    }
    const transaction = this.view.state.tr;
    const target = String(this.node.attrs.target ?? '');
    const raw = String(this.node.attrs.raw ?? '');
    const noteId = String(this.node.attrs.noteId ?? '');
    const isLegacyComment = this.noteType === 'comment' && !noteId && !raw.includes('scie_md:note');
    const hasSelectionBoundary = this.noteType === 'comment' && (target === 'selection' || target === 'block-range');

    if (isLegacyComment || hasSelectionBoundary) {
      const end = findNextTopLevelNode(this.view.state.doc, position, 'scie_comment_end');
      if (end) transaction.delete(end.from, end.to);
    }

    transaction.delete(position, position + this.node.nodeSize);
    this.view.dispatch(transaction.scrollIntoView());
    this.view.focus();
  }
}

class VariantNodeView implements NodeView {
  dom: HTMLElement;
  private node: ProseNode;
  private renderId = 0;
  private editingItemId: string | null = null;
  private pendingMarkdown: string | null = null;
  private originalEditingMarkdown: string | null = null;
  private isComposing = false;
  private saveTimer: number | null = null;
  private menuCloseTimer: number | null = null;

  constructor(
    node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.node = node;
    this.dom = document.createElement('section');
    this.dom.className = 'scie-md-variant-inline';
    this.dom.contentEditable = 'false';
    this.dom.dataset.scieMdNode = 'variant-group';
    activeVariantNodeViews.add(this);
    this.render();
  }

  update(node: ProseNode): boolean {
    if (node.type.name !== this.node.type.name) return false;
    this.node = node;
    if (!this.editingItemId) this.render();
    return true;
  }

  stopEvent(event: Event): boolean {
    return this.dom.contains(event.target as Node);
  }

  ignoreMutation(): boolean {
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('selected');
  }

  destroy(): void {
    this.flushActiveEdit(false);
    this.clearSaveTimer();
    this.clearMenuCloseTimer();
    activeVariantNodeViews.delete(this);
  }

  flushPendingEditForSync(): boolean {
    this.clearSaveTimer();
    return this.flushActiveEdit(false);
  }

  private render(): void {
    const items = this.items();
    const active = items.find((item) => item.id === this.active()) ?? items[0];
    this.dom.replaceChildren();
    this.dom.dataset.variantCount = String(items.length);
    this.dom.dataset.activeVariant = active?.id ?? '';
    this.dom.classList.toggle('is-anchored', this.target() === 'quote' && Boolean(this.quote()));

    const content = document.createElement('div');
    content.className = 'scie-md-variant-prose';
    content.contentEditable = active ? 'true' : 'false';
    content.spellcheck = false;
    content.setAttribute('role', 'textbox');
    content.setAttribute('aria-label', active
      ? `Active text version ${this.variantIndex(active.id)}. Edit this text directly; changes are saved to this version.`
      : 'Text version');
    content.dataset.placeholder = active ? `Version ${this.variantIndex(active.id)}` : 'No versions';
    content.addEventListener('focus', () => {
      if (!active) return;
      this.editingItemId = active.id;
      this.originalEditingMarkdown = normalizeVariantMarkdown(active.markdown);
      this.pendingMarkdown = null;
      this.isComposing = false;
      this.dom.classList.add('editing');
      content.classList.add('is-source-editing');
      content.textContent = active.markdown;
    });
    content.addEventListener('compositionstart', () => {
      this.isComposing = true;
    });
    content.addEventListener('compositionend', () => {
      this.isComposing = false;
      this.captureActiveEdit(content, active);
    });
    content.addEventListener('paste', (event) => {
      if (!active) return;
      const text = event.clipboardData?.getData('text/plain');
      if (text === undefined) return;
      event.preventDefault();
      insertPlainTextAtSelection(content, text);
      this.captureActiveEdit(content, active);
    });
    content.addEventListener('input', () => {
      if (this.isComposing) return;
      this.captureActiveEdit(content, active);
    });
    content.addEventListener('blur', () => {
      this.isComposing = false;
      this.flushActiveEdit(true);
      this.editingItemId = null;
      this.originalEditingMarkdown = null;
      this.dom.classList.remove('editing');
      this.render();
    });

    const rail = this.createRail(items, active);
    this.dom.append(content, rail);
    if (active?.markdown) {
      void this.renderMarkdown(content, active.markdown);
    } else {
      content.textContent = 'No active version.';
    }
  }

  private async renderMarkdown(container: HTMLElement, markdown: string): Promise<void> {
    const id = ++this.renderId;
    try {
      const html = await renderMarkdownHtmlFragmentLazy(markdown, null, { embedImages: false });
      if (id === this.renderId && !this.editingItemId) setSanitizedHtml(container, html);
    } catch {
      if (id === this.renderId && !this.editingItemId) container.textContent = markdown;
    }
  }

  private createRail(items: VariantItemViewModel[], active: VariantItemViewModel | undefined): HTMLElement {
    const rail = document.createElement('div');
    rail.className = 'scie-md-variant-rail';
    rail.addEventListener('mouseenter', () => this.openVariantMenu(rail));
    rail.addEventListener('mouseleave', () => this.scheduleCloseVariantMenu(rail));
    rail.addEventListener('focusin', () => this.openVariantMenu(rail));
    rail.addEventListener('focusout', () => this.scheduleCloseVariantMenu(rail));

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'scie-md-variant-trigger';
    trigger.title = `${items.length} text version${items.length === 1 ? '' : 's'}`;
    trigger.setAttribute('aria-label', `${items.length} text version${items.length === 1 ? '' : 's'}`);
    for (let index = 0; index < 3; index += 1) {
      trigger.append(document.createElement('span'));
    }
    const triggerCount = document.createElement('b');
    triggerCount.className = 'scie-md-variant-count';
    triggerCount.textContent = String(items.length);
    trigger.append(triggerCount);

    const menu = document.createElement('div');
    menu.className = 'scie-md-variant-menu';
    menu.setAttribute('role', 'menu');
    menu.addEventListener('mouseenter', () => this.openVariantMenu(rail));
    menu.addEventListener('mouseleave', () => this.scheduleCloseVariantMenu(rail));

    const heading = document.createElement('div');
    heading.className = 'scie-md-variant-menu-heading';
    const title = document.createElement('strong');
    title.textContent = 'Versions';
    const count = document.createElement('span');
    count.textContent = `${items.length}`;
    heading.append(title, count);
    menu.append(heading);

    for (const item of items) {
      const row = document.createElement('div');
      row.className = `scie-md-variant-row${item.id === active?.id ? ' selected' : ''}`;

      const switchButton = document.createElement('button');
      switchButton.type = 'button';
      switchButton.className = 'scie-md-variant-switch';
      switchButton.setAttribute('role', 'menuitemradio');
      switchButton.setAttribute('aria-checked', String(item.id === active?.id));

      const code = document.createElement('span');
      code.className = 'scie-md-variant-code';
      code.textContent = `V${this.variantIndex(item.id)}`;
      const name = document.createElement('span');
      name.className = 'scie-md-variant-name';
      name.textContent = item.name || item.id;
      switchButton.append(code, name);
      switchButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.switchActive(item.id);
      });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'scie-md-variant-remove';
      remove.textContent = 'Delete';
      remove.title = `Delete ${item.name || item.id}`;
      remove.setAttribute('aria-label', `Delete ${item.name || item.id}`);
      remove.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.removeItem(item.id);
      });

      row.append(switchButton, remove);
      menu.append(row);
    }

    if (active) {
      const duplicate = document.createElement('button');
      duplicate.type = 'button';
      duplicate.className = 'scie-md-variant-duplicate';
      duplicate.textContent = 'Duplicate active';
      duplicate.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.duplicateActive();
      });
      menu.append(duplicate);
    }

    const hint = document.createElement('p');
    hint.className = 'scie-md-variant-hint';
    hint.textContent = 'Click a version to show it. Edit the visible text directly; changes stay with that version.';
    menu.append(hint);

    rail.append(trigger, menu);
    return rail;
  }

  private openVariantMenu(rail: HTMLElement): void {
    this.clearMenuCloseTimer();
    rail.classList.add('menu-open');
  }

  private scheduleCloseVariantMenu(rail: HTMLElement): void {
    this.clearMenuCloseTimer();
    this.menuCloseTimer = window.setTimeout(() => {
      if (rail.matches(':hover') || rail.contains(document.activeElement)) return;
      rail.classList.remove('menu-open');
      this.menuCloseTimer = null;
    }, 220);
  }

  private clearMenuCloseTimer(): void {
    if (this.menuCloseTimer !== null) {
      window.clearTimeout(this.menuCloseTimer);
      this.menuCloseTimer = null;
    }
  }

  private switchActive(active: string): void {
    if (active === this.active()) return;
    const position = this.getPos();
    if (typeof position !== 'number') return;
    if (nodeTouchesProtectedBlock(this.view.state.doc, position, this.node.nodeSize)) {
      visualAtomToast('Cannot switch text versions inside a locked section. Unlock the section first.', 'warning');
      return;
    }
    const items = this.itemsWithPendingEdit();
    this.pendingMarkdown = null;
    this.editingItemId = null;
    this.originalEditingMarkdown = null;
    this.dispatchVariantState(active, items);
  }

  private flushActiveEdit(shouldRender: boolean): boolean {
    if (!this.editingItemId || this.pendingMarkdown === null) return false;
    const position = this.getPos();
    if (typeof position !== 'number') return false;
    if (nodeTouchesProtectedBlock(this.view.state.doc, position, this.node.nodeSize)) {
      visualAtomToast('Cannot edit text versions inside a locked section. Unlock the section first.', 'warning');
      return false;
    }
    const nextMarkdown = normalizeVariantMarkdown(this.pendingMarkdown);
    if (nextMarkdown === this.originalEditingMarkdown) {
      this.pendingMarkdown = null;
      if (shouldRender) this.originalEditingMarkdown = null;
      return false;
    }
    const result = updateVariantItemMarkdown(
      this.groupId(),
      this.active(),
      this.items(),
      this.editingItemId,
      nextMarkdown,
    );
    this.originalEditingMarkdown = shouldRender ? null : nextMarkdown;
    this.pendingMarkdown = null;
    this.dispatchVariantState(result.active, result.items, { preserveEditing: !shouldRender });
    return true;
  }

  private captureActiveEdit(content: HTMLElement, active: VariantItemViewModel | undefined): void {
    if (!active) return;
    this.editingItemId = active.id;
    this.pendingMarkdown = normalizeVariantMarkdown(content.innerText || content.textContent || '');
    this.scheduleSaveActiveEdit();
  }

  private scheduleSaveActiveEdit(): void {
    this.clearSaveTimer();
    this.saveTimer = window.setTimeout(() => {
      this.flushActiveEdit(false);
    }, 450);
  }

  private clearSaveTimer(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  private async removeItem(itemId: string): Promise<void> {
    const items = this.itemsWithPendingEdit();
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    const label = item.name || item.id;
    const lastItem = items.length === 1;
    const confirmed = await visualAtomConfirm({
      title: lastItem ? `Delete only version "${label}"?` : `Delete version "${label}"?`,
      message: lastItem
        ? 'This removes the entire version group. You can undo with Ctrl+Z.'
        : 'This removes that draft from the version group. You can undo with Ctrl+Z.',
      okLabel: 'Delete',
      cancelLabel: 'Cancel',
    });
    if (!confirmed) return;
    const position = this.getPos();
    if (typeof position !== 'number') return;
    if (nodeTouchesProtectedBlock(this.view.state.doc, position, this.node.nodeSize)) {
      visualAtomToast('Cannot remove text versions inside a locked section. Unlock the section first.', 'warning');
      return;
    }
    this.pendingMarkdown = null;
    this.editingItemId = null;
    this.originalEditingMarkdown = null;
    const result = deleteVariantItem(this.groupId(), this.active(), items, itemId);
    if (!result) {
      this.deleteVariantGroup();
      return;
    }
    this.dispatchVariantState(result.active, result.items);
  }

  private duplicateActive(): void {
    const position = this.getPos();
    if (typeof position !== 'number') return;
    if (nodeTouchesProtectedBlock(this.view.state.doc, position, this.node.nodeSize)) {
      visualAtomToast('Cannot duplicate text versions inside a locked section. Unlock the section first.', 'warning');
      return;
    }
    const items = this.itemsWithPendingEdit();
    const active = items.find((item) => item.id === this.active()) ?? items[0];
    if (!active) return;
    const nextNumber = nextVariantNumber(items);
    const nextId = `v${nextNumber}`;
    const nextItem: VariantItemViewModel = {
      id: nextId,
      name: `Version ${nextNumber}`,
      markdown: active.markdown,
    };
    this.pendingMarkdown = null;
    this.editingItemId = null;
    this.originalEditingMarkdown = null;
    this.dispatchVariantState(nextId, [...items, nextItem]);
  }

  private dispatchVariantState(
    active: string,
    items: VariantItemViewModel[],
    options: { preserveEditing?: boolean } = {},
  ): void {
    const position = this.getPos();
    if (typeof position !== 'number') return;
    if (nodeTouchesProtectedBlock(this.view.state.doc, position, this.node.nodeSize)) {
      visualAtomToast('Cannot change text versions inside a locked section. Unlock the section first.', 'warning');
      return;
    }
    const nextActive = items.some((item) => item.id === active) ? active : items[0]?.id ?? '';
    const raw = buildVariantGroupRaw(this.groupId(), nextActive, items, {
      target: this.target() || undefined,
      quote: this.quote() || undefined,
      prefix: this.prefix() || undefined,
      suffix: this.suffix() || undefined,
    });
    if (!options.preserveEditing) {
      this.editingItemId = null;
      this.pendingMarkdown = null;
      this.originalEditingMarkdown = null;
      this.clearSaveTimer();
    }
    const transaction = this.view.state.tr.setNodeMarkup(position, undefined, {
      ...this.node.attrs,
      raw,
      groupId: this.groupId(),
      active: nextActive,
      target: this.target(),
      quote: this.quote(),
      prefix: this.prefix(),
      suffix: this.suffix(),
      itemsJson: JSON.stringify(items),
    });
    this.view.dispatch(transaction);
    if (!options.preserveEditing) this.view.focus();
  }

  private deleteVariantGroup(): void {
    const position = this.getPos();
    if (typeof position !== 'number') return;
    this.view.dispatch(
      this.view.state.tr
        .delete(position, position + this.node.nodeSize)
        .scrollIntoView(),
    );
    this.view.focus();
  }

  private active(): string {
    return String(this.node.attrs.active ?? '');
  }

  private groupId(): string {
    return String(this.node.attrs.groupId ?? 'draft') || 'draft';
  }

  private target(): string {
    return String(this.node.attrs.target ?? '');
  }

  private quote(): string {
    return String(this.node.attrs.quote ?? '');
  }

  private prefix(): string {
    return String(this.node.attrs.prefix ?? '');
  }

  private suffix(): string {
    return String(this.node.attrs.suffix ?? '');
  }

  private variantIndex(itemId: string): number {
    return Math.max(1, this.items().findIndex((item) => item.id === itemId) + 1);
  }

  private itemsWithPendingEdit(): VariantItemViewModel[] {
    const items = this.items();
    if (!this.editingItemId || this.pendingMarkdown === null) return items;
    return items.map((item) => item.id === this.editingItemId
      ? { ...item, markdown: normalizeVariantMarkdown(this.pendingMarkdown ?? '') }
      : item);
  }

  private items(): VariantItemViewModel[] {
    try {
      const parsed = JSON.parse(String(this.node.attrs.itemsJson ?? '[]')) as VariantItemViewModel[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

type RenderedBlockType = 'directive' | 'mermaid' | 'svg';

class RenderedMarkdownAtomNodeView implements NodeView {
  dom: HTMLElement;
  private node: ProseNode;
  private mode: 'rendered' | 'editing' = 'rendered';
  private renderId = 0;
  private inkscapeSession: InkscapeSession | null = null;
  private inkscapePollTimer: number | null = null;
  private inkscapePollFocusListener: (() => void) | null = null;
  private inkscapeSaveNoticeShown = false;
  private inkscapeState: 'unknown' | 'checking' | 'available' | 'missing' = 'unknown';
  private inkscapeMessage = 'Checking Inkscape availability...';

  constructor(
    node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly blockType: RenderedBlockType,
  ) {
    this.node = node;
    this.dom = document.createElement('section');
    this.dom.className = `scie-md-visual-atom scie-md-${blockType}-atom`;
    this.dom.contentEditable = 'false';
    this.dom.dataset.scieMdNode = blockType === 'directive'
      ? 'directive-block'
      : blockType === 'mermaid'
        ? 'mermaid-block'
        : 'svg-block';
    this.syncDomDataset();
    this.render();
    if (this.blockType === 'svg') void this.refreshInkscapeAvailability();
  }

  update(node: ProseNode): boolean {
    if (node.type.name !== this.node.type.name) return false;
    this.node = node;
    this.syncDomDataset();
    this.render();
    return true;
  }

  stopEvent(event: Event): boolean {
    return this.dom.contains(event.target as Node);
  }

  ignoreMutation(): boolean {
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('selected');
  }

  destroy(): void {
    this.stopInkscapePolling();
    if (this.inkscapeSession) {
      void cleanupInkscapeSvgSession(this.inkscapeSession.sessionId).catch(() => undefined);
      this.inkscapeSession = null;
    }
  }

  private render(): void {
    this.dom.replaceChildren(this.mode === 'editing' ? this.createEditor() : this.createRendered());
    scheduleNoteCardLayout(this.view.dom);
  }

  private syncDomDataset(): void {
    if (this.blockType === 'directive') {
      this.dom.dataset.directiveName = String(this.node.attrs.name ?? '');
    } else {
      delete this.dom.dataset.directiveName;
    }
  }

  private createRendered(): HTMLElement {
    const shell = document.createElement('div');
    shell.className = 'scie-md-visual-atom-rendered';
    shell.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.mode = 'editing';
      this.render();
    });

    const content = document.createElement('div');
    content.className = 'scie-md-visual-atom-content';
    content.textContent = this.renderedPlaceholderLabel();
    shell.append(content);

    const controls = document.createElement('div');
    controls.className = 'scie-md-visual-atom-controls';

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'scie-md-visual-atom-edit';
    edit.textContent = 'Edit';
    edit.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.mode = 'editing';
      this.render();
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'scie-md-visual-atom-delete';
    remove.textContent = 'Delete';
    remove.title = `Delete ${this.blockLabel()}`;
    remove.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.deleteAtom();
    });
    controls.append(edit);
    if (this.blockType === 'svg') {
      controls.append(
        this.createSvgActionButton('Open in Inkscape', () => this.openSvgInInkscape()),
        this.createSvgActionButton('Apply saved SVG', () => this.applySavedInkscapeSvg(), { requiresSession: true }),
        this.createSvgActionButton('Export PNG', () => this.exportSvg('png')),
        this.createSvgActionButton('Export PDF', () => this.exportSvg('pdf')),
      );
    }
    controls.append(remove);
    shell.append(controls);

    void this.renderMarkdown(content, String(this.node.attrs.raw ?? ''));
    return shell;
  }

  private createEditor(): HTMLElement {
    const shell = document.createElement('div');
    shell.className = 'scie-md-visual-atom-editor';

    const header = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = `Edit ${this.blockLabel()}`;
    const hint = document.createElement('span');
    hint.textContent = 'Canonical Markdown is preserved on Apply.';
    header.append(title, hint);

    const textarea = document.createElement('textarea');
    textarea.value = String(this.node.attrs.raw ?? '');
    textarea.rows = Math.min(18, Math.max(5, textarea.value.split(/\r?\n/).length + 1));
    textarea.addEventListener('input', () => autoResizeTextarea(textarea));

    const actions = document.createElement('div');
    actions.className = 'scie-md-visual-atom-actions';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.textContent = 'Apply';
    apply.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.applyRaw(textarea.value);
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.mode = 'rendered';
      this.render();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = 'Delete block';
    remove.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.deleteAtom();
    });
    actions.append(apply, cancel, remove);
    shell.append(header, textarea, actions);
    queueMicrotask(() => {
      autoResizeTextarea(textarea);
      textarea.focus();
    });
    return shell;
  }

  private async renderMarkdown(container: HTMLElement, markdown: string): Promise<void> {
    const id = ++this.renderId;
    try {
      const documentPath = getScieMetadataDocumentPath();
      const displayMarkdown = toVisualImagePaths(markdown, documentPath).markdown;
      const html = await renderMarkdownHtmlFragmentLazy(displayMarkdown, documentPath, {
        embedImages: false,
        citationEntries: getScieMetadataCitationEntries(),
      });
      if (id === this.renderId) {
        setSanitizedHtml(container, html);
        decorateMissingImages(container);
      }
    } catch {
      if (id === this.renderId) container.textContent = markdown;
    }
  }

  private applyRaw(value: string): void {
    const position = this.getPos();
    if (typeof position !== 'number') return;
    if (this.nodeTouchesProtectedBlock(position)) {
      visualAtomToast(`Cannot edit ${this.blockLabel()} inside a locked section. Unlock the section first.`, 'warning');
      return;
    }
    const attrs = this.blockType === 'directive'
      ? attrsForDirectiveRaw(value)
      : this.blockType === 'mermaid'
        ? attrsForMermaidRaw(value)
        : attrsForSvgRaw(value);
    const transaction = this.view.state.tr.setNodeMarkup(position, undefined, attrs);
    this.view.dispatch(transaction);
    this.mode = 'rendered';
    this.render();
    this.view.focus();
  }

  private async deleteAtom(): Promise<void> {
    const position = this.getPos();
    if (typeof position !== 'number') return;
    const label = this.blockLabel();
    if (this.nodeTouchesProtectedBlock(position)) {
      visualAtomToast(`Cannot delete ${label} inside a locked section. Unlock the section first.`, 'warning');
      return;
    }
    const confirmed = await visualAtomConfirm({
      title: `Delete ${label}?`,
      message: 'This removes the block from the Markdown document. You can undo with Ctrl+Z.',
      okLabel: 'Delete',
      cancelLabel: 'Cancel',
    });
    if (!confirmed) return;
    this.view.dispatch(
      this.view.state.tr
        .delete(position, position + this.node.nodeSize)
        .scrollIntoView(),
    );
    this.view.focus();
  }

  private nodeTouchesProtectedBlock(position: number): boolean {
    return nodeTouchesProtectedBlock(this.view.state.doc, position, this.node.nodeSize);
  }

  private title(): string {
    return String(this.node.attrs.name ?? 'Directive')
      .split('-')
      .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : word)
      .join(' ');
  }

  private blockLabel(): string {
    if (this.blockType === 'directive') return `${this.title()} block`;
    if (this.blockType === 'svg') return 'SVG figure';
    return 'Mermaid diagram';
  }

  private renderedPlaceholderLabel(): string {
    if (this.blockType === 'directive') return `${this.title()} block`;
    if (this.blockType === 'svg') return 'SVG figure';
    return 'Mermaid diagram';
  }

  private createSvgActionButton(label: string, run: () => Promise<void>, options: { requiresSession?: boolean } = {}): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'scie-md-visual-atom-secondary';
    button.textContent = label;
    if (this.inkscapeState !== 'available') {
      button.disabled = true;
      button.title = this.inkscapeMessage;
    } else if (options.requiresSession && !this.inkscapeSession) {
      button.disabled = true;
      button.title = 'Open this SVG in Inkscape first.';
    }
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void run().catch((error) => this.reportSvgActionError(error));
    });
    return button;
  }

  private async refreshInkscapeAvailability(): Promise<void> {
    if (this.inkscapeState === 'checking') return;
    this.inkscapeState = 'checking';
    this.inkscapeMessage = 'Checking Inkscape availability...';
    this.render();
    try {
      const info = await checkInkscapeAvailable();
      this.inkscapeState = 'available';
      this.inkscapeMessage = `Inkscape ready: ${info.version}`;
    } catch (error) {
      this.inkscapeState = 'missing';
      this.inkscapeMessage = error instanceof Error ? error.message : 'Inkscape was not found.';
    }
    if (this.blockType === 'svg') this.render();
  }

  private async openSvgInInkscape(): Promise<void> {
    if (this.inkscapeState !== 'available') {
      visualAtomToast(this.inkscapeMessage || 'Inkscape is not available.', 'warning');
      return;
    }
    const session = await openSvgInInkscape(String(this.node.attrs.body ?? ''), getScieMetadataDocumentPath());
    this.inkscapeSession = session;
    this.inkscapeSaveNoticeShown = false;
    this.startInkscapePolling();
    this.render();
    visualAtomToast('SVG opened in Inkscape. Save there, then return here and apply the saved SVG.', 'info');
  }

  private async applySavedInkscapeSvg(): Promise<void> {
    if (!this.inkscapeSession) {
      visualAtomToast('Open this SVG in Inkscape first, then save it and apply the saved SVG here.', 'warning');
      return;
    }
    const svg = await readInkscapeSvgSession(this.inkscapeSession.sessionId);
    this.applyRaw(`\`\`\`svg\n${optimizeSvgSource(svg).trim()}\n\`\`\``);
    await cleanupInkscapeSvgSession(this.inkscapeSession.sessionId).catch(() => undefined);
    this.inkscapeSession = null;
    this.stopInkscapePolling();
    visualAtomToast('Applied saved SVG from Inkscape.', 'success');
  }

  private async exportSvg(format: SvgExportFormat): Promise<void> {
    if (this.inkscapeState !== 'available') {
      visualAtomToast(this.inkscapeMessage || 'Inkscape is not available.', 'warning');
      return;
    }
    const response = await exportSvgWithInkscape(String(this.node.attrs.body ?? ''), getScieMetadataDocumentPath(), format);
    visualAtomToast(`SVG exported to ${response.outputPath}`, 'success');
  }

  private reportSvgActionError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    visualAtomToast(message || 'SVG action failed.', 'error');
  }

  private startInkscapePolling(): void {
    this.stopInkscapePolling();
    if (!this.inkscapeSession || typeof window === 'undefined') return;
    this.inkscapePollFocusListener = () => this.syncInkscapePollingWithFocus();
    window.addEventListener('focus', this.inkscapePollFocusListener);
    window.addEventListener('blur', this.inkscapePollFocusListener);
    document.addEventListener('visibilitychange', this.inkscapePollFocusListener);
    this.syncInkscapePollingWithFocus();
  }

  private stopInkscapePolling(): void {
    if (this.inkscapePollTimer !== null) {
      window.clearInterval(this.inkscapePollTimer);
      this.inkscapePollTimer = null;
    }
    if (this.inkscapePollFocusListener) {
      window.removeEventListener('focus', this.inkscapePollFocusListener);
      window.removeEventListener('blur', this.inkscapePollFocusListener);
      document.removeEventListener('visibilitychange', this.inkscapePollFocusListener);
      this.inkscapePollFocusListener = null;
    }
  }

  private syncInkscapePollingWithFocus(): void {
    if (!this.inkscapeSession || this.inkscapeSaveNoticeShown || typeof window === 'undefined') {
      this.clearInkscapePollTimer();
      return;
    }
    if (!this.shouldPollInkscapeSession()) {
      this.clearInkscapePollTimer();
      return;
    }
    if (this.inkscapePollTimer === null) {
      void this.checkInkscapeSessionStatus();
      this.inkscapePollTimer = window.setInterval(() => {
        if (!this.shouldPollInkscapeSession()) {
          this.clearInkscapePollTimer();
          return;
        }
        void this.checkInkscapeSessionStatus();
      }, 2500);
    }
  }

  private shouldPollInkscapeSession(): boolean {
    if (typeof document === 'undefined') return true;
    return document.visibilityState !== 'hidden' && document.hasFocus();
  }

  private clearInkscapePollTimer(): void {
    if (this.inkscapePollTimer !== null) {
      window.clearInterval(this.inkscapePollTimer);
      this.inkscapePollTimer = null;
    }
  }

  private async checkInkscapeSessionStatus(): Promise<void> {
    if (!this.inkscapeSession || this.inkscapeSaveNoticeShown) return;
    try {
      const status = await statInkscapeSvgSession(this.inkscapeSession.sessionId);
      if (!status.changed || this.inkscapeSaveNoticeShown) return;
      this.inkscapeSaveNoticeShown = true;
      this.clearInkscapePollTimer();
      visualAtomToast('Saved SVG changes detected. Choose "Apply saved SVG" to update the Markdown.', 'info');
    } catch {
      // The temporary session may be cleaned up while Inkscape or the app is closing.
    }
  }
}

function findNextTopLevelNode(doc: ProseNode, fromPosition: number, typeName: string): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  doc.forEach((node, offset) => {
    if (found) return;
    const from = offset;
    if (from <= fromPosition) return;
    if (node.type.name === typeName) found = { from, to: from + node.nodeSize };
  });
  return found;
}

export interface LockedRange extends LockRange {
  reason: string;
}

function collectLockedRanges(doc: ProseNode): LockedRange[] {
  const boundaries: LockBoundary[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name === 'scie_lock_start') {
      boundaries.push({
        kind: 'start',
        from: offset,
        to: offset + node.nodeSize,
        contentFrom: offset + node.nodeSize,
        reason: String(node.attrs.reason ?? ''),
      });
      return;
    }
    if (node.type.name === 'scie_lock_end') {
      boundaries.push({
        kind: 'end',
        from: offset,
        to: offset + node.nodeSize,
      });
    }
  });
  const blockRanges = collectLockRangesFromBoundaries(boundaries).map((range) => ({
    ...range,
    reason: range.reason ?? '',
  }));
  const items = topLevelNodePositions(doc);
  const anchoredRanges: LockedRange[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.node.type.name !== 'scie_lock_anchor') continue;
    const quote = String(item.node.attrs.quote ?? '').trim();
    const target = String(item.node.attrs.target ?? 'quote');
    if (target !== 'quote' || !quote) continue;
    const range = findQuoteTargetRange(doc, items, index, quoteSelectorFromAttrs(item.node.attrs));
    if (!range) continue;
    anchoredRanges.push({
      from: range.from,
      to: range.to,
      contentFrom: range.from,
      contentTo: range.to,
      reason: String(item.node.attrs.reason ?? ''),
    });
  }
  return [...blockRanges, ...anchoredRanges].sort((left, right) => left.from - right.from || left.to - right.to);
}

function nodeTouchesProtectedBlock(doc: ProseNode, position: number, nodeSize: number): boolean {
  const nodeEnd = position + nodeSize;
  return collectLockedRanges(doc)
    .some((range) => position < range.contentTo && range.contentFrom < nodeEnd);
}

function transactionTouchedLockedRange(transaction: Transaction, lockedRanges: LockedRange[]): LockedRange | null {
  let touchedRange: LockedRange | null = null;
  transaction.mapping.maps.forEach((map) => {
    map.forEach((oldStart, oldEnd) => {
      if (touchedRange) return;
      touchedRange = lockedRanges.find((range) => changeTouchesLockedRange(oldStart, oldEnd, range)) ?? null;
    });
  });
  if (touchedRange) return touchedRange;
  return lockedRanges.find((range) => lockedRangeContentChanged(transaction, range)) ?? null;
}

function attrsForSvgRaw(raw: string): SvgAttrs {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  return {
    raw: normalized || '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120"></svg>\n```',
    body: svgFenceBody(normalized),
  };
}

export function changeTouchesLockedRange(changeFrom: number, changeTo: number, range: LockedRange): boolean {
  return changeTouchesLockRange(changeFrom, changeTo, range);
}

function lockedRangeContentChanged(transaction: Transaction, range: LockedRange): boolean {
  const nextFrom = transaction.mapping.map(range.contentFrom, 1);
  const nextTo = transaction.mapping.map(range.contentTo, -1);
  if (nextFrom < 0 || nextTo < nextFrom || nextTo > transaction.doc.content.size) return true;
  return serializeDocSlice(transaction.before, range.contentFrom, range.contentTo)
    !== serializeDocSlice(transaction.doc, nextFrom, nextTo);
}

function serializeDocSlice(doc: ProseNode, from: number, to: number): string {
  return JSON.stringify(doc.slice(from, to).content.toJSON());
}

function emitLockViolation(range: LockedRange): void {
  if (typeof window === 'undefined') return;
  const detail = {
    reason: range.reason,
    message: range.reason
      ? `This section is locked (${range.reason}). Use the lock icon to unlock it before editing.`
      : 'This section is locked. Use the lock icon to unlock it before editing.',
  };
  queueMicrotask(() => {
    window.dispatchEvent(new CustomEvent(lockViolationEvent, { detail }));
  });
}

function findMatchingLockEnd(doc: ProseNode, startPosition: number): { from: number; to: number } | null {
  let foundStart = false;
  let depth = 0;
  let match: { from: number; to: number } | null = null;
  doc.forEach((node, offset) => {
    if (match) return;
    if (offset === startPosition && node.type.name === 'scie_lock_start') {
      foundStart = true;
      depth = 1;
      return;
    }
    if (!foundStart || offset <= startPosition) return;
    if (node.type.name === 'scie_lock_start') {
      depth += 1;
      return;
    }
    if (node.type.name === 'scie_lock_end') {
      depth -= 1;
      if (depth === 0) match = { from: offset, to: offset + node.nodeSize };
    }
  });
  return match;
}

function createScieMetadataDecorations(doc: ProseNode): DecorationSet {
  const decorations: Decoration[] = [];
  addLockRangeDecorations(doc, decorations);
  addNoteTargetDecorations(doc, decorations);
  return decorations.length > 0 ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
}

function addLockRangeDecorations(doc: ProseNode, decorations: Decoration[]): void {
  const ranges = collectLockedRanges(doc);
  if (ranges.length === 0) return;
  doc.forEach((node, offset) => {
    if (decorations.length >= MAX_SCIE_METADATA_DECORATIONS) return;
    for (const range of ranges) {
      if (offset < range.contentFrom || offset >= range.contentTo) continue;
      if (isScieMetadataNode(node)) continue;
      const className = offset === range.contentFrom ? 'locked-range-block locked-range-first' : 'locked-range-block';
      decorations.push(Decoration.node(offset, offset + node.nodeSize, { class: className }));
      break;
    }
  });
}

function addNoteTargetDecorations(doc: ProseNode, decorations: Decoration[]): void {
  const nodePositions = topLevelNodePositions(doc);
  for (let index = 0; index < nodePositions.length; index += 1) {
    if (decorations.length >= MAX_SCIE_METADATA_DECORATIONS) return;
    const item = nodePositions[index];
    if (item.node.type.name === 'scie_comment') {
      const noteKind = normalizeNoteKind(String(item.node.attrs.kind ?? item.node.attrs.audience ?? 'llm'));
      const quoteClass = noteKind === 'human' ? 'human-note-target-quote' : 'llm-note-target-quote';
      const blockClass = noteKind === 'human' ? 'human-note-target-block' : 'llm-note-target-block';
      const target = String(item.node.attrs.target ?? '');
      const quote = String(item.node.attrs.quote ?? '').trim();
      if (target === 'quote' && quote) {
        decorateQuoteTarget(doc, nodePositions, decorations, index, quoteSelectorFromAttrs(item.node.attrs), quoteClass);
        continue;
      }
      const endIndex = findNextNodeIndex(nodePositions, index + 1, 'scie_comment_end');
      if (endIndex !== null) {
        decorateRange(nodePositions, decorations, index + 1, endIndex, blockClass);
      } else {
        const next = findNextEditableNodeIndex(nodePositions, index + 1);
        if (next !== null) decorateRange(nodePositions, decorations, next, next + 1, blockClass);
      }
    }
    if (item.node.type.name === 'scie_instruction') {
      const target = String(item.node.attrs.target ?? 'next-block');
      if (target === 'previous-block') {
        const previous = findPreviousEditableNodeIndex(nodePositions, index - 1);
        if (previous !== null) decorateRange(nodePositions, decorations, previous, previous + 1, 'llm-note-target-block');
      } else if (target === 'next-block') {
        const next = findNextEditableNodeIndex(nodePositions, index + 1);
        if (next !== null) decorateRange(nodePositions, decorations, next, next + 1, 'llm-note-target-block');
      } else if (target === 'section') {
        decorateInstructionSection(nodePositions, decorations, index);
      }
    }
    if (item.node.type.name === 'scie_lock_anchor') {
      const quote = String(item.node.attrs.quote ?? '').trim();
      if (quote) decorateQuoteTarget(doc, nodePositions, decorations, index, quoteSelectorFromAttrs(item.node.attrs), 'locked-range-quote');
    }
    if (item.node.type.name === 'scie_variant_group') {
      const target = String(item.node.attrs.target ?? '');
      const quote = String(item.node.attrs.quote ?? '').trim();
      if (target === 'quote' && quote) decorateQuoteTarget(doc, nodePositions, decorations, index, quoteSelectorFromAttrs(item.node.attrs), 'variant-target-quote');
    }
  }
}

function decorateQuoteTarget(
  doc: ProseNode,
  items: Array<{ node: ProseNode; offset: number }>,
  decorations: Decoration[],
  noteIndex: number,
  selector: QuoteAnchorSelector,
  className: string,
): boolean {
  const range = findQuoteTargetRange(doc, items, noteIndex, selector);
  if (!range) return false;
  if (decorations.length >= MAX_SCIE_METADATA_DECORATIONS) return false;
  decorations.push(Decoration.inline(range.from, range.to, { class: className }));
  return true;
}

function findQuoteTargetRange(
  doc: ProseNode,
  items: Array<{ node: ProseNode; offset: number }>,
  anchorIndex: number,
  selector: QuoteAnchorSelector,
): { from: number; to: number } | null {
  const next = findNextEditableNodeIndex(items, anchorIndex + 1);
  if (next !== null) {
    const range = findQuoteRangeInNode(doc, items[next], selector);
    if (range) return range;
  }

  const previous = findPreviousEditableNodeIndex(items, anchorIndex - 1);
  if (previous !== null) {
    const range = findQuoteRangeInNode(doc, items[previous], selector);
    if (range) return range;
  }

  for (let index = anchorIndex + 1; index < items.length; index += 1) {
    if (isScieMetadataNode(items[index].node)) continue;
    const range = findQuoteRangeInNode(doc, items[index], selector);
    if (range) return range;
  }
  for (let index = anchorIndex - 1; index >= 0; index -= 1) {
    if (isScieMetadataNode(items[index].node)) continue;
    const range = findQuoteRangeInNode(doc, items[index], selector);
    if (range) return range;
  }
  return null;
}

function findQuoteRangeInNode(
  doc: ProseNode,
  item: { node: ProseNode; offset: number },
  selector: QuoteAnchorSelector,
): { from: number; to: number } | null {
  const index = buildNormalizedTextIndex(doc, item.offset, item.offset + item.node.nodeSize);
  const match = findQuoteSelectorRangeInTextIndex(index, selector);
  return match ? { from: match.from, to: match.to } : null;
}

function quoteSelectorFromAttrs(attrs: ProseNode['attrs']): QuoteAnchorSelector {
  return {
    quote: String(attrs.quote ?? '').trim(),
    prefix: String(attrs.prefix ?? '').trim() || undefined,
    suffix: String(attrs.suffix ?? '').trim() || undefined,
  };
}

function buildNormalizedTextIndex(doc: ProseNode, from: number, to: number): { text: string; positions: number[] } {
  let text = '';
  const positions: number[] = [];
  let pendingSpacePosition: number | null = null;
  let previousTextPosition: number | null = null;

  doc.nodesBetween(from, to, (node, position) => {
    if (!node.isText || !node.text) return true;
    for (let index = 0; index < node.text.length; index += 1) {
      const char = node.text[index];
      const charPosition = position + index;
      if (
        previousTextPosition !== null
        && charPosition > previousTextPosition + 1
        && text
        && !text.endsWith(' ')
        && pendingSpacePosition === null
      ) {
        pendingSpacePosition = previousTextPosition + 1;
      }
      if (/\s/.test(char)) {
        if (text && !text.endsWith(' ') && pendingSpacePosition === null) pendingSpacePosition = charPosition;
        previousTextPosition = charPosition;
        continue;
      }
      if (pendingSpacePosition !== null && text && !text.endsWith(' ')) {
        text += ' ';
        positions.push(pendingSpacePosition);
      }
      pendingSpacePosition = null;
      text += char;
      positions.push(charPosition);
      previousTextPosition = charPosition;
    }
    return true;
  });

  return { text, positions };
}

function normalizeSearchText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function shortDisplayText(value: string, limit: number): string {
  const normalized = normalizeSearchText(value);
  return normalized.length > limit ? `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...` : normalized;
}

const noteCardLayoutFrames = new WeakMap<HTMLElement, number>();

function scheduleNoteCardLayout(root: HTMLElement): void {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
  const pending = noteCardLayoutFrames.get(root);
  if (pending !== undefined) window.cancelAnimationFrame(pending);
  const frame = window.requestAnimationFrame(() => {
    noteCardLayoutFrames.delete(root);
    layoutNoteCards(root);
  });
  noteCardLayoutFrames.set(root, frame);
}

function layoutNoteCards(root: HTMLElement): void {
  const cards = Array.from(root.querySelectorAll<HTMLElement>('.scie-md-note-card'));
  for (const card of cards) {
    card.style.setProperty('--note-stack-offset', '0px');
  }

  const measured = cards
    .map((card) => ({ card, rect: card.getBoundingClientRect() }))
    .filter((item) => item.rect.width > 0 && item.rect.height > 0)
    .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left);
  if (measured.length <= 1) return;

  const lanes: Array<{ left: number; right: number; bottom: number }> = [];
  for (const item of measured) {
    const lane = lanes.find((candidate) => item.rect.left < candidate.right && item.rect.right > candidate.left);
    if (!lane) {
      lanes.push({ left: item.rect.left, right: item.rect.right, bottom: item.rect.bottom });
      continue;
    }
    const offset = Math.max(0, lane.bottom + 10 - item.rect.top);
    item.card.style.setProperty('--note-stack-offset', `${Math.round(offset)}px`);
    lane.left = Math.min(lane.left, item.rect.left);
    lane.right = Math.max(lane.right, item.rect.right);
    lane.bottom = Math.max(lane.bottom, item.rect.bottom + offset);
  }
}

function topLevelNodePositions(doc: ProseNode): Array<{ node: ProseNode; offset: number }> {
  const positions: Array<{ node: ProseNode; offset: number }> = [];
  doc.forEach((node, offset) => positions.push({ node, offset }));
  return positions;
}

function findNextNodeIndex(items: Array<{ node: ProseNode }>, start: number, nodeName: string): number | null {
  for (let index = start; index < items.length; index += 1) {
    if (items[index].node.type.name === nodeName) return index;
  }
  return null;
}

function findNextEditableNodeIndex(items: Array<{ node: ProseNode }>, start: number): number | null {
  for (let index = start; index < items.length; index += 1) {
    if (!isScieMetadataNode(items[index].node)) return index;
  }
  return null;
}

function findPreviousEditableNodeIndex(items: Array<{ node: ProseNode }>, start: number): number | null {
  for (let index = start; index >= 0; index -= 1) {
    if (!isScieMetadataNode(items[index].node)) return index;
  }
  return null;
}

function decorateInstructionSection(
  items: Array<{ node: ProseNode; offset: number }>,
  decorations: Decoration[],
  instructionIndex: number,
): void {
  const first = findNextEditableNodeIndex(items, instructionIndex + 1);
  if (first === null) return;
  const headingLevel = headingLevelForNode(items[first].node);
  if (!headingLevel) {
    decorateRange(items, decorations, first, first + 1, 'llm-note-target-block');
    return;
  }
  let end = first + 1;
  while (end < items.length) {
    const level = headingLevelForNode(items[end].node);
    if (level && level <= headingLevel) break;
    end += 1;
  }
  decorateRange(items, decorations, first, end, 'llm-note-target-block');
}

function headingLevelForNode(node: ProseNode): number | null {
  if (node.type.name !== 'heading') return null;
  const level = Number(node.attrs.level);
  return Number.isFinite(level) ? level : null;
}

function decorateRange(
  items: Array<{ node: ProseNode; offset: number }>,
  decorations: Decoration[],
  startIndex: number,
  endIndexExclusive: number,
  baseClass: string,
): void {
  let first = true;
  for (let index = startIndex; index < endIndexExclusive; index += 1) {
    if (decorations.length >= MAX_SCIE_METADATA_DECORATIONS) break;
    const item = items[index];
    if (!item || isScieMetadataNode(item.node)) continue;
    decorations.push(Decoration.node(item.offset, item.offset + item.node.nodeSize, {
      class: first ? `${baseClass} ${baseClass}-first` : baseClass,
    }));
    first = false;
  }
}

function decorateMissingImages(container: HTMLElement): void {
  for (const image of Array.from(container.querySelectorAll('img'))) {
    attachMissingImageHandler(image);
  }
}

function attachMissingImageHandler(image: HTMLImageElement): void {
  image.addEventListener('error', () => {
    const alt = image.getAttribute('alt')?.trim() || 'image';
    const source = image.getAttribute('src') ?? '';
    const placeholder = document.createElement('div');
    placeholder.className = 'directive-missing-image';

    const copy = document.createElement('span');
    copy.className = 'directive-missing-image-copy';
    copy.textContent = source
      ? `Missing image: ${alt} (${shortImageSource(source)})`
      : `Missing image: ${alt}`;

    const actions = document.createElement('span');
    actions.className = 'directive-missing-image-actions';

    const locate = document.createElement('button');
    locate.type = 'button';
    locate.textContent = 'Locate file...';
    locate.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(new CustomEvent('scie-md-locate-missing-image', {
        detail: { alt, source },
      }));
    });

    const reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = 'Reload';
    reload.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const retry = image.cloneNode(false) as HTMLImageElement;
      attachMissingImageHandler(retry);
      placeholder.replaceWith(retry);
      retry.src = cacheBustedImageSource(source);
    });

    actions.append(locate, reload);
    placeholder.append(copy, actions);
    image.replaceWith(placeholder);
  }, { once: true });
}

function cacheBustedImageSource(source: string): string {
  if (!source || /^(?:data|blob):/i.test(source)) return source;
  const separator = source.includes('?') ? '&' : '?';
  return `${source}${separator}scieReload=${Date.now()}`;
}

function shortImageSource(source: string): string {
  const decoded = safeDecodeURIComponent(source);
  const normalized = decoded.replace(/\\/g, '/');
  const fileName = normalized.split('/').filter(Boolean).at(-1) ?? normalized;
  return fileName.length > 48 ? `${fileName.slice(0, 45)}...` : fileName;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeAudience(value: string): 'human' | 'llm' | 'both' {
  return value === 'human' || value === 'both' ? value : 'llm';
}

function normalizeNoteKind(value: string): 'human' | 'llm' {
  return value === 'human' ? 'human' : 'llm';
}

function normalizeTarget(value: string): 'next-block' | 'previous-block' | 'selection' | 'section' {
  if (value === 'previous-block' || value === 'selection' || value === 'section') return value;
  return 'next-block';
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
