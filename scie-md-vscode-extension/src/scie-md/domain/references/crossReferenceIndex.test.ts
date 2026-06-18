import { describe, expect, it } from 'vitest';
import { buildCrossReferenceIndex } from './crossReferenceIndex';

describe('buildCrossReferenceIndex', () => {
  it('ignores labels and usages inside fenced examples, inline code, and ScieMD comments', () => {
    const markdown = [
      '````markdown',
      ':::figure {#fig-demo}',
      'Caption.',
      ':::',
      'See @fig-demo.',
      '````',
      '',
      'Inline example `@fig-demo` and `{#fig-demo}` should stay instructional.',
      '<!-- scie_md:comment audience="llm": See @fig-demo and {#fig-demo}. -->',
      '',
      ':::figure {#fig-demo}',
      'Real figure.',
      ':::',
      '',
      'See @fig-demo.',
    ].join('\n');

    const index = buildCrossReferenceIndex(markdown);

    expect(index.labels.map((label) => label.id)).toEqual(['fig-demo']);
    expect(index.usages.map((usage) => usage.id)).toEqual(['fig-demo']);
    expect(index.duplicateLabels).toEqual([]);
    expect(index.missingLabels).toEqual([]);
  });

  it('supports Pandoc-style colon labels and IDs with underscores or dots', () => {
    const index = buildCrossReferenceIndex('![Surface](surface.png){#fig:surface_v1.2}\nSee @fig:surface_v1.2.');

    expect(index.labels.map((label) => label.id)).toEqual(['fig:surface_v1.2']);
    expect(index.usages.map((usage) => usage.id)).toEqual(['fig:surface_v1.2']);
  });
});
