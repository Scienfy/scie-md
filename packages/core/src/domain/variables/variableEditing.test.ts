import { describe, expect, it } from 'vitest';
import { createVariableToken, nextVariableName, renameVariableAndUpdateUsages, upsertFrontmatterVariable, upsertScienfyVariablesFile } from './variableEditing';

describe('variableEditing', () => {
  it('adds a front matter variable to a document without front matter', () => {
    expect(upsertFrontmatterVariable('# Title\n\nValue {{ variable_1 }}\n', 'variable_1', 'XXX')).toContain('variables:\n  variable_1: XXX');
  });

  it('allows intentionally blank variable values instead of inventing placeholders', () => {
    expect(upsertFrontmatterVariable('# Title\n\nValue {{ variable_1 }}\n', 'variable_1', '')).toContain('variables:\n  variable_1: ""');
  });

  it('renames variable usages outside code and ScieMD comments', () => {
    const markdown = [
      '---',
      'variables:',
      '  old_name: 1',
      '---',
      'Use {{ old_name }} here.',
      '`{{ old_name }}` stays literal.',
      '<!-- scie_md:comment audience="llm": keep {{ old_name }} -->',
      '',
    ].join('\n');
    const edited = renameVariableAndUpdateUsages(markdown, 'old_name', 'new_name', '2');
    expect(edited).toContain('new_name: "2"');
    expect(edited).toContain('Use {{ new_name }} here.');
    expect(edited).toContain('`{{ old_name }}` stays literal.');
    expect(edited).toContain('keep {{ old_name }}');
  });

  it('generates the next available variable name', () => {
    expect(nextVariableName([
      { name: 'variable_1', value: 'a', source: 'frontmatter' },
      { name: 'variable_2', value: 'b', source: 'frontmatter' },
    ])).toBe('variable_3');
  });

  it('creates canonical variable tokens without insertion spacing', () => {
    expect(createVariableToken('sample_count')).toBe('{{ sample_count }}');
  });

  it('links external variable data files through Scienfy front matter', () => {
    const linked = upsertScienfyVariablesFile('# Title\n\nBody\n', 'results.json');
    expect(linked).toContain('scienfy:');
    expect(linked).toContain('variablesFile:');
    expect(linked).toContain('- results.json');
  });
});
