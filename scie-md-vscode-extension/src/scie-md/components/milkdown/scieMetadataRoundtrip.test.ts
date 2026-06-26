import { Editor, defaultValueCtx, editorViewCtx, serializerCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { describe, expect, it } from 'vitest';
import { validateMarkdown } from '../../markdown/markdownValidation';
import { scieMetadataPlugins } from './scieMetadataNodes';

describe('scieMetadataPlugins round-trip', () => {
  it('preserves ScieMD metadata comments through Milkdown serialization', async () => {
    const markdown = [
      '<!-- scie_md:lock:start reason="Approved by PI" -->',
      'This content is locked.',
      '<!-- scie_md:lock:end -->',
      '',
      '<!-- scie_md:comment audience="llm": Revise this paragraph for clarity. -->',
      'Target paragraph here.',
      '<!-- scie_md:comment:end -->',
      '',
      '<!-- scie_md:instruction target="next-block" prompt="Make this more formal" -->',
      'Informal paragraph.',
      '',
      '<!-- scie_md:variant:group id="abstract" active="v2" -->',
      '<!-- scie_md:variant:item id="v1" name="Draft 1" -->',
      'First draft of abstract.',
      '<!-- scie_md:variant:item id="v2" name="Draft 2" -->',
      'Second draft of abstract.',
      '<!-- scie_md:variant:end -->',
    ].join('\n');

    const serialized = await serializeWithMetadata(markdown);

    expect(serialized).toContain('<!-- scie_md:lock:start reason="Approved by PI" -->');
    expect(serialized).toContain('<!-- scie_md:lock:end -->');
    expect(serialized).toContain('<!-- scie_md:comment audience="llm": Revise this paragraph for clarity. -->');
    expect(serialized).toContain('<!-- scie_md:comment:end -->');
    expect(serialized).toContain('<!-- scie_md:instruction target="next-block" prompt="Make this more formal" -->');
    expect(serialized).toContain('<!-- scie_md:variant:group id="abstract" active="v2" -->');
    expect(serialized).toContain('<!-- scie_md:variant:item id="v1" name="Draft 1" -->');
    expect(serialized).toContain('<!-- scie_md:variant:item id="v2" name="Draft 2" -->');
    expect(serialized).toContain('<!-- scie_md:variant:end -->');
  });

  it('rejects visual edits inside locked ranges and emits user feedback', async () => {
    const editor = await createMetadataEditor([
      '<!-- scie_md:lock:start reason="approved" -->',
      'Locked content.',
      '<!-- scie_md:lock:end -->',
      '',
      'Editable content.',
    ].join('\n'));
    const view = editor.ctx.get(editorViewCtx);
    const lockedTextPosition = findTextPosition(view.state.doc, 'Locked content.');
    const messages: string[] = [];
    const listener = (event: Event) => {
      const custom = event as CustomEvent<{ message?: string }>;
      if (custom.detail?.message) messages.push(custom.detail.message);
    };
    window.addEventListener('scie-md-lock-violation', listener);

    view.dispatch(view.state.tr.insertText('X', lockedTextPosition + 1));
    await Promise.resolve();

    const serializer = editor.ctx.get(serializerCtx);
    const serialized = serializer(view.state.doc);
    window.removeEventListener('scie-md-lock-violation', listener);
    await editor.destroy();

    expect(serialized).toContain('Locked content.');
    expect(serialized).not.toContain('LXocked content.');
    expect(messages.join('\n')).toContain('This section is locked');
  });

  it('preserves directive and mermaid blocks through Milkdown serialization', async () => {
    const markdown = [
      ':::tip {#tip-first-tour}',
      'Visual mode renders this as a tip.',
      ':::',
      '',
      ':::figure {#fig-flow}',
      '```mermaid',
      'flowchart LR',
      '  A --> B',
      '```',
      '',
      'Figure caption.',
      ':::',
      '',
      '```mermaid',
      'flowchart TD',
      '  X --> Y',
      '```',
      '',
      '```svg',
      '<svg viewBox="0 0 120 40"><text x="8" y="24">Vector</text></svg>',
      '```',
    ].join('\n');

    const serialized = await serializeWithMetadata(markdown);

    expect(serialized).toContain(':::tip {#tip-first-tour}');
    expect(serialized).toContain('Visual mode renders this as a tip.');
    expect(serialized).toContain(':::figure {#fig-flow}');
    expect(serialized).toContain('```mermaid');
    expect(serialized).toContain('flowchart LR');
    expect(serialized).toContain('flowchart TD');
    expect(serialized).toContain('```svg');
    expect(serialized).toContain('<svg viewBox="0 0 120 40"><text x="8" y="24">Vector</text></svg>');
  });

  it('keeps unsupported visual content as raw editable Markdown', async () => {
    const markdown = [
      '# Advanced',
      '',
      '<div class="callout">Raw HTML should stay raw.</div>',
      '',
      ':::custom',
      'Unknown directive body.',
      ':::',
    ].join('\n');

    const serialized = await serializeWithMetadata(markdown);

    expect(serialized).toContain('<div class="callout">Raw HTML should stay raw.</div>');
    expect(serialized).toContain(':::custom');
    expect(serialized).toContain('Unknown directive body.');
    expect(validateMarkdown(serialized).sourceOnly).toBe(false);
  });

  it('decorates structured note quote targets without highlighting the whole block', async () => {
    const editor = await createMetadataEditor([
      '<!-- scie_md:note id="llm-quote-1" kind="llm" target="quote" quote="selected sentence: with colon": Tighten only this sentence. -->',
      '',
      'Alpha selected sentence: with colon omega.',
      '',
      '<!-- scie_md:note id="llm-quote-2" kind="llm" target="quote" quote="Second bullet text": Tighten only this bullet. -->',
      '',
      '- First bullet text',
      '- Second bullet text',
      '- Third bullet text',
    ].join('\n'));
    const view = editor.ctx.get(editorViewCtx);
    await Promise.resolve();

    const quoteHighlights = Array.from(view.dom.querySelectorAll('.llm-note-target-quote')).map((node) => node.textContent);
    expect(quoteHighlights).toEqual(expect.arrayContaining(['selected sentence: with colon', 'Second bullet text']));
    expect(view.dom.querySelector('.llm-note-target-block')).toBeNull();
    await editor.destroy();
  });

  it('uses separate target decoration colors for human notes', async () => {
    const editor = await createMetadataEditor([
      '<!-- scie_md:note id="human-quote-1" kind="human" target="quote" quote="review this sentence": Revised for clarity; confirm the claim. -->',
      '',
      'Please review this sentence before submission.',
    ].join('\n'));
    const view = editor.ctx.get(editorViewCtx);
    await Promise.resolve();

    expect(view.dom.querySelector('.human-note-target-quote')?.textContent).toBe('review this sentence');
    expect(view.dom.querySelector('.llm-note-target-quote')).toBeNull();
    await editor.destroy();
  });

  it('uses note prefix and suffix context when duplicate quotes appear in one block', async () => {
    const editor = await createMetadataEditor([
      '<!-- scie_md:note id="llm-context" kind="llm" target="quote" quote="repeated sentence" prefix="Beta" suffix="two": Revise only the second occurrence. -->',
      '',
      'Alpha repeated sentence one. Beta repeated sentence two.',
    ].join('\n'));
    const view = editor.ctx.get(editorViewCtx);
    await Promise.resolve();

    const highlight = view.dom.querySelector('.llm-note-target-quote');
    expect(highlight?.textContent).toBe('repeated sentence');
    expect(highlight?.parentElement?.textContent).toContain('Beta repeated sentence two');
    await editor.destroy();
  });

  it('decorates structured note quote targets that span adjacent list items', async () => {
    const editor = await createMetadataEditor([
      '<!-- scie_md:note id="llm-list-quote" kind="llm" target="quote" quote="Use View -> Theme for light, dark, or system color mode. Type / on a blank line to insert content.": Tighten these bullets. -->',
      '',
      '1. Draft in **Visual** mode.',
      '2. Use **View -> Theme** for light, dark, or system color mode.',
      '3. Type `/` on a blank line to insert content.',
      '4. Select text to use the floating toolbar.',
    ].join('\n'));
    const view = editor.ctx.get(editorViewCtx);
    await Promise.resolve();

    const highlightedText = Array.from(view.dom.querySelectorAll('.llm-note-target-quote'))
      .map((node) => node.textContent)
      .join(' ')
      .replace(/\s+/g, ' ');
    expect(highlightedText).toContain('Use View -> Theme');
    expect(highlightedText).toContain('Type / on a blank line');
    await editor.destroy();
  });

  it('decorates explicit structured note ranges through the closing marker', async () => {
    const editor = await createMetadataEditor([
      '<!-- scie_md:note id="llm-range" kind="llm" target="selection" quote="Two paragraphs": Tighten both paragraphs. -->',
      '',
      'First selected paragraph.',
      '',
      'Second selected paragraph.',
      '<!-- scie_md:comment:end -->',
      '',
      'Outside paragraph.',
    ].join('\n'));
    const view = editor.ctx.get(editorViewCtx);
    await Promise.resolve();

    const highlightedText = Array.from(view.dom.querySelectorAll('.llm-note-target-block'))
      .map((node) => node.textContent)
      .join(' ');
    expect(highlightedText).toContain('First selected paragraph.');
    expect(highlightedText).toContain('Second selected paragraph.');
    expect(highlightedText).not.toContain('Outside paragraph.');
    await editor.destroy();
  });

  it('removes a structured range note together with its closing boundary', async () => {
    const editor = await createMetadataEditor([
      '<!-- scie_md:note id="llm-range" kind="llm" target="selection" quote="Two paragraphs": Tighten both paragraphs. -->',
      '',
      'First selected paragraph.',
      '',
      'Second selected paragraph.',
      '<!-- scie_md:comment:end -->',
      '',
      'Outside paragraph.',
    ].join('\n'));
    const view = editor.ctx.get(editorViewCtx);
    const remove = view.dom.querySelector<HTMLButtonElement>('.scie-md-note-card .danger');
    expect(remove).not.toBeNull();

    remove?.click();
    await Promise.resolve();

    const serializer = editor.ctx.get(serializerCtx);
    const serialized = serializer(view.state.doc);
    await editor.destroy();

    expect(serialized).not.toContain('scie_md:note');
    expect(serialized).not.toContain('scie_md:comment:end');
    expect(serialized).toContain('First selected paragraph.');
    expect(serialized).toContain('Second selected paragraph.');
    expect(serialized).toContain('Outside paragraph.');
    expect(validateMarkdown(serialized).sourceOnly).toBe(false);
  });

  it('removes a legacy paired note boundary without deleting nearby content', async () => {
    const editor = await createMetadataEditor([
      '<!-- scie_md:comment audience="llm": Revise this paragraph. -->',
      '',
      'Target paragraph here.',
      '',
      '<!-- scie_md:comment:end -->',
    ].join('\n'));
    const view = editor.ctx.get(editorViewCtx);
    const remove = view.dom.querySelector<HTMLButtonElement>('.scie-md-note-card .danger');
    expect(remove).not.toBeNull();

    remove?.click();
    await Promise.resolve();

    const serializer = editor.ctx.get(serializerCtx);
    const serialized = serializer(view.state.doc);
    await editor.destroy();

    expect(serialized).not.toContain('scie_md:comment');
    expect(serialized).not.toContain('scie_md:comment:end');
    expect(serialized).toContain('Target paragraph here.');
    expect(validateMarkdown(serialized).sourceOnly).toBe(false);
  });

  it('parses Markdown-safe image paths as image nodes', async () => {
    const serialized = await serializeWithMetadata(
      '![ChatGPT Image](assets/ChatGPT%20Image%20May%2019%2C%202026%2C%2001_26_41%20AM-3.png)',
    );

    expect(serialized).toContain('![ChatGPT Image](assets/ChatGPT%20Image%20May%2019%2C%202026%2C%2001_26_41%20AM-3.png)');
    expect(serialized).not.toContain('\\!\\[');
  });
});

async function serializeWithMetadata(markdown: string): Promise<string> {
  const editor = await createMetadataEditor(markdown);
  const view = editor.ctx.get(editorViewCtx);
  const serializer = editor.ctx.get(serializerCtx);
  const serialized = serializer(view.state.doc);
  await editor.destroy();
  return serialized;
}

async function createMetadataEditor(markdown: string): Promise<Editor> {
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(defaultValueCtx, markdown);
    })
    .use(scieMetadataPlugins)
    .use(commonmark)
    .use(gfm);
  await editor.create();
  return editor;
}

function findTextPosition(doc: { descendants: (callback: (node: { isText: boolean; text?: string }, pos: number) => boolean | void) => void }, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text?.includes(text)) {
      found = pos + node.text.indexOf(text);
      return false;
    }
    return true;
  });
  expect(found).toBeGreaterThanOrEqual(0);
  return found;
}
