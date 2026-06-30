import { describe, expect, it } from 'vitest';
import {
  createEditorCommentSnippet,
  createEditorNoteSnippet,
  detectEditorNoteLifecycleIssues,
  insertEditorNote,
  parseEditorComments,
} from './editorComments';

describe('editorComments', () => {
  it('parses LLM margin comments from Markdown comments', () => {
    const comments = parseEditorComments('Text\n<!-- scie_md:comment audience="llm": expand this claim -->\n');
    expect(comments).toMatchObject([
      { line: 2, audience: 'llm', body: 'expand this claim' },
    ]);
  });

  it('does not treat scoped comment end markers as standalone comments', () => {
    expect(parseEditorComments('Text\n<!-- scie_md:comment:end -->\n')).toEqual([]);
  });

  it('creates comment snippets', () => {
    expect(createEditorCommentSnippet('LLM: check tone', 'llm')).toBe('<!-- scie_md:comment audience="llm": LLM: check tone -->');
  });

  it('parses and round-trips multi-line comments', () => {
    const markdown = [
      'Text',
      '<!-- scie_md:comment audience="llm":',
      'Expand this section with more methodology.',
      'Also consider one citation.',
      '-->',
      'After',
    ].join('\n');

    expect(parseEditorComments(markdown)).toMatchObject([
      {
        line: 2,
        audience: 'llm',
        body: 'Expand this section with more methodology.\nAlso consider one citation.',
      },
    ]);
  });

  it('parses legacy delimiter-style LLM notes without leaking operational markers', () => {
    const markdown = [
      'Text',
      '<!-- scie_md:comment audience="llm" -->',
      'Preserve the numeric values.',
      '<!-- scie_md:comment:end -->',
    ].join('\n');

    expect(parseEditorComments(markdown)).toMatchObject([
      {
        line: 2,
        audience: 'llm',
        body: 'Preserve the numeric values.',
      },
    ]);
  });

  it('ignores comment examples inside fenced code', () => {
    const markdown = [
      '```markdown',
      '<!-- scie_md:comment audience="llm": example only -->',
      '```',
    ].join('\n');

    expect(parseEditorComments(markdown)).toEqual([]);
  });

  it('escapes embedded HTML comment terminators instead of truncating generated comments', () => {
    const snippet = createEditorCommentSnippet('Keep A --> B in the explanation.', 'llm');

    expect(snippet).toContain('--&gt;');
    expect(parseEditorComments(snippet)).toMatchObject([
      {
        line: 1,
        audience: 'llm',
        body: 'Keep A --> B in the explanation.',
      },
    ]);
  });

  it('creates and parses structured notes with ids, kinds, targets, and quote anchors', () => {
    const snippet = createEditorNoteSnippet('Tighten this sentence.', {
      id: 'llm-1',
      kind: 'llm',
      target: 'quote',
      quote: 'selected sentence',
    });

    expect(snippet).toBe('<!-- scie_md:note id="llm-1" kind="llm" target="quote" quote="selected sentence": Tighten this sentence. -->');
    expect(parseEditorComments(snippet)).toMatchObject([
      {
        id: 'llm-1',
        kind: 'llm',
        audience: 'llm',
        target: 'quote',
        quote: 'selected sentence',
        body: 'Tighten this sentence.',
      },
    ]);
  });

  it('parses structured notes when the quoted selection contains colon punctuation', () => {
    const snippet = createEditorNoteSnippet('Revise only the quoted text.', {
      id: 'llm-colon',
      kind: 'llm',
      target: 'quote',
      quote: 'thing it is good at: clear raw text',
    });

    expect(parseEditorComments(snippet)).toMatchObject([
      {
        id: 'llm-colon',
        kind: 'llm',
        target: 'quote',
        quote: 'thing it is good at: clear raw text',
        body: 'Revise only the quoted text.',
      },
    ]);
  });

  it('stores quote prefix and suffix context for duplicate-safe note anchors', () => {
    const result = insertEditorNote('Alpha repeated sentence one. Beta repeated sentence two.\n', {
      id: 'llm-context',
      kind: 'llm',
      body: 'Revise the second occurrence.',
      selectedText: 'repeated sentence',
      prefix: 'Beta',
      suffix: 'two',
      preferredLine: 1,
    });

    expect(result.markdown).toContain('quote="repeated sentence"');
    expect(result.markdown).toContain('prefix="Beta"');
    expect(result.markdown).toContain('suffix="two"');
    expect(parseEditorComments(result.markdown)).toMatchObject([
      {
        id: 'llm-context',
        quote: 'repeated sentence',
        prefix: 'Beta',
        suffix: 'two',
      },
    ]);
  });

  it('keeps long stored quote anchors searchable instead of appending display ellipses', () => {
    const snippet = createEditorNoteSnippet('Review this long selection.', {
      id: 'llm-long',
      kind: 'llm',
      target: 'quote',
      quote: 'alpha '.repeat(80),
    });

    const [note] = parseEditorComments(snippet);
    expect(note.quote).toBeDefined();
    expect(note.quote).not.toContain('...');
    expect(note.quote?.length).toBeLessThanOrEqual(2000);
  });

  it('anchors a note before a selected sentence without changing the paragraph text', () => {
    const markdown = 'Alpha sentence. The selected sentence stays in the paragraph. Final sentence.\n';

    const result = insertEditorNote(markdown, {
      id: 'llm-quote',
      kind: 'llm',
      body: 'Revise the selected sentence.',
      selectedText: 'selected sentence stays',
      preferredLine: 1,
    });

    expect(result.markdown).toContain('id="llm-quote"');
    expect(result.markdown).toContain('quote="selected sentence stays"');
    expect(result.markdown).toContain(markdown.trim());
    expect(result.markdown).not.toContain('<!-- scie_md:comment:end -->');
  });

  it('anchors a note before the first selected list item when selection spans multiple bullets', () => {
    const markdown = [
      '# Tour',
      '',
      '1. Draft in **Visual** mode.',
      '2. Use **View -> Theme** for light, dark, or system color mode, and **View -> Visual style** to change the document look without changing the underlying text.',
      '3. Type `/` on a blank line to insert content. Choose **Block** for note, callout, tip, important, warning, result, and figure blocks.',
      '4. Select text to use the floating toolbar.',
    ].join('\n');

    const result = insertEditorNote(markdown, {
      id: 'llm-list-selection',
      kind: 'llm',
      body: 'Revise these bullets.',
      selectedText: [
        'Use View -> Theme for light, dark, or system color mode, and View -> Visual style to change the document look without changing the underlying text.',
        'Type / on a blank line to insert content. Choose Block for note, callout, tip, important, warning, result, and figure blocks.',
      ].join('\n'),
      preferredLine: 1,
    });

    const noteIndex = result.markdown.indexOf('id="llm-list-selection"');
    expect(noteIndex).toBeGreaterThan(result.markdown.indexOf('1. Draft'));
    expect(noteIndex).toBeLessThan(result.markdown.indexOf('2. Use'));
    expect(result.markdown).toContain('target="selection"');
    expect(result.markdown).toContain('<!-- scie_md:comment:end -->');
  });

  it('uses explicit source start and end lines for visual multi-block selections before fuzzy text matching', () => {
    const markdown = [
      '# Tour',
      '',
      '1. Draft in **Visual** mode.',
      '2. Use **View -> Theme** for light, dark, or system color mode.',
      '3. Type `/` on a blank line to insert content.',
      '4. Select text to use the floating toolbar.',
    ].join('\n');

    const result = insertEditorNote(markdown, {
      id: 'llm-explicit-lines',
      kind: 'llm',
      body: 'Revise bullets two and three.',
      selectedText: 'Use View -> Theme for light, dark, or system color mode. Type / on a blank line to insert content.',
      selectionLine: 4,
      selectionEndLine: 5,
      preferredLine: 1,
    });

    const noteIndex = result.markdown.indexOf('id="llm-explicit-lines"');
    const bulletTwoIndex = result.markdown.indexOf('2. Use');
    const bulletThreeIndex = result.markdown.indexOf('3. Type');
    const bulletFourIndex = result.markdown.indexOf('4. Select');
    const endIndex = result.markdown.indexOf('<!-- scie_md:comment:end -->');

    expect(noteIndex).toBeLessThan(bulletTwoIndex);
    expect(bulletTwoIndex).toBeLessThan(bulletThreeIndex);
    expect(bulletThreeIndex).toBeLessThan(endIndex);
    expect(endIndex).toBeLessThan(bulletFourIndex);
    expect(result.markdown).toContain('target="selection"');
  });

  it('brackets multi-paragraph selections as source ranges instead of storing a lossy quote only', () => {
    const first = 'ScieMD is a scientific Markdown editor for hybrid work with an LLM. The LLM gets the thing it is good at: clear raw text with explicit structure, citations, variables, locks, notes, and revision instructions. You get the thing humans read best: a visual writing surface with typography, blocks, figures, references, formatting, and export previews.';
    const second = 'The Markdown file stays as the shared source of truth. Visual mode makes the document pleasant to read and edit; Source mode keeps every LLM-facing marker transparent and portable.';
    const markdown = ['# ScieMD Quick Tour', '', first, '', second, '', '## Next'].join('\n');

    const result = insertEditorNote(markdown, {
      id: 'llm-two-paragraphs',
      kind: 'llm',
      body: 'Revise these paragraphs.',
      selectedText: `${first}\n${second}`,
      selectionLine: 3,
    });

    const noteIndex = result.markdown.indexOf('id="llm-two-paragraphs"');
    const firstIndex = result.markdown.indexOf(first);
    const secondIndex = result.markdown.indexOf(second);
    const endIndex = result.markdown.indexOf('<!-- scie_md:comment:end -->');
    expect(result.markdown).toContain('target="selection"');
    expect(noteIndex).toBeLessThan(firstIndex);
    expect(firstIndex).toBeLessThan(secondIndex);
    expect(secondIndex).toBeLessThan(endIndex);
    expect(result.markdown).toContain(`${first}\n\n${second}`);
    expect(result.markdown.indexOf('## Next')).toBeGreaterThan(endIndex);
  });

  it('uses the editor selection line when rendered selected text does not exist in source', () => {
    const markdown = [
      '# Tour',
      '',
      '1. Draft in **Visual** mode.',
      '2. Use **View -> Theme** for light, dark, or system color mode.',
      '3. Type `/` on a blank line to insert content.',
      '4. Select text to use the floating toolbar.',
      '5. Keep reusable values in front matter variables, then cite them inline: {{ cohort_n }} participants, p = {{ exp1_p_value }}.',
      '6. Export through **File -> Export**.',
    ].join('\n');

    const result = insertEditorNote(markdown, {
      id: 'llm-variable-preview-selection',
      kind: 'llm',
      body: 'Revise this bullet.',
      selectedText: 'Keep reusable values in front matter variables, then cite them inline: 128 participants, p = 0.018.',
      selectionLine: 7,
      preferredLine: 3,
    });

    const noteIndex = result.markdown.indexOf('id="llm-variable-preview-selection"');
    expect(noteIndex).toBeGreaterThan(result.markdown.indexOf('4. Select text'));
    expect(noteIndex).toBeLessThan(result.markdown.indexOf('5. Keep reusable'));
    expect(result.line).toBe(7);
  });

  it('detects completed LLM notes that lack a human review summary', () => {
    const before = [
      '<!-- scie_md:note id="llm-1" kind="llm" target="quote" quote="Claim": Tighten. -->',
      'Claim.',
    ].join('\n');
    const afterWithoutSummary = 'Sharper claim.\n';
    const afterWithSummary = [
      'Sharper claim.',
      '<!-- scie_md:note id="human-1" kind="human" target="cursor" source="llm-1": Tightened the claim for clarity. -->',
    ].join('\n');

    expect(detectEditorNoteLifecycleIssues(before, afterWithoutSummary)).toHaveLength(1);
    expect(detectEditorNoteLifecycleIssues(before, afterWithSummary)).toHaveLength(0);
  });
});
