import { describe, expect, it } from 'vitest';
import { insertStandaloneMarkdownBlockNearSelection, wrapMarkdownBlockSelection, wrapMarkdownSelection } from './selectionWrapping';

describe('wrapMarkdownSelection', () => {
  it('wraps the complete selected bullet item instead of only visible text', () => {
    const markdown = '- First item\n- Second **important** item\n- Third item\n';

    const wrapped = wrapMarkdownSelection(
      markdown,
      'Second important item',
      (selection) => `<!-- lock -->\n${selection}<!-- end -->\n`,
      2,
    );

    expect(wrapped).toBe('- First item\n<!-- lock -->\n- Second **important** item\n<!-- end -->\n- Third item\n');
  });

  it('prefers the selected line nearest the visual cursor line', () => {
    const markdown = '- Repeat me\n\nParagraph.\n\n- Repeat me\n';

    const wrapped = wrapMarkdownSelection(
      markdown,
      'Repeat me',
      (selection) => `[${selection}]`,
      5,
    );

    expect(wrapped).toBe('- Repeat me\n\nParagraph.\n\n[- Repeat me\n]');
  });

  it('falls back to exact inline wrapping when the selection is not a whole block', () => {
    const wrapped = wrapMarkdownSelection('This sentence has a target word.\n', 'target', (selection) => `<${selection}>`);

    expect(wrapped).toBe('This sentence has a <target> word.\n');
  });

  it('refuses ambiguous inline fallbacks instead of editing the first repeated match', () => {
    const wrapped = wrapMarkdownSelection('alpha target beta\n\ngamma target delta\n', 'target', (selection) => `<${selection}>`);

    expect(wrapped).toBeNull();
  });

  it('wraps an existing heading line when only the rendered heading text is selected', () => {
    const wrapped = wrapMarkdownSelection(
      '# Existing heading\n\nParagraph.\n',
      'Existing heading',
      (selection) => `plain:${selection}`,
      1,
    );

    expect(wrapped).toBe('plain:# Existing heading\n\nParagraph.\n');
  });

  it('refuses to block-wrap a partial visual paragraph selection', () => {
    const wrapped = wrapMarkdownBlockSelection(
      'Alpha sentence. Selected sentence. Final sentence.\n',
      { text: 'Selected sentence', line: 1, endLine: 1, surface: 'visual' },
      (selection) => `<!-- block -->\n${selection}\n<!-- end -->\n`,
      1,
    );

    expect(wrapped).toBeNull();
  });

  it('block-wraps exact source whole-line selections without text matching', () => {
    const markdown = 'Alpha.\nBeta.\nGamma.\n';
    const wrapped = wrapMarkdownBlockSelection(
      markdown,
      { text: 'Beta.', from: 7, to: 12, surface: 'source' },
      (selection) => `[${selection}]`,
      2,
    );

    expect(wrapped).toBe('Alpha.\n[Beta.]\nGamma.\n');
  });

  it('inserts standalone anchored metadata before the selected source neighborhood', () => {
    const markdown = 'Alpha.\n\n1. First item\n2. Second item\n';
    const result = insertStandaloneMarkdownBlockNearSelection(
      markdown,
      { text: 'Second item', line: 4, surface: 'visual' },
      '<!-- anchor -->\n\n',
      1,
    );

    expect(result).toBe('Alpha.\n\n1. First item\n\n<!-- anchor -->\n\n2. Second item\n');
  });
});
