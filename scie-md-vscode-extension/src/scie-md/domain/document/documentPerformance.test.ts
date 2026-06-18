import { describe, expect, it } from 'vitest';
import { parseScienfyDocumentAsync } from './documentParserWorker';

describe('document parser performance guardrail', () => {
  it('parses a large scientific document without a multi-second regression', async () => {
    const markdown = createLargeScientificMarkdown(900);
    const startedAt = performance.now();
    const parsed = await parseScienfyDocumentAsync(markdown, {
      bibtex: '@article{smith2026,title={Example},author={Smith, Jane},year={2026}}',
      variableDefinitions: [{ name: 'cohort_n', value: '128', source: 'frontmatter' }],
    });
    const durationMs = performance.now() - startedAt;

    expect(parsed.directives.length).toBeGreaterThan(400);
    expect(parsed.citations.usages.length).toBeGreaterThan(800);
    expect(parsed.variables.usages.length).toBeGreaterThan(800);
    expect(durationMs).toBeLessThan(3000);
  });
});

function createLargeScientificMarkdown(sectionCount: number): string {
  const sections: string[] = [
    '---',
    'title: Large parser guardrail',
    'cohort_n: 128',
    '---',
    '',
    '# Large parser guardrail',
  ];
  for (let index = 0; index < sectionCount; index += 1) {
    sections.push(
      `## Section ${index}`,
      `Participants {{ cohort_n }} were analyzed with citation [@smith2026] and figure @fig-${index}.`,
      '',
      `:::figure{#fig-${index} title="Figure ${index}"}`,
      `![Figure ${index}](figures/${index}.png)`,
      ':::',
      '',
    );
  }
  return sections.join('\n');
}
