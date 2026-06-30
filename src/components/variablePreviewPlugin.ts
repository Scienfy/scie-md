import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import type { Node as ProseNode } from '@milkdown/prose/model';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import type { VariableDefinition } from '@sciemd/core';

interface VariableRange {
  from: number;
  to: number;
  name: string;
  raw: string;
}

interface VariablePreviewState {
  decorations: DecorationSet;
  signature: string;
}

const variablePreviewPluginKey = new PluginKey<VariablePreviewState>('scie-md-variable-preview');
const MAX_VARIABLE_DECORATIONS = 500;

export function createVariablePreviewPlugin(
  getDefinitions: () => VariableDefinition[],
  getHighlightedVariableName: () => string | null | undefined,
  onEditVariable?: (name: string) => void,
) {
  return $prose(() => new Plugin({
    key: variablePreviewPluginKey,
    filterTransaction(transaction, state) {
      if (!transaction.docChanged) return true;
      return !transactionTouchesPartialVariable(transaction, collectVariableRanges(state.doc));
    },
    state: {
      init(_config, state) {
        const definitions = getDefinitions();
        const highlightedVariableName = getHighlightedVariableName() ?? null;
        const signature = variablePreviewSignature(definitions, highlightedVariableName);
        return {
          decorations: createVariableDecorations(state.doc, definitions, highlightedVariableName, onEditVariable),
          signature,
        };
      },
      apply(transaction, pluginState, oldState, newState) {
        const definitions = getDefinitions();
        const highlightedVariableName = getHighlightedVariableName() ?? null;
        const signature = variablePreviewSignature(definitions, highlightedVariableName);
        if (!transaction.docChanged && signature === pluginState.signature) {
          return {
            decorations: pluginState.decorations.map(transaction.mapping, transaction.doc),
            signature,
          };
        }
        if (transaction.docChanged && signature === pluginState.signature && !transactionCouldAffectVariables(transaction, oldState.doc, newState.doc)) {
          return {
            decorations: pluginState.decorations.map(transaction.mapping, transaction.doc),
            signature,
          };
        }
        return {
          decorations: createVariableDecorations(newState.doc, definitions, highlightedVariableName, onEditVariable),
          signature,
        };
      },
    },
    props: {
      decorations(state) {
        const definitions = getDefinitions();
        const highlightedVariableName = getHighlightedVariableName() ?? null;
        const signature = variablePreviewSignature(definitions, highlightedVariableName);
        const pluginState = variablePreviewPluginKey.getState(state);
        if (pluginState?.signature === signature) return pluginState.decorations;
        return createVariableDecorations(state.doc, definitions, highlightedVariableName, onEditVariable);
      },
    },
  }));
}

function variablePreviewSignature(definitions: VariableDefinition[], highlightedVariableName: string | null): string {
  return `${variableDefinitionSignature(definitions)}\u0002${highlightedVariableName ?? ''}`;
}

function variableDefinitionSignature(definitions: VariableDefinition[]): string {
  return definitions
    .map((definition) => `${definition.name}\u0000${definition.value}\u0000${definition.source ?? ''}\u0000${definition.file ?? ''}`)
    .join('\u0001');
}

function createVariableDecorations(
  doc: ProseNode,
  definitions: VariableDefinition[],
  highlightedVariableName: string | null,
  onEditVariable?: (name: string) => void,
): DecorationSet {
  const values = new Map(definitions.map((definition) => [definition.name, definition]));
  const decorations: Decoration[] = [];

  doc.descendants((node, position, parent) => {
    if (decorations.length >= MAX_VARIABLE_DECORATIONS) return false;
    if (node.type.name === 'code_block') return false;
    if (!node.isText || parent?.type.name === 'code_block' || hasCodeMark(node)) return true;

    for (const range of findVariableRanges(node.text ?? '', position)) {
      if (decorations.length > MAX_VARIABLE_DECORATIONS - 2) break;
      const definition = values.get(range.name);
      const value = definition?.value ?? range.raw;
      const selected = highlightedVariableName === range.name;
      decorations.push(Decoration.inline(range.from, range.to, { class: selected ? 'variable-source-hidden variable-source-selected' : 'variable-source-hidden' }));
      decorations.push(Decoration.widget(range.to, () => createVariableElement(range.name, value, definition?.source, selected, onEditVariable), {
        side: 1,
        key: `var-${range.from}-${range.to}-${range.name}-${value}-${selected ? 'selected' : 'idle'}`,
      }));
    }

    return true;
  });

  return DecorationSet.create(doc, decorations);
}

