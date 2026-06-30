import { describe, expect, it } from 'vitest';
import { DEFAULT_METADATA } from '../documentState';
import {
  buildOpenedDocumentTransition,
  buildReviewedDiskMergeTransition,
  buildUntitledDraftRestoreTransition,
  decideLaunchDuplicate,
  decideUntitledDraftRestore,
  displayNameForPath,
  documentOpenStatusClearDelay,
  nextDirtyReplacementStep,
  settingsDocumentTypeFor,
  shouldShowImmediatePreparingOverlay,
} from './controller';

describe('documentSession controller', () => {
  it('builds opened saved-document state and metadata-derived settings', () => {
    const transition = buildOpenedDocumentTransition({
      path: 'C:\\lab\\paper.md',
      content: '# Paper',
      metadata: DEFAULT_METADATA,
      preferredMode: 'source',
      parsedDocument: { visualStyle: 'scienfy', documentType: 'paper' },
      normalizeVisualStyle: (value) => value === 'scienfy' ? 'scienfy' : null,
    });

    expect(transition.state).toMatchObject({
      markdown: '# Paper',
      lastSavedMarkdown: '# Paper',
      filePath: 'C:\\lab\\paper.md',
      mode: 'source',
      autosaveStatus: 'saved',
      externalConflict: false,
    });
    expect(transition.settingsPatch).toEqual({ visualStyle: 'scienfy', documentType: 'report' });
    expect(transition.recentFilePath).toBe('C:\\lab\\paper.md');
  });

  it('builds untitled opened state without saved-file status', () => {
    const transition = buildOpenedDocumentTransition({
      path: null,
      content: '',
      metadata: DEFAULT_METADATA,
      preferredMode: 'visual',
      normalizeVisualStyle: () => null,
    });

    expect(transition.state.filePath).toBeNull();
    expect(transition.state.autosaveStatus).toBe('idle');
    expect(transition.recentFilePath).toBeNull();
  });

  it('records disk merge state as saved only when editor and disk match', () => {
    expect(buildReviewedDiskMergeTransition('# Same', '# Same', DEFAULT_METADATA).state.autosaveStatus).toBe('saved');
    expect(buildReviewedDiskMergeTransition('# Local', '# Disk', DEFAULT_METADATA).state.autosaveStatus).toBe('pending');
  });

  it('decides when untitled draft restore can be skipped, cleared, or prompted', () => {
    expect(decideUntitledDraftRestore({
      draftMarkdown: null,
      initialMarkdown: '# Welcome',
      draftIsBundledWelcome: false,
      initialIsBundledWelcome: true,
    }).action).toBe('skip');
    expect(decideUntitledDraftRestore({
      draftMarkdown: '# Welcome',
      initialMarkdown: '# Welcome',
      draftIsBundledWelcome: true,
      initialIsBundledWelcome: true,
    }).action).toBe('skip');
    expect(decideUntitledDraftRestore({
      draftMarkdown: '# Bundled',
      initialMarkdown: '# Initial bundled',
      draftIsBundledWelcome: true,
      initialIsBundledWelcome: true,
    }).action).toBe('clear-bundled-welcome');
    expect(decideUntitledDraftRestore({
      draftMarkdown: '# Draft',
      initialMarkdown: '# Welcome',
      draftIsBundledWelcome: false,
      initialIsBundledWelcome: true,
    }).action).toBe('prompt');
  });

  it('builds untitled draft restore state', () => {
    const transition = buildUntitledDraftRestoreTransition('# Draft', '# Welcome');

    expect(transition.state).toMatchObject({
      markdown: '# Draft',
      lastSavedMarkdown: '# Welcome',
      filePath: null,
      mode: 'visual',
      autosaveStatus: 'idle',
      externalConflict: false,
    });
    expect(transition.toast).toEqual({ text: 'Restored unsaved draft.', tone: 'warning' });
  });

  it('chooses the next dirty-replacement step', () => {
    expect(nextDirtyReplacementStep({
      dirty: false,
      filePath: null,
      externalConflict: false,
      autosaveBlocked: false,
    })).toBe('continue');
    expect(nextDirtyReplacementStep({
      dirty: true,
      filePath: 'C:\\lab\\paper.md',
      externalConflict: false,
      autosaveBlocked: false,
    })).toBe('flush-autosave');
    expect(nextDirtyReplacementStep({
      dirty: true,
      filePath: 'C:\\lab\\paper.md',
      externalConflict: true,
      autosaveBlocked: false,
    })).toBe('confirm-discard');
  });

  it('detects duplicate launch paths by active, in-flight, and recent opens', () => {
    expect(decideLaunchDuplicate({
      requestedPath: 'C:/Lab/Paper.md',
      activePath: 'c:\\lab\\paper.md',
      inFlightPathKeys: new Set(),
      lastLaunchOpen: null,
      nowMs: 10_000,
      duplicateWindowMs: 3_000,
    })).toMatchObject({ duplicate: true, reason: 'active' });

    expect(decideLaunchDuplicate({
      requestedPath: 'C:/Lab/Paper.md',
      activePath: null,
      inFlightPathKeys: new Set(['c:\\lab\\paper.md']),
      lastLaunchOpen: null,
      nowMs: 10_000,
      duplicateWindowMs: 3_000,
    })).toMatchObject({ duplicate: true, reason: 'in-flight' });

    expect(decideLaunchDuplicate({
      requestedPath: 'C:/Lab/Paper.md',
      activePath: null,
      inFlightPathKeys: new Set(),
      lastLaunchOpen: { pathKey: 'c:\\lab\\paper.md', openedAt: 8_000 },
      nowMs: 10_000,
      duplicateWindowMs: 3_000,
    })).toMatchObject({ duplicate: true, reason: 'recent' });
  });

  it('normalizes launch path display and status helpers', () => {
    expect(displayNameForPath('C:\\lab\\paper.md')).toBe('paper.md');
    expect(settingsDocumentTypeFor('paper')).toBe('report');
    expect(settingsDocumentTypeFor('memo')).toBe('memo');
    expect(settingsDocumentTypeFor('unknown')).toBeNull();
    expect(shouldShowImmediatePreparingOverlay(512 * 1024 - 1)).toBe(false);
    expect(shouldShowImmediatePreparingOverlay(512 * 1024)).toBe(true);
    expect(documentOpenStatusClearDelay(false)).toBe(0);
    expect(documentOpenStatusClearDelay(true)).toBe(220);
  });
});
