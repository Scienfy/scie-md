import DOMPurify, { type Config } from 'dompurify';
import {
  HTML_SANITIZER_ALLOWED_DATA_ATTRIBUTES,
  HTML_SANITIZER_ALLOWED_URI_REGEXP,
  HTML_SANITIZER_FORBID_ATTR,
  HTML_SANITIZER_FORBID_TAGS,
} from '@sciemd/core';

const sanitizerConfig: Config = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: [...HTML_SANITIZER_ALLOWED_DATA_ATTRIBUTES],
  FORBID_TAGS: [...HTML_SANITIZER_FORBID_TAGS],
  FORBID_ATTR: [...HTML_SANITIZER_FORBID_ATTR],
  SANITIZE_DOM: true,
  SAFE_FOR_XML: true,
  ALLOWED_URI_REGEXP: HTML_SANITIZER_ALLOWED_URI_REGEXP,
};

export function sanitizeHtmlFragment(html: string): string {
  return DOMPurify.sanitize(html, sanitizerConfig) as string;
}

export function setSanitizedHtml(container: HTMLElement, html: string): void {
  container.innerHTML = sanitizeHtmlFragment(html);
}
