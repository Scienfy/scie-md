import { describe, expect, it } from 'vitest';
import { compileMarkdownForOutput, prepareMarkdownForHtmlExport, prepareMarkdownForLlm, prepareMarkdownForPandocExport } from './outputPipeline';

describe('outputPipeline', () => {
  it('substitutes variables and compiles active variants for final output', () => {
    const markdown = [
      'Result p = {{ p_value }}.',
      '',
      '<!-- scie_md:variant:group id="abstract" active="v2" -->',
      '<!-- scie_md:variant:item id="v1" name="Original" -->',
      'Original abstract.',
      '<!-- scie_md:variant:item id="v2" name="Short" -->',
      'Short abstract with {{ p_value }}.',
      '<!-- scie_md:variant:end -->',
    ].join('\n');

    const output = compileMarkdownForOutput(markdown, [
      { name: 'p_value', value: '0.051', source: 'external', file: 'results.json' },
    ]);

    expect(output).toContain('Result p = 0.051.');
    expect(output).toContain('Short abstract with 0.051.');
    expect(output).not.toContain('Original abstract.');
    expect(output).not.toContain('scie_md:variant');
  });

  it('keeps operational comments in LLM packets but removes them from final exports', () => {
    const markdown = [
      '<!-- scie_md:instruction target="next-block" prompt="Tighten." -->',
      '<!-- scie_md:lock:start reason="approved" -->',
      'Approved sentence with {{ value }}.',
      '<!-- scie_md:lock:end -->',
      '<!-- scie_md:lock id="lock-1" target="quote" quote="Approved sentence" reason="approved" -->',
      '<!-- scie_md:comment audience="llm": Check this claim. -->',
      '<!-- scie_md:note id="human-1" kind="human" target="cursor": Human review note. -->',
    ].join('\n');
    const variables = [{ name: 'value', value: '42', source: 'frontmatter' as const }];

    const llm = prepareMarkdownForLlm(markdown, variables);
    expect(llm).toContain('scie_md:instruction');
    expect(llm).toContain('scie_md:lock:start');
    expect(llm).toContain('scie_md:lock id="lock-1"');
    expect(llm).toContain('Approved sentence with {{ value }}.');

    const pandoc = prepareMarkdownForPandocExport(markdown, variables);
    expect(pandoc).toContain('Approved sentence with 42.');
    expect(pandoc).not.toContain('scie_md:instruction');
    expect(pandoc).not.toContain('scie_md:comment');
    expect(pandoc).not.toContain('scie_md:note');
    expect(pandoc).not.toContain('scie_md:lock');

    expect(prepareMarkdownForHtmlExport(markdown, variables)).toBe(pandoc);
  });

  it('preserves variant metadata for LLM packets so external edits do not destroy draft history', () => {
    const markdown = [
      '<!-- scie_md:variant:group id="abstract" active="v2" -->',
      '<!-- scie_md:variant:item id="v1" name="Original" -->',
      'Original abstract with {{ value }}.',
      '<!-- scie_md:variant:item id="v2" name="Short" -->',
      'Short abstract with {{ value }}.',
      '<!-- scie_md:variant:end -->',
    ].join('\n');

    const llm = prepareMarkdownForLlm(markdown, [{ name: 'value', value: '42', source: 'frontmatter' }]);
    expect(llm).toContain('scie_md:variant:group');
    expect(llm).toContain('Original abstract with {{ value }}.');
    expect(llm).toContain('Short abstract with {{ value }}.');
  });

  it('preserves variable tokens in LLM packets so external edits do not hard-code data bindings', () => {
    const markdown = 'The measured temperature was {{reactor_temp}}.';

    expect(prepareMarkdownForLlm(markdown, [
      { name: 'reactor_temp', value: '405.2', source: 'external', file: 'results.json' },
    ])).toBe(markdown);
  });

  it('does not strip ScieMD examples inside fenced code during final export preparation', () => {
    const markdown = [
      '```markdown',
      '<!-- scie_md:instruction target="next-block" prompt="Example only." -->',
      '```',
      '<!-- scie_md:instruction target="next-block" prompt="Real instruction." -->',
    ].join('\n');

    const output = prepareMarkdownForPandocExport(markdown);
    expect(output).toContain('Example only.');
    expect(output).not.toContain('Real instruction.');
  });

  it('converts pagebreak directives for Pandoc without touching fenced examples', () => {
    const markdown = [
      'Before',
      '',
      ':::pagebreak',
      ':::',
      '',
      '```markdown',
      ':::pagebreak',
      ':::',
      '```',
    ].join('\n');

    const output = prepareMarkdownForPandocExport(markdown);
    expect(output).toContain('Before\n\n\\newpage');
    expect(output).toContain('```markdown\n:::pagebreak\n:::');
  });

  it('escapes variable values before final export rendering', () => {
    const output = compileMarkdownForOutput('Result: {{ value }}.', [
      { name: 'value', value: '<script>alert(1)</script> ![x](file:///secret.png)', source: 'external' },
    ]);

    expect(output).toContain('&lt;script&gt;alert\\(1\\)&lt;/script&gt;');
    expect(output).toContain('\\!\\[x\\]\\(file:///secret.png\\)');
  });
});
