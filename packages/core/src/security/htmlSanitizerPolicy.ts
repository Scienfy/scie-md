export const HTML_SANITIZER_FORBID_TAGS = [
  'script',
  'foreignObject',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
] as const;

export const HTML_SANITIZER_FORBID_ATTR = [
  'srcdoc',
] as const;

export const HTML_SANITIZER_ALLOWED_DATA_ATTRIBUTES = [
  'data-scie-md-export-issue',
  'data-scie-md-export-source',
  'data-scie-md-export-message',
] as const;

export const HTML_SANITIZER_ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|blob|scie-md-local-image):|data:image\/(?:png|gif|jpe?g|webp|bmp|svg\+xml);|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

export function isAllowedHtmlSanitizerUri(uri: string): boolean {
  HTML_SANITIZER_ALLOWED_URI_REGEXP.lastIndex = 0;
  return HTML_SANITIZER_ALLOWED_URI_REGEXP.test(uri);
}
