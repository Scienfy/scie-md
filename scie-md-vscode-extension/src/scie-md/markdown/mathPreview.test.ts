import { describe, expect, it } from 'vitest';
import { findBlockMathRange, findInlineMathRanges } from './mathPreview';

describe('mathPreview', () => {
  it('finds inline dollar math while ignoring display delimiters', () => {
    expect(findInlineMathRanges('Area is $x^2$ and $$not inline$$.')).toEqual([
      { from: 8, to: 13, content: 'x^2' },
    ]);
  });

  it('ignores escaped dollar delimiters', () => {
    expect(findInlineMathRanges('Cost is \\$5 and math is $a+b$.')).toEqual([
      { from: 24, to: 29, content: 'a+b' },
    ]);
  });

  it('finds display math blocks', () => {
    expect(findBlockMathRange('$$\nE=mc^2\n$$')).toEqual({
      from: 0,
      to: 12,
      content: 'E=mc^2',
    });
  });
});
