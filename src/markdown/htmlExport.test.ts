import { describe, expect, it, vi } from 'vitest';
import { createHtmlDocument, exportedDocumentTitle, extractLocalImageReferences, renderMarkdownHtmlDocument, renderMarkdownHtmlFragment } from './htmlExport';

vi.mock('mermaid', () => {
  return {
    default: {
      initialize: vi.fn(),
      render: vi.fn().mockImplementation(async (id: string, code: string) => {
        return { svg: `<svg id="${id}">mock-svg</svg>` };
      }),
    },
  };
});


describe('htmlExport', () => {
  it('creates a complete html document', () => {
    const html = createHtmlDocument('<h1>Title</h1>', 'Doc', {
      resolvedTheme: 'dark',
      themeMode: 'dark',
      visualStyle: 'scienfy',
      fontScale: 1.1,
      fontCss: '@font-face { font-family: "Test"; src: url("data:font/woff2;base64,AA=="); }',
      exportOptions: {
        profileId: 'test',
        citationStylePath: null,
        pdf: {
          paperSize: 'Letter',
          orientation: 'landscape',
          margins: { top: '12mm', right: '14mm', bottom: '16mm', left: '18mm' },
          pageNumbers: 'bottom-right',
          runningHeader: 'Header',
          runningFooter: 'Footer',
        },
      },
    });

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('data-visual-style="scienfy"');
    expect(html).toContain('--font-scale: 1.1');
    expect(html).toContain('<title>Doc</title>');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("script-src 'none'");
    expect(html).toContain('data:font/woff2;base64,AA==');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('.mermaid-figure svg { width: clamp(720px, 74%, 1180px);');
    expect(html).toContain('.svg-figure svg { width: clamp(720px, 74%, 1180px);');
    expect(html).toContain('@page');
    expect(html).toContain('size: Letter landscape;');
    expect(html).toContain('margin: 12mm 14mm 16mm 18mm;');
    expect(html).toContain('@top-center { content: "Header"; }');
    expect(html).toContain('@bottom-right { content: counter(page); }');
    expect(html).toContain('@bottom-center { content: "Footer"; }');
  });

  it('does not let fallback markdown CSS restyle a captured visual frame', () => {
    const html = createHtmlDocument(
      '<main class="editor-stage export-captured-stage"><div class="visual-editor"><article class="ProseMirror"><h1>Captured</h1></article></div></main>',
      'Captured',
      {
        resolvedTheme: 'light',
        themeMode: 'light',
        visualStyle: 'scienfy',
        bodyIsFullVisualFrame: true,
        embedFonts: false,
      },
    );

    expect(html).toContain('editor-stage export-captured-stage');
    expect(html).not.toContain('main { max-width: 920px;');
    expect(html).not.toContain('body { margin: 0; background: #f6f8f7;');
    expect(html).toContain('.scie-md-export-page > .editor-stage.export-captured-stage');
  });

  it('freezes captured visual layout width for matching html and pdf export', () => {
    const html = createHtmlDocument(
      '<main class="editor-stage export-captured-stage"><div class="visual-editor"><div class="milkdown"><article class="ProseMirror"><h1>Captured</h1></article></div></div></main>',
      'Captured',
      {
        resolvedTheme: 'light',
        themeMode: 'light',
        visualStyle: 'scienfy',
        bodyIsFullVisualFrame: true,
        embedFonts: false,
        exportLayout: {
          viewportWidthPx: 2048,
          contentWidthPx: 1474,
        },
      },
    );

    expect(html).toContain('data-export-layout="captured"');
    expect(html).toContain('--scie-md-export-layout-width: 2048px');
    expect(html).toContain('--scie-md-export-content-width: 1474px');
    expect(html).toContain('max-width: var(--scie-md-export-content-width, var(--content-width));');
    expect(html).toContain('size: 2048px 2896px;');
    expect(html).toContain('html:not([data-export-layout="captured"]) .scie-md-export-page > .editor-stage.export-captured-stage');
  });

  it('uses frontmatter or the first h1 as the export document title', async () => {
    expect(exportedDocumentTitle('---\ntitle: Paper Draft\n---\n# Ignored\n', null)).toBe('Paper Draft');
    expect(exportedDocumentTitle('# **ScieMD Tutorial**\n\nBody', null)).toBe('ScieMD Tutorial');

    const html = await renderMarkdownHtmlDocument('# ScieMD Tutorial\n\nBody', null, undefined, {
      embedFonts: false,
    });
    expect(html).toContain('<title>ScieMD Tutorial</title>');
  });

  it('finds local markdown image references', () => {
    const references = extractLocalImageReferences(
      [
        '![Figure](assets/a.png)',
        '![Escape](../secret.png)',
        '![Absolute](C:\\Users\\amin_\\secret.png)',
        '![Unc](\\\\server\\share\\secret.png)',
        '![Not image](assets/data.csv)',
        '![Remote](https://example.com/a.png)',
      ].join('\n'),
      'C:\\docs\\paper.md',
    );

    expect(references).toEqual([
      {
        markdownPath: 'assets/a.png',
        diskPath: 'C:\\docs\\assets\\a.png',
        mimeType: 'image/png',
      },
    ]);
  });

  it('keeps POSIX asset paths POSIX when resolving local images', () => {
    const references = extractLocalImageReferences('![Figure](assets/a.png)', '/home/user/docs/paper.md');

    expect(references[0]?.diskPath).toBe('/home/user/docs/assets/a.png');
  });

  it('finds local markdown image references with spaces in the filename', () => {
    const references = extractLocalImageReferences(
      '![Figure](assets/ChatGPT Image May 19, 2026.png)',
      'C:\\docs\\paper.md',
    );

    expect(references).toEqual([
      {
        markdownPath: 'assets/ChatGPT Image May 19, 2026.png',
        diskPath: 'C:\\docs\\assets\\ChatGPT Image May 19, 2026.png',
        mimeType: 'image/png',
      },
    ]);
  });

  it('renders missing local export images as explicit placeholders', async () => {
    const html = await renderMarkdownHtmlFragment('![Critical workflow](assets/missing.png)\n', 'C:\\docs\\paper.md');

    expect(html).toContain('data:image/svg+xml');
    expect(html).toContain('data-scie-md-export-issue%3D%22missing-image%22');
    expect(html).not.toContain('assets/missing.png');
  });

  it('does not render YAML front matter as document content', async () => {
    const html = await renderMarkdownHtmlFragment('---\ntitle: Hidden\n---\n# Visible\n', null);

    expect(html).toContain('<h1>Visible</h1>');
    expect(html).not.toContain('title: Hidden');
  });

  it('renders known directive blocks as visual-safe cards', async () => {
    const html = await renderMarkdownHtmlFragment(':::figure {#fig-a}\n![A](assets/a.png)\n\nCaption.\n:::\n', null);

    expect(html).toContain('directive-card directive-figure');
    expect(html).toContain('Figure');
    expect(html).toContain('#fig-a');
    expect(html).toContain('directive-figure-content');
    expect(html).toContain('Figure 1:');
    expect(html).not.toContain(':::figure');
  });

  it('auto-numbers figures and table results without changing directive source', async () => {
    const html = await renderMarkdownHtmlFragment([
      ':::figure {#fig-a}',
      '![A](assets/a.png)',
      '',
      'First caption.',
      ':::',
      '',
      ':::figure {#fig-b}',
      '![B](assets/b.png)',
      '',
      'Second caption.',
      ':::',
      '',
      ':::result {#tbl-a}',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      ':::',
      '',
    ].join('\n'), null);

    expect(html).toContain('Figure 1:');
    expect(html).toContain('Figure 2:');
    expect(html).toContain('Table 1:');
    expect(html).not.toContain(':::result');
  });

  it('renders references directives from loaded BibTeX entries', async () => {
    const html = await renderMarkdownHtmlFragment([
      'Claim [@smith2026; @missing2026].',
      '',
      ':::references',
      ':::',
    ].join('\n'), null, {
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
    });

    expect(html).toContain('directive-card directive-references');
    expect(html).toContain('Reliable Scientific Markdown.');
    expect(html).toContain('@missing2026');
    expect(html).not.toContain(':::references');
  });

  it('renders directive bodies with shared math and mermaid preview support', async () => {
    const html = await renderMarkdownHtmlFragment([
      ':::figure {#fig-flow}',
      '```mermaid',
      'flowchart LR',
      '  A --> B',
      '```',
      '',
      'Caption with $x^2$.',
      ':::',
      '',
    ].join('\n'), null);

    expect(html).toContain('directive-card directive-figure');
    expect(html).toContain('directive-card-body-rendered');
    expect(html).toContain('<math');
    expect(html).not.toContain('id="&lt;figure');
    expect(html).not.toContain(':::figure');
    expect(html).not.toContain('```mermaid');
  });

  it('preserves literal dollar replacement tokens in rendered directive HTML', async () => {
    const html = await renderMarkdownHtmlFragment(':::note\nLiteral $& marker stays text.\n:::\n', null);

    expect(html).toContain('Literal $&amp; marker stays text.');
    expect(html).not.toContain('SCIENFY_DIRECTIVE_');
  });

  it('renders svg fences as sanitized vector figures', async () => {
    const html = await renderMarkdownHtmlFragment([
      '```svg',
      '<svg viewBox="0 0 120 40" onload="alert(1)">',
      '<script>alert(1)</script>',
      '<rect width="120" height="40" fill="#ddeeff"/>',
      '<text x="8" y="24">Vector figure</text>',
      '</svg>',
      '```',
    ].join('\n'), null);

    expect(html).toContain('class="svg-figure"');
    expect(html).toContain('<rect');
    expect(html).toContain('Vector figure');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onload');
    expect(html).not.toContain('```svg');
  });

  it('shows an inline error badge for unsafe svg fences', async () => {
    const html = await renderMarkdownHtmlFragment([
      '```svg',
      '<!DOCTYPE svg [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>',
      '<svg><text>&xxe;</text></svg>',
      '```',
      '',
    ].join('\n'), null);

    expect(html).toContain('render-error-svg');
    expect(html).toContain('SVG figure error');
  });

  it('treats svg fences inside figure directives as numbered figure media', async () => {
    const html = await renderMarkdownHtmlFragment([
      ':::figure {#fig-vector}',
      '```svg',
      '<svg viewBox="0 0 100 30"><text x="4" y="20">A -> B</text></svg>',
      '```',
      '',
      'A vector workflow that remains editable as text.',
      ':::',
    ].join('\n'), null);

    expect(html).toContain('directive-figure-content');
    expect(html).toContain('class="svg-figure"');
    expect(html).toContain('Figure 1:');
    expect(html).toContain('A vector workflow that remains editable as text.');
  });

  it('renders inline math in shared preview/export fragments', async () => {
    const html = await renderMarkdownHtmlFragment('Area is $x^2$.\n', null);

    expect(html).toContain('<math');
    expect(html).toContain('x');
  });

  it('renders only active variants in preview/export fragments', async () => {
    const html = await renderMarkdownHtmlFragment([
      '<!-- scie_md:variant:group id="abstract" active="v2" -->',
      '<!-- scie_md:variant:item id="v1" name="Original" -->',
      'Original abstract.',
      '<!-- scie_md:variant:item id="v2" name="Short" -->',
      'Short abstract.',
      '<!-- scie_md:variant:end -->',
    ].join('\n'), null);

    expect(html).toContain('Short abstract.');
    expect(html).not.toContain('Original abstract.');
    expect(html).not.toContain('scie_md:variant');
  });

  it('renders pagebreak directives as print page breaks', async () => {
    const html = await renderMarkdownHtmlFragment('Before\n\n:::pagebreak\n:::\n\nAfter\n', null);

    expect(html).toContain('Before');
    expect(html).toContain('class="page-break"');
    expect(html).toContain('After');
    expect(html).not.toContain(':::pagebreak');
  });
});
