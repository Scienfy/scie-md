import MarkdownIt from 'markdown-it';
import katex from 'katex';
import deflist from 'markdown-it-deflist';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import { basename } from '../app/documentState';
import { directiveBody, parseDirectiveBlocks } from '../domain/blocks/directiveParser';
import type { DirectiveBlock } from '../domain/blocks/directiveParser';
import { parseFrontmatter } from '../domain/document/frontmatter';
import { readBinaryFileBase64 } from '../services/fileService';
import { findMarkdownImages, formatMarkdownImageDestination, replaceMarkdownImagesAsync } from './markdownImages';
import { fencedCodeRanges } from './markdownRanges';
import { prepareMarkdownForHtmlExport } from './outputPipeline';
import { findSvgFenceBlocks } from './svgBlocks';
import { sanitizeSvg } from './svgSanitizer';
import { findMermaidFenceBlocks } from './mermaidBlocks';
import appCss from '../styles/app.css?raw';
import scientificDocumentCss from '../styles/scientific-document.css?raw';
import katexCss from 'katex/dist/katex.min.css?raw';
import type { ThemeMode } from '../services/settingsService';
import type { VisualStyleId } from '../services/visualStyleService';
import type { ExportLayoutMetrics, ExportRequestOptions, PdfExportOptions } from '../export/exportTypes';
import { DEFAULT_EXPORT_OPTIONS } from '../export/exportTypes';
import { extractCitationUsageKeys, formatBibliographyEntry } from '../domain/citations/bibtex';
import type { BibtexEntry } from '../domain/citations/bibtex';

interface ImageReference {
  markdownPath: string;
  diskPath: string;
  mimeType: string;
}

interface DirectiveNumbering {
  label: string;
  number: number;
}

interface RenderMarkdownOptions {
  prepareOutput?: boolean;
  embedImages?: boolean;
  renderDirectives?: boolean;
  renderMermaid?: boolean;
  renderSvg?: boolean;
  citationEntries?: BibtexEntry[];
}

interface NormalizedExportLayout {
  viewportWidthPx?: number;
  contentWidthPx?: number;
}

export interface HtmlDocumentStyleOptions {
  themeMode?: ThemeMode;
  resolvedTheme?: Exclude<ThemeMode, 'system'>;
  visualStyle?: VisualStyleId;
  fontScale?: number;
  embedFonts?: boolean;
  exportOptions?: ExportRequestOptions;
  cssOverrides?: string;
  bodyIsFullVisualFrame?: boolean;
  exportLayout?: ExportLayoutMetrics;
  citationEntries?: BibtexEntry[];
}

const fullRenderOptions: Required<RenderMarkdownOptions> = {
  prepareOutput: true,
  embedImages: true,
  renderDirectives: true,
  renderMermaid: true,
  renderSvg: true,
  citationEntries: [],
};

