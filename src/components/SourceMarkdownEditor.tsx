import { useMemo, useRef } from 'react';
import { autocompletion } from '@codemirror/autocomplete';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import type { Extension, TransactionSpec } from '@codemirror/state';
import { Decoration, EditorView, hoverTooltip, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type { FormatDiagnostic } from '@sciemd/core';
import { fencedCodeRanges, inlineCodeRanges, isOffsetInsideRanges, mergeRanges, scieMdCommentRanges } from '@sciemd/core';
import { changeTouchesProtectedAnchor, changeTouchesProtectedBlockBody, extractCitationTokens, parseProtectedAnchors, parseProtectedBlocks } from '@sciemd/core';
import type { BibtexEntry, CrossReferenceLabel, ProtectedAnchor, ProtectedBlock, VariableDefinition } from '@sciemd/core';
import type { AuthorshipMark } from '../markdown/authorship';
import type { ValidationIssue } from '../markdown/markdownValidation';
import {
  SourceTextEditor,
  type SourceTextContextMenuRequest,
  type SourceTextContextMenuRequestHandler,
  type SourceTextFind,
  type SourceTextInsert,
  type SourceTextJump,
  type SourceTextMarker,
  type SourceTextSelection,
} from './SourceTextEditor';
import type { EditorHistoryControls } from './editorControls';
import type { EditorAdapterReady } from './editorAdapter';

export type SourceMarkdownInsert = SourceTextInsert;
export type SourceMarkdownJump = SourceTextJump;
export type SourceMarkdownFind = SourceTextFind;
export type SourceMarkdownSelection = SourceTextSelection;
export type SourceMarkdownContextMenuRequest = SourceTextContextMenuRequest;

interface SourceMarkdownEditorProps {
  markdown: string;
  onChange: (markdown: string) => void;
  onInsertReady?: (insert: SourceMarkdownInsert | undefined) => void;
  onJumpReady?: (jump: SourceMarkdownJump | undefined) => void;
  onFindReady?: (find: SourceMarkdownFind | undefined) => void;
  onHistoryReady?: (history: EditorHistoryControls | undefined) => void;
  onSelectionTextReady?: (selection: SourceMarkdownSelection | undefined) => void;
  onAdapterReady?: EditorAdapterReady;
  onContextMenuRequest?: SourceTextContextMenuRequestHandler;
  onCursorLineChange?: (line: number, column: number) => void;
  onViewportLineChange?: (line: number) => void;
  authorshipMarks?: AuthorshipMark[];
  citationKeys?: string[];
  citationEntries?: BibtexEntry[];
  crossReferenceLabels?: CrossReferenceLabel[];
  variableDefinitions?: VariableDefinition[];
  highlightedVariableName?: string | null;
  validationIssues?: ValidationIssue[];
  protectedBlocks?: ProtectedBlock[];
  onLockViolation?: (message: string) => void;
}

export interface SourceVariableDecorationRange {
  from: number;
  to: number;
  name: string;
  className: string;
  title: string;
}

export interface SourceCitationDecorationRange {
  from: number;
  to: number;
  key: string;
  className: string;
  title: string;
}

interface SourceMarkdownInsertTransaction extends TransactionSpec {
  changes: { from: number; to: number; insert: string };
  selection: { anchor: number };
}

export function SourceMarkdownEditor({
  markdown,
  onChange,
  onInsertReady,
  onJumpReady,
  onFindReady,
  onHistoryReady,
  onSelectionTextReady,
  onAdapterReady,
  onContextMenuRequest,
  onCursorLineChange,
  onViewportLineChange,
  authorshipMarks = [],
  citationKeys = [],
  citationEntries = [],
  crossReferenceLabels = [],
  variableDefinitions = [],
  highlightedVariableName = null,
  validationIssues = [],
  protectedBlocks = [],
  onLockViolation,
}: SourceMarkdownEditorProps) {
  const protectedEditBypassRef = useRef(false);
  const diagnostics = useMemo<FormatDiagnostic[]>(() => validationIssues.map((issue) => ({
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
    line: lineFromIssue(issue) ?? undefined,
    source: 'markdown',
  })), [validationIssues]);
  const markers = useMemo<SourceTextMarker[]>(() => protectedBlocks.map((block) => ({
    id: `lock-${block.startLine}-${block.endLine}`,
    line: block.startLine,
    kind: 'locked',
    title: block.reason ? `Locked section: ${block.reason}` : 'Locked section',
  })), [protectedBlocks]);
  const markdownExtensions = useMemo<Extension[]>(() => [
    createSourceLockProtectionExtension(
      () => protectedEditBypassRef.current,
      () => protectedBlocks,
      (message) => onLockViolation?.(message),
    ),
    createSourceFocusExtension(),
    createAuthorshipExtension(markdown, authorshipMarks),
    createScientificAutocomplete(citationKeys, crossReferenceLabels),
    createSourceCitationExtension(citationEntries, citationKeys),
    createSourceVariableExtension(variableDefinitions, highlightedVariableName),
  ], [
    authorshipMarks,
    citationEntries,
    citationKeys,
    crossReferenceLabels,
    highlightedVariableName,
    markdown,
    onLockViolation,
    protectedBlocks,
    variableDefinitions,
  ]);

  return (
    <SourceTextEditor
      value={markdown}
      onChange={onChange}
      language="markdown"
      diagnostics={diagnostics}
      markers={markers}
      extraExtensions={markdownExtensions}
      programmaticEditBypassRef={protectedEditBypassRef}
      createInsertTransaction={buildInsertTransaction}
      onInsertReady={onInsertReady}
      onJumpReady={onJumpReady}
      onFindReady={onFindReady}
      onHistoryReady={onHistoryReady}
      onSelectionTextReady={onSelectionTextReady}
      onAdapterReady={onAdapterReady}
      onContextMenuRequest={onContextMenuRequest}
      onCursorLineChange={onCursorLineChange}
      onViewportLineChange={onViewportLineChange}
    />
  );
}

function lineFromIssue(issue: ValidationIssue): number | null {
  const match = issue.message.match(/\bline\s+(\d+)\b/i);
  if (!match) return null;
  const line = Number(match[1]);
  return Number.isFinite(line) && line > 0 ? line : null;
}

function createScientificAutocomplete(citationKeys: string[], crossReferenceLabels: CrossReferenceLabel[]): Extension {
  return autocompletion({
    activateOnTyping: true,
    override: [createScientificCompletionSource(citationKeys, crossReferenceLabels)],
  });
}

export function createScientificCompletionSource(citationKeys: string[], crossReferenceLabels: CrossReferenceLabel[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const before = context.state.sliceDoc(Math.max(0, context.pos - 96), context.pos);
    const citationMatch = before.match(/\[@([A-Za-z0-9_:.#$%&+\-?<>~/]*)$/);
    if (citationMatch) {
      const query = citationMatch[1] ?? '';
      const keys = citationKeys.filter((key) => key.toLowerCase().includes(query.toLowerCase())).slice(0, 30);
      if (keys.length === 0 && !context.explicit) return null;
      return {
        from: context.pos - query.length - 1,
        options: keys.map((key) => ({
          label: `@${key}`,
          type: 'reference',
          detail: 'citation',
          apply: `@${key}]`,
        })),
      };
    }

    const referenceMatch = before.match(/(?:^|[\s([])@((?:fig|tbl|eq|sec|lst|nte|tip|wrn|imp|cau)-[A-Za-z0-9-]*)?$/);
    if (referenceMatch) {
      const query = referenceMatch[1] ?? '';
      const labels = crossReferenceLabels
        .filter((label) => label.id.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 30);
      if (labels.length === 0 && !context.explicit) return null;
      return {
        from: context.pos - query.length - 1,
        options: labels.map((label) => ({
          label: `@${label.id}`,
          type: 'reference',
          detail: `line ${label.line}`,
          apply: `@${label.id}`,
        })),
      };
    }

    return null;
  };
}

function createAuthorshipExtension(markdown: string, marks: AuthorshipMark[]): Extension {
  const ranges = marks
    .map((mark) => ({
      from: Math.max(0, Math.min(mark.start, markdown.length)),
      to: Math.max(0, Math.min(mark.end, markdown.length)),
      mark,
    }))
    .filter((range) => range.to > range.from)
    .sort((a, b) => a.from - b.from)
    .map((range) => Decoration.mark({
      class: 'ai-authorship-highlight',
      attributes: { title: range.mark.label },
    }).range(range.from, range.to));

  return EditorView.decorations.of(Decoration.set(ranges, true));
}

function createSourceLockProtectionExtension(
  shouldBypass: () => boolean,
  getProtectedBlocks: () => ProtectedBlock[],
  onViolation: (message: string) => void,
): Extension {
  return EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged || shouldBypass()) return transaction;
    const markdown = transaction.startState.doc.toString();
    const touchedBlock = sourceTransactionTouchedProtectedBody(transaction, markdown, getProtectedBlocks());
    if (!touchedBlock) return transaction;

    const message = touchedBlock.reason
      ? `This section is locked (${touchedBlock.reason}). Unlock it before editing.`
      : 'This section is locked. Unlock it before editing.';
    queueMicrotask(() => onViolation(message));
    return [];
  });
}

function sourceTransactionTouchedProtectedBody(
  transaction: { changes: { iterChanges: (callback: (fromA: number, toA: number) => void) => void } },
  markdown: string,
  protectedBlocks: ProtectedBlock[],
): ProtectedBlock | null {
  const blocks = protectedBlocks.length > 0 ? protectedBlocks : parseProtectedBlocks(markdown);
  const anchors = parseProtectedAnchors(markdown);
  if (blocks.length === 0 && anchors.length === 0) return null;
  let touched: ProtectedBlock | null = null;
  let touchedAnchor: ProtectedAnchor | null = null;
  transaction.changes.iterChanges((fromA, toA) => {
    if (touched || touchedAnchor) return;
    touched = blocks.find((block) => changeTouchesProtectedBlockBody(block, fromA, toA)) ?? null;
    touchedAnchor = anchors.find((anchor) => changeTouchesProtectedAnchor(anchor, markdown, fromA, toA)) ?? null;
  });
  if (touched) return touched;
  if (!touchedAnchor) return null;
  const anchor = touchedAnchor as ProtectedAnchor;
  return {
    start: anchor.start,
    end: anchor.end,
    startLine: anchor.line,
    endLine: anchor.line,
    reason: anchor.reason,
    raw: anchor.raw,
    body: anchor.quote,
  };
}

function createSourceVariableExtension(definitions: VariableDefinition[], highlightedVariableName: string | null = null): Extension {
  return EditorView.decorations.compute(['doc'], (state) => {
    const ranges = createSourceVariableDecorationRanges(state.doc.toString(), definitions, highlightedVariableName).map((range) => (
      Decoration.mark({
        class: range.className,
        attributes: { title: range.title },
      }).range(range.from, range.to)
    ));
    return Decoration.set(ranges, true);
  });
}

function createSourceCitationExtension(entries: BibtexEntry[], citationKeys: string[]): Extension {
  const decorationExtension = EditorView.decorations.compute(['doc'], (state) => {
    const ranges = createSourceCitationDecorationRanges(state.doc.toString(), entries, citationKeys).map((range) => (
      Decoration.mark({
        class: range.className,
        attributes: { title: range.title },
      }).range(range.from, range.to)
    ));
    return Decoration.set(ranges, true);
  });
  return [decorationExtension, createCitationHoverTooltip(entries, citationKeys)];
}

function createCitationHoverTooltip(entries: BibtexEntry[], citationKeys: string[]): Extension {
  return hoverTooltip((view, pos) => {
    const range = citationRangeAt(view.state.doc.toString(), pos, entries, citationKeys);
    if (!range) return null;
    return {
      pos: range.from,
      end: range.to,
      above: true,
      create() {
        const dom = document.createElement('div');
        const citationStatusClass = range.className
          .split(/\s+/)
          .filter((className) => className && className !== 'source-citation')
          .join(' ');
        dom.className = `source-citation-tooltip ${citationStatusClass}`;
        for (const [index, line] of range.title.split('\n').filter(Boolean).entries()) {
          const node = document.createElement(index === 0 ? 'strong' : 'span');
          node.textContent = line;
          dom.append(node);
        }
        return { dom };
      },
    };
  });
}

function citationRangeAt(
  markdown: string,
  pos: number,
  entries: BibtexEntry[],
  citationKeys: string[],
): SourceCitationDecorationRange | null {
  return createSourceCitationDecorationRanges(markdown, entries, citationKeys)
    .find((range) => pos >= range.from && pos <= range.to) ?? null;
}

export function createSourceCitationDecorationRanges(
  markdown: string,
  entries: BibtexEntry[],
  citationKeys: string[] = entries.map((entry) => entry.key),
): SourceCitationDecorationRange[] {
  const entryByKey = new Map(entries.map((entry) => [entry.key, entry]));
  const known = new Set(citationKeys);
  const hasBibliography = citationKeys.length > 0;
  return extractCitationTokens(markdown, { allowLoose: hasBibliography })
    .map((token) => createCitationDecorationRange(token.from, token.to, token.key, entryByKey, known, hasBibliography));
}

export function createSourceVariableDecorationRanges(
  markdown: string,
  definitions: VariableDefinition[],
  highlightedVariableName: string | null = null,
): SourceVariableDecorationRange[] {
  const values = new Map(definitions.map((definition) => [definition.name, definition]));
  const ignoredRanges = mergeRanges([
    ...fencedCodeRanges(markdown),
    ...inlineCodeRanges(markdown),
    ...scieMdCommentRanges(markdown),
  ]);
  const ranges: SourceVariableDecorationRange[] = [];
  const pattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*}}/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(markdown))) {
    if (isOffsetInsideRanges(match.index, ignoredRanges)) continue;
    const name = match[1];
    const definition = values.get(name);
    ranges.push({
      from: match.index,
      to: match.index + match[0].length,
      name,
      className: [
        'source-variable',
        definition ? 'source-variable-defined' : 'source-variable-missing',
        highlightedVariableName === name ? 'source-variable-selected' : '',
      ].filter(Boolean).join(' '),
      title: definition
        ? `{{ ${name} }} = ${definition.value}`
        : `Missing variable: {{ ${name} }}`,
    });
  }

  return ranges;
}

