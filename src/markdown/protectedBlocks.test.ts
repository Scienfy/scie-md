import { describe, expect, it } from 'vitest';
import {
  changeTouchesProtectedBlockBody,
  changeTouchesProtectedAnchor,
  createProtectedAnchorSnippet,
  createProtectedBlockSnippet,
  detectProtectedChanges,
  parseProtectedAnchors,
  parseProtectedBlocks,
  protectedAnchorQuoteRange,
  protectedBlockBodyRange,
} from './protectedBlocks';
import { createDiffHunks } from './diffReview';

describe('protectedBlocks', () => {
  it('parses locked markdown comments with line ranges and reason', () => {
    const markdown = [
      '# Draft',
      '<!-- scie_md:lock:start reason="approved intro" -->',
      'Do not rewrite this paragraph.',
      '<!-- scie_md:lock:end -->',
      '',
    ].join('\n');

    expect(parseProtectedBlocks(markdown)).toMatchObject([
      {
        startLine: 2,
        endLine: 4,
        reason: 'approved intro',
        body: 'Do not rewrite this paragraph.',
      },
    ]);
  });

  it('detects diff hunks that touch locked sections', () => {
    const before = [
      '<!-- scie_md:lock:start reason="approved" -->',
      'Stable sentence.',
      '<!-- scie_md:lock:end -->',
      '',
      'Editable sentence.',
    ].join('\n');
    const after = before.replace('Stable sentence.', 'Changed sentence.');

    const hunks = createDiffHunks(before, after);
    expect(detectProtectedChanges(before, hunks)).toHaveLength(1);
  });

  it('protects locked body and marker edits without blocking insertions before or after the lock', () => {
    const markdown = [
      'Before.',
      '<!-- scie_md:lock:start reason="approved" -->',
      'Locked claim.',
      '<!-- scie_md:lock:end -->',
      'After.',
    ].join('\n');
    const [block] = parseProtectedBlocks(markdown);
    const body = protectedBlockBodyRange(block);

    expect(markdown.slice(body.start, body.end)).toContain('Locked claim.');
    expect(changeTouchesProtectedBlockBody(block, body.start, body.start)).toBe(true);
    expect(changeTouchesProtectedBlockBody(block, body.start + 2, body.start + 6)).toBe(true);
    expect(changeTouchesProtectedBlockBody(block, block.start + 2, block.start + 6)).toBe(true);
    expect(changeTouchesProtectedBlockBody(block, block.start, block.start)).toBe(false);
    expect(changeTouchesProtectedBlockBody(block, block.end, block.end)).toBe(false);
  });

  it('adds word segments for prose line edits', () => {
    const hunks = createDiffHunks('The material is stable.\n', 'The material is robust.\n');
    expect(hunks[0].diffLines[0].segments?.some((segment) => segment.kind === 'removed')).toBe(true);
    expect(hunks[0].diffLines[1].segments?.some((segment) => segment.kind === 'added')).toBe(true);
  });

  it('splits diff hunks at variant metadata boundaries', () => {
    const before = [
      'Before.',
      '<!-- scie_md:variant:group id="abstract" active="v1" -->',
      '<!-- scie_md:variant:item id="v1" name="Draft" -->',
      'Original variant.',
      '<!-- scie_md:variant:end -->',
      'After.',
    ].join('\n');
    const after = before
      .replace('active="v1"', 'active="v2"')
      .replace('Original variant.', 'Variant revised.');

    const hunks = createDiffHunks(before, after);
    expect(hunks.length).toBeGreaterThan(1);
    expect(hunks.some((hunk) => (
      hunk.beforeLines.some((line) => line.includes('scie_md:variant:group'))
      && hunk.beforeLines.includes('Original variant.')
    ))).toBe(false);
  });

  it('creates a canonical lock snippet', () => {
    expect(createProtectedBlockSnippet('Text', 'voice')).toContain('scie_md:lock:start reason="voice"');
  });

  it('creates and parses quote-anchored locks for sentence-level selections', () => {
    const snippet = createProtectedAnchorSnippet('selected sentence: with detail', 'approved', 'lock-1');
    const [anchor] = parseProtectedAnchors(`${snippet}\n\nAlpha selected sentence: with detail omega.`);

    expect(snippet).toContain('scie_md:lock id="lock-1" target="quote"');
    expect(anchor).toMatchObject({
      id: 'lock-1',
      reason: 'approved',
      quote: 'selected sentence: with detail',
    });
  });

  it('detects edits that touch a quote-anchored lock', () => {
    const markdown = [
      createProtectedAnchorSnippet('selected sentence', 'approved', 'lock-1'),
      '',
      'Alpha selected sentence omega.',
    ].join('\n');
    const [anchor] = parseProtectedAnchors(markdown);
    const range = protectedAnchorQuoteRange(markdown, anchor);

    expect(range).not.toBeNull();
    expect(changeTouchesProtectedAnchor(anchor, markdown, range?.start ?? 0, range?.end ?? 0)).toBe(true);
    expect(changeTouchesProtectedAnchor(anchor, markdown, markdown.length, markdown.length)).toBe(false);
  });

  it('uses quote context to protect the intended duplicate occurrence', () => {
    const markdown = [
      createProtectedAnchorSnippet('repeated sentence', 'approved', 'lock-1', {
        prefix: 'Beta',
        suffix: 'two',
      }),
      '',
      'Alpha repeated sentence one. Beta repeated sentence two.',
    ].join('\n');
    const [anchor] = parseProtectedAnchors(markdown);
    const range = protectedAnchorQuoteRange(markdown, anchor);

    expect(anchor).toMatchObject({ prefix: 'Beta', suffix: 'two' });
    expect(range).not.toBeNull();
    expect(markdown.slice(range?.start ?? 0, range?.end ?? 0)).toBe('repeated sentence');
    expect(markdown.slice(0, range?.start ?? 0)).toContain('Beta ');
  });

  it('ignores lock examples inside fenced code', () => {
    const markdown = [
      '```markdown',
      '<!-- scie_md:lock:start reason="example" -->',
      'Do not parse this example.',
      '<!-- scie_md:lock:end -->',
      '```',
    ].join('\n');

    expect(parseProtectedBlocks(markdown)).toEqual([]);
  });

  it('parses nested locks with stack semantics', () => {
    const markdown = [
      '<!-- scie_md:lock:start reason="outer" -->',
      'Outer start.',
      '<!-- scie_md:lock:start reason="inner" -->',
      'Inner.',
      '<!-- scie_md:lock:end -->',
      'Outer end.',
      '<!-- scie_md:lock:end -->',
    ].join('\n');

    const blocks = parseProtectedBlocks(markdown);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ reason: 'outer', startLine: 1, endLine: 7 });
    expect(blocks[1]).toMatchObject({ reason: 'inner', startLine: 3, endLine: 5 });
  });
});
