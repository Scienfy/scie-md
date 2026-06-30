export interface LockRange {
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
}

export interface LockBoundary {
  kind: 'start' | 'end';
  from: number;
  to: number;
  contentFrom?: number;
  reason?: string | null;
}

export interface CollectedLockRange extends LockRange {
  reason: string | null;
}

export function collectLockRangesFromBoundaries(boundaries: LockBoundary[]): CollectedLockRange[] {
  const ranges: CollectedLockRange[] = [];
  const stack: Array<{ from: number; contentFrom: number; reason: string | null }> = [];
  const ordered = boundaries.slice().sort((left, right) => left.from - right.from || left.to - right.to);
  for (const boundary of ordered) {
    if (boundary.kind === 'start') {
      stack.push({
        from: boundary.from,
        contentFrom: boundary.contentFrom ?? boundary.to,
        reason: boundary.reason ?? null,
      });
      continue;
    }
    const start = stack.pop();
    if (!start) continue;
    ranges.push({
      from: start.from,
      to: boundary.to,
      contentFrom: start.contentFrom,
      contentTo: boundary.from,
      reason: start.reason,
    });
  }
  return ranges.sort((left, right) => left.from - right.from || left.to - right.to);
}

export function changeTouchesLockRange(changeFrom: number, changeTo: number, range: LockRange): boolean {
  if (changeFrom === changeTo) {
    return changeFrom > range.from && changeFrom < range.to;
  }
  return rangesIntersect(changeFrom, changeTo, range.from, range.to);
}

function rangesIntersect(changeFrom: number, changeTo: number, rangeFrom: number, rangeTo: number): boolean {
  if (rangeFrom === rangeTo) return changeFrom <= rangeFrom && rangeFrom <= changeTo;
  return changeFrom < rangeTo && rangeFrom < changeTo;
}
