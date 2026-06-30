import {
  directiveBody,
  extractCitationUsageKeys,
  formatBibliographyEntry,
  parseDirectiveBlocks,
} from '@sciemd/core';
import type { BibtexEntry, DirectiveBlock } from '@sciemd/core';
import { fencedCodeRanges } from '@sciemd/core';
import { findMermaidFenceBlocks } from './mermaidBlocks';
import { findSvgFenceBlocks } from './svgBlocks';
import { sanitizeSvg } from './svgSanitizer';

export interface HtmlExportBlockReplacement {
  placeholder: string;
  html: string;
}

export interface HtmlExportBlockRenderOptions {
  citationEntries: BibtexEntry[];
  renderMarkdownHtml: (markdown: string) => Promise<string>;
}

interface DirectiveNumbering {
  label: string;
  number: number;
}

let mermaidInitialized = false;
let mermaidModulePromise: Promise<typeof import('mermaid')> | null = null;
const mermaidRenderCache = new Map<string, string>();
const MAX_MERMAID_RENDER_CACHE_SIZE = 100;

export function replacePageBreakBlocks(markdown: string): {
  markdown: string;
  replacements: HtmlExportBlockReplacement[];
} {
  const replacements: HtmlExportBlockReplacement[] = [];
  const ignoredRanges = fencedCodeRanges(markdown);
  const output = markdown.replace(/^:::\s*pagebreak\s*\r?\n:::\s*$/gim, (raw, offset: number) => {
    if (ignoredRanges.some((range) => offset >= range.start && offset < range.end)) return raw;
    const placeholder = `SCIENFY_PAGEBREAK_${randomId()}`;
    replacements.push({ placeholder, html: '<div class="page-break" aria-hidden="true"></div>' });
    return placeholder;
  });
  return { markdown: output, replacements };
}

export async function replaceDirectiveBlocks(
  markdown: string,
  options: HtmlExportBlockRenderOptions,
): Promise<{
  markdown: string;
  replacements: HtmlExportBlockReplacement[];
}> {
  const replacements: HtmlExportBlockReplacement[] = [];
  let output = markdown;
  const counters = { figure: 0, table: 0 };

  for (const directive of parseDirectiveBlocks(markdown)) {
    if (!directive.known || directive.endLine === null) continue;
    const placeholder = `SCIENFY_DIRECTIVE_${randomId()}`;
    replacements.push({
      placeholder,
      html: await renderDirectiveCard(directive, nextDirectiveNumbering(directive, counters), options, markdown),
    });
    output = output.replace(directive.raw, placeholder);
  }

  return { markdown: output, replacements };
}

export async function replaceMermaidBlocks(markdown: string): Promise<{
  markdown: string;
  replacements: HtmlExportBlockReplacement[];
}> {
  const replacements: HtmlExportBlockReplacement[] = [];
  let output = markdown;
  const blocks = findMermaidFenceBlocks(markdown);

  for (const block of blocks) {
    const source = block.raw;
    const code = block.code;
    if (!code) continue;
    const placeholder = `SCIENFY_MERMAID_${randomId()}`;
    const rendered = await renderMermaidSvg(code, placeholder);
    replacements.push({ placeholder, html: rendered });
    output = output.replace(source, placeholder);
  }

  return { markdown: output, replacements };
}

export function replaceSvgBlocks(markdown: string): {
  markdown: string;
  replacements: HtmlExportBlockReplacement[];
} {
  const replacements: HtmlExportBlockReplacement[] = [];
  let output = markdown;

  for (const block of findSvgFenceBlocks(markdown)) {
    if (!block.code) continue;
    const placeholder = `SCIENFY_SVG_${randomId()}`;
    replacements.push({ placeholder, html: renderSanitizedSvg(block.code) });
    output = output.replace(block.raw, placeholder);
  }

  return { markdown: output, replacements };
}

