import { describe, expect, it } from 'vitest';
import {
  buildVariantGroupRaw,
  changeTouchesLockedRange,
  deleteVariantItem,
  metadataAttrsFromRaw,
  metadataNodeFromHtml,
  replaceVariantActive,
  transformScieMetadataAst,
  updateVariantItemMarkdown,
} from './scieMetadataNodes';

describe('scieMetadataNodes', () => {
  it('recognizes ScieMD lock and note comments as metadata nodes', () => {
    expect(metadataNodeFromHtml('<!-- scie_md:lock:start reason="approved" -->')).toMatchObject({
      type: 'scie_lock_start',
      reason: 'approved',
    });
    expect(metadataNodeFromHtml('<!-- scie_md:lock id="lock-1" target="quote" quote="selected sentence" reason="approved" -->')).toMatchObject({
      type: 'scie_lock_anchor',
      lockId: 'lock-1',
      target: 'quote',
      quote: 'selected sentence',
      reason: 'approved',
    });
    expect(metadataNodeFromHtml('<!-- scie_md:comment audience="llm": tighten this paragraph -->')).toMatchObject({
      type: 'scie_comment',
      audience: 'llm',
      body: 'tighten this paragraph',
    });
    expect(metadataNodeFromHtml('<!-- scie_md:note id="llm-1" kind="llm" target="quote" quote="selected text": tighten this paragraph -->')).toMatchObject({
      type: 'scie_comment',
      audience: 'llm',
      noteId: 'llm-1',
      kind: 'llm',
      target: 'quote',
      quote: 'selected text',
      body: 'tighten this paragraph',
    });
    expect(metadataNodeFromHtml('<!-- scie_md:note id="llm-colon" kind="llm" target="quote" quote="thing it is good at: clear raw text": revise only this selection -->')).toMatchObject({
      type: 'scie_comment',
      noteId: 'llm-colon',
      target: 'quote',
      quote: 'thing it is good at: clear raw text',
      body: 'revise only this selection',
    });
    expect(metadataNodeFromHtml('<!-- scie_md:instruction target="next-block" prompt="emphasize mechanism" -->')).toMatchObject({
      type: 'scie_instruction',
      target: 'next-block',
      prompt: 'emphasize mechanism',
    });
  });

  it('reconstructs full attrs from raw DOM data when metadata atoms are pasted', () => {
    expect(metadataAttrsFromRaw('scie_comment', '<!-- scie_md:comment audience="llm": tighten this -->')).toMatchObject({
      raw: '<!-- scie_md:comment audience="llm": tighten this -->',
      audience: 'llm',
      body: 'tighten this',
    });
    expect(metadataAttrsFromRaw('scie_comment', '<!-- scie_md:note id="human-1" kind="human" target="cursor" source="llm-1": tightened text -->')).toMatchObject({
      audience: 'human',
      noteId: 'human-1',
      kind: 'human',
      sourceNoteId: 'llm-1',
      body: 'tightened text',
    });
    expect(metadataAttrsFromRaw('scie_lock_anchor', '<!-- scie_md:lock id="lock-1" target="quote" quote="selected text" reason="approved" -->')).toMatchObject({
      lockId: 'lock-1',
      target: 'quote',
      quote: 'selected text',
      reason: 'approved',
    });
    expect(metadataAttrsFromRaw('scie_directive_block', ':::tip {#tip-a}\nKeep it concise.\n:::')).toMatchObject({
      name: 'tip',
      label: 'tip-a',
      body: 'Keep it concise.',
    });
    expect(metadataAttrsFromRaw('scie_svg_block', '```svg\n<svg viewBox="0 0 10 10"></svg>\n```')).toMatchObject({
      raw: '```svg\n<svg viewBox="0 0 10 10"></svg>\n```',
      body: '<svg viewBox="0 0 10 10"></svg>',
    });
  });

  it('does not block insertions immediately before or after a locked range', () => {
    const range = {
      from: 10,
      contentFrom: 12,
      contentTo: 24,
      to: 26,
      reason: 'approved',
    };

    expect(changeTouchesLockedRange(10, 10, range)).toBe(false);
    expect(changeTouchesLockedRange(26, 26, range)).toBe(false);
    expect(changeTouchesLockedRange(12, 12, range)).toBe(true);
    expect(changeTouchesLockedRange(20, 20, range)).toBe(true);
    expect(changeTouchesLockedRange(10, 12, range)).toBe(true);
    expect(changeTouchesLockedRange(24, 26, range)).toBe(true);
  });

  it('collapses a variant group into one atom node', () => {
    const markdown = [
      '<!-- scie_md:variant:group id="abstract" active="v2" -->',
      '<!-- scie_md:variant:item id="v1" name="Original" -->',
      'Original draft.',
      '<!-- scie_md:variant:item id="v2" name="Short" -->',
      'Short draft.',
      '<!-- scie_md:variant:end -->',
    ].join('\n');
    const children = [
      htmlNode('<!-- scie_md:variant:group id="abstract" active="v2" -->', markdown, 0),
      htmlNode('<!-- scie_md:variant:item id="v1" name="Original" -->', markdown, 1),
      textNode('Original draft.', markdown, 2),
      htmlNode('<!-- scie_md:variant:item id="v2" name="Short" -->', markdown, 3),
      textNode('Short draft.', markdown, 4),
      htmlNode('<!-- scie_md:variant:end -->', markdown, 5),
    ];
    const tree = { type: 'root', children };

    transformScieMetadataAst(tree, markdown);

    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]).toMatchObject({
      type: 'scie_variant_group',
      groupId: 'abstract',
      active: 'v2',
    });
    const variantNode = tree.children[0] as unknown as { itemsJson: string };
    expect(JSON.parse(String(variantNode.itemsJson))).toEqual([
      { id: 'v1', name: 'Original', markdown: 'Original draft.' },
      { id: 'v2', name: 'Short', markdown: 'Short draft.' },
    ]);
  });

  it('preserves anchored variant target attributes when rebuilding raw', () => {
    const raw = buildVariantGroupRaw('variant-1', 'v1', [
      { id: 'v1', name: 'Original', markdown: 'Selected text.' },
      { id: 'v2', name: 'Alternative', markdown: 'Alternative text.' },
    ], { target: 'quote', quote: 'Selected text.' });

    expect(raw).toContain('target="quote"');
    expect(raw).toContain('quote="Selected text."');
  });

  it('collapses legacy delimiter-style LLM notes into a rendered note atom', () => {
    const markdown = [
      '<!-- scie_md:comment audience="llm" -->',
      'Preserve the numeric values.',
      '<!-- scie_md:comment:end -->',
      '',
      'After.',
    ].join('\n');
    const children = [
      htmlNode('<!-- scie_md:comment audience="llm" -->', markdown, 0),
      paragraphNode('Preserve the numeric values.', markdown, 1),
      htmlNode('<!-- scie_md:comment:end -->', markdown, 2),
      paragraphNode('After.', markdown, 4),
    ];
    const tree = { type: 'root', children };

    transformScieMetadataAst(tree, markdown);

    expect(tree.children).toHaveLength(2);
    expect(tree.children[0]).toMatchObject({
      type: 'scie_comment',
      audience: 'llm',
      body: 'Preserve the numeric values.',
    });
    expect(String((tree.children[0] as unknown as { raw: string }).raw)).toContain('scie_md:comment audience="llm": Preserve the numeric values.');
  });

  it('collapses directive blocks into atom nodes', () => {
    const markdown = [
      'Intro.',
      '',
      ':::tip {#tip-a}',
      'Visual blocks render as document elements.',
      ':::',
      '',
      'Outro.',
    ].join('\n');
    const children = [
      paragraphNode('Intro.', markdown, 0),
      paragraphNode(':::tip {#tip-a}', markdown, 2),
      paragraphNode('Visual blocks render as document elements.', markdown, 3),
      paragraphNode(':::', markdown, 4),
      paragraphNode('Outro.', markdown, 6),
    ];
    const tree = { type: 'root', children };

    transformScieMetadataAst(tree, markdown);

    expect(tree.children).toHaveLength(3);
    expect(tree.children[1]).toMatchObject({
      type: 'scie_directive_block',
      name: 'tip',
      label: 'tip-a',
      body: 'Visual blocks render as document elements.',
    });
  });

  it('collapses compact one-line directive blocks into atom nodes', () => {
    const markdown = ':::tip {#tip-first-tour} Visual mode renders this as a tip. :::';
    const tree = { type: 'root', children: [paragraphNode(markdown, markdown, 0)] };

    transformScieMetadataAst(tree, markdown);

    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]).toMatchObject({
      type: 'scie_directive_block',
      name: 'tip',
      label: 'tip-first-tour',
      body: 'Visual mode renders this as a tip.',
    });
  });

  it('collapses standalone svg fences into atom nodes', () => {
    const markdown = [
      'Intro.',
      '',
      '```svg',
      '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
      '```',
      '',
      'Outro.',
    ].join('\n');
    const children = [
      paragraphNode('Intro.', markdown, 0),
      paragraphNode('```svg', markdown, 2),
      paragraphNode('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>', markdown, 3),
      paragraphNode('```', markdown, 4),
      paragraphNode('Outro.', markdown, 6),
    ];
    const tree = { type: 'root', children };

    transformScieMetadataAst(tree, markdown);

    expect(tree.children).toHaveLength(3);
    expect(tree.children[1]).toMatchObject({
      type: 'scie_svg_block',
      body: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
    });
  });

  it('updates only the active attribute in a variant group opener', () => {
    expect(replaceVariantActive('<!-- scie_md:variant:group id="a" active="v1" -->\nBody\n<!-- scie_md:variant:end -->', 'v2'))
      .toContain('active="v2"');
    expect(replaceVariantActive('<!-- scie_md:variant:group id="a" -->\nBody\n<!-- scie_md:variant:end -->', 'v3'))
      .toContain('id="a" active="v3"');
  });

  it('rebuilds variant raw after visual edits to an active item', () => {
    const result = updateVariantItemMarkdown('abstract', 'v1', [
      { id: 'v1', name: 'Original', markdown: 'Old draft.' },
      { id: 'v2', name: 'Short', markdown: 'Short draft.' },
    ], 'v1', 'Edited draft.');

    expect(result.active).toBe('v1');
    expect(result.raw).toContain('<!-- scie_md:variant:group id="abstract" active="v1" -->');
    expect(result.raw).toContain('<!-- scie_md:variant:item id="v1" name="Original" -->\nEdited draft.');
    expect(result.raw).toContain('<!-- scie_md:variant:item id="v2" name="Short" -->\nShort draft.');
  });

  it('deletes a variant item and moves active selection when needed', () => {
    const result = deleteVariantItem('abstract', 'v1', [
      { id: 'v1', name: 'Original', markdown: 'Old draft.' },
      { id: 'v2', name: 'Short', markdown: 'Short draft.' },
    ], 'v1');

    expect(result).not.toBeNull();
    expect(result?.active).toBe('v2');
    expect(result?.raw).not.toContain('id="v1"');
    expect(result?.raw).toContain('active="v2"');
  });

  it('returns null when deleting the final variant item', () => {
    expect(deleteVariantItem('abstract', 'v1', [
      { id: 'v1', name: 'Only', markdown: 'Only draft.' },
    ], 'v1')).toBeNull();
  });

  it('escapes attributes when rebuilding variant raw', () => {
    const raw = buildVariantGroupRaw('ab"c', 'v1', [
      { id: 'v1', name: 'A "quoted" draft', markdown: 'Text.' },
    ]);

    expect(raw).toContain('id="ab&quot;c"');
    expect(raw).toContain('name="A &quot;quoted&quot; draft"');
  });
});

function htmlNode(value: string, markdown: string, lineIndex: number) {
  return positioned({ type: 'html', value }, markdown, lineIndex);
}

function textNode(value: string, markdown: string, lineIndex: number) {
  return positioned({ type: 'paragraph', value }, markdown, lineIndex);
}

function paragraphNode(value: string, markdown: string, lineIndex: number) {
  return positioned({ type: 'paragraph', value }, markdown, lineIndex);
}

function positioned<T extends { type: string; value: string }>(node: T, markdown: string, lineIndex: number): T & { position: { start: { offset: number }; end: { offset: number } } } {
  const lines = markdown.split('\n');
  const start = lines.slice(0, lineIndex).join('\n').length + (lineIndex === 0 ? 0 : 1);
  return {
    ...node,
    position: {
      start: { offset: start },
      end: { offset: start + node.value.length },
    },
  };
}