function createCitationDecorationRange(
  from: number,
  to: number,
  key: string,
  entryByKey: Map<string, BibtexEntry>,
  known: Set<string>,
  hasBibliography: boolean,
): SourceCitationDecorationRange {
  const entry = entryByKey.get(key);
  const missing = hasBibliography && !known.has(key);
  return {
    from,
    to,
    key,
    className: `source-citation ${entry ? 'source-citation-verified' : missing ? 'source-citation-missing' : 'source-citation-unverified'}`,
    title: entry
      ? citationEntryTooltip(entry)
      : missing
        ? `Missing citation @${key}. Add it to the loaded .bib file.`
        : `Unverified citation @${key}. Configure bibliography in front matter for verification.`,
  };
}

function citationEntryTooltip(entry: BibtexEntry): string {
  const title = cleanBibtexField(entry.fields.title) || entry.key;
  const authors = cleanBibtexField(entry.fields.author || entry.fields.editor || 'Unknown authors');
  const year = cleanBibtexField(entry.fields.year || 'n.d.');
  const venue = cleanBibtexField(entry.fields.journal || entry.fields.booktitle || entry.fields.publisher || '');
  const doi = cleanBibtexField(entry.fields.doi || '');
  return [
    `@${entry.key}`,
    title,
    `${authors} (${year})`,
    venue,
    doi ? `DOI: ${doi.replace(/^https?:\/\/doi\.org\//i, '')}` : '',
  ].filter(Boolean).join('\n');
}

