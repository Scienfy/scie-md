import { describe, expect, it } from 'vitest';
import { applyDiffDecisions, applyThreeWayDiffDecisions, createDiffHunks } from './diffReview';

describe('diffReview', () => {
  it('creates hunks and applies accepted or rejected decisions', () => {
    const before = 'A\nB\nC\n';
    const after = 'A\nB changed\nC\nD\n';
    const hunks = createDiffHunks(before, after);

    expect(hunks).toHaveLength(2);
    expect(applyDiffDecisions(before, after, hunks, new Set())).toBe(after);
    expect(applyDiffDecisions(before, after, hunks, new Set(hunks.map((hunk) => hunk.id)))).toBe(before);
    expect(applyDiffDecisions(before, after, hunks, new Set([hunks[0].id]))).toBe('A\nB\nC\nD\n');
  });

  it('preserves non-conflicting local edits while applying disk edits from a saved baseline', () => {
    const base = 'Intro.\n\nShared sentence.\n';
    const mine = 'Intro from me.\n\nShared sentence.\n\nMy new paragraph.\n';
    const disk = 'Intro.\n\nShared sentence from disk.\n';
    const diskHunks = createDiffHunks(base, disk);

    expect(applyThreeWayDiffDecisions(base, mine, disk, diskHunks, new Set())).toBe(
      'Intro from me.\n\nShared sentence from disk.\n\nMy new paragraph.\n',
    );
  });

  it('keeps overlapping local and disk edits with conflict markers', () => {
    const base = 'Intro.\nShared sentence.\nDone.\n';
    const mine = 'Intro.\nShared sentence from me.\nDone.\n';
    const disk = 'Intro.\nShared sentence from disk.\nDone.\n';
    const diskHunks = createDiffHunks(base, disk);

    expect(applyThreeWayDiffDecisions(base, mine, disk, diskHunks, new Set())).toBe([
      'Intro.',
      '<<<<<<< ScieMD local edits',
      'Shared sentence from me.',
      '=======',
      'Shared sentence from disk.',
      '>>>>>>> Disk changes',
      'Done.',
      '',
    ].join('\n'));
  });

  it('groups interleaved overlapping local and disk hunks into one conflict region', () => {
    const base = 'A\nB\nC\nD\nE\n';
    const mine = 'A\nB local\nC\nD local\nE\n';
    const disk = 'A\nB disk\nC disk\nD disk\nE\n';
    const diskHunks = createDiffHunks(base, disk);

    expect(applyThreeWayDiffDecisions(base, mine, disk, diskHunks, new Set())).toBe([
      'A',
      '<<<<<<< ScieMD local edits',
      'B local',
      'C',
      'D local',
      '=======',
      'B disk',
      'C disk',
      'D disk',
      '>>>>>>> Disk changes',
      'E',
      '',
    ].join('\n'));
  });

  it('keeps bridged overlap components together so no local or disk hunk is dropped', () => {
    const base = 'A\nB\nC\nD\nE\nF\nG\nH\n';
    const mine = 'A\nB local\nC\nD local\nE\nF local\nG\nH\n';
    const disk = 'A\nB disk\nC disk\nD\nE disk\nF disk\nG\nH\n';
    const diskHunks = createDiffHunks(base, disk);
    const merged = applyThreeWayDiffDecisions(base, mine, disk, diskHunks, new Set());

    expect(merged).toBe([
      'A',
      '<<<<<<< ScieMD local edits',
      'B local',
      'C',
      'D local',
      'E',
      'F local',
      '=======',
      'B disk',
      'C disk',
      'D',
      'E disk',
      'F disk',
      '>>>>>>> Disk changes',
      'G',
      'H',
      '',
    ].join('\n'));
    expect(merged.match(/<<<<<<< ScieMD local edits/g)).toHaveLength(1);
    for (const expectedLine of ['B local', 'D local', 'F local', 'B disk', 'C disk', 'E disk', 'F disk']) {
      expect(merged.match(new RegExp(`^${expectedLine}$`, 'gm'))).toHaveLength(1);
    }
  });

  it('keeps local edits when an overlapping disk hunk is rejected', () => {
    const base = 'Intro.\nShared sentence.\nDone.\n';
    const mine = 'Intro.\nShared sentence from me.\nDone.\n';
    const disk = 'Intro.\nShared sentence from disk.\nDone.\n';
    const diskHunks = createDiffHunks(base, disk);

    expect(applyThreeWayDiffDecisions(base, mine, disk, diskHunks, new Set(diskHunks.map((hunk) => hunk.id)))).toBe(mine);
  });

  it('treats competing same-position insertions as a conflict instead of silently ordering them', () => {
    const base = 'A\nB\n';
    const mine = 'A\nlocal insertion\nB\n';
    const disk = 'A\ndisk insertion\nB\n';
    const diskHunks = createDiffHunks(base, disk);

    expect(applyThreeWayDiffDecisions(base, mine, disk, diskHunks, new Set())).toBe([
      'A',
      '<<<<<<< ScieMD local edits',
      'local insertion',
      '=======',
      'disk insertion',
      '>>>>>>> Disk changes',
      'B',
      '',
    ].join('\n'));
  });

  it('does not turn adjacent non-overlapping edits into conflicts without a real overlap', () => {
    const base = 'A\nB\nC\nD\n';
    const mine = 'A local\nB\nC\nD\n';
    const disk = 'A\nB disk\nC\nD\n';
    const diskHunks = createDiffHunks(base, disk);

    expect(applyThreeWayDiffDecisions(base, mine, disk, diskHunks, new Set())).toBe('A local\nB disk\nC\nD\n');
  });

  it('splits hunks at locked-section boundaries so protected changes can be rejected alone', () => {
    const base = [
      'Editable before.',
      '<!-- scie_md:lock:start reason="approved" -->',
      'Locked wording.',
      '<!-- scie_md:lock:end -->',
      'Editable after.',
    ].join('\n');
    const disk = [
      'Disk before.',
      '<!-- scie_md:lock:start reason="approved" -->',
      'Disk changed locked wording.',
      '<!-- scie_md:lock:end -->',
      'Disk after.',
    ].join('\n');
    const hunks = createDiffHunks(base, disk);

    expect(hunks.length).toBeGreaterThan(1);
    expect(hunks.some((hunk) => hunk.beforeStart <= 1 && hunk.beforeEnd >= 4)).toBe(false);
  });

  it('ignores whitespace-only reflow inside word-level prose diffs', () => {
    const hunks = createDiffHunks('The material is stable and reproducible.\n', 'The material is stable   and reproducible.\n');
    const removedSegments = hunks[0].diffLines[0].segments ?? [];
    const addedSegments = hunks[0].diffLines[1].segments ?? [];

    expect(removedSegments.every((segment) => segment.kind === 'same')).toBe(true);
    expect(addedSegments.every((segment) => segment.kind === 'same')).toBe(true);
  });

  it('falls back to a bounded whole-document hunk for very large diffs', () => {
    const before = Array.from({ length: 1100 }, (_, index) => `before ${index}`).join('\n');
    const after = Array.from({ length: 1100 }, (_, index) => `after ${index}`).join('\n');

    const hunks = createDiffHunks(before, after);

    expect(hunks).toHaveLength(1);
    expect(hunks[0].beforeLines).toHaveLength(1100);
    expect(hunks[0].afterLines).toHaveLength(1100);
  });

  it('falls back for huge single-line edits before allocating word diff tables', () => {
    const before = `${'a'.repeat(180_000)}\n`;
    const after = `${'b'.repeat(180_000)}\n`;

    const hunks = createDiffHunks(before, after);

    expect(hunks).toHaveLength(1);
    expect(hunks[0].diffLines[0].segments).toBeUndefined();
    expect(hunks[0].diffLines[1].segments).toBeUndefined();
  });

  it('skips word-level segments for token-heavy line edits', () => {
    const before = `${Array.from({ length: 2500 }, (_, index) => `before${index}`).join(' ')}\n`;
    const after = `${Array.from({ length: 2500 }, (_, index) => `after${index}`).join(' ')}\n`;

    const hunks = createDiffHunks(before, after);

    expect(hunks).toHaveLength(1);
    expect(hunks[0].diffLines[0].segments).toBeUndefined();
    expect(hunks[0].diffLines[1].segments).toBeUndefined();
  });
});
