import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../document/frontmatter';
import { buildVariableIndex, canonicalizeVariableTokens, extractVariableUsages, parseVariableDataFile, substituteVariables, substituteVariablesWithDefinitions } from './variableIndex';

describe('variableIndex', () => {
  it('extracts template variable usages', () => {
    expect(extractVariableUsages('Project {{ project_name }} uses {{sample.id}}.')).toEqual([
      { name: 'project_name', raw: '{{ project_name }}', line: 1, from: 8, to: 26 },
      { name: 'sample.id', raw: '{{sample.id}}', line: 1, from: 32, to: 45 },
    ]);
  });

  it('canonicalizes escaped visual serializer variable tokens outside ignored ranges', () => {
    const markdown = [
      'Text {{ sample\\_name }} and {{ sample\\.id }}.',
      '',
      '`{{ sample\\_name }}`',
      '',
      '```md',
      '{{ sample\\_name }}',
      '```',
      '',
      '<!-- scie_md:note id="n1" kind="llm" target="next-block": Preserve {{ sample\\_name }}. -->',
    ].join('\n');

    const canonical = canonicalizeVariableTokens(markdown);

    expect(canonical).toContain('Text {{ sample_name }} and {{ sample.id }}.');
    expect(canonical).toContain('`{{ sample\\_name }}`');
    expect(canonical).toContain('```md\n{{ sample\\_name }}\n```');
    expect(canonical).toContain('Preserve {{ sample\\_name }}.');
  });

  it('matches usages to front matter variable definitions', () => {
    const markdown = [
      '---',
      'variables:',
      '  project_name: SynExer',
      'scienfy:',
      '  variables:',
      '    sample_count: 12',
      '---',
      'Project {{ project_name }} has {{ sample_count }} samples and {{ missing }}.',
    ].join('\n');

    expect(buildVariableIndex(markdown, parseFrontmatter(markdown))).toMatchObject({
      definitions: [
        { name: 'project_name', value: 'SynExer', source: 'frontmatter' },
        { name: 'sample_count', value: '12', source: 'scie_md' },
      ],
      missingVariables: ['missing'],
    });
  });

  it('substitutes defined variables in body output while preserving front matter definitions', () => {
    const markdown = [
      '---',
      'variables:',
      '  p_value: 0.023',
      'scienfy:',
      '  variables:',
      '    sample_count: 12',
      '---',
      'The result was {{ p_value }} across {{ sample_count }} samples and {{ missing }}.',
    ].join('\n');

    expect(substituteVariables(markdown)).toContain('The result was 0.023 across 12 samples and {{ missing }}.');
    expect(substituteVariables(markdown)).toContain('p_value: 0.023');
  });

  it('does not substitute variables inside code or ScieMD operational comments', () => {
    const markdown = [
      '---',
      'variables:',
      '  p_value: 0.023',
      '---',
      'Text {{ p_value }}.',
      '',
      '`{{ p_value }}`',
      '',
      '```python',
      'print("{{ p_value }}")',
      '```',
      '',
      '<!-- scie_md:comment audience="llm": Explain {{ p_value }} later. -->',
    ].join('\n');

    const substituted = substituteVariables(markdown);

    expect(substituted).toContain('Text 0.023.');
    expect(substituted).toContain('`{{ p_value }}`');
    expect(substituted).toContain('print("{{ p_value }}")');
    expect(substituted).toContain('Explain {{ p_value }} later.');
    expect(extractVariableUsages(markdown)).toEqual([expect.objectContaining({ name: 'p_value', raw: '{{ p_value }}', line: 5 })]);
  });

  it('records full-document source offsets for front matter documents', () => {
    const markdown = [
      '---',
      'variables:',
      '  sample_count: 12',
      '---',
      'Value {{ sample_count }}.',
    ].join('\n');

    const usage = buildVariableIndex(markdown, parseFrontmatter(markdown)).usages[0];
    expect(usage).toMatchObject({
      name: 'sample_count',
      raw: '{{ sample_count }}',
      line: 5,
      from: markdown.indexOf('{{ sample_count }}'),
      to: markdown.indexOf('{{ sample_count }}') + '{{ sample_count }}'.length,
    });
  });

  it('parses JSON and CSV variable data files', () => {
    expect(parseVariableDataFile('{"exp1":{"p_value":0.023},"sample_count":12}', 'results.json')).toEqual([
      { name: 'exp1.p_value', value: '0.023', source: 'external', file: 'results.json' },
      { name: 'sample_count', value: '12', source: 'external', file: 'results.json' },
    ]);

    expect(parseVariableDataFile('name,value\np_value,0.051\nsample_count,18\n', 'results.csv')).toEqual([
      { name: 'p_value', value: '0.051', source: 'external', file: 'results.csv' },
      { name: 'sample_count', value: '18', source: 'external', file: 'results.csv' },
    ]);
  });

  it('substitutes using external definitions supplied by the output pipeline', () => {
    expect(substituteVariablesWithDefinitions('Result p = {{ p_value }}.', [
      { name: 'p_value', value: '0.051', source: 'external', file: 'results.json' },
    ])).toBe('Result p = 0.051.');
  });
});
