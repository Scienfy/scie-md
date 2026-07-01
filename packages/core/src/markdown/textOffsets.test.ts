import { describe, expect, it } from 'vitest';
import { lineStartOffsets, offsetToLine } from './textOffsets';

describe('textOffsets', () => {
  it('tracks line starts across mixed newline input', () => {
    const text = 'Alpha\nBeta\r\nGamma\rDelta';

    expect(lineStartOffsets(text)).toEqual([0, 6, 12, 18]);
  });

  it('maps source offsets to one-based line numbers', () => {
    const starts = lineStartOffsets('Alpha\nBeta\nGamma');

    expect(offsetToLine(starts, 0)).toBe(1);
    expect(offsetToLine(starts, 6)).toBe(2);
    expect(offsetToLine(starts, 99)).toBe(3);
  });
});
