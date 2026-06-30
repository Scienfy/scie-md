import { readBinaryFileBase64 } from '../services/fileService';
import { sanitizeHtmlFragment } from '../services/htmlSanitizer';
import { localImageDisplayUrlToPath } from '../markdown/imagePaths';
import type { ExportLayoutMetrics } from './exportTypes';
import { createExportArtifactIssue, EXPORT_ISSUE_ATTRIBUTE, EXPORT_ISSUE_MESSAGE_ATTRIBUTE, EXPORT_ISSUE_SOURCE_ATTRIBUTE } from './exportArtifactIssues';
import type { ExportArtifactIssue } from './exportArtifactIssues';

const EXPORT_ONLY_REMOVE_SELECTORS = [
  '.save-pill',
  '.quick-outline',
  '.metadata-rail',
  '.block-handle',
  '.scie-md-variant-gutter',
  '.variable-edit-popover',
  '.citation-dialog',
  '.slash-command-menu',
  '.floating-format-toolbar',
  '.visual-annotation-overlay',
  '.editor-context-menu',
  '.scie-md-visual-atom-controls',
  '.scie-md-visual-atom-actions',
  '.scie-md-note-actions',
  '.scie-md-note-card',
  '.scie-md-note-anchor',
  '.scie-md-note-boundary',
  '.scie-md-lock-boundary',
  '.scie-md-lock-unlock',
  '.scie-md-variant-rail',
  '[data-export-hidden="true"]',
].join(',');

const EXPORT_CLASS_CLEANUP = [
  'ProseMirror-focused',
  'ProseMirror-selectednode',
  'has-focus',
  'is-selected',
  'is-hovered',
  'focus-dimmed-block',
  'focus-active-block',
  'source-focus-dimmed',
  'source-focus-active',
  'locked-range-block',
  'locked-range-first',
  'llm-note-target-block',
  'variant-active-block',
];
const MAX_CONCURRENT_EXPORT_IMAGE_INLINES = 4;

export interface CapturedEditorHtml {
  bodyHtml: string;
  warnings: string[];
  issues: ExportArtifactIssue[];
  isFullVisualFrame: boolean;
  exportLayout?: ExportLayoutMetrics;
}

export async function captureEditorHtmlForExport(root: HTMLElement | null): Promise<CapturedEditorHtml | null> {
  const frame = resolveVisualFrame(root);
  if (!frame) return null;
  const clone = frame.cloneNode(true) as HTMLElement;
  const warnings: string[] = [];
  const issues: ExportArtifactIssue[] = [];

  clone.classList.add('export-captured-stage');
  clone.removeAttribute('onkeydown');
  clone.removeAttribute('onpaste');
  clone.removeAttribute('ondrop');
  clone.removeAttribute('ondragover');
  clone.removeAttribute('oncontextmenu');

  for (const className of EXPORT_CLASS_CLEANUP) clone.classList.remove(className);
  clone.querySelectorAll<HTMLElement>(EXPORT_CLASS_CLEANUP.map((className) => `.${className}`).join(',')).forEach((element) => {
    for (const className of EXPORT_CLASS_CLEANUP) element.classList.remove(className);
  });

  clone.querySelectorAll<HTMLElement>(EXPORT_ONLY_REMOVE_SELECTORS).forEach((element) => element.remove());
  clone.querySelectorAll<HTMLElement>('.source-editor, .source-editor-shell').forEach((element) => element.remove());
  clone.querySelectorAll<HTMLElement>('.ProseMirror').forEach((element) => {
    element.removeAttribute('contenteditable');
    element.removeAttribute('spellcheck');
    element.removeAttribute('tabindex');
  });
  clone.querySelectorAll<HTMLElement>('[contenteditable]').forEach((element) => {
    element.removeAttribute('contenteditable');
  });
  clone.querySelectorAll<HTMLElement>('[draggable]').forEach((element) => {
    element.removeAttribute('draggable');
  });
  clone.querySelectorAll<HTMLElement>('[data-placeholder]').forEach((element) => {
    element.removeAttribute('data-placeholder');
  });
  clone.querySelectorAll<HTMLElement>('.ProseMirror-selectednode, .selected, .is-editing').forEach((element) => {
    element.classList.remove('ProseMirror-selectednode', 'selected', 'is-editing');
  });

  await inlineExportImages(clone, warnings, issues);

  return {
    bodyHtml: sanitizeHtmlFragment(clone.outerHTML),
    warnings,
    issues,
    isFullVisualFrame: true,
    exportLayout: measureExportLayout(frame),
  };
}

function measureExportLayout(frame: HTMLElement): ExportLayoutMetrics | undefined {
  const viewportWidthPx = positivePixelValue(
    typeof window !== 'undefined'
      ? window.innerWidth || document.documentElement.clientWidth
      : frame.getBoundingClientRect().width,
  );
  const contentWidthPx = positivePixelValue(
    frame.querySelector<HTMLElement>('.visual-editor .milkdown')?.getBoundingClientRect().width
      ?? frame.querySelector<HTMLElement>('.visual-editor .ProseMirror')?.getBoundingClientRect().width
      ?? 0,
  );
  if (!viewportWidthPx && !contentWidthPx) return undefined;
  return { viewportWidthPx, contentWidthPx };
}

