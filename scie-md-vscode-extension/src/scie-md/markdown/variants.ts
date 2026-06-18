import { lineStartOffsets, offsetToLine } from './textOffsets';
import { fencedCodeRanges, isOffsetInsideRanges } from './markdownRanges';
import {
  buildNormalizedMarkdownTextIndex,
  createQuoteAnchorSelector,
  findQuoteSelectorRangeInTextIndex,
} from './quoteAnchors';
import type { QuoteAnchorSelector } from './quoteAnchors';

export interface VariantItem {
  id: string;
  name: string;
  markdown: string;
  line: number;
}

export interface VariantGroup {
  id: string;
  active: string;
  target?: 'quote' | string;
  quote?: string;
  prefix?: string;
  suffix?: string;
  start: number;
  end: number;
  line: number;
  endLine: number;
  items: VariantItem[];
}

export interface VariantStructureIssue {
  severity: 'warning' | 'error';
  code: string;
  message: string;
  line: number;
}

interface AnchoredVariantOptions {
  markdown?: string;
  preferredLine?: number;
  selectionLine?: number;
  prefix?: string;
  suffix?: string;
}

export function parseVariantGroups(markdown: string): VariantGroup[] {
  const groups: VariantGroup[] = [];
  const lineStarts = lineStartOffsets(markdown);
  const ignoredRanges = fencedCodeRanges(markdown);
  const groupPattern = /<!--\s*scie_md:variant:group\s+([^>]*)-->/gi;
  let groupMatch: RegExpExecArray | null;

  while ((groupMatch = groupPattern.exec(markdown))) {
    if (isOffsetInsideRanges(groupMatch.index, ignoredRanges)) continue;
    const groupAttrs = parseAttributes(groupMatch[1] ?? '');
    const id = groupAttrs.id;
    const active = groupAttrs.active;
    if (!id || !active) continue;

    const contentStart = groupMatch.index + groupMatch[0].length;
    const endMatch = findVariantEnd(markdown, contentStart, ignoredRanges);
    if (!endMatch) continue;
    const content = markdown.slice(contentStart, endMatch.index);
    const items = parseVariantItems(content, contentStart, lineStarts, ignoredRanges);
    groups.push({
      id,
      active,
      target: groupAttrs.target,
      quote: groupAttrs.quote,
      prefix: groupAttrs.prefix,
      suffix: groupAttrs.suffix,
      start: groupMatch.index,
      end: endMatch.index + endMatch.raw.length,
      line: offsetToLine(lineStarts, groupMatch.index),
      endLine: offsetToLine(lineStarts, endMatch.index + endMatch.raw.length),
      items,
    });
    groupPattern.lastIndex = endMatch.index + endMatch.raw.length;
  }

  return groups;
}

export function validateVariantStructure(markdown: string): VariantStructureIssue[] {
  const issues: VariantStructureIssue[] = [];
  const lineStarts = lineStartOffsets(markdown);
  const ignoredRanges = fencedCodeRanges(markdown);
  const markerPattern = /<!--\s*scie_md:variant:(group|item|end)\b([^>]*)-->/gi;
  let openGroup: { line: number; itemCount: number } | null = null;
  let match: RegExpExecArray | null;

  while ((match = markerPattern.exec(markdown))) {
    if (isOffsetInsideRanges(match.index, ignoredRanges)) continue;
    const kind = match[1];
    const line = offsetToLine(lineStarts, match.index);
    if (kind === 'group') {
      if (openGroup) {
        issues.push({
          severity: 'error',
          code: 'variant-nested-group',
          message: 'Variant groups cannot be nested. Close the current variant before starting another one.',
          line,
        });
      } else {
        openGroup = { line, itemCount: 0 };
      }
      continue;
    }
    if (kind === 'item') {
      if (!openGroup) {
        issues.push({
          severity: 'error',
          code: 'variant-dangling-item',
          message: 'Variant item marker appears outside a variant group.',
          line,
        });
      } else {
        openGroup.itemCount += 1;
      }
      continue;
    }
    if (!openGroup) {
      issues.push({
        severity: 'error',
        code: 'variant-dangling-end',
        message: 'Variant end marker appears without a matching variant group.',
        line,
      });
      continue;
    }
    if (openGroup.itemCount === 0) {
      issues.push({
        severity: 'error',
        code: 'variant-empty-group',
        message: 'Variant group has no variant items.',
        line: openGroup.line,
      });
    }
    openGroup = null;
  }

  if (openGroup) {
    issues.push({
      severity: 'error',
      code: 'variant-unclosed-group',
      message: 'Variant group is missing its scie_md:variant:end marker.',
      line: openGroup.line,
    });
  }

  for (const group of parseVariantGroups(markdown)) {
    for (const item of group.items) {
      if (!item.markdown.trim()) {
        issues.push({
          severity: 'warning',
          code: 'variant-empty-item',
          message: `Variant item "${item.id}" in group "${group.id}" is empty.`,
          line: item.line,
        });
      }
    }
  }

  return issues;
}

