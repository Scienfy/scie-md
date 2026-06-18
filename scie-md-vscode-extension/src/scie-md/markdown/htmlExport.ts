import MarkdownIt from 'markdown-it';
import markdownItDeflist from 'markdown-it-deflist';
import markdownItFootnote from 'markdown-it-footnote';
import markdownItTaskLists from 'markdown-it-task-lists';

const markdown = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
})
  .use(markdownItDeflist)
  .use(markdownItFootnote)
  .use(markdownItTaskLists, { enabled: true, label: true, labelAfter: true });

export interface RenderMarkdownFragmentOptions {
  embedImages?: boolean;
  citationEntries?: unknown[];
}

export function renderMarkdownHtmlFragment(
  source: string,
  _documentPath: string | null,
  _options: RenderMarkdownFragmentOptions = {},
): string {
  return markdown.render(source);
}

export function renderMarkdownHtmlDocument(
  source: string,
  documentPath: string | null,
  options: RenderMarkdownFragmentOptions = {},
): string {
  return `<!doctype html><html><body>${renderMarkdownHtmlFragment(source, documentPath, options)}</body></html>`;
}

export function createHtmlDocument(body: string): string {
  return `<!doctype html><html><body>${body}</body></html>`;
}

export function exportedDocumentTitle(): string {
  return 'ScieMD Document';
}

export function extractLocalImageReferences(): string[] {
  return [];
}
