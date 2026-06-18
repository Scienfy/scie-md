import { describe, expect, it } from 'vitest';
import i18n, { resources } from './index';

describe('i18n bootstrap', () => {
  it('initializes the default English namespace', () => {
    expect(i18n.isInitialized).toBe(true);
    expect(resources.en.app.accessibility.skipToEditor).toBe('Skip to editor');
    expect(i18n.t('accessibility.skipToEditor')).toBe('Skip to editor');
  });
});
