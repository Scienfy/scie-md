import { describe, expect, it } from 'vitest';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter';
import { DOCUMENT_PARSE_CRASH_CODE, createFallbackScienfyDocument, parseScienfyDocument, safeParseScienfyDocument } from './documentModel';

describe('Layer II document model', () => {
  it('parses front matter and preserves body text separately', () => {
    const parsed = parseFrontmatter('---\ntitle: Test\nbibliography: refs.bib\n---\n# Body\n');

    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.data.title).toBe('Test');
    expect(parsed.body).toBe('# Body\n');
    expect(parsed.error).toBeNull();
  });

  it('serializes front matter without touching body content', () => {
    expect(serializeFrontmatter({ title: 'Test' }, '# Body\n')).toBe('---\ntitle: Test\n---\n# Body\n');
  });

  it('builds citations, cross-references, and directives', () => {
    const markdown = [
      '---',
      'title: Surface Catalysis',
      'bibliography: refs.bib',
      'scienfy:',
      '  documentType: paper',
      '  visualStyle: scienfy',
      '---',
      '# Intro {#sec-intro}',
      '',
      'See @fig-surface and [@smith2026].',
      '',
      ':::figure {#fig-surface layout="wide"}',
      '![Surface](assets/surface.png)',
      'Caption.',
      ':::',
    ].join('\n');

    const parsed = parseScienfyDocument(markdown);

    expect(parsed.title).toBe('Surface Catalysis');
    expect(parsed.documentType).toBe('paper');
    expect(parsed.visualStyle).toBe('scienfy');
    expect(parsed.citations.usages.map((usage) => usage.key)).toEqual(['smith2026']);
    expect(parsed.references.labels.map((label) => label.id)).toContain('fig-surface');
    expect(parsed.references.usages.map((usage) => usage.id)).toContain('fig-surface');
    expect(parsed.directives[0].known).toBe(true);
  });

  it('preserves unknown directives as warnings instead of source-only blockers', () => {
    const parsed = parseScienfyDocument(':::custom\ncontent\n:::\n');

    expect(parsed.diagnostics.some((diagnostic) => diagnostic.code === 'directive-unknown')).toBe(true);
  });

  it('reports missing bibliography keys when bibtex content is loaded', () => {
    const markdown = [
      '---',
      'bibliography: refs.bib',
      '---',
      'Known [@known2026], missing [@missing2026].',
    ].join('\n');
    const parsed = parseScienfyDocument(markdown, {
      bibtex: '@article{known2026, title={Known}}',
    });

    expect(parsed.citations.bibtexKeys).toEqual(['known2026']);
    expect(parsed.citations.missingKeys).toEqual(['missing2026']);
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.code === 'citation-missing')).toBe(true);
  });

  it('rejects excessive YAML alias expansion in front matter', () => {
    const aliases = Array.from({ length: 120 }, () => '*anchor').join(', ');
    const parsed = parseFrontmatter(`---\nanchor: &anchor value\naliases: [${aliases}]\n---\n# Body\n`);

    expect(parsed.error).toMatch(/alias/i);
  });

  it('does not close front matter on indented YAML block scalar fences', () => {
    const parsed = parseFrontmatter([
      '---',
      'abstract: |',
      '  Methods stay readable.',
      '  ---',
      '  This is still abstract text.',
      'title: Scalar Test',
      '---',
      '# Body',
    ].join('\n'));

    expect(parsed.error).toBeNull();
    expect(parsed.data.title).toBe('Scalar Test');
    expect(parsed.body).toBe('# Body');
  });

  it('warns on invalid scienfy front matter types', () => {
    const parsed = parseScienfyDocument('---\ntitle: 123\nscienfy:\n  visualStyle: 123\n---\n# Body\n');

    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toContain('frontmatter-title-type');
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toContain('scienfy-visual-style');
  });

  it('keeps normal safe parsing equivalent to the strict parser', () => {
    const markdown = '---\ntitle: Rescue Test\n---\n# Body\n';

    expect(safeParseScienfyDocument(markdown).title).toBe(parseScienfyDocument(markdown).title);
  });

  it('builds a structurally valid source-only fallback document after parser failure', () => {
    const fallback = createFallbackScienfyDocument(
      [
        '---',
        'title: Poisoned',
        'bibliography: refs.bib',
        'scienfy:',
        '  documentType: paper',
        '  variablesFile: vars.json',
        '---',
        '# Body',
      ].join('\n'),
      { variableDefinitions: [{ name: 'n', value: '12', source: 'external', file: 'vars.json' }] },
      new Error('boom'),
    );

    expect(fallback.title).toBe('Poisoned');
    expect(fallback.documentType).toBe('paper');
    expect(fallback.bibliographyFiles).toEqual(['refs.bib']);
    expect(fallback.variableFiles).toEqual(['vars.json']);
    expect(fallback.variables.definitions.map((definition) => definition.name)).toEqual(['n']);
    expect(fallback.directives).toEqual([]);
    expect(fallback.diagnostics.some((diagnostic) => diagnostic.code === DOCUMENT_PARSE_CRASH_CODE)).toBe(true);
  });
});
