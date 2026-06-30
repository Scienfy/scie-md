import { describe, expect, it } from 'vitest';
import { changeTouchesLockRange, collectLockRangesFromBoundaries } from './lockRanges';

describe('lockRanges', () => {
  const range = {
    from: 10,
    contentFrom: 20,
    contentTo: 40,
    to: 50,
  };

  it('allows insertion immediately outside a lock', () => {
    expect(changeTouchesLockRange(10, 10, range)).toBe(false);
    expect(changeTouchesLockRange(50, 50, range)).toBe(false);
  });

  it('blocks insertions and replacements inside body or markers', () => {
    expect(changeTouchesLockRange(20, 20, range)).toBe(true);
    expect(changeTouchesLockRange(12, 16, range)).toBe(true);
    expect(changeTouchesLockRange(22, 28, range)).toBe(true);
    expect(changeTouchesLockRange(42, 48, range)).toBe(true);
  });

  it('collects nested ranges with shared stack semantics', () => {
    expect(collectLockRangesFromBoundaries([
      { kind: 'start', from: 0, to: 4, contentFrom: 4, reason: 'outer' },
      { kind: 'start', from: 10, to: 14, contentFrom: 14, reason: 'inner' },
      { kind: 'end', from: 20, to: 24 },
      { kind: 'end', from: 30, to: 34 },
    ])).toEqual([
      { from: 0, to: 34, contentFrom: 4, contentTo: 30, reason: 'outer' },
      { from: 10, to: 24, contentFrom: 14, contentTo: 20, reason: 'inner' },
    ]);
  });
});
