import { describe, expect, it } from 'vitest';
import {
  applyReviewPlanDecisions,
  createProtectedBlockSnippet,
  createReviewPlan,
  insertEditorNote,
  parseEditorComments,
  parseProtectedBlocks,
  parseVariantGroups,
  createLlmClipboardPayload,
  createLlmStyleGuide,
  createScieMDLlmSkill,
  createJsonContent,
  parseJsonDocument,
} from '@sciemd/core';

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

  it('generates LLM helper output from the shared package boundary', () => {
    const markdown = [
      '---',
      'title: Trial',
      'variables:',
      '  cohort_n: 128',
      '---',
      '',
      '# Trial',
      '',
      '<!-- scie_md:lock:start reason="approved" -->',
      'Approved wording.',
      '<!-- scie_md:lock:end -->',
      '',
      '<!-- scie_md:note id="llm-1" kind="llm" target="quote" quote="Target sentence.": Tighten this. -->',
      'Target sentence.',
    ].join('\n');
    const options = { selection: 'Target sentence.' };
    const payload = createLlmClipboardPayload(markdown, 'trial.md', 'expand', options);

    expect(payload).toContain('Scope: selected text only');
    expect(payload).toContain('Protected sections: Locked section');
    expect(payload).toContain('Notes to LLM: id llm-1');
    expect(createLlmStyleGuide()).toContain('ScieMD Markdown Style Guide');
    expect(createScieMDLlmSkill()).toContain('ScieMD LLM Skill');
  });

  it('uses the shared structured parser boundary for JSON previews', () => {
    const result = parseJsonDocument(createJsonContent('{"id":"trial","n":12}\n', 'trial.json'));

    expect(result.parsed?.value).toEqual({ id: 'trial', n: 12 });
    expect(result.diagnostics).toEqual([]);
  });
});
