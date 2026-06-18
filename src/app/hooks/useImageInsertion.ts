import { useCallback } from 'react';
import type { EditorMode } from '../documentState';
import type { SourceMarkdownInsert } from '../../components/SourceMarkdownEditor';
import type { VisualMarkdownInsert } from '../../components/VisualMarkdownEditor';
import { blobToByteArray, copyImageToAssets, defaultImageAlt, imageFileNameFromBlob, markdownImageSyntax, pickImageFile, saveImageBytesToAssets } from '../../services/assetService';
import { grantExternalPath } from '../../services/fileService';
import type { PromptState } from './useDialogs';

interface ImageInsertionParams {
  mode: EditorMode;
  sourceInsertHandler: SourceMarkdownInsert | undefined;
  visualInsertHandler: VisualMarkdownInsert | undefined;
  ensureDocumentPathForAssets: () => Promise<string | null>;
  promptText: (state: PromptState) => Promise<string | null>;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function useImageInsertion({
  mode,
  sourceInsertHandler,
  visualInsertHandler,
  ensureDocumentPathForAssets,
  promptText,
  pushToast,
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
    return insertMarkdown(`${markdownImageSyntax(image.altText, image.markdownPath)}\n`, { visualDocumentPath: documentPath });
  }, [insertMarkdown]);

  const insertImageFromPath = useCallback(async (imagePath: string, promptForAlt = false) => {
    try {
      const documentPath = await ensureDocumentPathForAssets();
      if (!documentPath) return;
      if (!editorCanInsertMarkdown()) {
        pushToast('The editor is still getting ready. Try the image insert again in a moment.', 'warning');
        return;
      }
      const defaultAlt = defaultImageAlt(imagePath);
      const requestedAlt = promptForAlt
        ? await promptText({ title: 'Insert image', label: 'Image alt text', defaultValue: defaultAlt })
        : defaultAlt;
      if (requestedAlt === null) return;
      const grantedImagePath = await grantExternalPath(imagePath, 'image');
      const image = await copyImageToAssets(documentPath, grantedImagePath, requestedAlt.trim() || defaultAlt);
      if (insertCopiedImage(image, documentPath)) pushToast('Image inserted', 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Image insertion failed.', 'error');
    }
  }, [editorCanInsertMarkdown, ensureDocumentPathForAssets, insertCopiedImage, promptText, pushToast]);

  const insertImageBlob = useCallback(async (blob: Blob, preferredName?: string) => {
    try {
      const documentPath = await ensureDocumentPathForAssets();
      if (!documentPath) return;
      if (!editorCanInsertMarkdown()) {
        pushToast('The editor is still getting ready. Try the paste again in a moment.', 'warning');
        return;
      }
      const fileName = imageFileNameFromBlob(blob, preferredName);
      const defaultAlt = defaultImageAlt(fileName);
      const bytes = await blobToByteArray(blob);
      const image = await saveImageBytesToAssets(documentPath, fileName, bytes, defaultAlt);
      if (insertCopiedImage(image, documentPath)) pushToast('Image pasted', 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Pasted image could not be saved.', 'error');
    }
  }, [editorCanInsertMarkdown, ensureDocumentPathForAssets, insertCopiedImage, pushToast]);

  const handleInsertImage = useCallback(async () => {
    try {
      const imagePath = await pickImageFile();
      if (!imagePath) return;
      await insertImageFromPath(imagePath, true);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Image picker failed.', 'error');
    }
  }, [insertImageFromPath, pushToast]);

  return {
    insertMarkdown,
    insertImageFromPath,
    insertImageBlob,
    handleInsertImage,
  };
}
