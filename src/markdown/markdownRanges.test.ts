import { describe, expect, it } from 'vitest';
import { fencedCodeRanges, inlineCodeRanges, isOffsetInsideRanges } from './markdownRanges';

describe('markdownRanges', () => {
  it('tracks fenced code offsets without treating four-space indented fences as real fences', () => {
    const markdown = [
      'Paragraph',
      '',
      '    ```ts',
      '    const insideIndentedCode = true;',
      '    ```',
      '',
      '```js',
      'const fenced = true;',
      '```',
      '',
      'After',
    ].join('\r\n');

    const ranges = fencedCodeRanges(markdown);
    const indentedOffset = markdown.indexOf('insideIndentedCode');
    const fencedOffset = markdown.indexOf('const fenced');
    const afterOffset = markdown.indexOf('After');

    expect(ranges).toHaveLength(2);
    expect(isOffsetInsideRanges(indentedOffset, ranges)).toBe(true);
    expect(isOffsetInsideRanges(fencedOffset, ranges)).toBe(true);
    expect(isOffsetInsideRanges(afterOffset, ranges)).toBe(false);
  });

  it('keeps unclosed fenced and indented code ranges bounded to source offsets', () => {
    const markdown = 'Intro\n\n~~~python\nprint("unterminated")\n';
    const ranges = fencedCodeRanges(markdown);
    expect(ranges).toEqual([{ start: markdown.indexOf('~~~python'), end: markdown.length }]);
  });

  it('matches inline code spans by equal backtick run length', () => {
    const markdown = [
      'Use `one` and ``two ` ticks``.',
      'Do not treat ``mismatched` as closed.',
    ].join('\n');
    const ranges = inlineCodeRanges(markdown);

    expect(ranges.map((range) => markdown.slice(range.start, range.end))).toEqual([
      '`one`',
      '``two ` ticks``',
    ]);
  });
});
