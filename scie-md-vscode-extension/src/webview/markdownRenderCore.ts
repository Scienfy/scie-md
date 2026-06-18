import MarkdownIt from 'markdown-it';
import { renderActiveVariants } from '../shared/markdown/variants';

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

export function renderMarkdownHtmlUnsafe(source: string): string {
  return markdown.render(renderActiveVariants(source));
}
