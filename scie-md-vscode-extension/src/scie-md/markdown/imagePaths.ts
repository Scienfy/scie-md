import { formatMarkdownImageDestination, replaceMarkdownImages } from './markdownImages';

interface VisualImagePathResult {
  markdown: string;
  displayToOriginal: Map<string, string>;
}

export function toVisualImagePaths(markdown: string, filePath: string | null): VisualImagePathResult {
  const displayToOriginal = new Map<string, string>();
  const tauriRuntime = isTauriRuntime();
  const vscodeResourceBase = tauriRuntime ? null : getVscodeDocumentResourceBase();
  if ((tauriRuntime && !filePath) || (!tauriRuntime && !vscodeResourceBase)) {
    return { markdown, displayToOriginal };
  }

  const markdownWithDisplayPaths = replaceMarkdownImages(markdown, (image) => {
    const { alt, url, title } = image;
    if (!shouldConvertImageUrl(url)) return image.raw;
    const displayUrl = tauriRuntime
      ? displayUrlForTauri(filePath, url)
      : displayUrlForVscode(vscodeResourceBase, url);
    if (!displayUrl) return image.raw;
    displayToOriginal.set(displayUrl, url);
    return `![${alt}](${displayUrl}${title})`;
  });

  return {
    markdown: markdownWithDisplayPaths,
    displayToOriginal,
  };
}

export function fromVisualImagePaths(markdown: string, displayToOriginal: Map<string, string>): string {
  return replaceMarkdownImages(markdown, (image) => {
    const originalUrl = displayToOriginal.get(image.url);
    return originalUrl ? `![${image.alt}](${formatMarkdownImageDestination(originalUrl)}${image.title})` : image.raw;
  });
}

function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

function shouldConvertImageUrl(url: string): boolean {
  return !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(url);
}

export function resolveSafeDocumentRelativePath(filePath: string, relativeUrl: string): string | null {
  const parsed = parseSafeRelativeImageUrl(relativeUrl);
  if (!parsed) return null;
  const usesBackslash = filePath.includes('\\');
  const separator = usesBackslash ? '\\' : '/';
  const baseDir = filePath.replace(/[\\/][^\\/]*$/, '');
  return `${baseDir}${separator}${parsed.segments.join(separator)}`;
}

function displayUrlForTauri(filePath: string | null, relativeUrl: string): string | null {
  if (!filePath) return null;
  const absolute = resolveSafeDocumentRelativePath(filePath, relativeUrl);
  return absolute ? localImageDisplayUrl(absolute, relativeUrl) : null;
}

export function localImageDisplayUrl(path: string, sourceUrl = ''): string {
  const suffix = sourceUrl.match(/[?#][\s\S]*$/)?.[0] ?? '';
  return `scie-md-local-image://localhost/${base64UrlEncode(path)}${suffix}`;
}

export function localImageDisplayUrlToPath(src: string): string | null {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  const isCustomProtocol = url.protocol === 'scie-md-local-image:';
  const isWindowsProtocol = url.protocol === 'http:' && url.hostname === 'scie-md-local-image.localhost';
  if (!isCustomProtocol && !isWindowsProtocol) return null;
  const token = url.pathname.replace(/^\/+/, '').split('/')[0] ?? '';
  return token ? base64UrlDecode(token) : null;
}

function displayUrlForVscode(vscodeResourceBase: string | null, relativeUrl: string): string | null {
  if (!vscodeResourceBase) return null;
  const parsed = parseSafeRelativeImageUrl(relativeUrl);
  if (!parsed) return null;
  const base = vscodeResourceBase.endsWith('/') ? vscodeResourceBase.slice(0, -1) : vscodeResourceBase;
  const encodedPath = parsed.segments.map((segment) => encodeURIComponent(segment)).join('/');
  return `${base}/${encodedPath}${parsed.suffix}`;
}

function parseSafeRelativeImageUrl(relativeUrl: string): { segments: string[]; suffix: string } | null {
  const match = relativeUrl.match(/^([^?#]*)([?#][\s\S]*)?$/);
  const pathOnly = match?.[1] ?? '';
  if (!pathOnly.trim()) return null;
  let normalizedRelative: string;
  try {
    normalizedRelative = decodeURIComponent(pathOnly).replace(/[\\/]+/g, '/');
  } catch {
    return null;
  }
  const segments = normalizedRelative.split('/').filter((segment) => segment && segment !== '.');
  if (segments.length === 0 || segments.some((segment) => segment === '..')) return null;
  return { segments, suffix: match?.[2] ?? '' };
}

function getVscodeDocumentResourceBase(): string | null {
  const globalWindow = window as Window & { __SCIE_MD_VSCODE_DOCUMENT_RESOURCE_BASE__?: string };
  const base = globalWindow.__SCIE_MD_VSCODE_DOCUMENT_RESOURCE_BASE__?.trim();
  return base || null;
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): string | null {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}
