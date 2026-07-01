import { describe, expect, it } from 'vitest';
import { formatCapabilitiesFor } from './formatCapabilities';

describe('formatCapabilitiesFor', () => {
  it('derives structured surfaces from core adapter declarations', () => {
    expect(formatCapabilitiesFor('json')).toMatchObject({
      canUseStructuredVisualMode: true,
      canEditJsonVisualTree: true,
      canUseRecordList: false,
      canUseTablePreview: false,
      sourceLanguage: 'json',
      sourceEditor: {
        codeMirrorLanguage: 'json',
        lintProfile: 'json',
      },
    });
    expect(formatCapabilitiesFor('jsonl')).toMatchObject({
      canUseStructuredVisualMode: false,
      canUseRecordList: true,
      canUseTablePreview: false,
      sourceLanguage: 'jsonl',
      sourceEditor: {
        codeMirrorLanguage: 'json',
        lintProfile: 'jsonl',
      },
    });
    expect(formatCapabilitiesFor('csv')).toMatchObject({
      canUseStructuredVisualMode: false,
      canUseRecordList: false,
      canUseTablePreview: true,
      sourceLanguage: 'csv',
      sourceEditor: {
        codeMirrorLanguage: 'plainText',
        lintProfile: 'tabular',
      },
    });
    expect(formatCapabilitiesFor('xml')).toMatchObject({
      canUseStructuredVisualMode: true,
      canEditJsonVisualTree: false,
      canUseRecordList: false,
      canUseTablePreview: false,
      sourceLanguage: 'xml',
      sourceEditor: {
        codeMirrorLanguage: 'xml',
        lintProfile: 'structured',
      },
    });
  });
});
