import { describe, expect, it } from 'vitest';
import { createReviewPlan, applyReviewPlanDecisions } from './reviewPlan';

describe('reviewPlan', () => {
  it('ties completed LLM note metadata to the related text edit decision', () => {
    const before = [
      'Intro.',
      '',
      '<!-- scie_md:note id="llm-1" kind="llm" target="quote" quote="Original sentence": Tighten this sentence. -->',
      '',
      'Original sentence.',
      '',
      'Outro.',
      '',
    ].join('\n');
    const after = [
      'Intro.',
      '',
      'Revised sentence.',
      '',
      '<!-- scie_md:note id="human-1" kind="human" target="cursor" source="llm-1": Revised for clarity. -->',
      '',
      'Outro.',
      '',
    ].join('\n');

    const plan = createReviewPlan(before, after);

    expect(plan.units).toHaveLength(1);
    expect(plan.units[0].textHunkIds.length).toBeGreaterThanOrEqual(1);
    expect(plan.units[0].attachedMetadataHunkIds.length).toBeGreaterThanOrEqual(2);
    expect(plan.units[0].displayHunk.diffLines.map((line) => line.text)).toEqual([
      'Original sentence.',
      'Revised sentence.',
    ]);

    expect(applyReviewPlanDecisions(before, after, plan, new Set([plan.units[0].id]))).toBe(before);
    expect(applyReviewPlanDecisions(before, after, plan, new Set())).toBe(after);
  });

  it('auto-accepts unrelated added human notes instead of turning them into review decisions', () => {
    const before = [
      'Original sentence.',
      '',
    ].join('\n');
    const after = [
      'Revised sentence.',
      '',
      '<!-- scie_md:note id="human-extra" kind="human" target="cursor": Extra review note. -->',
      '',
    ].join('\n');

    const plan = createReviewPlan(before, after);

    expect(plan.units).toHaveLength(1);
    expect(plan.units[0].attachedMetadataHunkIds).toEqual([]);
    expect(plan.autoAcceptedMetadataHunkIds).toHaveLength(1);
    expect(applyReviewPlanDecisions(before, after, plan, new Set([plan.units[0].id]))).toBe([
      'Original sentence.',
      '',
      '<!-- scie_md:note id="human-extra" kind="human" target="cursor": Extra review note. -->',
      '',
    ].join('\n'));
  });

  it('keeps completed instructions with rejected text edits', () => {
    const before = [
      '<!-- scie_md:instruction target="next-block" prompt="Tighten." -->',
      '',
      'Original claim.',
      '',
    ].join('\n');
    const after = [
      'Tightened claim.',
      '',
    ].join('\n');

    const plan = createReviewPlan(before, after);

    expect(plan.units).toHaveLength(1);
    expect(plan.units[0].attachedMetadataHunkIds).toHaveLength(1);
    expect(applyReviewPlanDecisions(before, after, plan, new Set([plan.units[0].id]))).toBe(before);
  });
});