function cleanBibtexField(value: string): string {
  return value.replace(/[{}]/g, '').replace(/\\&/g, '&').replace(/\s+/g, ' ').trim();
}

function createSourceFocusExtension(): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildSourceFocusDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildSourceFocusDecorations(update.view);
      }
    }
  }, {
    decorations: (plugin) => plugin.decorations,
  });
}

function buildSourceFocusDecorations(view: EditorView): DecorationSet {
  const active = activeParagraphRange(view.state);
  const ranges = [];
  let visibleParagraph: { from: number; to: number } | null = null;
  let position = view.viewport.from;
  while (position <= view.viewport.to) {
    const line = view.state.doc.lineAt(position);
    if (!visibleParagraph || line.from > visibleParagraph.to) {
      visibleParagraph = paragraphRangeAtLine(view.state, line.number);
    }
    const paragraph = visibleParagraph;
    const className = paragraph.from === active.from && paragraph.to === active.to
      ? 'source-focus-active'
      : 'source-focus-dimmed';
    ranges.push(Decoration.line({ class: className }).range(line.from));
    if (line.to >= view.viewport.to || line.to >= view.state.doc.length) break;
    position = line.to + 1;
  }
  return Decoration.set(ranges, true);
}

function activeParagraphRange(state: EditorState): { from: number; to: number } {
  const headLine = state.doc.lineAt(state.selection.main.head);
  let startLine = headLine.number;
  let endLine = headLine.number;
  while (startLine > 1 && state.doc.line(startLine - 1).text.trim()) startLine -= 1;
  while (endLine < state.doc.lines && state.doc.line(endLine + 1).text.trim()) endLine += 1;
  return {
    from: state.doc.line(startLine).from,
    to: state.doc.line(endLine).to,
  };
}

