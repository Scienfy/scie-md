import { describe, expect, it } from 'vitest';
import { createScieMDLlmSkill } from '../src/shared/markdown/llm';
import { insertEditorNote, parseEditorComments } from '../src/shared/markdown/editorComments';
import { createProtectedBlockSnippet, parseProtectedBlocks } from '../src/shared/markdown/protectedBlocks';
import { applyReviewPlanDecisions, createReviewPlan } from '../src/shared/markdown/reviewPlan';
import { parseVariantGroups } from '../src/shared/markdown/variants';

describe('copied ScieMD core', () => {
  it('creates and parses Note to LLM markers', () => {
    const result = insertEditorNote('Target sentence.\n', {
      body: 'Sharpen the claim.',
      kind: 'llm',
      selectedText: 'Target sentence.',
      selectionLine: 1,
      preferredLine: 1,
    });

    const notes = parseEditorComments(result.markdown);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ audience: 'llm', body: 'Sharpen the claim.' });
  });

  it('preserves lock and version primitives', () => {
    const locked = createProtectedBlockSnippet('Approved wording.', 'approved');
    expect(parseProtectedBlocks(locked)[0]).toMatchObject({ reason: 'approved', body: 'Approved wording.' });

    const variants = parseVariantGroups([
      '<!-- scie_md:variant:group id="tone" active="v1" -->',
      '<!-- scie_md:variant:item id="v1" name="Current" -->',
      'Current text.',
      '<!-- scie_md:variant:item id="v2" name="Alternative" -->',
      'Alternative text.',
      '<!-- scie_md:variant:end -->',
    ].join('\n'));
    expect(variants[0]?.items.map((item) => item.id)).toEqual(['v1', 'v2']);
  });

  it('can review and reject a pasted Markdown text edit', () => {
    const before = 'Intro sentence.\n';
    const after = 'Sharper intro sentence.\n';
    const plan = createReviewPlan(before, after);
    const rejected = applyReviewPlanDecisions(before, after, plan, new Set([plan.units[0].id]));

    expect(plan.units).toHaveLength(1);
    expect(rejected).toBe(before);
  });

  it('generates the LLM skill contract', () => {
    const skill = createScieMDLlmSkill();
    expect(skill).toContain('ScieMD LLM Skill');
    expect(skill).toContain('Note to LLM');
    expect(skill).toContain('Text Versions');
  });
});
