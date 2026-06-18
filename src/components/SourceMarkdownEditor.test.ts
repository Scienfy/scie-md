import { describe, expect, it } from 'vitest';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { buildInsertTransaction, createScientificCompletionSource, createSourceCitationDecorationRanges, createSourceInsertion, createSourceVariableDecorationRanges } from './SourceMarkdownEditor';
import { createVariantGroupSnippet } from '../markdown/variants';

function applyChange(doc: string, change: { from: number; to: number; insert: string }): string {
  return `${doc.slice(0, change.from)}${change.insert}${doc.slice(change.to)}`;
}

describe('createSourceInsertion', () => {
  it('wraps selected text for inline formatting', () => {
    expect(createSourceInsertion('**bold**', 'selected')).toBe('**selected**');
    expect(createSourceInsertion('*italic*', 'selected')).toBe('*selected*');
    expect(createSourceInsertion('[link](https://example.com)', 'selected')).toBe('[selected](https://example.com)');
  });

  it('adds a leading newline when inserting a block snippet inside an existing line', () => {
    expect(createSourceInsertion('# Heading\n\n', '', true)).toBe('\n# Heading\n\n');
  });

  it('uses selected text as the first draft when wrapping a variant group', () => {
    const inserted = createSourceInsertion(createVariantGroupSnippet('abstract'), 'Original abstract.');

    expect(inserted).toContain('Original abstract.');
    expect(inserted).not.toContain('Write the first version here.');
    expect(inserted).toContain('Write the alternate version here.');
    expect(inserted).toContain('active="v1"');
  });
});

describe('buildInsertTransaction', () => {
  it('inserts block snippets before a partial source selection without deleting selected text', () => {
    const doc = 'Alpha Original abstract. omega.';
    const state = EditorState.create({
      doc,
      selection: { anchor: 'Alpha '.length, head: 'Alpha Original abstract.'.length },
    });

    const transaction = buildInsertTransaction({ state }, createVariantGroupSnippet('abstract'));
    const output = applyChange(doc, transaction.changes);

    expect(transaction.changes).toMatchObject({ from: 0, to: 0 });
    expect(output).toContain('scie_md:variant:group');
    expect(output).toContain('Alpha Original abstract. omega.');
    expect(output.indexOf('scie_md:variant:group')).toBeLessThan(output.indexOf('Alpha Original abstract. omega.'));
  });

  it('still wraps block snippets around whole-line source selections', () => {
    const doc = 'Original abstract.\nNext paragraph.\n';
    const state = EditorState.create({
      doc,
      selection: { anchor: 0, head: 'Original abstract.'.length },
    });

    const transaction = buildInsertTransaction({ state }, createVariantGroupSnippet('abstract'));
    const output = applyChange(doc, transaction.changes);

    expect(transaction.changes).toMatchObject({ from: 0, to: 'Original abstract.'.length });
    expect(output).toContain('Original abstract.');
    expect(output).not.toContain('Write the first version here.');
    expect(output).toContain('Next paragraph.');
    expect(output.indexOf('Original abstract.')).toBeLessThan(output.indexOf('Next paragraph.'));
  });
});

describe('createScientificCompletionSource', () => {
  it('suggests citation keys supplied by the caller', () => {
    const state = EditorState.create({ doc: 'This is known [@smi' });
    const context = new CompletionContext(state, state.doc.length, false);
    const result = createScientificCompletionSource(['smith2026', 'lee2025'], [])(context);

    expect(result?.options.map((option) => option.label)).toEqual(['@smith2026']);
  });
});

describe('createSourceVariableDecorationRanges', () => {
  it('skips variable-like text inside code and ScieMD operational comments', () => {
    const markdown = [
      'Live value {{ reactor_temp }}.',
      '',
      '```ts',
      'const example = "{{ ignored_fence }}";',
      '```',
      '',
      'Inline code `{{ ignored_inline }}`.',
      '<!-- scie_md:comment text="{{ ignored_comment }}" -->',
      'Missing value {{ missing_value }}.',
    ].join('\n');

    const ranges = createSourceVariableDecorationRanges(markdown, [
      { name: 'reactor_temp', value: '405.2', source: 'external', file: 'results.json' },
    ]);

    expect(ranges.map((range) => range.name)).toEqual(['reactor_temp', 'missing_value']);
    expect(ranges[0].className).toContain('source-variable-defined');
    expect(ranges[0].title).toBe('{{ reactor_temp }} = 405.2');
    expect(ranges[1].className).toContain('source-variable-missing');
  });

  it('marks all usages of the highlighted variable', () => {
    const ranges = createSourceVariableDecorationRanges(
      'Use {{ sample_count }} and {{ p_value }} and {{ sample_count }} again.',
      [
        { name: 'sample_count', value: '1500', source: 'frontmatter' },
        { name: 'p_value', value: '0.018', source: 'frontmatter' },
      ],
      'sample_count',
    );

    expect(ranges.filter((range) => range.name === 'sample_count')).toHaveLength(2);
    expect(ranges.filter((range) => range.name === 'sample_count').every((range) => range.className.includes('source-variable-selected'))).toBe(true);
    expect(ranges.find((range) => range.name === 'p_value')?.className).not.toContain('source-variable-selected');
  });
});

describe('createSourceCitationDecorationRanges', () => {
  it('adds citation tooltips and skips code examples', () => {
    const markdown = [
      'Known citation [@smith2026] and missing citation [@missing2025].',
      '',
      '```md',
      'Example [@ignored2020]',
      '```',
      '',
      'Cross-reference @fig-one is not a citation.',
    ].join('\n');

    const ranges = createSourceCitationDecorationRanges(markdown, [
      {
        type: 'article',
        key: 'smith2026',
        fields: {
          title: '{Useful Paper}',
          author: 'Smith, A. and Lee, B.',
          year: '2026',
          journal: 'Journal of Useful Results',
        },
      },
    ], ['smith2026']);

    expect(ranges.map((range) => range.key)).toEqual(['smith2026', 'missing2025']);
    expect(ranges[0].className).toContain('source-citation-verified');
    expect(ranges[0].title).toContain('Useful Paper');
    expect(ranges[1].className).toContain('source-citation-missing');
  });
});
