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

  it('restores an external-launch draft only if the just-opened disk content is still displayed', () => {
    expect(shouldRestoreExternalLaunchDraft({
      stillCurrentDocument: true,
      currentMarkdown: '# Disk\n',
      diskMarkdown: '# Disk\n',
      draftMarkdown: '# Draft\n',
      draftRestoreOfferable: true,
    })).toBe(true);

    expect(shouldRestoreExternalLaunchDraft({
      stillCurrentDocument: true,
      currentMarkdown: '# Disk\n',
      diskMarkdown: '# Disk\n',
      draftMarkdown: '',
      draftRestoreOfferable: true,
    })).toBe(true);

    expect(shouldRestoreExternalLaunchDraft({
      stillCurrentDocument: true,
      currentMarkdown: '# User already typed\n',
      diskMarkdown: '# Disk\n',
      draftMarkdown: '# Draft\n',
      draftRestoreOfferable: true,
    })).toBe(false);
  });

  it('does not restore stale or inapplicable external-launch drafts', () => {
    for (const decision of [
      { stillCurrentDocument: false, currentMarkdown: '# Disk\n', diskMarkdown: '# Disk\n', draftMarkdown: '# Draft\n', draftRestoreOfferable: true },
      { stillCurrentDocument: true, currentMarkdown: '# Disk\n', diskMarkdown: '# Disk\n', draftMarkdown: '# Disk\n', draftRestoreOfferable: true },
      { stillCurrentDocument: true, currentMarkdown: '# Disk\n', diskMarkdown: '# Disk\n', draftMarkdown: null, draftRestoreOfferable: true },
      { stillCurrentDocument: true, currentMarkdown: '# Disk\n', diskMarkdown: '# Disk\n', draftMarkdown: '# Draft\n', draftRestoreOfferable: false },
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
