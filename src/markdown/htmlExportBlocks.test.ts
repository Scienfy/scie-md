import { describe, expect, it, vi } from 'vitest';
import { replaceDirectiveBlocks, replaceMermaidBlocks, replacePageBreakBlocks, replaceSvgBlocks } from './htmlExportBlocks';

vi.mock('mermaid', () => {
  return {
    default: {
      initialize: vi.fn(),
      render: vi.fn().mockImplementation(async (id: string, code: string) => {
        return { svg: `<svg id="${id}">${code}</svg>` };
      }),
    },
  };
});

describe('htmlExportBlocks', () => {
  it('turns pagebreak directives into export placeholders outside code fences', () => {
    const result = replacePageBreakBlocks([
      'Before',
      '',
      ':::pagebreak',
      ':::',
      '',
      '```',
      ':::pagebreak',
      ':::',
      '```',
    ].join('\n'));

    expect(result.replacements).toHaveLength(1);
    expect(result.replacements[0].html).toContain('class="page-break"');
    expect(result.markdown).toContain(result.replacements[0].placeholder);
    expect(result.markdown).toContain('```');
    expect(result.markdown).toContain(':::pagebreak\n:::\n```');
  });

  it('renders directive cards through the supplied markdown renderer', async () => {
    const result = await replaceDirectiveBlocks(':::figure {#fig-a .wide}\n![A](a.png)\n\nCaption.\n:::\n', {
      citationEntries: [],
      renderMarkdownHtml: async () => '<p><img src="a.png" alt="A"></p><p>Caption.</p>',
    });

    expect(result.replacements).toHaveLength(1);
    expect(result.markdown.trim()).toBe(result.replacements[0].placeholder);
    expect(result.replacements[0].html).toContain('directive-card directive-figure');
    expect(result.replacements[0].html).toContain('#fig-a - .wide');
    expect(result.replacements[0].html).toContain('Figure 1:');
  });

  it('renders references directives from citation usage and loaded entries', async () => {
    const result = await replaceDirectiveBlocks([
      'Claim [@smith2026; @missing2026].',
      '',
      ':::references',
      ':::',
    ].join('\n'), {
      citationEntries: [{
        type: 'article',
        key: 'smith2026',
        fields: {
          title: 'Reliable Scientific Markdown',
          author: 'Jane Smith and Alex Doe',
          year: '2026',
          journal: 'Journal of Research Tools',
        },
      }],
      renderMarkdownHtml: async (markdown) => `<p>${markdown}</p>`,
    });

    expect(result.replacements).toHaveLength(1);
    expect(result.replacements[0].html).toContain('directive-card directive-references');
    expect(result.replacements[0].html).toContain('Reliable Scientific Markdown.');
    expect(result.replacements[0].html).toContain('@missing2026');
  });

  it('renders Mermaid fences into reusable figure replacements', async () => {
    const result = await replaceMermaidBlocks('```mermaid\nflowchart LR\n  A --> B\n```\n');

    expect(result.replacements).toHaveLength(1);
    expect(result.markdown).toBe(`${result.replacements[0].placeholder}\n`);
    expect(result.replacements[0].html).toContain('class="mermaid-figure"');
    expect(result.replacements[0].html).toContain('flowchart LR');
  });

  it('sanitizes svg fences and returns an explicit error card for rejected svg', () => {
    const safe = replaceSvgBlocks('```svg\n<svg viewBox="0 0 40 20" onload="alert(1)"><text x="1" y="10">A</text></svg>\n```');
    const unsafe = replaceSvgBlocks('```svg\n<!DOCTYPE svg [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]><svg><text>&xxe;</text></svg>\n```');

    expect(safe.replacements).toHaveLength(1);
    expect(safe.replacements[0].html).toContain('class="svg-figure"');
    expect(safe.replacements[0].html).not.toContain('onload');
    expect(unsafe.replacements).toHaveLength(1);
    expect(unsafe.replacements[0].html).toContain('render-error-svg');
    expect(unsafe.replacements[0].html).toContain('SVG figure error');
  });
});
