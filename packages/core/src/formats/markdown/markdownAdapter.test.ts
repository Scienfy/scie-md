import { describe, expect, it } from 'vitest';
import { createDocumentContent } from '../documentFormat';
import { markdownAdapter, MARKDOWN_SOURCE_ONLY_FILE_BYTES } from './markdownAdapter';

describe('markdownAdapter', () => {
  it('wraps the existing ScieMD Markdown parser without changing parsed output', () => {
    const content = markdownAdapter.createContent('---\ntitle: Trial Note\n---\n# Body\n', 'C:\\lab\\paper.md');

    const result = markdownAdapter.parse(content);

    expect(result.format).toBe('markdown');
    expect(result.content).toBe(content);
    expect(result.parsed?.title).toBe('Trial Note');
    expect(result.sourceOnly).toBe(false);
    expect(result.diagnostics).toEqual([]);
  });

  it('maps Markdown parser diagnostics into format diagnostics', () => {
    const content = createDocumentContent('markdown', '---\ntitle: [unterminated\n---\n# Body\n');

    const result = markdownAdapter.parse(content);

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'frontmatter-yaml',
        source: 'markdown',
      }),
    ]);
  });

  it('exposes Markdown capabilities needed by later format-aware UI gates', () => {
    expect(markdownAdapter.extensions).toEqual(['md', 'markdown']);
    expect(markdownAdapter.capabilities).toMatchObject({
      sourceEditing: true,
      visualEditing: true,
      diagnostics: true,
      imageReferences: true,
      frontmatter: true,
      conflictMarkersAllowed: true,
      defaultMode: 'visual',
      sourceOnlyFileBytes: MARKDOWN_SOURCE_ONLY_FILE_BYTES,
    });
  });

  it('marks oversized Markdown content as source-only at the adapter boundary', () => {
    const content = markdownAdapter.createContent('x'.repeat(MARKDOWN_SOURCE_ONLY_FILE_BYTES + 1));

    expect(markdownAdapter.parse(content).sourceOnly).toBe(true);
  });
});