function paragraphRangeAtLine(state: EditorState, lineNumber: number): { from: number; to: number } {
  const line = state.doc.line(lineNumber);
  if (!line.text.trim()) {
    return { from: line.from, to: line.to };
  }
  let startLine = lineNumber;
  let endLine = lineNumber;
  while (startLine > 1 && state.doc.line(startLine - 1).text.trim()) startLine -= 1;
  while (endLine < state.doc.lines && state.doc.line(endLine + 1).text.trim()) endLine += 1;
  return {
    from: state.doc.line(startLine).from,
    to: state.doc.line(endLine).to,
  };
}

export function buildInsertTransaction(view: Pick<EditorView, 'state'>, snippet: string): SourceMarkdownInsertTransaction {
  const selection = view.state.selection.main;
  const selectedText = view.state.sliceDoc(selection.from, selection.to);
  if (selectedText && isBlockSnippet(snippet) && !sourceSelectionCoversWholeLines(view.state)) {
    const insertionOffset = activeParagraphRange(view.state).from;
    const text = createStandaloneBlockInsertionForSource(view.state, insertionOffset, snippet);
    return {
      changes: { from: insertionOffset, to: insertionOffset, insert: text },
      selection: { anchor: insertionOffset + text.length },
    };
  }
  const lineStart = view.state.doc.lineAt(selection.from).from;
  const text = createSourceInsertion(snippet, selectedText, selection.from > lineStart);

  return {
    changes: { from: selection.from, to: selection.to, insert: text },
    selection: { anchor: selection.from + text.length },
  };
}