function positivePixelValue(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(Math.min(Math.max(value, 320), 4096));
}

function resolveVisualFrame(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  if (root.classList.contains('editor-stage') && root.querySelector('.visual-editor .ProseMirror')) {
    return root;
  }
  const stage = root.querySelector<HTMLElement>('.editor-stage');
  if (stage?.querySelector('.visual-editor .ProseMirror')) return stage;
  const visualEditor = root.querySelector<HTMLElement>('.visual-editor');
  if (visualEditor?.querySelector('.ProseMirror')) return visualEditor;
  return null;
}

async function inlineExportImages(root: HTMLElement, warnings: string[], issues: ExportArtifactIssue[]): Promise<void> {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('img[src]'));
  await runWithConcurrency(images, MAX_CONCURRENT_EXPORT_IMAGE_INLINES, async (image) => {
    const src = image.getAttribute('src') ?? '';
    if (!src || src.startsWith('data:')) return;
    image.removeAttribute('srcset');
    image.removeAttribute('sizes');
    try {
      const dataUri = await imageSourceToDataUri(src);
      if (dataUri) image.setAttribute('src', dataUri);
    } catch (error) {
      if (mustEmbedImage(src)) {
        throw new Error(`Could not embed local image "${shortSource(src)}": ${errorMessage(error)}`);
      }
      const issue = createExportArtifactIssue('remote-image-kept', shortSource(src));
      issues.push(issue);
      warnings.push(issue.message);
      image.setAttribute(EXPORT_ISSUE_ATTRIBUTE, issue.code);
      if (issue.source) image.setAttribute(EXPORT_ISSUE_SOURCE_ATTRIBUTE, issue.source);
      image.setAttribute(EXPORT_ISSUE_MESSAGE_ATTRIBUTE, issue.message);
    }
  });
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

async function imageSourceToDataUri(src: string): Promise<string | null> {
  if (/^https?:/i.test(src)) {
    try {
      return await fetchImageAsDataUri(src);
    } catch (error) {
      const diskPath = diskPathFromVisualAssetUrl(src);
      if (!diskPath) throw error;
      const base64 = await readBinaryFileBase64(diskPath);
      return `data:${imageMimeType(diskPath)};base64,${base64}`;
    }
  }

  if (isRelativeOrAppAsset(src)) {
    return fetchImageAsDataUri(src);
  }

  const diskPath = diskPathFromVisualAssetUrl(src);
  if (diskPath) {
    const base64 = await readBinaryFileBase64(diskPath);
    return `data:${imageMimeType(diskPath)};base64,${base64}`;
  }

  return null;
}

async function fetchImageAsDataUri(src: string): Promise<string> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  const buffer = await blob.arrayBuffer();
  const mimeType = blob.type || imageMimeType(src);
  return `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`;
}

function diskPathFromVisualAssetUrl(src: string): string | null {
  const localImagePath = localImageDisplayUrlToPath(src);
  if (localImagePath) return localImagePath;
  if (/^file:\/\//i.test(src)) return pathFromUrlPath(src);
  if (/^https?:\/\//i.test(src)) {
    try {
      const parsed = new URL(src);
      if (parsed.hostname !== 'scie-md-local-image.localhost') return null;
      if (!parsed.pathname) return null;
      const decoded = decodeURIComponent(parsed.pathname);
      return normalizeDecodedUrlPath(decoded);
    } catch {
      return null;
    }
  }
  return null;
}

function pathFromUrlPath(src: string): string | null {
  try {
    const parsed = new URL(src);
    if (!parsed.pathname) return null;
    return normalizeDecodedUrlPath(decodeURIComponent(parsed.pathname), parsed.hostname);
  } catch {
    return null;
  }
}

function normalizeDecodedUrlPath(pathname: string, hostname = ''): string {
  if (hostname && hostname !== 'localhost') {
    return `\\\\${hostname}${pathname.replace(/\//g, '\\')}`;
  }
  const withoutLeadingSlash = /^\/[A-Za-z]:[\\/]/.test(pathname) ? pathname.slice(1) : pathname;
  if (/^[A-Za-z]:[\\/]/.test(withoutLeadingSlash)) {
    return withoutLeadingSlash.replace(/\//g, '\\');
  }
  return withoutLeadingSlash;
}

function isRelativeOrAppAsset(src: string): boolean {
  return !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(src);
}

function mustEmbedImage(src: string): boolean {
  if (src.startsWith('data:')) return false;
  if (/^https?:/i.test(src) && !diskPathFromVisualAssetUrl(src)) return false;
  return true;
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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function shortSource(src: string): string {
  return src.length > 90 ? `${src.slice(0, 87)}...` : src;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}
