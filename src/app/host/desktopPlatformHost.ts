import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  blobToByteArray,
  copyImageToAssets,
  defaultImageAlt,
  imageFileNameFromBlob,
  isImagePath,
  markdownImageSyntax,
  pickImageFile,
  saveImageBytesToAssets,
} from '../../services/assetService';
import {
  cleanupStaleTempFilesForPaths,
  grantExternalPath,
  listReadableFiles,
  pickExportSavePath,
  pickFolder,
  pickHtmlSavePath,
  writeTextFileAtomic,
} from '../../services/fileService';
import {
  checkPandocAvailable,
  defaultPandocExportPath,
  exportHtmlToDocxNative,
  exportHtmlWithPandoc,
  exportStyledHtmlToPdf,
  exportWithPandoc,
} from '../../services/exportService';
import { checkInkscapeAvailable, exportSvgWithInkscape } from '../../services/inkscapeService';
import { revealInFileManager } from '../../services/revealService';
import {
  clearWatchedFiles,
  listenFileWatchChanges,
  updateWatchedFiles,
} from '../../services/fileWatchService';
import { isTauriRuntime } from '../runtime';
import type { DesktopPlatformHost } from './platformHost';

export const desktopPlatformHost: DesktopPlatformHost = {
  runtime: {
    isDesktopRuntime: isTauriRuntime,
  },
  assets: {
    pickImageFile,
    grantExternalImagePath: (path) => grantExternalPath(path, 'image'),
    copyImageToAssets,
    saveImageBytesToAssets,
    defaultImageAlt,
    markdownImageSyntax,
    isImagePath,
    imageFileNameFromBlob,
    blobToByteArray,
  },
  export: {
    pickHtmlSavePath,
    pickExportSavePath,
    writeTextFileAtomic,
    defaultPandocExportPath,
    checkPandocAvailable,
    exportStyledHtmlToPdf,
    exportHtmlToDocxNative,
    exportHtmlWithPandoc,
    exportWithPandoc,
  },
  inkscape: {
    checkAvailable: checkInkscapeAvailable,
    exportSvg: exportSvgWithInkscape,
  },
  fileBrowser: {
    pickFolder,
    listReadableFiles,
  },
  watcher: {
    listenFileWatchChanges,
    updateWatchedFiles,
    clearWatchedFiles,
  },
  dragDrop: {
    listenDroppedPaths: async (callback) => {
      if (!isTauriRuntime()) return () => undefined;
      return getCurrentWindow().onDragDropEvent((event) => {
        if (event.payload.type === 'drop') callback(event.payload.paths);
      });
    },
  },
  reveal: {
    revealInFileManager,
  },
  maintenance: {
    cleanupStaleTempFilesForPaths,
  },
};
