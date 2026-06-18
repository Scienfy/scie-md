import { convertFileSrc } from '@tauri-apps/api/core';
import { replaceMarkdownImages } from './markdownImages';

interface VisualImagePathResult {
  markdown: string;
  displayToOriginal: Map<string, string>;
}

export function toVisualImagePaths(markdown: string, filePath: string | null): VisualImagePathResult {
  const displayToOriginal = new Map<string, string>();
  if (!filePath || !isTauriRuntime()) {
    return { markdown, displayToOriginal };
  }

  const markdownWithDisplayPaths = replaceMarkdownImages(markdown, (image) => {
    const { alt, url, title } = image;
    if (!shouldConvertImageUrl(url)) return image.raw;
    const absolute = resolveSafeDocumentRelativePath(filePath, url);
    if (!absolute) return image.raw;
    const displayUrl = convertFileSrc(absolute);
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
    return originalUrl ? `![${image.alt}](${originalUrl}${image.title})` : image.raw;
  });
}

function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

function shouldConvertImageUrl(url: string): boolean {
  return !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(url);
}

export function resolveSafeDocumentRelativePath(filePath: string, relativeUrl: string): string | null {
  const usesBackslash = filePath.includes('\\');
  const separator = usesBackslash ? '\\' : '/';
  const pathOnly = relativeUrl.split(/[?#]/, 1)[0];
  const normalizedRelative = decodeURIComponent(pathOnly).replace(/[\\/]+/g, '/');
  const segments = normalizedRelative.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '..')) return null;
  const baseDir = filePath.replace(/[\\/][^\\/]*$/, '');
  return `${baseDir}${separator}${segments.join(separator)}`;
}
