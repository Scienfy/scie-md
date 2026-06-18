import DOMPurify from 'dompurify';
import { renderMarkdownHtmlUnsafe } from './markdownRenderCore';

export function renderVisualHtml(source: string): string {
  return sanitizeRenderedHtml(renderMarkdownHtmlUnsafe(source));
}

export function sanitizeRenderedHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
  });
}