async function renderDirectiveCard(
  directive: DirectiveBlock,
  numbering: DirectiveNumbering | null,
  options: HtmlExportBlockRenderOptions,
  sourceMarkdown: string,
): Promise<string> {
  if (directive.name === 'references') return renderReferencesDirectiveCard(directive, sourceMarkdown, options.citationEntries);
  const detail = directiveDetail(directive);
  const body = directiveBody(directive.raw);
  const bodyHtml = enrichDirectiveBodyHtml(directive, body ? await options.renderMarkdownHtml(body) : '<p>Empty block</p>', numbering);
  return [
    `<section class="directive-card directive-${safeClassName(directive.name)} is-rendered">`,
    '<header>',
    `<strong>${escapeHtml(directiveTitle(directive))}</strong>`,
    `<span>${escapeHtml(detail)}</span>`,
    '</header>',
    `<div class="directive-card-body-rendered">${bodyHtml}</div>`,
    '</section>',
  ].join('');
}

function renderReferencesDirectiveCard(directive: DirectiveBlock, markdown: string, entries: BibtexEntry[]): string {
  const usedKeys = Array.from(new Set(extractCitationUsageKeys(markdown)));
  const entryByKey = new Map(entries.map((entry) => [entry.key, entry]));
  const detail = usedKeys.length > 0
    ? `${usedKeys.length} cited source${usedKeys.length === 1 ? '' : 's'}`
    : 'No citation keys found yet';
  const items = usedKeys.length === 0
    ? ['<li class="directive-reference-missing">No Pandoc citation keys such as <code>[@smith2026]</code> were found in this document.</li>']
    : usedKeys.map((key) => {
      const entry = entryByKey.get(key);
      return entry
        ? `<li>${escapeHtml(formatBibliographyEntry(entry))}</li>`
        : `<li class="directive-reference-missing"><code>@${escapeHtml(key)}</code> is missing from the loaded bibliography.</li>`;
    });
  return [
    '<section class="directive-card directive-references is-rendered" data-generated-references="true">',
    '<header>',
    `<strong>${escapeHtml(directiveTitle(directive))}</strong>`,
    `<span>${escapeHtml(detail)}</span>`,
    '</header>',
    `<ol class="directive-references-list">${items.join('')}</ol>`,
    '</section>',
  ].join('');
}

function nextDirectiveNumbering(
  directive: DirectiveBlock,
  counters: { figure: number; table: number },
): DirectiveNumbering | null {
  if (directive.name === 'figure') {
    counters.figure += 1;
    return { label: 'Figure', number: counters.figure };
  }
  if (directive.name === 'result' && bodyContainsMarkdownTable(directiveBody(directive.raw))) {
    counters.table += 1;
    return { label: 'Table', number: counters.table };
  }
  return null;
}

function bodyContainsMarkdownTable(markdown: string): boolean {
  const lines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let inFence = false;
  let fenceChar = '';
  let fenceLength = 0;

  for (let index = 0; index < lines.length - 1; index += 1) {
    const fence = lines[index].match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1];
      if (!inFence) {
        inFence = true;
        fenceChar = marker[0];
        fenceLength = marker.length;
      } else if (marker[0] === fenceChar && marker.length >= fenceLength) {
        inFence = false;
        fenceChar = '';
        fenceLength = 0;
      }
      continue;
    }
    if (inFence) continue;
    if (/\|/.test(lines[index]) && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])) {
      return true;
    }
  }

  return false;
}

function enrichDirectiveBodyHtml(directive: DirectiveBlock, html: string, numbering: DirectiveNumbering | null): string {
  if (!numbering) return html;
  if (directive.name === 'figure') return enrichFigureBodyHtml(html, numbering);
  if (directive.name === 'result' && numbering.label === 'Table') {
    return `<div class="directive-table-caption"><strong>${escapeHtml(numbering.label)} ${numbering.number}:</strong></div>${html}`;
  }
  return html;
}

