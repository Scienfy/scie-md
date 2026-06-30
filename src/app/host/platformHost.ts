import type { CopyImageResponse, FileMetadata } from '../documentState';
import type { FileExplorerEntry } from '../../services/fileService';
import type { FileWatchChangeEvent } from '../../services/fileWatchService';
import type { InkscapeInfo, SvgExportFormat, SvgExportResponse } from '../../services/inkscapeService';
import type { PandocExportResponse } from '../../services/exportService';
import type { ExportRequestOptions, PandocExportFormat } from '../../export/exportTypes';
import type { HostUnlisten } from './documentHost';

// Workflow-level platform side effects live here so app hooks can be tested with
// fake hosts. Leaf utilities such as render-capture image reads, Milkdown SVG
// node-view editing, and citation file helpers stay as service-level globals
// until their callers need host-level workflow tests.

export interface PlatformAssetHost {
  pickImageFile(): Promise<string | null>;
  grantExternalImagePath(path: string): Promise<string>;
  copyImageToAssets(documentPath: string, imagePath: string, altText: string): Promise<CopyImageResponse>;
  saveImageBytesToAssets(documentPath: string, fileName: string, bytes: number[], altText: string): Promise<CopyImageResponse>;
  defaultImageAlt(filePath: string): string;
  markdownImageSyntax(altText: string, markdownPath: string): string;
  isImagePath(filePath: string): boolean;
  imageFileNameFromBlob(blob: Blob, preferredName?: string): string;
  blobToByteArray(blob: Blob): Promise<number[]>;
}

export interface PlatformExportHost {
  pickHtmlSavePath(defaultPath?: string | null): Promise<string | null>;
  pickExportSavePath(format: PandocExportFormat, defaultPath?: string | null): Promise<string | null>;
  writeTextFileAtomic(path: string, markdown: string, metadata: FileMetadata | null, expectedMetadata?: FileMetadata | null): Promise<FileMetadata>;
  defaultPandocExportPath(documentPath: string | null, format: PandocExportFormat): string;
  checkPandocAvailable(): Promise<string>;
  exportStyledHtmlToPdf(html: string, outputPath: string): Promise<PandocExportResponse>;
  exportHtmlToDocxNative(html: string, outputPath: string): Promise<PandocExportResponse>;
  exportHtmlWithPandoc(
    html: string,
    documentPath: string | null,
    outputPath: string,
    format: PandocExportFormat,
    options?: ExportRequestOptions,
  ): Promise<PandocExportResponse>;
  exportWithPandoc(
    markdown: string,
    documentPath: string | null,
    outputPath: string,
    format: PandocExportFormat,
    options?: ExportRequestOptions,
  ): Promise<PandocExportResponse>;
}

export interface PlatformInkscapeHost {
  checkAvailable(customPath?: string | null): Promise<InkscapeInfo>;
  exportSvg(svgSource: string, documentPath: string | null, format: SvgExportFormat): Promise<SvgExportResponse>;
}

export interface PlatformFileBrowserHost {
  pickFolder(): Promise<string | null>;
  listReadableFiles(path: string): Promise<FileExplorerEntry[]>;
}

export interface PlatformWatcherHost {
  listenFileWatchChanges(callback: (event: FileWatchChangeEvent) => void): Promise<HostUnlisten>;
  updateWatchedFiles(scope: string, paths: string[]): Promise<boolean>;
  clearWatchedFiles(scope: string): Promise<boolean>;
}

export interface PlatformDragDropHost {
  listenDroppedPaths(callback: (paths: string[]) => void): Promise<HostUnlisten>;
}

export interface DesktopPlatformHost {
  runtime: {
    isDesktopRuntime(): boolean;
  };
  assets: PlatformAssetHost;
  export: PlatformExportHost;
  inkscape: PlatformInkscapeHost;
  fileBrowser: PlatformFileBrowserHost;
  watcher: PlatformWatcherHost;
  dragDrop: PlatformDragDropHost;
  reveal: {
    revealInFileManager(path: string): Promise<void>;
  };
  maintenance: {
    cleanupStaleTempFilesForPaths(paths: string[]): Promise<void>;
  };
}
