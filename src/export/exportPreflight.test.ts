import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_OPTIONS } from './exportTypes';
import { preflightSummary, runExportPreflight } from './exportPreflight';

describe('runExportPreflight', () => {
  it('blocks export when unresolved variables would leak into output', () => {
    const result = runExportPreflight({
      markdown: 'Result is {{ missing_value }}.',
      format: 'html',
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContainEqual(expect.objectContaining({
      code: 'variable-missing',
      severity: 'blocker',
    }));
    expect(preflightSummary(result)).toContain('Export blocked');
  });

  it('blocks invalid front matter before export starts', () => {
    const result = runExportPreflight({
      markdown: [
        '---',
        'title: [broken',
        '---',
        'Body.',
      ].join('\n'),
      format: 'docx',
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.some((issue) => issue.code === 'frontmatter-yaml')).toBe(true);
  });

  it('warns on citations without bibliography and missing loaded entries', () => {
    const result = runExportPreflight({
      markdown: [
        'Known citation [@known2026].',
        'Narrative citation @missing2026.',
      ].join('\n'),
      format: 'html',
      citationEntries: [
        { type: 'article', key: 'known2026', fields: { title: 'Known' } },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'export-citation-no-bibliography' }),
      expect.objectContaining({ code: 'export-citation-missing' }),
    ]));
  });

  it('warns when citation-heavy Pandoc formats have no CSL style configured', () => {
    const result = runExportPreflight({
      markdown: [
        '---',
        'bibliography: refs.bib',
        '---',
        'Claim [@known2026].',
      ].join('\n'),
      format: 'docx',
      citationEntries: [
        { type: 'article', key: 'known2026', fields: { title: 'Known' } },
      ],
      exportOptions: DEFAULT_EXPORT_OPTIONS,
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'export-csl-missing' }));
  });

  it('warns when a generated references directive has no loaded entries', () => {
    const result = runExportPreflight({
      markdown: [
        ':::references',
        ':::',
      ].join('\n'),
      format: 'html',
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'export-references-empty' }));
  });
});
