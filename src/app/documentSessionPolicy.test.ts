import { describe, expect, it } from 'vitest';
import { DEFAULT_METADATA } from './documentState';
import {
  openedDocumentMode,
  shouldFlushAutosaveBeforeReplacingDocument,
  shouldRestoreExternalLaunchDraft,
} from './documentSessionPolicy';
import { SOURCE_ONLY_FILE_BYTES } from '../markdown/supportedMarkdown';

describe('document session policy', () => {
  it('forces oversized documents into source mode regardless of preferred mode', () => {
    const metadata = {
      ...DEFAULT_METADATA,
      lastKnownSizeBytes: SOURCE_ONLY_FILE_BYTES + 1,
    };

    expect(openedDocumentMode(metadata)).toBe('source');
    expect(openedDocumentMode(metadata, 'visual')).toBe('source');
    expect(openedDocumentMode(metadata, 'source')).toBe('source');
  });

  it('keeps preferred or visual mode for documents under the source-only limit', () => {
    const metadata = {
      ...DEFAULT_METADATA,
      lastKnownSizeBytes: SOURCE_ONLY_FILE_BYTES,
    };

    expect(openedDocumentMode(metadata)).toBe('visual');
    expect(openedDocumentMode(metadata, 'source')).toBe('source');
  });

  it('defaults structured documents to visual mode unless source mode is explicitly requested', () => {
    const metadata = {
      ...DEFAULT_METADATA,
      lastKnownSizeBytes: SOURCE_ONLY_FILE_BYTES,
    };

    expect(openedDocumentMode(metadata, undefined, 'json')).toBe('visual');
    expect(openedDocumentMode(metadata, undefined, 'jsonl')).toBe('visual');
    expect(openedDocumentMode(metadata, undefined, 'csv')).toBe('visual');
    expect(openedDocumentMode(metadata, 'source', 'json')).toBe('source');
    expect(openedDocumentMode(metadata, 'visual', 'json')).toBe('visual');
    expect(openedDocumentMode(metadata, 'visual', 'plainText')).toBe('source');
  });

  it('restores an external-launch draft only if the just-opened disk content is still displayed', () => {
    expect(shouldRestoreExternalLaunchDraft({
      stillCurrentDocument: true,
      currentSourceText: '# Disk\n',
      diskSourceText: '# Disk\n',
      draftSourceText: '# Draft\n',
      draftRestoreOfferable: true,
    })).toBe(true);

    expect(shouldRestoreExternalLaunchDraft({
      stillCurrentDocument: true,
      currentSourceText: '# Disk\n',
      diskSourceText: '# Disk\n',
      draftSourceText: '',
      draftRestoreOfferable: true,
    })).toBe(true);

    expect(shouldRestoreExternalLaunchDraft({
      stillCurrentDocument: true,
      currentSourceText: '# User already typed\n',
      diskSourceText: '# Disk\n',
      draftSourceText: '# Draft\n',
      draftRestoreOfferable: true,
    })).toBe(false);
  });

  it('does not restore stale or inapplicable external-launch drafts', () => {
    for (const decision of [
      { stillCurrentDocument: false, currentSourceText: '# Disk\n', diskSourceText: '# Disk\n', draftSourceText: '# Draft\n', draftRestoreOfferable: true },
      { stillCurrentDocument: true, currentSourceText: '# Disk\n', diskSourceText: '# Disk\n', draftSourceText: '# Disk\n', draftRestoreOfferable: true },
      { stillCurrentDocument: true, currentSourceText: '# Disk\n', diskSourceText: '# Disk\n', draftSourceText: null, draftRestoreOfferable: true },
      { stillCurrentDocument: true, currentSourceText: '# Disk\n', diskSourceText: '# Disk\n', draftSourceText: '# Draft\n', draftRestoreOfferable: false },
    ]) {
      expect(shouldRestoreExternalLaunchDraft(decision)).toBe(false);
    }
  });

  it('flushes autosave before replacement only for dirty saved documents without conflicts or blocks', () => {
    expect(shouldFlushAutosaveBeforeReplacingDocument({
      dirty: true,
      filePath: 'C:\\docs\\paper.md',
      externalConflict: false,
      autosaveBlocked: false,
    })).toBe(true);

    for (const decision of [
      { dirty: false, filePath: 'C:\\docs\\paper.md', externalConflict: false, autosaveBlocked: false },
      { dirty: true, filePath: null, externalConflict: false, autosaveBlocked: false },
      { dirty: true, filePath: 'C:\\docs\\paper.md', externalConflict: true, autosaveBlocked: false },
      { dirty: true, filePath: 'C:\\docs\\paper.md', externalConflict: false, autosaveBlocked: true },
    ]) {
      expect(shouldFlushAutosaveBeforeReplacingDocument(decision)).toBe(false);
    }
  });
});
