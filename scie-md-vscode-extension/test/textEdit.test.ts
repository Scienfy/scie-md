import { describe, expect, it } from 'vitest';
import { computeMinimalTextReplacement } from '../src/extension/textEdit';

function applyReplacement(before: string, after: string): string {
  const replacement = computeMinimalTextReplacement(before, after);
  if (!replacement) return before;
  return `${before.slice(0, replacement.start)}${replacement.text}${before.slice(replacement.end)}`;
}

describe('computeMinimalTextReplacement', () => {
  it('returns null for identical documents', () => {
    expect(computeMinimalTextReplacement('same', 'same')).toBeNull();
  });

  it('creates a focused middle replacement', () => {
    const before = 'alpha\nbeta\ngamma\n';
    const after = 'alpha\nBETA\ngamma\n';
    const replacement = computeMinimalTextReplacement(before, after);

    expect(replacement).toEqual({
      start: 'alpha\n'.length,
      end: 'alpha\nbeta'.length,
      text: 'BETA',
    });
    expect(applyReplacement(before, after)).toBe(after);
  });

  it('handles append and delete edits', () => {
    expect(applyReplacement('alpha', 'alpha\nbeta')).toBe('alpha\nbeta');
    expect(applyReplacement('alpha\nbeta', 'alpha')).toBe('alpha');
  });
});
