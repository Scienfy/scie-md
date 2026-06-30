import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import type { Node as ProseNode } from '@milkdown/prose/model';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import type { BibtexEntry } from '@sciemd/core';

export interface CitationHoverRange {
  from: number;
  to: number;
  key: string;
  className: string;
  tooltip: string;
  link: string | null;
}

interface CitationHoverState {
  decorations: DecorationSet;
  signature: string;
}

const citationHoverPluginKey = new PluginKey<CitationHoverState>('scie-md-citation-hover');
const MAX_CITATION_DECORATIONS = 750;

export function createCitationHoverPlugin(
  getEntries: () => BibtexEntry[],
  getCitationKeys: () => string[],
  getEditCitation?: () => ((key: string) => void) | undefined,
) {
  return $prose(() => new Plugin({
    key: citationHoverPluginKey,
    state: {
      init(_config, state) {
        const entries = getEntries();
        const citationKeys = getCitationKeys();
        const signature = citationSignature(entries, citationKeys);
        return {
          decorations: createCitationHoverDecorations(state.doc, entries, citationKeys),
          signature,
        };
      },
      apply(transaction, pluginState, oldState, newState) {
        const entries = getEntries();
        const citationKeys = getCitationKeys();
        const signature = citationSignature(entries, citationKeys);
        if (!transaction.docChanged && signature === pluginState.signature) {
          return {
            decorations: pluginState.decorations.map(transaction.mapping, transaction.doc),
            signature,
          };
        }
        if (transaction.docChanged && signature === pluginState.signature && !transactionCouldAffectCitations(transaction, oldState.doc, newState.doc)) {
          return {
            decorations: pluginState.decorations.map(transaction.mapping, transaction.doc),
            signature,
          };
        }
        return {
          decorations: createCitationHoverDecorations(newState.doc, entries, citationKeys),
          signature,
        };
      },
    },
    props: {
      decorations(state) {
        const entries = getEntries();
        const citationKeys = getCitationKeys();
        const signature = citationSignature(entries, citationKeys);
        const pluginState = citationHoverPluginKey.getState(state);
        if (pluginState?.signature === signature) return pluginState.decorations;
        return createCitationHoverDecorations(state.doc, entries, citationKeys);
      },
      handleClick(_view, _position, event) {
        const target = event.target instanceof HTMLElement
          ? event.target.closest<HTMLElement>('.visual-citation-token')
          : null;
        const key = target?.dataset.citationKey;
        const link = target?.dataset.citationLink;
        if (!key) return false;
        if ((event.ctrlKey || event.metaKey) && link) {
          window.open(link, '_blank', 'noopener,noreferrer');
          return true;
        }
        const editCitation = getEditCitation?.();
        if (editCitation) {
          editCitation(key);
          return true;
        }
        if (!link) return false;
        window.open(link, '_blank', 'noopener,noreferrer');
        return true;
      },
    },
  }));
}

function citationSignature(entries: BibtexEntry[], citationKeys: string[]): string {
  return [
    citationKeys.join('\u0000'),
    entries.map((entry) => `${entry.key}\u0000${entry.fields.title ?? ''}\u0000${entry.fields.doi ?? ''}\u0000${entry.fields.url ?? ''}`).join('\u0001'),
  ].join('\u0002');
}

function createCitationHoverDecorations(
  doc: ProseNode,
  entries: BibtexEntry[],
  citationKeys: string[],
): DecorationSet {
  const decorations: Decoration[] = [];
  const entryByKey = new Map(entries.map((entry) => [entry.key, entry]));
  const known = new Set(citationKeys);
  const hasBibliography = citationKeys.length > 0;

  doc.descendants((node, position, parent) => {
    if (decorations.length >= MAX_CITATION_DECORATIONS) return false;
    if (node.type.name === 'code_block') return false;
    if (!node.isText || parent?.type.name === 'code_block' || hasCodeMark(node)) return true;

    for (const range of createCitationHoverRanges(node.text ?? '', position, entryByKey, known, hasBibliography)) {
      if (decorations.length >= MAX_CITATION_DECORATIONS) break;
      decorations.push(Decoration.inline(range.from, range.to, {
        class: range.className,
        title: range.tooltip,
        'data-citation-key': range.key,
        'data-citation-tooltip': range.tooltip,
        ...(range.link ? { 'data-citation-link': range.link } : {}),
      }));
    }
    return true;
  });

  return DecorationSet.create(doc, decorations);
}

