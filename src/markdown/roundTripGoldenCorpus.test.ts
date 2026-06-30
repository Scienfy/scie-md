import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '@sciemd/core';
import { parseDirectiveBlocks } from '@sciemd/core';
import { buildCrossReferenceIndex } from '@sciemd/core';
import { buildVariableIndex } from '@sciemd/core';
import { validateMarkdown } from './markdownValidation';
import { roundTripGoldenCorpus, visualNormalizationGoldenCases } from './roundTripGoldenCorpus';

describe('roundTripGoldenCorpus', () => {
  it('keeps the scientific paper fixture aligned with ScieMD semantic indexes', () => {
    const fixture = roundTripGoldenCorpus.find((item) => item.name === 'scientific-paper-surface');
    expect(fixture).toBeDefined();
    const markdown = fixture?.markdown ?? '';
    const frontmatter = parseFrontmatter(markdown);
    const directives = parseDirectiveBlocks(markdown);
    const variables = buildVariableIndex(markdown, frontmatter);
    const references = buildCrossReferenceIndex(markdown, frontmatter.hasFrontmatter ? frontmatter.endLine : 0);
    const validation = validateMarkdown(markdown);

    expect(validation.sourceOnly).toBe(false);
    expect(validation.issues.some((issue) => issue.code === 'conflict-marker')).toBe(false);
    expect(variables.definitions.map((definition) => definition.name)).toContain('sample_count');
    expect(variables.usages.map((usage) => usage.name)).toContain('sample_count');
    expect(directives.map((directive) => directive.label).filter(Boolean)).toEqual(expect.arrayContaining([
      'callout-method',
      'fig-workflow',
      'result-main',
    ]));
    expect(references.labels.map((label) => label.id)).toContain('fig-workflow');
    expect(references.usages.map((usage) => usage.id)).toContain('fig-workflow');
  });

  it('documents source-preserved constructs that stay visual-editable with explicit diagnostics', () => {
    const fixture = roundTripGoldenCorpus.find((item) => item.name === 'source-preserved-raw-html-and-unknown-directive');
    expect(fixture).toBeDefined();
    const validation = validateMarkdown(fixture?.markdown ?? '');

    expect(validation.sourceOnly).toBe(false);
    for (const code of fixture?.expectedValidationCodes ?? []) {
      expect(validation.issues.some((issue) => issue.code === code)).toBe(true);
    }
  });

  it('documents known visual normalization cases without making them source-only', () => {
    for (const { name, markdown, warning } of visualNormalizationGoldenCases) {
      const validation = validateMarkdown(markdown);

      expect(validation.sourceOnly, name).toBe(false);
      expect(validation.formattingWillNormalize, name).toBe(true);
      expect(
        validation.issues.some((issue) => issue.code === 'visual-roundtrip-risk' && issue.message.includes(warning)),
        name,
      ).toBe(true);
    }
  });
});
