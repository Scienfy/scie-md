import { describe, expect, it } from 'vitest';
import {
  attrsForDirectiveRaw,
  attrsForMermaidRaw,
  attrsForSvgRaw,
  createOversizedAtomFallback,
  isOversizedVisualAtomSource,
  replaceRenderedVisualAtomNodes,
} from './renderedVisualAtoms';
import type { MetadataMdastNode } from './renderedVisualAtoms';

describe('renderedVisualAtoms', () => {
  it('collapses directive, Mermaid, and SVG source ranges into positioned metadata atoms', () => {
    const markdown = [
      'Intro.',
      '',
      ':::tip {#tip-a .tour}',
      'Use the visual atom.',
      ':::',
      '',
      '```mermaid',
      'flowchart LR',
      '  A --> B',
      '```',
      '',
      '```svg',
      '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
      '```',
      '',
      'Outro.',
    ].join('\n');
    const children = [
      paragraphNode('Intro.', markdown, 0),
      paragraphNode(':::tip {#tip-a .tour}', markdown, 2),
      paragraphNode('Use the visual atom.', markdown, 3),
      paragraphNode(':::', markdown, 4),
      paragraphNode('```mermaid', markdown, 6),
      paragraphNode('flowchart LR', markdown, 7),
      paragraphNode('  A --> B', markdown, 8),
      paragraphNode('```', markdown, 9),
      paragraphNode('```svg', markdown, 11),
      paragraphNode('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>', markdown, 12),
      paragraphNode('```', markdown, 13),
      paragraphNode('Outro.', markdown, 15),
    ];

    replaceRenderedVisualAtomNodes(children, markdown);

    expect(children).toHaveLength(5);
    expect(children[1]).toMatchObject({
      type: 'scie_directive_block',
      name: 'tip',
      label: 'tip-a',
      detail: '#tip-a - .tour',
      body: 'Use the visual atom.',
    });
    expect(children[2]).toMatchObject({
      type: 'scie_mermaid_block',
      body: 'flowchart LR\n  A --> B',
    });
    expect(children[3]).toMatchObject({
      type: 'scie_svg_block',
      body: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
    });
    expect(children[1].position?.start?.offset).toBe(positionedStart(markdown, 2));
    expect(children[3].position?.end?.offset).toBe(positionedStart(markdown, 13) + 3);
  });

  it('parses raw block attrs and keeps invalid directives editable as raw Markdown', () => {
    expect(attrsForDirectiveRaw(':::warning {#warn-a}\nCheck assumptions.\n:::')).toMatchObject({
      raw: ':::warning {#warn-a}\nCheck assumptions.\n:::',
      name: 'warning',
      label: 'warn-a',
      body: 'Check assumptions.',
    });
    expect(attrsForDirectiveRaw(':::not-closed\nbody')).toMatchObject({
      name: 'note',
      detail: 'Invalid directive syntax',
      body: ':::not-closed\nbody',
    });
    expect(attrsForMermaidRaw('```mermaid\nflowchart TD\n  A --> B\n```')).toMatchObject({
      body: 'flowchart TD\n  A --> B',
    });
    expect(attrsForSvgRaw('```svg\n<svg viewBox="0 0 1 1"></svg>\n```')).toMatchObject({
      body: '<svg viewBox="0 0 1 1"></svg>',
    });
  });

  it('keeps oversized rendered atom content raw and produces a truncated fallback preview', () => {
    const largeMermaid = `\`\`\`mermaid\nflowchart LR\n${'A --> B\n'.repeat(40_000)}\`\`\``;
    const fallback = createOversizedAtomFallback('Mermaid diagram', largeMermaid);

    expect(isOversizedVisualAtomSource(largeMermaid)).toBe(true);
    expect(attrsForMermaidRaw(largeMermaid)).toMatchObject({
      raw: largeMermaid,
      body: '',
    });
    expect(fallback.className).toBe('scie-md-visual-atom-raw-fallback');
    expect(fallback.querySelector('strong')?.textContent).toBe('Mermaid diagram shown as raw Markdown');
    expect(fallback.querySelector('span')?.textContent).toContain('Rendering is skipped');
    expect(fallback.querySelector('pre')?.textContent).toContain('raw block truncated in visual preview');
  });
});

function paragraphNode(value: string, markdown: string, lineIndex: number): MetadataMdastNode {
  return positioned({ type: 'paragraph', value }, markdown, lineIndex);
}

function positioned<T extends { type: string; value: string }>(
  node: T,
  markdown: string,
  lineIndex: number,
): T & { position: { start: { offset: number }; end: { offset: number } } } {
  const start = positionedStart(markdown, lineIndex);
  return {
    ...node,
    position: {
      start: { offset: start },
      end: { offset: start + node.value.length },
    },
  };
}

function positionedStart(markdown: string, lineIndex: number): number {
  const lines = markdown.split('\n');
  return lines.slice(0, lineIndex).join('\n').length + (lineIndex === 0 ? 0 : 1);
}
