import { describe, expect, it } from 'vitest';
import { findMermaidFenceBlocks, mermaidFenceBody } from './mermaidBlocks';

describe('mermaidBlocks', () => {
  it('finds backtick and tilde mermaid fences with source offsets', () => {
    const markdown = [
      'Intro',
      '~~~Mermaid',
      'flowchart LR',
      '  A --> B',
      '~~~~',
      '',
      '```mermaid',
      'sequenceDiagram',
      '  A->>B: hello',
      '```',
    ].join('\n');

    const blocks = findMermaidFenceBlocks(markdown);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ line: 2, code: 'flowchart LR\n  A --> B' });
    expect(blocks[1]).toMatchObject({ line: 7, code: 'sequenceDiagram\n  A->>B: hello' });
    expect(markdown.slice(blocks[0].start, blocks[0].end)).toBe(blocks[0].raw);
  });

  it('requires matching fence marker families', () => {
    const markdown = [
      '```mermaid',
      'flowchart LR',
      '~~~',
      '',
      'text',
    ].join('\n');

    expect(findMermaidFenceBlocks(markdown)).toHaveLength(0);
  });

  it('ignores mermaid examples nested inside another fenced code block', () => {
    const markdown = [
      '```markdown',
      '```mermaid',
      'flowchart LR',
      '  A --> B',
      '```',
      '```',
      '',
      '```mermaid',
      'flowchart TD',
      '  C --> D',
      '```',
    ].join('\n');

    const blocks = findMermaidFenceBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].code).toBe('flowchart TD\n  C --> D');
  });

  it('extracts canonical fence bodies', () => {
    expect(mermaidFenceBody('```mermaid\nflowchart LR\n  A --> B\n```')).toBe('flowchart LR\n  A --> B');
  });
});