export function createCitationHoverRanges(
  text: string,
  baseOffset: number,
  entryByKey: Map<string, BibtexEntry>,
  known: Set<string>,
  hasBibliography: boolean,
): CitationHoverRange[] {
  const ranges: CitationHoverRange[] = [];
  for (const cluster of text.matchAll(/\[[^\]]*@[^\]]*]/g)) {
    const clusterText = cluster[0];
    const clusterStart = cluster.index ?? 0;
    for (const citation of clusterText.matchAll(/@([A-Za-z0-9_][A-Za-z0-9_:.#$%&+\-?<>~/]*)/g)) {
      const key = citation[1];
      const entry = entryByKey.get(key);
      const missing = hasBibliography && !known.has(key);
      const from = baseOffset + clusterStart + (citation.index ?? 0);
      const link = entry ? citationLink(entry) : null;
      ranges.push({
        from,
        to: from + citation[0].length,
        key,
        className: `visual-citation-token visual-citation-clickable ${entry ? 'visual-citation-verified' : missing ? 'visual-citation-missing' : 'visual-citation-unverified'}`,
        tooltip: entry
          ? `${citationTooltip(entry)}\nClick to edit citation.${link ? '\nCtrl-click to open source.' : ''}`
          : missing
            ? `Missing citation @${key}\nClick to create or repair this bibliography entry.`
            : `Unverified citation @${key}\nClick to create this citation or declare a bibliography file.`,
        link,
      });
    }
  }
  return ranges;
}

function citationTooltip(entry: BibtexEntry): string {
  const title = cleanBibtexField(entry.fields.title) || entry.key;
  const authors = cleanBibtexField(entry.fields.author || entry.fields.editor || 'Unknown authors');
  const year = cleanBibtexField(entry.fields.year || 'n.d.');
  const venue = cleanBibtexField(entry.fields.journal || entry.fields.booktitle || entry.fields.publisher || '');
  const abstract = cleanBibtexField(entry.fields.abstract || '');
  const doi = cleanBibtexField(entry.fields.doi || '');
  const url = cleanBibtexField(entry.fields.url || entry.fields.file || '');
  return [
    title,
    `${authors} (${year})${venue ? ` - ${venue}` : ''}`,
    abstract ? `Abstract: ${abstract}` : '',
    doi ? `DOI: ${doi.replace(/^https?:\/\/doi\.org\//i, '')}` : '',
    !doi && url ? `Link: ${url}` : '',
  ].filter(Boolean).join('\n');
}

function citationLink(entry: BibtexEntry): string | null {
  const doi = cleanBibtexField(entry.fields.doi || '');
  if (doi) return doi.startsWith('http') ? doi : `https://doi.org/${doi}`;
  const url = cleanBibtexField(entry.fields.url || entry.fields.file || '');
  return /^https?:\/\//i.test(url) ? url : null;
}

function cleanBibtexField(value: string): string {
  return value.replace(/[{}]/g, '').replace(/\\&/g, '&').replace(/\s+/g, ' ').trim();
}

function transactionCouldAffectCitations(
  transaction: { mapping: { maps: readonly { forEach: (callback: (oldStart: number, oldEnd: number, newStart: number, newEnd: number) => void) => void }[] } },
  oldDoc: ProseNode,
  newDoc: ProseNode,
): boolean {
  let couldAffect = false;
  for (const map of transaction.mapping.maps) {
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      if (couldAffect) return;
      const changedText = `${textAroundChange(oldDoc, oldStart, oldEnd, 2)}\n${textAroundChange(newDoc, newStart, newEnd, 2)}`;
      couldAffect = changedText.includes('@') || changedText.includes('[') || changedText.includes(']');
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

function hasCodeMark(node: ProseNode): boolean {
  return node.marks.some((mark) => mark.type.name.toLowerCase().includes('code'));
}
