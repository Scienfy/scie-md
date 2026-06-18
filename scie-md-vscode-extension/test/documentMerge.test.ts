import { describe, expect, it } from 'vitest';
import { createDocumentReplacementPlan } from '../src/extension/documentMerge';

function applyPlan(currentText: string, plan: ReturnType<typeof createDocumentReplacementPlan>): string {
  if (!plan.replacement) return currentText;
  return `${currentText.slice(0, plan.replacement.start)}${plan.replacement.text}${currentText.slice(plan.replacement.end)}`;
}

describe('createDocumentReplacementPlan', () => {
  it('uses a direct replacement when the webview base is still current', () => {
    const plan = createDocumentReplacementPlan({
      baseText: 'A\nB\n',
      currentText: 'A\nB\n',
      requestedText: 'A local\nB\n',
    });

    expect(plan.mergedStaleBase).toBe(false);
    expect(applyPlan('A\nB\n', plan)).toBe('A local\nB\n');
  });

  it('merges non-overlapping external edits instead of overwriting them', () => {
    const currentText = 'A\nB external\n';
    const plan = createDocumentReplacementPlan({
      baseText: 'A\nB\n',
      currentText,
      requestedText: 'A local\nB\n',
    });

    expect(plan.mergedStaleBase).toBe(true);
    expect(applyPlan(currentText, plan)).toBe('A local\nB external\n');
  });

  it('keeps rejected external hunks rejected during stale-base merge', () => {
    const currentText = 'A\nB external\n';
    const plan = createDocumentReplacementPlan({
      baseText: 'A\nB\n',
      currentText,
      requestedText: 'A local\nB\n',
      rejectedHunkIds: new Set(['hunk-1']),
    });

    expect(plan.mergedStaleBase).toBe(false);
    expect(applyPlan(currentText, plan)).toBe('A local\nB\n');
  });


  it('uses conflict markers for overlapping stale webview and external edits', () => {
    const currentText = 'A external\n';
    const plan = createDocumentReplacementPlan({
      baseText: 'A\n',
      currentText,
      requestedText: 'A local\n',
    });

    const output = applyPlan(currentText, plan);
    expect(plan.mergedStaleBase).toBe(true);
    expect(output).toContain('<<<<<<< ScieMD local edits');
    expect(output).toContain('A local');
    expect(output).toContain('A external');
  });

  it('does not treat a previous ScieMD webview edit as an external stale-base change', () => {
    const currentText = 'A local\n';
    const plan = createDocumentReplacementPlan({
      baseText: 'A\n',
      currentText,
      requestedText: 'A local more\n',
      lastAppliedWebviewText: currentText,
    });

    expect(plan.mergedStaleBase).toBe(false);
    expect(applyPlan(currentText, plan)).toBe('A local more\n');
  });
});
