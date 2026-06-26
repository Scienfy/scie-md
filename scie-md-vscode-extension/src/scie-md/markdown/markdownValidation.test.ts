import { describe, expect, it } from 'vitest';
import { createFallbackScienfyDocument, DOCUMENT_PARSE_CRASH_CODE } from '../domain/document/documentModel';
import { createScienfyTemplate } from '../domain/document/templates';
import { countRenderedWords, hasRawHtml, removeFencedCodeBlocks, validateMarkdown } from './markdownValidation';
import { SOURCE_ONLY_FILE_BYTES } from './supportedMarkdown';

describe('validateMarkdown', () => {
  it('allows known closed directive blocks in visual mode through the placeholder preview layer', () => {
    const result = validateMarkdown('# Note\n\n::: warning\ncontent\n:::\n');
    expect(result.sourceOnly).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'directive-unknown-visual')).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'directive-unknown')).toBe(false);
  });

  it('does not block visual mode for directive examples inside fenced code', () => {
    const result = validateMarkdown('```markdown\n::: warning\ncontent\n:::\n```\n');
    expect(result.sourceOnly).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'directive-unknown')).toBe(false);
  });

  it('reports unknown directives without blocking visual mode', () => {
    const result = validateMarkdown(':::custom\ncontent\n:::\n');
    expect(result.sourceOnly).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'directive-unknown')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'directive-unknown-visual')).toBe(true);
  });

  it('opens directive-based Layer II paper templates in visual mode when directives are known and closed', () => {
    const result = validateMarkdown(createScienfyTemplate('paper'));
    expect(result.sourceOnly).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'directive-unknown-visual')).toBe(false);
  });

  it('allows variant groups in visual mode through the variant preview card', () => {
    const result = validateMarkdown([
      '<!-- scie_md:variant:group id="abstract" active="v2" -->',
      '<!-- scie_md:variant:item id="v1" name="Original" -->',
      'Original draft.',
      '<!-- scie_md:variant:item id="v2" name="Short" -->',
      'Short draft.',
      '<!-- scie_md:variant:end -->',
    ].join('\n'));

    expect(result.sourceOnly).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'variant-source-only')).toBe(false);
  });

  it('reports raw HTML without blocking visual mode', () => {
    const result = validateMarkdown('<div>kept</div>\n');
    expect(result.sourceOnly).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'raw-html' && issue.severity === 'error')).toBe(true);
  });

  it('does not treat HTML-like front matter strings as body raw HTML', () => {
    const metadataOnly = validateMarkdown([
      '---',
      'title: "<span>Draft</span>"',
      'threshold: "p < 0.05"',
      '---',
      '',
      'Body text.',
    ].join('\n'));
    expect(metadataOnly.issues.some((issue) => issue.code === 'raw-html')).toBe(false);

    const bodyHtml = validateMarkdown([
      '---',
      'title: "<span>Draft</span>"',
      '---',
      '',
      '<div>Body HTML</div>',
    ].join('\n'));
    expect(bodyHtml.issues.some((issue) => issue.code === 'raw-html')).toBe(true);
  });

  it('does not treat visual-editor list transients as source-only syntax', () => {
    for (const markdown of ['- First\n\n- <br>\n', '- [ ] Task\n\n- [ ] \n']) {
      const result = validateMarkdown(markdown);
      expect(result.sourceOnly).toBe(false);
      expect(result.issues.some((issue) => issue.code === 'raw-html')).toBe(false);
    }
  });

  it('does not treat CommonMark autolinks or angle text as raw HTML', () => {
    for (const markdown of ['<https://example.com>\n', '<user@example.com>\n', 'Math note: <x^2> is not HTML.\n']) {
      const result = validateMarkdown(markdown);
      expect(result.sourceOnly).toBe(false);
      expect(result.issues.some((issue) => issue.code === 'raw-html')).toBe(false);
    }
  });

  it('still blocks unsafe HTML while allowing plain hard breaks', () => {
    expect(hasRawHtml('<br>')).toBe(false);
    expect(hasRawHtml('<br />')).toBe(false);
    expect(hasRawHtml('<!-- editorial note -->')).toBe(false);
    expect(hasRawHtml('<br onclick="x()">')).toBe(true);
    expect(hasRawHtml('<iframe src="javascript:alert(1)"></iframe>')).toBe(true);
  });

  it('accepts a valid GFM table separator', () => {
    const result = validateMarkdown('| Feature | Status |\n| --- | --- |\n| A | B |\n');
    expect(result.issues.some((issue) => issue.code === 'table-syntax')).toBe(false);
  });

  it('warns when a table-like block lacks a separator', () => {
    const result = validateMarkdown('| Feature | Status |\n| A | B |\n');
    expect(result.issues.some((issue) => issue.code === 'table-syntax')).toBe(true);
  });

  it('reports oversized documents as source-first and defers deep parser diagnostics', () => {
    const result = validateMarkdown('small', SOURCE_ONLY_FILE_BYTES + 1);
    expect(result.sourceOnly).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'source-only-size')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'large-file-parser-deferred')).toBe(true);
  });

  it('flags internal visual placeholder markers if they ever leak into canonical markdown', () => {
    const result = validateMarkdown('SCIENFY\\_VISUAL\\_BLOCK\\_abc123\n');
    expect(result.sourceOnly).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'internal-visual-marker')).toBe(true);
  });

  it('reports parser fallback without blocking visual mode', () => {
    const fallback = createFallbackScienfyDocument('# Body\n', {}, new Error('boom'));
    const result = validateMarkdown('# Body\n', undefined, fallback);

    expect(result.sourceOnly).toBe(false);
    expect(result.issues.some((issue) => issue.code === DOCUMENT_PARSE_CRASH_CODE && issue.severity === 'error')).toBe(true);
  });

  it('warns while still allowing visual mode for Markdown forms that visual mode normalizes', () => {
    for (const markdown of [
      'Heading\n=======\n',
      '+ Alpha\n+ Beta\n',
      '* Alpha\n* Beta\n',
      '1) Alpha\n2) Beta\n',
      'A [reference link][id].\n\n[id]: https://example.com\n',
      'Hard break  \nnext line\n',
      '\tIndented with a tab\n',
    ]) {
      const result = validateMarkdown(markdown);
      expect(result.sourceOnly).toBe(false);
      expect(result.formattingWillNormalize).toBe(true);
      expect(result.issues.some((issue) => issue.code === 'visual-roundtrip-risk' && issue.severity === 'warning')).toBe(true);
    }
  });

  it('allows canonical visual-safe dash list forms and ignores fenced examples/front matter arrays', () => {
    const result = validateMarkdown([
      '---',
      'authors:',
      '  - name: "Author Name"',
      '---',
      '',
      '- Alpha',
      '',
      '- Beta',
      '',
      '```markdown',
      '* This example stays source text.',
      '```',
      '',
    ].join('\n'));

    expect(result.sourceOnly).toBe(false);
    expect(result.formattingWillNormalize).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'visual-roundtrip-risk')).toBe(false);
  });
});

describe('removeFencedCodeBlocks', () => {
  it('removes fenced code before validation checks', () => {
    expect(removeFencedCodeBlocks('a\n```md\n::: note\n```\nb')).toBe('a\n\n\n\nb');
  });
});

describe('countRenderedWords', () => {
  it('counts rendered text while excluding code blocks and markdown syntax', () => {
    const markdown = [
      '# Heading One',
      '',
      'A **bold** [link text](https://example.com).',
      '',
      '```ts',
      'const skipped = true;',
      '```',
    ].join('\n');

    expect(countRenderedWords(markdown)).toBe(6);
  });
});
