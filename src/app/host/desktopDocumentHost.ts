import { listen } from '@tauri-apps/api/event';
import {
  clearPendingDocumentOpen,
  clearPendingMarkdownOpen,
  getInitialDocumentPath,
  getInitialMarkdownPath,
  peekPendingDocumentOpen,
  peekPendingMarkdownOpen,
  pickDocumentFile,
  pickJsonSchemaFile,
  pickMarkdownFile,
  pickSavePath,
  takePendingDocumentOpen,
  takePendingMarkdownOpen,
  readTextFile,
  readTextFileForEdit,
  statFile,
  writeTextFileAtomic,
  createBackupSnapshot,
} from '../../services/fileService';
import {
  clearFileDraft,
  clearFileDraftAsync,
  clearUntitledDraftAsync,
  isBundledWelcomeMarkdown,
  loadFileDraftAsync,
  loadUntitledDraftAsync,
  saveFileDraft,
  saveFileDraftAsync,
  saveUntitledDraft,
  saveUntitledDraftAsync,
  shouldOfferFileDraftRestore,
  shouldPersistUntitledDraft,
} from '../../services/draftRecoveryService';
import { appendDiagnosticsEvent } from '../../services/nativeRecoveryService';
import { forgetRecentFile, rememberRecentFile, updateSettings } from '../../services/settingsService';
import {
  clearWatchedFiles,
  listenFileWatchChanges,
  updateWatchedFiles,
} from '../../services/fileWatchService';
import type { DocumentHost } from './documentHost';

export const desktopDocumentHost: DocumentHost = {
  file: {
    readTextFile,
    readTextFileForEdit,
    statFile,
    writeTextFileAtomic,
    createBackupSnapshot,
  },
  dialog: {
    pickMarkdownFile,
    pickDocumentFile,
    pickJsonSchemaFile,
    pickSavePath,
  },
  launch: {
    getInitialMarkdownPath,
    getInitialDocumentPath,
    peekPendingMarkdownOpen,
    peekPendingDocumentOpen,
    takePendingMarkdownOpen,
    takePendingDocumentOpen,
    clearPendingMarkdownOpen,
    clearPendingDocumentOpen,
    listenSingleInstanceOpen: async (callback) => listen<string>('single-instance-open', (event) => {
      callback(typeof event.payload === 'string' ? event.payload : '');
    }),
  },
  recovery: {
    loadUntitledDraft: loadUntitledDraftAsync,
    loadFileDraft: loadFileDraftAsync,
    saveUntitledDraft,
    saveUntitledDraftAsync,
    clearUntitledDraftAsync,
    saveFileDraft,
    saveFileDraftAsync,
    clearFileDraft,
    clearFileDraftAsync,
    shouldPersistUntitledDraft,
    shouldOfferFileDraftRestore,
    isBundledWelcomeMarkdown,
    appendDiagnosticsEvent,
  },
  settings: {
    rememberRecentFile,
    forgetRecentFile,
    updateSettings,
  },
  watcher: {
    listenFileWatchChanges,
    updateWatchedFiles,
    clearWatchedFiles,
  },
};