function enrichFigureBodyHtml(html: string, numbering: DirectiveNumbering): string {
  if (!/<img[\s>]|mermaid-figure|svg-figure/.test(html)) return html;
  const prefix = `<strong class="directive-caption-prefix">${escapeHtml(numbering.label)} ${numbering.number}:</strong> `;
  const imageParagraph = /<p>\s*(<img[\s\S]*?)\s*<\/p>/;
  const mermaidFigure = /(<figure class="mermaid-figure"[\s\S]*?<\/figure>)/;
  const svgFigure = /(<figure class="svg-figure"[\s\S]*?<\/figure>)/;
  const mediaMatch = html.match(imageParagraph) ?? html.match(mermaidFigure) ?? html.match(svgFigure);
  if (!mediaMatch || mediaMatch.index === undefined) return html;

  const mediaHtml = mediaMatch[0];
  const before = html.slice(0, mediaMatch.index).trim();
  const after = html.slice(mediaMatch.index + mediaHtml.length).trim();
  const caption = after && !captionAlreadyNumbered(after, numbering.label)
    ? `<figcaption>${prefix}${after}</figcaption>`
    : after ? `<figcaption>${after}</figcaption>` : '';
  const beforeHtml = before ? `${before}` : '';
  return `${beforeHtml}<figure class="directive-figure-content"><div class="directive-figure-media">${mediaHtml}</div>${caption}</figure>`;
}

function captionAlreadyNumbered(html: string, label: string): boolean {
  return new RegExp(`^\\s*(?:<[^>]+>\\s*)*${label}\\s+\\d+\\s*[:.]`, 'i').test(html.replace(/<[^>]+>/g, '').trim());
}

function randomId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replace(/-/g, '');
  return `${Date.now()}${Math.random().toString(16).slice(2)}`;
}

function directiveTitle(directive: DirectiveBlock): string {
  return directive.name
    .split('-')
    .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : word)
    .join(' ');
}

function directiveDetail(directive: DirectiveBlock): string {
  const parts = [
    directive.label ? `#${directive.label}` : '',
    directive.classes.length > 0 ? directive.classes.map((item) => `.${item}`).join(' ') : '',
  ].filter(Boolean);
  return parts.join(' - ') || directive.opening;
}

function safeClassName(value: string): string {
  return value
    .toLowerCase()
    .slice(0, 48)
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'block';
}

async function renderMermaidSvg(code: string, id: string): Promise<string> {
  const cacheKey = code.trim();
  const cached = mermaidRenderCache.get(cacheKey);
  if (cached) return cached;
  try {
    const mermaid = await loadMermaid();
    if (!mermaidInitialized) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'default',
      });
      mermaidInitialized = true;
    }
    const rendered = await mermaid.render(id, code);
    const html = `<figure class="mermaid-figure">${rendered.svg}</figure>`;
    mermaidRenderCache.set(cacheKey, html);
    if (mermaidRenderCache.size > MAX_MERMAID_RENDER_CACHE_SIZE) {
      const oldest = mermaidRenderCache.keys().next().value;
      if (oldest) mermaidRenderCache.delete(oldest);
    }
    return html;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Mermaid could not render this diagram.';
    return renderCodeRenderError('Mermaid diagram error', message, 'mermaid', code);
  }
}

function renderSanitizedSvg(code: string): string {
  const result = sanitizeSvg(code);
  if (!result.svg) {
    return renderCodeRenderError('SVG figure error', result.warnings[0] ?? 'SVG could not be rendered safely.', 'svg', code);
  }
  const warning = result.warnings.length > 0
    ? `<figcaption class="svg-sanitizer-note">${escapeHtml(result.warnings.length === 1 ? 'Unsafe SVG content was removed.' : `${result.warnings.length} unsafe SVG items were removed.`)}</figcaption>`
    : '';
  return `<figure class="svg-figure"><div class="svg-figure-frame">${result.svg}</div>${warning}</figure>`;
}

function renderCodeRenderError(title: string, message: string, language: string, code: string): string {
  return [
    `<figure class="render-error-card render-error-${language}" role="note">`,
    `<figcaption><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></figcaption>`,
    `<pre><code class="language-${language}">${escapeHtml(code)}</code></pre>`,
    '</figure>',
  ].join('');
}

async function loadMermaid() {
  mermaidModulePromise ??= import('mermaid');
  const module = await mermaidModulePromise;
  return module.default;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