const documentCss = `
  :root { color-scheme: light; }
  body { margin: 0; background: #f6f8f7; color: #1f2933; font: 16px/1.65 "Scie Sans", sans-serif; }
  main { max-width: 920px; margin: 0 auto; padding: 48px 36px 72px; background: #fff; min-height: 100vh; }
  h1, h2, h3, h4, h5, h6 { color: #12251f; line-height: 1.25; margin: 1.6em 0 0.55em; }
  h1 { font-size: 2rem; }
  h2 { border-bottom: 1px solid #d7dfdc; padding-bottom: 0.25em; font-size: 1.5rem; }
  a { color: #1f6f8b; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; width: 100%; margin: 1.2rem 0; }
  th, td { border: 1px solid #cbd7d2; padding: 0.45rem 0.6rem; vertical-align: top; }
  th { background: #eef5f2; }
  code { background: #edf2f0; border-radius: 4px; padding: 0.12em 0.32em; font-family: "JetBrains Mono", monospace; }
  pre { overflow: auto; padding: 1rem; border-radius: 8px; background: #17231f; color: #eef7f3; }
  pre code { background: transparent; padding: 0; }
  blockquote { margin: 1rem 0; padding-left: 1rem; border-left: 4px solid #8eb6a5; color: #465650; }
  .task-list-item { list-style: none; }
  .task-list-item input { margin-left: -1.4rem; margin-right: 0.5rem; }
  .math-block { overflow-x: auto; padding: 0.5rem 0; text-align: center; }
  .directive-card { margin: 0.7rem 0; border: 0; border-left: 3px solid #1f6f8b; border-radius: 0; padding: 0.18rem 0 0.18rem 0.85rem; background: transparent; line-height: 1.45; }
  .directive-figure { padding: 0; border: 0; background: transparent; }
  .directive-result { border-left-width: 4px; border-left-color: #8b6f20; padding: 0.48rem 0.82rem; background: #fffaf0; }
  .directive-note { border-left-width: 2px; border-left-color: #4f7c68; }
  .directive-callout { border-left-width: 2px; border-left-color: #42526e; }
  .directive-tip { border-left-width: 2px; border-left-color: #23834f; font-style: italic; }
  .directive-important { border-top: 2px solid #9b2c6a; border-bottom: 1px solid #ead0df; border-left: 0; padding: 0.48rem 0; color: #7b2357; font-weight: 650; }
  .directive-warning { border-top: 2px solid #bd5a20; border-bottom: 1px solid #efd2bc; border-left: 0; padding: 0.48rem 0; color: #9a4216; }
  .directive-card header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-bottom: 0.28rem; font-family: "Scie Sans", sans-serif; }
  .directive-card strong { color: #12251f; font-size: 0.68rem; letter-spacing: 0.08em; text-transform: uppercase; }
  .directive-card span { color: #66756f; font-size: 0.78rem; }
  .directive-card-body-rendered p { margin: 0.15rem 0; }
  .directive-card-body-rendered > :first-child { margin-top: 0; }
  .directive-card-body-rendered > :last-child { margin-bottom: 0; }
  .directive-figure-content { display: grid; gap: 0.55rem; margin: 0; }
  .directive-figure-media { display: grid; justify-items: center; border: 1px solid #d7dfdc; border-radius: 8px; padding: 0.7rem; background: #fff; }
  .directive-figure-media p { margin: 0; }
  .directive-figure-content figcaption { color: #66756f; font-size: 0.92rem; line-height: 1.45; }
  .directive-caption-prefix { color: #12251f; font-weight: 750; }
  .directive-table-caption { margin: 0.4rem 0 -0.3rem; color: #66756f; font-size: 0.9rem; }
  .directive-table-caption strong { color: #12251f; font-weight: 750; }
  .directive-references { border-left-color: #4f7c68; }
  .directive-references-list { margin: 0.45rem 0 0; padding-left: 1.35rem; }
  .directive-references-list li { margin: 0.35rem 0; }
  .directive-reference-missing { color: #9a4216; }
  .directive-card pre { margin: 0; white-space: pre-wrap; }
  .mermaid-figure { display: grid; justify-items: center; overflow-x: auto; margin: 1.4rem 0; padding: 1rem; border: 1px solid #d7dfdc; border-radius: 8px; background: #fbfdfc; text-align: center; }
  .mermaid-figure svg { width: clamp(720px, 74%, 1180px); max-width: 100%; height: auto; }
  .svg-figure { display: grid; justify-items: center; overflow-x: auto; margin: 1.4rem 0; padding: 1rem; border: 1px solid #d7dfdc; border-radius: 8px; background: #fbfdfc; text-align: center; }
  .svg-figure svg { width: clamp(720px, 74%, 1180px); max-width: 100%; height: auto; }
  .directive-figure-media .mermaid-figure,
  .directive-figure-media .svg-figure { width: 100%; margin: 0; border: 0; padding: 0; background: transparent; }
  .page-break { break-before: page; page-break-before: always; height: 0; margin: 0; }
  @media print {
    body { background: white; }
    main { max-width: none; padding: 0; }
    a { color: inherit; text-decoration: underline; }
    pre, blockquote, table, img { break-inside: avoid; }
  }
`;