function sourceSelectionCoversWholeLines(state: EditorState): boolean {
  const selection = state.selection.main;
  if (selection.from === selection.to) return false;
  const startLine = state.doc.lineAt(selection.from);
  const endLine = state.doc.lineAt(Math.max(selection.from, selection.to - 1));
  const startsAtLineBoundary = selection.from === startLine.from;
  const endsAtLineBoundary = selection.to === endLine.to
    || (selection.to === endLine.to + 1 && state.doc.sliceString(endLine.to, endLine.to + 1) === '\n');
  return startsAtLineBoundary && endsAtLineBoundary;
}

function createStandaloneBlockInsertionForSource(state: EditorState, offset: number, snippet: string): string {
  const before = state.doc.sliceString(0, offset);
  const after = state.doc.sliceString(offset, state.doc.length);
  const beforePad = before && !/\n\s*\n$/.test(before) ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
  const afterPad = after && !/^\s*\n/.test(after) ? '\n\n' : '\n';
  return `${beforePad}${snippet.trimEnd()}${afterPad}`;
}

export function createSourceInsertion(snippet: string, selectedText = '', insideLine = false): string {
  const insertion = selectedText ? wrapSelection(snippet, selectedText) : snippet;
  return insideLine && isBlockSnippet(insertion) ? `\n${insertion}` : insertion;
}

function wrapSelection(snippet: string, selectedText: string): string {
  if (snippet === '**bold**') return `**${selectedText}**`;
  if (snippet === '*italic*') return `*${selectedText}*`;
  if (snippet === '`code`') return `\`${selectedText}\``;
  if (snippet === '[link]()') return `[${selectedText}]()`;
  if (/^\[link]\([^)]+\)$/.test(snippet)) return snippet.replace('[link]', `[${selectedText}]`);
  if (snippet.startsWith('# Heading')) return `# ${selectedText}\n\n`;
  if (snippet.startsWith('## Heading')) return `## ${selectedText}\n\n`;
  if (snippet.startsWith('> Quote')) return selectedText.split('\n').map((line) => `> ${line}`).join('\n');
  if (snippet.includes('scie_md:lock:start')) return snippet.replace('Protected content.', selectedText);
  if (snippet.includes('scie_md:note') || snippet.includes('scie_md:comment')) return `${snippet.trimEnd()}\n\n${selectedText}`;
  if (snippet.includes('scie_md:variant:group')) {
    return snippet
      .replace(/\sactive=(?:"[^"]*"|'[^']*'|[^\s>]+)/i, ' active="v1"')
      .replace('Write the first version here.', selectedText);
  }
  return snippet;
}

function isBlockSnippet(snippet: string): boolean {
  return /^#{1,6}\s|^[-*+]\s|^\d+[.)]\s|^>\s|^```|^\||^<!--\s*scie_md:/.test(snippet.trimStart());
}