export function renderActiveVariants(markdown: string): string {
  const groups = parseVariantGroups(markdown);
  if (groups.length === 0) return markdown;
  let output = markdown;

  for (const group of [...groups].reverse()) {
    const active = group.items.find((item) => item.id === group.active) ?? group.items[0];
    if (!active) continue;
    const activeMarkdown = active.markdown.trim();
    if (group.target === 'quote' && group.quote?.trim()) {
      const withoutGroup = `${output.slice(0, group.start)}${output.slice(group.end)}`;
      output = replaceAnchoredQuote(withoutGroup, {
        quote: group.quote,
        prefix: group.prefix,
        suffix: group.suffix,
      }, activeMarkdown, group.start);
      continue;
    }
    output = `${output.slice(0, group.start)}${activeMarkdown}\n${output.slice(group.end)}`;
  }

  return output;
}

export function duplicateVariantGroupIds(groups: VariantGroup[]): string[] {
  return duplicateValues(groups.map((group) => group.id));
}

export function duplicateVariantItemIds(group: VariantGroup): string[] {
  return duplicateValues(group.items.map((item) => item.id));
}

export function createVariantGroupSnippet(groupId = 'abstract', activeId = 'v2'): string {
  return [
    `<!-- scie_md:variant:group id="${escapeAttribute(groupId)}" active="${escapeAttribute(activeId)}" -->`,
    '<!-- scie_md:variant:item id="v1" name="Original draft" -->',
    'Write the first version here.',
    '<!-- scie_md:variant:item id="v2" name="Alternative revision" -->',
    'Write the alternate version here.',
    '<!-- scie_md:variant:end -->',
    '',
  ].join('\n');
}

export function createAnchoredVariantGroupSnippet(
  groupId: string,
  quote: string,
  activeId = 'v1',
  options: AnchoredVariantOptions = {},
): string {
  const selector = createQuoteAnchorSelector(options.markdown ?? '', quote, {
    prefix: options.prefix,
    suffix: options.suffix,
    preferredLine: options.preferredLine,
    selectionLine: options.selectionLine,
  });
  const attrs = [
    `id="${escapeAttribute(groupId)}"`,
    `active="${escapeAttribute(activeId)}"`,
    'target="quote"',
    `quote="${escapeAttribute(compactQuote(selector.quote))}"`,
  ];
  const prefix = compactContext(selector.prefix ?? '');
  if (prefix) attrs.push(`prefix="${escapeAttribute(prefix)}"`);
  const suffix = compactContext(selector.suffix ?? '');
  if (suffix) attrs.push(`suffix="${escapeAttribute(suffix)}"`);
  return [
    `<!-- scie_md:variant:group ${attrs.join(' ')} -->`,
    '<!-- scie_md:variant:item id="v1" name="Original draft" -->',
    quote.trim(),
    '<!-- scie_md:variant:item id="v2" name="Alternative revision" -->',
    'Write the alternate version here.',
    '<!-- scie_md:variant:end -->',
    '',
  ].join('\n');
}

function parseVariantItems(content: string, baseOffset: number, lineStarts: number[], ignoredRanges: { start: number; end: number }[]): VariantItem[] {
  const items: VariantItem[] = [];
  const itemPattern = /<!--\s*scie_md:variant:item\s+([^>]*)-->/gi;
  const matches = [...content.matchAll(itemPattern)]
    .filter((match) => !isOffsetInsideRanges(baseOffset + (match.index ?? 0), ignoredRanges));
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const attrs = parseAttributes(match[1] ?? '');
    if (!attrs.id) continue;
    const itemStart = (match.index ?? 0) + match[0].length;
    const itemEnd = index + 1 < matches.length
      ? matches[index + 1].index ?? content.length
      : content.length;
    items.push({
      id: attrs.id,
      name: attrs.name ?? attrs.id,
      markdown: content.slice(itemStart, itemEnd).replace(/^\r?\n/, '').replace(/\s+$/g, ''),
      line: offsetToLine(lineStarts, baseOffset + (match.index ?? 0)),
    });
  }
  return items;
}

function findVariantEnd(markdown: string, start: number, ignoredRanges: { start: number; end: number }[]): { index: number; raw: string } | null {
  const endPattern = /<!--\s*scie_md:variant:end\s*-->/gi;
  endPattern.lastIndex = start;
  let match: RegExpExecArray | null;
  while ((match = endPattern.exec(markdown))) {
    if (!isOffsetInsideRanges(match.index, ignoredRanges)) return { index: match.index, raw: match[0] };
  }
  return null;
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([A-Za-z_][A-Za-z0-9_.:-]*)=(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    attributes[match[1]] = decodeAttribute(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function replaceAnchoredQuote(markdown: string, selector: QuoteAnchorSelector, replacement: string, preferredOffset: number): string {
  const range = findNormalizedQuoteRangeInMarkdown(markdown, selector, preferredOffset);
  if (!range) return markdown;
  return `${markdown.slice(0, range.from)}${replacement}${markdown.slice(range.to)}`;
}

function findNormalizedQuoteRangeInMarkdown(markdown: string, selector: QuoteAnchorSelector, preferredOffset: number): { from: number; to: number } | null {
  const index = buildNormalizedMarkdownTextIndex(markdown);
  const match = findQuoteSelectorRangeInTextIndex(index, selector, preferredOffset);
  return match ? { from: match.from, to: match.to } : null;
}

function normalizeSearchText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\\(["'\\])/g, '$1');
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    } else {
      seen.add(value);
    }
  }
  return Array.from(duplicates);
}

function compactQuote(value: string): string {
  const quote = normalizeSearchText(value);
  return quote.length <= 2000 ? quote : quote.slice(0, 2000).trimEnd();
}

function compactContext(value: string): string {
  return normalizeSearchText(value).slice(0, 80).trimEnd();
}