const exportOverrideCss = `
  html,
  body {
    height: auto !important;
    min-height: 100%;
    overflow: visible !important;
  }

  body.scie-md-export {
    margin: 0;
    min-width: 0;
    background: var(--editor-bg);
    color: var(--text);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .scie-md-export-page {
    min-height: 100vh;
    background: var(--editor-bg);
    color: var(--text);
  }

  .scie-md-export-page .visual-editor {
    height: auto;
    min-height: 100vh;
    overflow: visible;
  }

  .scie-md-export-page .visual-editor [data-milkdown-root],
  .scie-md-export-page .visual-editor .milkdown {
    height: auto;
    min-height: 0;
    overflow: visible;
  }

  html[data-export-layout="captured"] .scie-md-export-page .visual-editor .milkdown {
    max-width: var(--scie-md-export-content-width, var(--content-width));
  }

  .scie-md-export-page .export-fallback-frame .ProseMirror {
    min-height: 0;
    max-width: var(--content-width);
    margin: 0 auto;
    padding: var(--document-pad-y) var(--document-pad-x) var(--document-pad-bottom);
    outline: 0;
  }

  .scie-md-export-page .visual-editor .ProseMirror:focus,
  .scie-md-export-page .visual-editor .ProseMirror:focus-visible {
    outline: 0;
  }

  .scie-md-export-page .visual-editor .ProseMirror > :first-child {
    margin-top: 0;
  }

  .scie-md-export-page .visual-editor .ProseMirror > p:has(> br.ProseMirror-trailingBreak)::before {
    content: none !important;
    display: none !important;
  }

  .scie-md-export-page > .editor-stage.export-captured-stage,
  .scie-md-export-page > .visual-editor.export-captured-stage {
    min-height: 100vh;
    overflow: visible;
  }

  .scie-md-export-page > .editor-stage.export-captured-stage {
    background: var(--bg);
  }

  .scie-md-export-page > .editor-stage.export-captured-stage .visual-editor {
    min-height: 100vh;
  }

  .scie-md-export-page .export-captured-stage .ProseMirror {
    min-height: 0;
    outline: 0;
  }

  .scie-md-export-page .scie-md-variant-gutter,
  .scie-md-export-page .block-handle,
  .scie-md-export-page .variable-edit-popover,
  .scie-md-export-page .math-edit-button,
  .scie-md-export-page .math-edit-input,
  .scie-md-export-page .citation-dialog,
  .scie-md-export-page .slash-command-menu {
    display: none !important;
  }

  @media print {
    html,
    body,
    body.scie-md-export,
    .scie-md-export-page {
      background: var(--editor-bg) !important;
      color: var(--text) !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .scie-md-export-page .export-fallback-frame .ProseMirror {
      max-width: none;
      padding: 0;
    }

    html:not([data-export-layout="captured"]) .scie-md-export-page > .editor-stage.export-captured-stage,
    html:not([data-export-layout="captured"]) .scie-md-export-page > .visual-editor.export-captured-stage,
    html:not([data-export-layout="captured"]) .scie-md-export-page > .editor-stage.export-captured-stage .visual-editor,
    html:not([data-export-layout="captured"]) .scie-md-export-page > .editor-stage.export-captured-stage .visual-editor .milkdown,
    html:not([data-export-layout="captured"]) .scie-md-export-page > .visual-editor.export-captured-stage .milkdown {
      --content-width: 100%;
    }

    html:not([data-export-layout="captured"]) .scie-md-export-page > .editor-stage.export-captured-stage .visual-editor .milkdown,
    html:not([data-export-layout="captured"]) .scie-md-export-page > .visual-editor.export-captured-stage .milkdown {
      width: 100%;
      max-width: 100%;
      padding:
        calc(var(--document-pad-y) * var(--visual-padding-scale))
        calc(var(--document-pad-x) * var(--visual-padding-scale))
        calc(var(--document-pad-bottom) * var(--visual-padding-scale));
    }

    .scie-md-export-page .export-captured-stage .ProseMirror h1 {
      font-size: calc(var(--document-h1-size) * var(--font-scale));
    }
  }
`;

function createDocumentStyleCss(bodyIsFullVisualFrame: boolean): string {
  const baseCss = [
    stripFontFaceBlocks(katexCss),
    stripFontFaceBlocks(appCss),
    scientificDocumentCss,
    exportOverrideCss,
  ];
  return (bodyIsFullVisualFrame ? baseCss : [documentCss, ...baseCss]).join('\n');
}

const markdownIt = MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
})
  .use(deflist)
  .use(footnote)
  .use(taskLists, { enabled: true })
  .use(markdownItKatex);

let mermaidInitialized = false;
let mermaidModulePromise: Promise<typeof import('mermaid')> | null = null;
const mermaidRenderCache = new Map<string, string>();
const MAX_MERMAID_RENDER_CACHE_SIZE = 100;

export async function renderMarkdownHtmlDocument(
  markdown: string,
  documentPath: string | null,
  title?: string,
  styleOptions: HtmlDocumentStyleOptions = {},
): Promise<string> {
  const options = resolveRenderOptions({ citationEntries: styleOptions.citationEntries });
  const documentTitle = title ?? exportedDocumentTitle(markdown, documentPath);
  const markdownWithEmbeddedImages = await maybeEmbedLocalMarkdownImages(renderableMarkdown(markdown, options), documentPath, options);
  const bodyHtml = await renderMarkdownHtml(markdownWithEmbeddedImages, options);
  return createHtmlDocument(bodyHtml, documentTitle, {
    ...styleOptions,
    fontCss: styleOptions.embedFonts === false ? '' : await createEmbeddedFontCss(resolveUsedFontFamilies(bodyHtml, styleOptions)),
  });
}