function collectVariableRanges(doc: ProseNode): VariableRange[] {
  const ranges: VariableRange[] = [];
  doc.descendants((node, position, parent) => {
    if (node.type.name === 'code_block') return false;
    if (!node.isText || parent?.type.name === 'code_block' || hasCodeMark(node)) return true;
    ranges.push(...findVariableRanges(node.text ?? '', position));
    return true;
  });
  return ranges;
}

function transactionTouchesPartialVariable(
  transaction: { mapping: { maps: readonly { forEach: (callback: (oldStart: number, oldEnd: number, newStart: number, newEnd: number) => void) => void }[] } },
  ranges: VariableRange[],
): boolean {
  if (ranges.length === 0) return false;
  let partial = false;
  for (const map of transaction.mapping.maps) {
    map.forEach((oldStart, oldEnd) => {
      if (partial) return;
      for (const range of ranges) {
        if (!changeIntersectsRange(oldStart, oldEnd, range)) continue;
        if (oldStart <= range.from && oldEnd >= range.to) continue;
        partial = true;
        break;
      }
    });
    if (partial) break;
  }
  return partial;
}

function changeIntersectsRange(oldStart: number, oldEnd: number, range: VariableRange): boolean {
  if (oldStart === oldEnd) return oldStart > range.from && oldStart < range.to;
  return oldStart < range.to && range.from < oldEnd;
}

function hasCodeMark(node: ProseNode): boolean {
  return node.marks.some((mark) => mark.type.name.toLowerCase().includes('code'));
}

function findVariableRanges(text: string, baseOffset: number): VariableRange[] {
  const ranges: VariableRange[] = [];
  const pattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*}}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    ranges.push({
      from: baseOffset + match.index,
      to: baseOffset + match.index + match[0].length,
      name: match[1],
      raw: match[0],
    });
  }
  return ranges;
}

function transactionCouldAffectVariables(
  transaction: { mapping: { maps: readonly { forEach: (callback: (oldStart: number, oldEnd: number, newStart: number, newEnd: number) => void) => void }[] } },
  oldDoc: ProseNode,
  newDoc: ProseNode,
): boolean {
  let couldAffect = false;
  for (const map of transaction.mapping.maps) {
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      if (couldAffect) return;
      const changedText = `${textAroundChange(oldDoc, oldStart, oldEnd, 3)}\n${textAroundChange(newDoc, newStart, newEnd, 3)}`;
      couldAffect = changedText.includes('{{') || changedText.includes('}}');
    });
    if (couldAffect) break;
  }
  return couldAffect;
}

function textAroundChange(doc: ProseNode, fromPosition: number, toPosition: number, padding: number): string {
  const from = Math.max(0, fromPosition - padding);
  const to = Math.min(doc.content.size, Math.max(toPosition, fromPosition) + padding);
  return doc.textBetween(from, to, '\n', '\n');
}

function createVariableElement(
  name: string,
  value: string,
  source: VariableDefinition['source'] | undefined,
  selected: boolean,
  onEditVariable?: (name: string) => void,
): HTMLElement {
  const element = document.createElement('span');
  element.className = `variable-preview ${source ? `source-${source}` : 'source-missing'}${selected ? ' selected-variable' : ''}`;
  element.contentEditable = 'false';
  element.tabIndex = 0;
  element.setAttribute('role', 'button');
  element.title = source
    ? `{{ ${name} }} from ${source} variables. Click to edit.`
    : `Missing variable: {{ ${name} }}. Click to define.`;
  element.dataset.variableName = name;
  element.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  element.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onEditVariable?.(name);
  });
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    onEditVariable?.(name);
  });
  const rendered = document.createElement('span');
  rendered.className = 'variable-preview-value';
  rendered.textContent = value;

  const card = document.createElement('span');
  card.className = 'variable-preview-card';
  card.setAttribute('role', 'tooltip');
  const title = document.createElement('strong');
  title.textContent = source ? `{{ ${name} }}` : `Missing {{ ${name} }}`;
  const detail = document.createElement('span');
  detail.textContent = source
    ? `Value: ${value}. Click to edit name or value.`
    : 'Click to define this variable in front matter.';
  card.append(title, detail);

  element.append(rendered, card);
  return element;
}
