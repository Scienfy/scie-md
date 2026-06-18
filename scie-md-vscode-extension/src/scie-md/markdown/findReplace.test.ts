import { describe, expect, it } from 'vitest';
import { findTextMatches, replaceAllTextMatches, replaceTextMatch, replaceTextMatches } from './findReplace';

describe('findReplace', () => {
  it('finds matches case-insensitively by default', () => {
    expect(findTextMatches('Alpha alpha', 'alpha')).toEqual([
      { from: 0, to: 5 },
      { from: 6, to: 11 },
    ]);
  });

  it('replaces one or all matches', () => {
    const matches = findTextMatches('one two one', 'one');

    expect(replaceTextMatch('one two one', matches[0], '1')).toBe('1 two one');
    expect(replaceAllTextMatches('one two one', 'one', '1')).toBe('1 two 1');
    expect(replaceTextMatches('one two one', [matches[1]], '1')).toBe('one two 1');
  });

  it('keeps replacement offsets stable when case folding changes length', () => {
    expect(findTextMatches('Straße', 'STRASSE')).toEqual([{ from: 0, to: 6 }]);
    expect(replaceAllTextMatches('Straße', 'STRASSE', 'Road')).toBe('Road');
    expect(findTextMatches('İstanbul', 'i\u0307')).toEqual([{ from: 0, to: 1 }]);
  });
});
