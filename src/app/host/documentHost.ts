import type { FileMetadata, ReadTextFileResponse } from '../documentState';
import type { DocumentFormat } from '@sciemd/core';
import type { DiagnosticsEvent } from '../../services/nativeRecoveryService';
import type { PersistedSettings } from '../../services/settingsService';
import type { UntitledDraft } from '../../services/draftRecoveryService';
import type { FileWatchChangeEvent } from '../../services/fileWatchService';

export type HostUnlisten = () => void;

export interface FileHost {
  readTextFile(path: string): Promise<ReadTextFileResponse>;
  readTextFileForEdit(path: string): Promise<ReadTextFileResponse>;
  statFile(path: string, options?: { contentHash?: boolean }): Promise<FileMetadata>;
  writeTextFileAtomic(
    path: string,
    sourceText: string,
    metadata: FileMetadata | null,
    expectedMetadata?: FileMetadata | null,
  ): Promise<FileMetadata>;
  createBackupSnapshot(path: string, label: string): Promise<string | null>;
}

export interface DialogHost {
  pickMarkdownFile(): Promise<string | null>;
  pickDocumentFile(): Promise<string | null>;
  pickJsonSchemaFile(): Promise<string | null>;
  pickSavePath(defaultPath?: string | null, format?: DocumentFormat): Promise<string | null>;
}

export interface LaunchHost {
  /**
   * The generic document launch methods are preferred for native startup and
   * Open With. Markdown-named methods remain as compatibility aliases.
   */
  getInitialMarkdownPath(): Promise<string | null>;
  getInitialDocumentPath(): Promise<string | null>;
  peekPendingMarkdownOpen(): Promise<string | null>;
  peekPendingDocumentOpen(): Promise<string | null>;
  takePendingMarkdownOpen(): Promise<string | null>;
  takePendingDocumentOpen(): Promise<string | null>;
  clearPendingMarkdownOpen(path: string): Promise<void>;
  clearPendingDocumentOpen(path: string): Promise<void>;
  listenSingleInstanceOpen(callback: (path: string) => void): Promise<HostUnlisten>;
}

export interface RecoveryHost {
  loadUntitledDraft(now?: number): Promise<UntitledDraft | null>;
  loadFileDraft(filePath: string, now?: number): Promise<UntitledDraft | null>;
  saveUntitledDraft(sourceText: string, savedAt?: number, format?: DocumentFormat): void;
  saveUntitledDraftAsync(sourceText: string, savedAt?: number, format?: DocumentFormat): Promise<void>;
  clearUntitledDraftAsync(): Promise<void>;
  saveFileDraft(filePath: string, sourceText: string, savedAt?: number, baseMetadata?: FileMetadata | null, format?: DocumentFormat): void;
  saveFileDraftAsync(filePath: string, sourceText: string, savedAt?: number, baseMetadata?: FileMetadata | null, format?: DocumentFormat): Promise<void>;
  clearFileDraft(filePath: string): void;
  clearFileDraftAsync(filePath: string): Promise<void>;
  shouldPersistUntitledDraft(sourceText: string, initialSourceText: string, options?: { suppressBundledWelcome?: boolean }): boolean;
  shouldOfferFileDraftRestore(draft: UntitledDraft, diskMetadata: FileMetadata): boolean;
  isBundledWelcomeMarkdown(markdown: string): boolean;
  appendDiagnosticsEvent(event: DiagnosticsEvent): Promise<boolean>;
}

export interface SettingsHost {
  rememberRecentFile(filePath: string): PersistedSettings;
  forgetRecentFile(filePath: string): PersistedSettings;
  updateSettings(patch: Partial<PersistedSettings>): PersistedSettings;
}

export interface WatcherHost {
  listenFileWatchChanges(callback: (event: FileWatchChangeEvent) => void): Promise<HostUnlisten>;
  updateWatchedFiles(scope: string, paths: string[]): Promise<boolean>;
  clearWatchedFiles(scope: string): Promise<boolean>;
}

export interface DocumentHost {
  file: FileHost;
  dialog: DialogHost;
  launch: LaunchHost;
  recovery: RecoveryHost;
  settings: SettingsHost;
  watcher: WatcherHost;
}
