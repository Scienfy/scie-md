import { describe, expect, it } from 'vitest';
import { createTargetedInstructionSnippet, parseTargetedInstructionRaw, parseTargetedInstructions, resolveInstructionTargets } from './targetedInstructions';

describe('targetedInstructions', () => {
  it('parses targeted LLM instructions', () => {
    const markdown = [
      '# Draft',
      '<!-- scie_md:instruction target="next-block" prompt="Emphasize temperature dependency." -->',
      'The reaction slowed over time.',
    ].join('\n');

    expect(parseTargetedInstructions(markdown)).toMatchObject([
      {
        line: 2,
        target: 'next-block',
        prompt: 'Emphasize temperature dependency.',
      },
    ]);
  });

  it('supports multiline instruction bodies', () => {
    const raw = [
      '<!-- scie_md:instruction target="section":',
      'Revise the section for a journal audience.',
      '-->',
    ].join('\n');

    expect(parseTargetedInstructionRaw(raw)).toMatchObject({
      target: 'section',
      prompt: 'Revise the section for a journal audience.',
    });
  });

  it('resolves next-block instructions to precise markdown ranges', () => {
    const markdown = [
      '# Draft',
      '',
      '<!-- scie_md:instruction target="next-block" prompt="Tighten." -->',
      '',
      'The reaction slowed over time.',
      '',
      'Another paragraph.',
    ].join('\n');

    const targets = resolveInstructionTargets(markdown);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      startLine: 5,
      endLine: 5,
      markdown: 'The reaction slowed over time.',
    });
  });

  it('ignores instruction examples inside fenced code', () => {
    const markdown = [
      '```markdown',
      '<!-- scie_md:instruction target="next-block" prompt="Example only." -->',
      '```',
    ].join('\n');

    expect(parseTargetedInstructions(markdown)).toEqual([]);
  });

  it('escapes and decodes quoted prompt attributes', () => {
    const snippet = createTargetedInstructionSnippet('Say "precise" and keep A & B.', 'next-block');
    expect(snippet).toContain('&quot;precise&quot;');
    expect(parseTargetedInstructions(snippet)[0].prompt).toBe('Say "precise" and keep A & B.');
  });

  it('round-trips prompts containing an HTML comment terminator', () => {
    const snippet = createTargetedInstructionSnippet('Keep A --> B unchanged.', 'next-block');

    expect(snippet).toContain('--&gt;');
    expect(parseTargetedInstructions(snippet)[0].prompt).toBe('Keep A --> B unchanged.');
  });

  it('creates canonical instruction snippets', () => {
    expect(createTargetedInstructionSnippet('Tighten this.', 'next-block')).toBe(
      '<!-- scie_md:instruction target="next-block" prompt="Tighten this." -->\n',
    );
  });
});
