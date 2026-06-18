import { invoke } from '@tauri-apps/api/core';
import type { CopyImageResponse } from '../app/documentState';

export const IMAGE_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff'];

export async function pickImageFile(): Promise<string | null> {
  return invoke<string | null>('pick_image_file');
}

export function defaultImageAlt(filePath: string): string {
  const name = filePath.replace(/\\/g, '/').split('/').at(-1) ?? 'image';
  const stem = name.replace(/\.[^.]+$/, '');
  return stem.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'image';
}

export function markdownImageSyntax(altText: string, markdownPath: string): string {
  return `![${escapeMarkdownImageAlt(altText)}](${encodeMarkdownImagePath(markdownPath)})`;
}

export function encodeMarkdownImagePath(markdownPath: string): string {
  return markdownPath
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => encodeMarkdownPathSegment(decodePathSegment(segment)))
    .join('/');
}

function encodeMarkdownPathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function escapeMarkdownImageAlt(altText: string): string {
  return altText
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export async function copyImageToAssets(documentPath: string, imagePath: string, altText: string): Promise<CopyImageResponse> {
  return invoke<CopyImageResponse>('copy_image_to_assets', {
    documentPath,
    imagePath,
    altText,
  });
}

export async function saveImageBytesToAssets(
  documentPath: string,
  fileName: string,
  bytes: number[],
  altText: string,
): Promise<CopyImageResponse> {
  return invoke<CopyImageResponse>('save_image_bytes_to_assets', {
    documentPath,
    fileName,
    bytes,
    altText,
  });
}

export function isImagePath(filePath: string): boolean {
  const extension = filePath.replace(/\\/g, '/').split('/').at(-1)?.split('.').at(-1)?.toLowerCase() ?? '';
  return IMAGE_FILE_EXTENSIONS.includes(extension);
}

export function imageFileNameFromBlob(blob: Blob, preferredName?: string): string {
  if (preferredName && /\.[a-z0-9]+$/i.test(preferredName)) return preferredName;
  const extension = imageExtensionFromMime(blob.type);
  return `${preferredName || 'pasted-image'}.${extension}`;
}

export async function blobToByteArray(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

function imageExtensionFromMime(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/bmp') return 'bmp';
  if (mimeType === 'image/tiff') return 'tiff';
  return 'png';
}
