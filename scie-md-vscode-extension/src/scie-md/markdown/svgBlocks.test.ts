import { describe, expect, it } from 'vitest';
import { createSvgFence, findSvgFenceBlocks, svgFenceBody } from './svgBlocks';

describe('svgBlocks', () => {
  it('finds standalone svg fenced blocks with source offsets', () => {
    const markdown = [
      'Intro.',
      '',
      '```svg',
      '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
      '```',
      '',
      'Outro.',
    ].join('\n');

    const blocks = findSvgFenceBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      line: 3,
      code: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
    });
    expect(markdown.slice(blocks[0].start, blocks[0].end)).toBe(blocks[0].raw);
  });

  it('extracts svg body and creates canonical fences', () => {
    expect(svgFenceBody('```svg\n<svg></svg>\n```')).toBe('<svg></svg>');
    expect(createSvgFence('<svg viewBox="0 0 1 1"></svg>')).toBe('```svg\n<svg viewBox="0 0 1 1"></svg>\n```');
  });

  it('requires the closing fence to match the opening marker type and length', () => {
    const markdown = [
      '````svg',
      '<svg><text>``` is content</text></svg>',
      '```',
      'still inside',
      '````',
    ].join('\n');

    const blocks = findSvgFenceBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].code).toContain('still inside');
  });

  it('ignores svg fence examples nested inside larger Markdown code fences', () => {
    const markdown = [
      '````markdown',
      '```svg',
      '<svg viewBox="0 0 10 10"></svg>',
      '```',
      '````',
    ].join('\n');

    expect(findSvgFenceBlocks(markdown)).toEqual([]);
  });
});
