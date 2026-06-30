import { describe, expect, it } from 'vitest';
import { createAnchoredVariantGroupSnippet, createVariantGroupSnippet, duplicateVariantGroupIds, parseVariantGroups, renderActiveVariants, validateVariantStructure } from './variants';

describe('variants', () => {
  it('parses variant groups and keeps item metadata', () => {
    const markdown = [
      '<!-- scie_md:variant:group id="abstract" active="v2" -->',
      '<!-- scie_md:variant:item id="v1" name="Original" -->',
      'Original abstract.',
      '<!-- scie_md:variant:item id="v2" name="Short" -->',
      'Short abstract.',
      '<!-- scie_md:variant:end -->',
    ].join('\n');

    expect(parseVariantGroups(markdown)).toMatchObject([
      {
        id: 'abstract',
        active: 'v2',
        items: [
          { id: 'v1', name: 'Original', markdown: 'Original abstract.' },
          { id: 'v2', name: 'Short', markdown: 'Short abstract.' },
        ],
      },
    ]);
  });

  it('decodes escaped and HTML-escaped variant attributes before rebuilding visual state', () => {
    const [group] = parseVariantGroups([
      '<!-- scie_md:variant:group id="abstract&quot;draft" active="v1" -->',
      '<!-- scie_md:variant:item id="v1" name="A &quot;quoted&quot; &amp; checked draft" -->',
      'Draft.',
      '<!-- scie_md:variant:end -->',
    ].join('\n'));

    expect(group.id).toBe('abstract"draft');
    expect(group.items[0].name).toBe('A "quoted" & checked draft');
  });

  it('renders only the active variant for output', () => {
    const markdown = [
      '# Paper',
      '',
      '<!-- scie_md:variant:group id="abstract" active="v2" -->',
      '<!-- scie_md:variant:item id="v1" name="Original" -->',
      'Original abstract.',
      '<!-- scie_md:variant:item id="v2" name="Short" -->',
      'Short abstract.',
      '<!-- scie_md:variant:end -->',
      '',
      'Conclusion.',
    ].join('\n');

    const rendered = renderActiveVariants(markdown);
    expect(rendered).toContain('Short abstract.');
    expect(rendered).not.toContain('Original abstract.');
    expect(rendered).not.toContain('scie_md:variant');
  });

  it('renders duplicate group ids by source offsets instead of reusing the first group', () => {
    const markdown = [
      '<!-- scie_md:variant:group id="abstract" active="v1" -->',
      '<!-- scie_md:variant:item id="v1" name="Original" -->',
      'First group.',
      '<!-- scie_md:variant:end -->',
      '',
      '<!-- scie_md:variant:group id="abstract" active="v2" -->',
      '<!-- scie_md:variant:item id="v1" name="Original" -->',
      'Wrong item.',
      '<!-- scie_md:variant:item id="v2" name="Short" -->',
      'Second group active.',
      '<!-- scie_md:variant:end -->',
    ].join('\n');

    const rendered = renderActiveVariants(markdown);
    expect(rendered).toContain('First group.');
    expect(rendered).toContain('Second group active.');
    expect(rendered).not.toContain('Wrong item.');
    expect(duplicateVariantGroupIds(parseVariantGroups(markdown))).toEqual(['abstract']);
  });

  it('ignores variant examples inside fenced code', () => {
    const markdown = [
      '```markdown',
      '<!-- scie_md:variant:group id="example" active="v1" -->',
      '<!-- scie_md:variant:item id="v1" name="Draft" -->',
      'Example only.',
      '<!-- scie_md:variant:end -->',
      '```',
    ].join('\n');

    expect(parseVariantGroups(markdown)).toEqual([]);
    expect(renderActiveVariants(markdown)).toBe(markdown);
  });

  it('ignores variant item and end markers inside fenced code within a variant group', () => {
    const markdown = [
      '<!-- scie_md:variant:group id="abstract" active="v1" -->',
      '<!-- scie_md:variant:item id="v1" name="Original" -->',
      'Keep this code example:',
      '```markdown',
      '<!-- scie_md:variant:item id="fake" name="Fake" -->',
      '<!-- scie_md:variant:end -->',
      '```',
      'Still active.',
      '<!-- scie_md:variant:item id="v2" name="Short" -->',
      'Short abstract.',
      '<!-- scie_md:variant:end -->',
    ].join('\n');

    const [group] = parseVariantGroups(markdown);
    expect(group.items).toHaveLength(2);
    expect(group.items[0].markdown).toContain('Still active.');
    expect(group.items[0].markdown).toContain('scie_md:variant:end');
    expect(renderActiveVariants(markdown)).toContain('Still active.');
    expect(renderActiveVariants(markdown)).not.toContain('Short abstract.');
  });

  it('creates a canonical Markdown snippet', () => {
    expect(createVariantGroupSnippet()).toContain('scie_md:variant:group');
    expect(createVariantGroupSnippet()).toContain('active="v2"');
  });

  it('creates anchored variant groups that do not wrap the paragraph in source', () => {
    const snippet = createAnchoredVariantGroupSnippet('variant-1', 'selected sentence', 'v1');
    const [group] = parseVariantGroups(`${snippet}\nAlpha selected sentence omega.`);

    expect(group).toMatchObject({
      id: 'variant-1',
      active: 'v1',
      target: 'quote',
      quote: 'selected sentence',
    });
    expect(group.items[0].markdown).toBe('selected sentence');
  });

  it('renders anchored variants by replacing the quoted span and removing metadata', () => {
    const markdown = [
      '<!-- scie_md:variant:group id="variant-1" active="v2" target="quote" quote="selected sentence" -->',
      '<!-- scie_md:variant:item id="v1" name="Original draft" -->',
      'selected sentence',
      '<!-- scie_md:variant:item id="v2" name="Alternative revision" -->',
      'replacement phrase',
      '<!-- scie_md:variant:end -->',
      '',
      'Alpha selected sentence omega.',
    ].join('\n');

    const rendered = renderActiveVariants(markdown);
    expect(rendered).toContain('Alpha replacement phrase omega.');
    expect(rendered).not.toContain('selected sentence');
    expect(rendered).not.toContain('scie_md:variant');
  });

  it('renders anchored variants against the duplicate quote selected by context', () => {
    const markdown = [
      '<!-- scie_md:variant:group id="variant-1" active="v2" target="quote" quote="repeated sentence" prefix="Beta" suffix="two" -->',
      '<!-- scie_md:variant:item id="v1" name="Original draft" -->',
      'repeated sentence',
      '<!-- scie_md:variant:item id="v2" name="Alternative revision" -->',
      'replacement phrase',
      '<!-- scie_md:variant:end -->',
      '',
      'Alpha repeated sentence one. Beta repeated sentence two.',
    ].join('\n');

    const rendered = renderActiveVariants(markdown);

    expect(rendered).toContain('Alpha repeated sentence one. Beta replacement phrase two.');
  });

  it('reports malformed variant marker structure', () => {
    const issues = validateVariantStructure([
      '<!-- scie_md:variant:item id="orphan" name="Orphan" -->',
      '<!-- scie_md:variant:group id="outer" active="v1" -->',
      '<!-- scie_md:variant:group id="inner" active="v1" -->',
      '<!-- scie_md:variant:end -->',
      '<!-- scie_md:variant:end -->',
    ].join('\n'));

    expect(issues.map((issue) => issue.code)).toEqual([
      'variant-dangling-item',
      'variant-nested-group',
      'variant-empty-group',
      'variant-dangling-end',
    ]);
  });

  it('reports unclosed and empty variant items', () => {
    const issues = validateVariantStructure([
      '<!-- scie_md:variant:group id="abstract" active="v1" -->',
      '<!-- scie_md:variant:item id="v1" name="Draft" -->',
      '<!-- scie_md:variant:end -->',
      '<!-- scie_md:variant:group id="methods" active="v1" -->',
      '<!-- scie_md:variant:item id="v1" name="Draft" -->',
      'Draft text',
    ].join('\n'));

    expect(issues.map((issue) => issue.code)).toContain('variant-empty-item');
    expect(issues.map((issue) => issue.code)).toContain('variant-unclosed-group');
  });
});