export function exportedDocumentTitle(markdown: string, documentPath: string | null): string {
  const frontmatter = parseFrontmatter(markdown);
  const frontmatterTitle = frontmatter.error ? null : frontmatter.data.title;
  if (typeof frontmatterTitle === 'string' && frontmatterTitle.trim()) {
    return frontmatterTitle.trim();
  }
  const source = frontmatter.hasFrontmatter && !frontmatter.error ? frontmatter.body : markdown;
  const headingMatch = source.match(/^#\s+(.+?)\s*#*\s*$/m);
  const headingTitle = headingMatch ? plainTitleText(headingMatch[1]) : '';
  if (headingTitle) return headingTitle;
  return basename(documentPath);
}

export async function renderMarkdownHtmlFragment(
  markdown: string,
  documentPath: string | null,
  renderOptions: RenderMarkdownOptions = {},
): Promise<string> {
  const options = resolveRenderOptions(renderOptions);
  const markdownWithEmbeddedImages = await maybeEmbedLocalMarkdownImages(renderableMarkdown(markdown, options), documentPath, options);
  return renderMarkdownHtml(markdownWithEmbeddedImages, options);
}

export function createHtmlDocument(
  bodyHtml: string,
  title: string,
  styleOptions: HtmlDocumentStyleOptions & { fontCss?: string } = {},
): string {
  const theme = styleOptions.resolvedTheme ?? (styleOptions.themeMode === 'system' ? 'light' : styleOptions.themeMode) ?? 'light';
  const themeMode = styleOptions.themeMode ?? theme;
  const visualStyle = styleOptions.visualStyle ?? 'scienfy';
  const fontScale = Number.isFinite(styleOptions.fontScale) ? styleOptions.fontScale : 1;
  const exportLayout = normalizeExportLayout(styleOptions.exportLayout);
  const exportCss = createExportPageCss(styleOptions.exportOptions?.pdf ?? DEFAULT_EXPORT_OPTIONS.pdf, exportLayout);
  const cssOverrides = styleOptions.cssOverrides ?? styleOptions.exportOptions?.cssOverrides ?? '';
  const bodyIsFullVisualFrame = styleOptions.bodyIsFullVisualFrame === true;
  const htmlStyle = [
    `--font-scale: ${escapeHtml(String(fontScale))}`,
    exportLayout.viewportWidthPx ? `--scie-md-export-layout-width: ${escapeHtml(`${exportLayout.viewportWidthPx}px`)}` : null,
    exportLayout.contentWidthPx ? `--scie-md-export-content-width: ${escapeHtml(`${exportLayout.contentWidthPx}px`)}` : null,
  ].filter(Boolean).join('; ');
  const bodyMarkup = styleOptions.bodyIsFullVisualFrame
    ? bodyHtml
    : [
      '<div class="export-fallback-frame visual-editor">',
      '<div data-milkdown-root><div class="milkdown"><article class="ProseMirror" contenteditable="false">',
      bodyHtml,
      '</article></div></div>',
      '</div>',
    ].join('\n');
  return [
    '<!doctype html>',
    `<html lang="en" data-theme="${escapeHtml(theme)}" data-theme-mode="${escapeHtml(themeMode)}" data-visual-style="${escapeHtml(visualStyle)}" data-export-layout="${exportLayout.viewportWidthPx ? 'captured' : 'responsive'}" style="${htmlStyle};">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\' data: file: https:; style-src \'unsafe-inline\'; font-src data:; script-src \'none\'; object-src \'none\'; base-uri \'none\';">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${styleOptions.fontCss ?? ''}\n${createDocumentStyleCss(bodyIsFullVisualFrame)}\n${exportCss}\n${cssOverrides}</style>`,
    '</head>',
    '<body class="scie-md-export">',
    '<main class="scie-md-export-page">',
    bodyMarkup,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

let embeddedFontCssPromise: Promise<string> | null = null;
const embeddedFontCssByFamilies = new Map<string, Promise<string>>();

async function createEmbeddedFontCss(usedFamilies?: Set<string>): Promise<string> {
  if (!usedFamilies || usedFamilies.size === 0) {
    embeddedFontCssPromise ??= inlineFontFaceAssets(`${katexCss}\n${appCss}\n${collectRuntimeFontFaceCss()}`);
    return embeddedFontCssPromise;
  }
  const key = Array.from(usedFamilies).sort().join('|');
  let promise = embeddedFontCssByFamilies.get(key);
  if (!promise) {
    promise = inlineFontFaceAssets(filterFontFaces(`${katexCss}\n${appCss}\n${collectRuntimeFontFaceCss()}`, usedFamilies));
    embeddedFontCssByFamilies.set(key, promise);
  }
  return promise;
}

async function inlineFontFaceAssets(css: string): Promise<string> {
  const fontFaces = css.match(/@font-face\s*{[\s\S]*?}\s*/g) ?? [];
  const inlined = await Promise.all(fontFaces.map(async (block) => {
    const urlMatch = block.match(/url\((["']?)([^"')]+)\1\)/);
    const assetUrl = urlMatch?.[2];
    if (!assetUrl) return block;
    try {
      const dataUri = await fetchAssetAsDataUri(assetUrl);
      return block.replace(/url\((["']?)([^"')]+)\1\)/, `url("${dataUri}")`);
    } catch {
      return block;
    }
  }));
  return inlined.join('\n');
}

function stripFontFaceBlocks(css: string): string {
  return css.replace(/@font-face\s*{[\s\S]*?}\s*/g, '');
}

function filterFontFaces(css: string, usedFamilies: Set<string>): string {
  const fontFaces = css.match(/@font-face\s*{[\s\S]*?}\s*/g) ?? [];
  return fontFaces
    .filter((block) => {
      const family = block.match(/font-family\s*:\s*["']?([^;"'}]+)["']?/i)?.[1]?.trim();
      return family ? usedFamilies.has(family) || Array.from(usedFamilies).some((used) => family.startsWith(used)) : false;
    })
    .join('\n');
}

function resolveUsedFontFamilies(bodyHtml: string, styleOptions: HtmlDocumentStyleOptions): Set<string> {
  const families = new Set<string>(['Scie Sans', 'Scie Sans Compact', 'JetBrains Mono']);
  if (/\bkatex\b/i.test(bodyHtml)) families.add('KaTeX');
  switch (styleOptions.visualStyle) {
    case 'journal-manuscript':
    case 'nature':
    case 'science':
    case 'scientific-draft':
      families.add('Source Serif 4');
      break;
    case 'lab-notebook':
    case 'codex':
    case 'technical-code':
      families.add('IBM Plex Sans');
      break;
    default:
      families.add('Scie Sans');
  }
  return families;
}

function createExportPageCss(options: PdfExportOptions, exportLayout: NormalizedExportLayout): string {
  const pageSize = exportLayout.viewportWidthPx
    ? `${exportLayout.viewportWidthPx}px ${pageHeightForWidth(exportLayout.viewportWidthPx, options)}px`
    : `${options.paperSize} ${options.orientation}`;
  const pageRules = pageMarginRules(options);
  return `
  @page {
    size: ${pageSize};
    margin: ${options.margins.top} ${options.margins.right} ${options.margins.bottom} ${options.margins.left};
    ${pageRules}
  }
`;
}

function pageMarginRules(options: PdfExportOptions): string {
  const rules: string[] = [];
  if (options.runningHeader.trim()) {
    rules.push(`@top-center { content: "${cssString(options.runningHeader)}"; }`);
  }
  if (options.pageNumbers === 'top-right') {
    rules.push('@top-right { content: counter(page); }');
  }
  if (options.pageNumbers === 'bottom-right') {
    rules.push('@bottom-right { content: counter(page); }');
  }
  if (options.runningFooter.trim() || options.pageNumbers === 'bottom-center') {
    const footer = cssString(options.runningFooter.trim());
    const content = options.runningFooter.trim() && options.pageNumbers === 'bottom-center'
      ? `"${footer}  " counter(page)`
      : options.runningFooter.trim()
        ? `"${footer}"`
        : 'counter(page)';
    rules.push(`@bottom-center { content: ${content}; }`);
  }
  return rules.join('\n    ');
}

function cssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function pageHeightForWidth(widthPx: number, options: PdfExportOptions): number {
  const [shortSide, longSide] = paperSizeDimensions(options.paperSize);
  const pageWidth = options.orientation === 'landscape' ? longSide : shortSide;
  const pageHeight = options.orientation === 'landscape' ? shortSide : longSide;
  return Math.round(widthPx * (pageHeight / pageWidth));
}

function paperSizeDimensions(paperSize: PdfExportOptions['paperSize']): [number, number] {
  switch (paperSize) {
    case 'Letter':
      return [8.5, 11];
    case 'Legal':
      return [8.5, 14];
    case 'A5':
      return [148, 210];
    case 'B5':
      return [176, 250];
    case 'A4':
    default:
      return [210, 297];
  }
}

function normalizeExportLayout(layout: ExportLayoutMetrics | undefined): NormalizedExportLayout {
  return {
    viewportWidthPx: positivePixelValue(layout?.viewportWidthPx),
    contentWidthPx: positivePixelValue(layout?.contentWidthPx),
  };
}

function positivePixelValue(value: number | undefined): number | undefined {
  if (!Number.isFinite(value) || !value || value <= 0) return undefined;
  return Math.round(Math.min(Math.max(value, 320), 4096));
}

function collectRuntimeFontFaceCss(): string {
  if (typeof document === 'undefined') return '';
  const blocks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule.cssText.startsWith('@font-face')) blocks.push(rule.cssText);
      }
    } catch {
      // Cross-origin or not-yet-readable stylesheets are ignored; bundled raw font faces remain available.
    }
  }
  return blocks.join('\n');
}

async function fetchAssetAsDataUri(assetUrl: string): Promise<string> {
  if (typeof fetch !== 'function') throw new Error('Font embedding requires fetch.');
  const response = await fetch(assetUrl);
  if (!response.ok) throw new Error(`Could not load font asset: ${assetUrl}`);
  const buffer = await response.arrayBuffer();
  return `data:${mimeTypeForAsset(assetUrl)};base64,${arrayBufferToBase64(buffer)}`;
}

function mimeTypeForAsset(assetUrl: string): string {
  if (/\.woff2(?:$|\?)/i.test(assetUrl)) return 'font/woff2';
  if (/\.woff(?:$|\?)/i.test(assetUrl)) return 'font/woff';
  if (/\.ttf(?:$|\?)/i.test(assetUrl)) return 'font/ttf';
  return 'application/octet-stream';
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function renderMarkdownHtml(markdown: string, options: Required<RenderMarkdownOptions>): Promise<string> {
  const normalizedMarkdown = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const pageBreakPass = replacePageBreakBlocks(normalizedMarkdown);
  const directivePass = options.renderDirectives
    ? await replaceDirectiveBlocks(pageBreakPass.markdown, options)
    : { markdown: pageBreakPass.markdown, replacements: [] };
  const { markdown: markdownWithPlaceholders, replacements: mermaidReplacements } = options.renderMermaid
    ? await replaceMermaidBlocks(directivePass.markdown)
    : { markdown: directivePass.markdown, replacements: [] };
  const svgPass = options.renderSvg
    ? replaceSvgBlocks(markdownWithPlaceholders)
    : { markdown: markdownWithPlaceholders, replacements: [] };
  const replacements = [...pageBreakPass.replacements, ...directivePass.replacements, ...mermaidReplacements, ...svgPass.replacements];
  let html = markdownIt.render(svgPass.markdown);
  for (const replacement of replacements) {
    const paragraphPlaceholder = `<p>${replacement.placeholder}</p>`;
    html = html.includes(paragraphPlaceholder)
      ? html.replace(paragraphPlaceholder, () => replacement.html)
      : html.replace(replacement.placeholder, () => replacement.html);
  }
  return html;
}

function replacePageBreakBlocks(markdown: string): {
  markdown: string;
  replacements: Array<{ placeholder: string; html: string }>;
} {
  const replacements: Array<{ placeholder: string; html: string }> = [];
  const ignoredRanges = fencedCodeRanges(markdown);
  const output = markdown.replace(/^:::\s*pagebreak\s*\r?\n:::\s*$/gim, (raw, offset: number) => {
    if (ignoredRanges.some((range) => offset >= range.start && offset < range.end)) return raw;
    const placeholder = `SCIENFY_PAGEBREAK_${randomId()}`;
    replacements.push({ placeholder, html: '<div class="page-break" aria-hidden="true"></div>' });
    return placeholder;
  });
  return { markdown: output, replacements };
}

async function replaceDirectiveBlocks(markdown: string, options: Required<RenderMarkdownOptions>): Promise<{
  markdown: string;
  replacements: Array<{ placeholder: string; html: string }>;
}> {
  const replacements: Array<{ placeholder: string; html: string }> = [];
  let output = markdown;
  const counters = { figure: 0, table: 0 };

  for (const directive of parseDirectiveBlocks(markdown)) {
    if (!directive.known || directive.endLine === null) continue;
    const placeholder = `SCIENFY_DIRECTIVE_${randomId()}`;
    replacements.push({ placeholder, html: await renderDirectiveCard(directive, nextDirectiveNumbering(directive, counters), options, markdown) });
    output = output.replace(directive.raw, placeholder);
  }

  return { markdown: output, replacements };
}

async function renderDirectiveCard(
  directive: DirectiveBlock,
  numbering: DirectiveNumbering | null,
  options: Required<RenderMarkdownOptions>,
  sourceMarkdown: string,
): Promise<string> {
  if (directive.name === 'references') return renderReferencesDirectiveCard(directive, sourceMarkdown, options.citationEntries);
  const detail = directiveDetail(directive);
  const body = directiveBody(directive.raw);
  const bodyHtml = enrichDirectiveBodyHtml(directive, body ? await renderMarkdownHtml(body, options) : '<p>Empty block</p>', numbering);
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

async function replaceMermaidBlocks(markdown: string): Promise<{
  markdown: string;
  replacements: Array<{ placeholder: string; html: string }>;
}> {
  const replacements: Array<{ placeholder: string; html: string }> = [];
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

function replaceSvgBlocks(markdown: string): {
  markdown: string;
  replacements: Array<{ placeholder: string; html: string }>;
} {
  const replacements: Array<{ placeholder: string; html: string }> = [];
  let output = markdown;

  for (const block of findSvgFenceBlocks(markdown)) {
    if (!block.code) continue;
    const placeholder = `SCIENFY_SVG_${randomId()}`;
    replacements.push({ placeholder, html: renderSanitizedSvg(block.code) });
    output = output.replace(block.raw, placeholder);
  }

  return { markdown: output, replacements };
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

export function defaultHtmlExportPath(documentPath: string | null): string {
  if (!documentPath) return 'Untitled.html';
  const normalized = documentPath.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  const parent = slash >= 0 ? documentPath.slice(0, slash + 1) : '';
  const name = basename(documentPath).replace(/\.(md|markdown)$/i, '.html');
  return `${parent}exports/${name}`;
}

async function embedLocalMarkdownImages(markdown: string, documentPath: string | null): Promise<string> {
  if (!documentPath) return markdown;
  return replaceMarkdownImagesAsync(markdown, async (image) => {
    const { alt, url: markdownPath } = image;
    let replacement = image.raw;

    if (!isExternalImage(markdownPath)) {
      const diskPath = resolveMarkdownAssetPath(documentPath, markdownPath);
      if (diskPath) {
        try {
          const base64 = await readBinaryFileBase64(diskPath);
          replacement = replaceImageDestination(image, `data:${imageMimeType(markdownPath)};base64,${base64}`);
        } catch {
          replacement = replaceImageDestination(image, missingImageDataUri(alt, markdownPath));
        }
      } else {
        replacement = replaceImageDestination(image, missingImageDataUri(alt, markdownPath));
      }
    }

    return replacement;
  });
}

function replaceImageDestination(image: { alt: string; title: string }, destination: string): string {
  return `![${image.alt}](${formatMarkdownImageDestination(destination)}${image.title})`;
}

async function maybeEmbedLocalMarkdownImages(
  markdown: string,
  documentPath: string | null,
  options: Required<RenderMarkdownOptions>,
): Promise<string> {
  if (!options.embedImages) return markdown;
  return embedLocalMarkdownImages(markdown, documentPath);
}

function missingImageDataUri(altText: string, markdownPath: string): string {
  const label = altText.trim() || basename(markdownPath);
  const detail = markdownPath.length > 92 ? `${markdownPath.slice(0, 89)}...` : markdownPath;
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="220" viewBox="0 0 1200 220" role="img">',
    `<title>Missing image: ${escapeHtml(label)}</title>`,
    '<rect x="1" y="1" width="1198" height="218" rx="12" fill="#f8faf9" stroke="#b8c7c0" stroke-dasharray="10 8"/>',
    '<text x="600" y="96" text-anchor="middle" font-family="Scie Sans, sans-serif" font-size="28" font-weight="700" fill="#465650">Missing image</text>',
    `<text x="600" y="137" text-anchor="middle" font-family="Scie Sans, sans-serif" font-size="22" fill="#66756f">${escapeHtml(label)}</text>`,
    `<text x="600" y="171" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="18" fill="#7c8b85">${escapeHtml(detail)}</text>`,
    '</svg>',
  ].join('');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function extractLocalImageReferences(markdown: string, documentPath: string): ImageReference[] {
  const references: ImageReference[] = [];
  for (const image of findMarkdownImages(markdown)) {
    const markdownPath = image.url;
    if (isExternalImage(markdownPath)) continue;
    const diskPath = resolveMarkdownAssetPath(documentPath, markdownPath);
    if (!diskPath) continue;
    references.push({
      markdownPath,
      diskPath,
      mimeType: imageMimeType(markdownPath),
    });
  }

  return references;
}

function markdownItKatex(md: MarkdownIt): void {
  md.inline.ruler.before('escape', 'math_inline', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x24 || state.src.charCodeAt(state.pos + 1) === 0x24) return false;
    let pos = state.pos + 1;
    while (pos < state.src.length) {
      if (state.src.charCodeAt(pos) === 0x24 && state.src.charCodeAt(pos - 1) !== 0x5c) break;
      pos += 1;
    }
    if (pos >= state.src.length || pos === state.pos + 1) return false;
    if (!silent) {
      const token = state.push('math_inline', 'math', 0);
      token.content = state.src.slice(state.pos + 1, pos);
    }
    state.pos = pos + 1;
    return true;
  });

  md.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    if (state.src.slice(start, max).trim() !== '$$') return false;

    let nextLine = startLine + 1;
    const content: string[] = [];
    while (nextLine < endLine) {
      const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
      const lineMax = state.eMarks[nextLine];
      const line = state.src.slice(lineStart, lineMax);
      if (line.trim() === '$$') {
        if (!silent) {
          const token = state.push('math_block', 'math', 0);
          token.block = true;
          token.content = content.join('\n');
          token.map = [startLine, nextLine + 1];
        }
        state.line = nextLine + 1;
        return true;
      }
      content.push(line);
      nextLine += 1;
    }
    return false;
  });

  md.renderer.rules.math_inline = (tokens, index) => renderKatex(tokens[index].content, false);
  md.renderer.rules.math_block = (tokens, index) => `<div class="math-block">${renderKatex(tokens[index].content, true)}</div>\n`;
}

function renderableMarkdown(markdown: string, options: Required<RenderMarkdownOptions>): string {
  const prepared = options.prepareOutput ? prepareMarkdownForHtmlExport(markdown) : markdown;
  const frontmatter = parseFrontmatter(prepared);
  return frontmatter.hasFrontmatter && !frontmatter.error ? frontmatter.body : prepared;
}

function resolveRenderOptions(options: RenderMarkdownOptions): Required<RenderMarkdownOptions> {
  const resolved = {
    ...fullRenderOptions,
    ...options,
  };
  return {
    ...resolved,
    citationEntries: options.citationEntries ?? fullRenderOptions.citationEntries,
  };
}

function renderKatex(content: string, displayMode: boolean): string {
  try {
    return katex.renderToString(content, {
      displayMode,
      output: 'mathml',
      strict: 'warn',
      throwOnError: false,
      trust: false,
    });
  } catch {
    return `<code>${escapeHtml(content)}</code>`;
  }
}

function resolveMarkdownAssetPath(documentPath: string, markdownPath: string): string | null {
  if (/^[a-zA-Z]:[\\/]/.test(markdownPath) || markdownPath.startsWith('\\\\') || markdownPath.startsWith('/')) return null;
  const pathOnly = markdownPath.split(/[?#]/, 1)[0];
  if (!isSupportedImagePath(pathOnly)) return null;
  let normalizedAssetPath: string;
  try {
    normalizedAssetPath = decodeURI(pathOnly).replace(/[\\/]+/g, '/');
  } catch {
    return null;
  }
  const segments = normalizedAssetPath.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '..' || segment === '.')) return null;
  const normalizedDocument = documentPath.replace(/\\/g, '/');
  const slash = normalizedDocument.lastIndexOf('/');
  const parent = slash >= 0 ? normalizedDocument.slice(0, slash + 1) : '';
  const separator = documentPath.includes('\\') ? '\\' : '/';
  return `${parent}${segments.join('/')}`.replace(/\//g, separator);
}

function isExternalImage(src: string): boolean {
  return /^(https?:|data:|blob:)/i.test(src);
}

function imageMimeType(src: string): string {
  const extension = src.split('?')[0].split('#')[0].split('.').at(-1)?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'svg') return 'image/svg+xml';
  if (extension === 'bmp') return 'image/bmp';
  if (extension === 'tif' || extension === 'tiff') return 'image/tiff';
  return 'image/png';
}

function isSupportedImagePath(src: string): boolean {
  const extension = src.split('?')[0].split('#')[0].split('.').at(-1)?.toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg'].includes(extension ?? '');
}

function plainTitleText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*~]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
