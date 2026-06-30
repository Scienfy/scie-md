import { useCallback } from 'react';
import type { EditorMode } from '../documentState';
import type { SourceMarkdownInsert } from '../../components/SourceMarkdownEditor';
import type { VisualMarkdownInsert } from '../../components/VisualMarkdownEditor';
import type { PromptState } from './useDialogs';
import { desktopPlatformHost } from '../host/desktopPlatformHost';
import type { DesktopPlatformHost } from '../host/platformHost';

interface ImageInsertionParams {
  mode: EditorMode;
  sourceInsertHandler: SourceMarkdownInsert | undefined;
  visualInsertHandler: VisualMarkdownInsert | undefined;
  ensureDocumentPathForAssets: () => Promise<string | null>;
  promptText: (state: PromptState) => Promise<string | null>;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  platformHost?: DesktopPlatformHost;
}

export function useImageInsertion({
  mode,
  sourceInsertHandler,
  visualInsertHandler,
  ensureDocumentPathForAssets,
  promptText,
  pushToast,
  platformHost = desktopPlatformHost,
}: ImageInsertionParams) {
  const editorCanInsertMarkdown = useCallback(() => (
    (mode === 'source' && Boolean(sourceInsertHandler))
    || (mode === 'visual' && Boolean(visualInsertHandler))
  ), [mode, sourceInsertHandler, visualInsertHandler]);

  const insertMarkdown = useCallback((snippet: string, options?: { visualDocumentPath?: string | null }) => {
    if (mode === 'source' && sourceInsertHandler) {
      sourceInsertHandler(snippet);
      return true;
    }
    if (mode === 'visual' && visualInsertHandler) {
      visualInsertHandler(snippet, { filePath: options?.visualDocumentPath });
      return true;
    }
    pushToast('The editor is still getting ready. Try the insert again in a moment so it lands at the cursor.', 'warning');
    return false;
  }, [mode, pushToast, sourceInsertHandler, visualInsertHandler]);

  const insertCopiedImage = useCallback((image: { altText: string; markdownPath: string }, documentPath: string) => {
    return insertMarkdown(`${platformHost.assets.markdownImageSyntax(image.altText, image.markdownPath)}\n`, { visualDocumentPath: documentPath });
  }, [insertMarkdown, platformHost]);

  const insertImageFromPath = useCallback(async (imagePath: string, promptForAlt = false) => {
    try {
      const documentPath = await ensureDocumentPathForAssets();
      if (!documentPath) return;
      if (!editorCanInsertMarkdown()) {
        pushToast('The editor is still getting ready. Try the image insert again in a moment.', 'warning');
        return;
      }
      const defaultAlt = platformHost.assets.defaultImageAlt(imagePath);
      const requestedAlt = promptForAlt
        ? await promptText({ title: 'Insert image', label: 'Image alt text', defaultValue: defaultAlt })
        : defaultAlt;
      if (requestedAlt === null) return;
      const grantedImagePath = await platformHost.assets.grantExternalImagePath(imagePath);
      const image = await platformHost.assets.copyImageToAssets(documentPath, grantedImagePath, requestedAlt.trim() || defaultAlt);
      if (insertCopiedImage(image, documentPath)) pushToast('Image inserted', 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Image insertion failed.', 'error');
    }
  }, [editorCanInsertMarkdown, ensureDocumentPathForAssets, insertCopiedImage, platformHost, promptText, pushToast]);

  const insertImageBlob = useCallback(async (blob: Blob, preferredName?: string) => {
    try {
      const documentPath = await ensureDocumentPathForAssets();
      if (!documentPath) return;
      if (!editorCanInsertMarkdown()) {
        pushToast('The editor is still getting ready. Try the paste again in a moment.', 'warning');
        return;
      }
      const fileName = platformHost.assets.imageFileNameFromBlob(blob, preferredName);
      const defaultAlt = platformHost.assets.defaultImageAlt(fileName);
      const bytes = await platformHost.assets.blobToByteArray(blob);
      const image = await platformHost.assets.saveImageBytesToAssets(documentPath, fileName, bytes, defaultAlt);
      if (insertCopiedImage(image, documentPath)) pushToast('Image pasted', 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Pasted image could not be saved.', 'error');
    }
  }, [editorCanInsertMarkdown, ensureDocumentPathForAssets, insertCopiedImage, platformHost, pushToast]);

  const handleInsertImage = useCallback(async () => {
    try {
      const imagePath = await platformHost.assets.pickImageFile();
      if (!imagePath) return;
      await insertImageFromPath(imagePath, true);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Image picker failed.', 'error');
    }
  }, [insertImageFromPath, platformHost, pushToast]);

  return {
    insertMarkdown,
    insertImageFromPath,
    insertImageBlob,
    handleInsertImage,
  };
}
