import { describe, expect, it } from 'vitest';
import {
  getVisualStyleOption,
  isVisualStyleId,
  nextVisualStyle,
  normalizeVisualStyleId,
  VISUAL_STYLE_OPTIONS,
} from './visualStyleService';

describe('visualStyleService', () => {
  it('exposes the release style presets without retired style aliases', () => {
    const ids = VISUAL_STYLE_OPTIONS.map((style) => style.id);

    expect(ids).toEqual([
      'scientific-draft',
      'journal-manuscript',
      'lab-notebook',
      'technical-code',
      'codex',
      'scienfy',
      'science',
      'nature',
      'claude',
    ]);
    expect(isVisualStyleId('amin')).toBe(false);
    expect(isVisualStyleId('scie-sans')).toBe(false);
    expect(isVisualStyleId('scie-sans-compact')).toBe(false);
  });

  it('falls back to the first style and cycles through all styles', () => {
    expect(getVisualStyleOption('science').label).toBe('Science');
    expect(getVisualStyleOption('scienfy').label).toBe('Scienfy');
    expect(getVisualStyleOption('claude').label).toBe('Claude');
    expect(nextVisualStyle('nature')).toBe('claude');
    expect(nextVisualStyle('claude')).toBe('scientific-draft');
  });

  it('normalizes retired Scie Sans style aliases to Scienfy', () => {
    expect(normalizeVisualStyleId('amin')).toBe('scienfy');
    expect(normalizeVisualStyleId('amin-style')).toBe('scienfy');
    expect(normalizeVisualStyleId('research-statement')).toBe('scienfy');
    expect(normalizeVisualStyleId('scie-sans')).toBe('scienfy');
    expect(normalizeVisualStyleId('scie-sans-compact')).toBe('scienfy');
    expect(normalizeVisualStyleId('missing')).toBeNull();
  });
});
