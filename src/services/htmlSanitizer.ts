import DOMPurify, { type Config } from 'dompurify';

const sanitizerConfig: Config = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed', 'link', 'meta'],
  FORBID_ATTR: ['srcdoc'],
  SANITIZE_DOM: true,
  SAFE_FOR_XML: true,
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|blob|asset):|data:image\/(?:png|gif|jpe?g|webp|bmp|svg\+xml);|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
};

export function sanitizeHtmlFragment(html: string): string {
  return DOMPurify.sanitize(html, sanitizerConfig) as string;
}

export function setSanitizedHtml(container: HTMLElement, html: string): void {
  container.innerHTML = sanitizeHtmlFragment(html);
}
