import { describe, expect, it } from 'vitest';
import { createLlmClipboardPayload, createLlmStyleGuide, createScieMDLlmSkill } from './llm';

describe('createLlmClipboardPayload', () => {
  it('adds editing instructions before the document', () => {
    const payload = createLlmClipboardPayload('# Title', 'doc.md');

    expect(payload).toContain('ScieMD document');
    expect(payload).toContain('Format Contract');
    expect(payload).toContain('Document: doc.md');
    expect(payload.endsWith('# Title')).toBe(true);
  });

  it('supports task-specific prompt modes', () => {
    expect(createLlmClipboardPayload('# Title', 'doc.md', 'summarize')).toContain('executive summary');
    expect(createLlmClipboardPayload('# Title', 'doc.md', 'expand')).toContain('Expand the draft');
  });

  it('includes labels and citations in the editing context', () => {
    const payload = createLlmClipboardPayload('See @fig-a and [@smith2026].\n\n![A](a.png){#fig-a}', 'doc.md');

    expect(payload).toContain('Reference labels: fig-a');
    expect(payload).toContain('Citation keys: smith2026');
  });

  it('preserves variable tokens in source while listing evaluated values in context', () => {
    const payload = createLlmClipboardPayload('Temperature was {{reactor_temp}}.', 'doc.md', 'style-guide', {
      variableDefinitions: [
        { name: 'reactor_temp', value: '405.2', source: 'external', file: 'results.json' },
      ],
    });

    expect(payload).toContain('Preserve dynamic variable tokens');
    expect(payload).toContain('Dynamic variables: reactor_temp = 405.2 (results.json)');
    expect(payload.endsWith('Temperature was {{reactor_temp}}.')).toBe(true);
    expect(payload).not.toContain('Temperature was 405.2.');
  });

  it('can scope the LLM packet to selected markdown', () => {
    const payload = createLlmClipboardPayload('# Title\n\nKeep\n\nEdit this paragraph.', 'doc.md', 'expand', {
      selection: 'Edit this paragraph.',
    });

    expect(payload).toContain('Scope: selected text only');
    expect(payload).toContain('## Selected Markdown');
    expect(payload.endsWith('Edit this paragraph.')).toBe(true);
    expect(payload).not.toContain('\nKeep\n');
  });

  it('summarizes protected regions, notes, targeted instructions, and variants', () => {
    const payload = createLlmClipboardPayload([
      '---',
      'title: Trial',
      'scienfy:',
      '  documentType: paper',
      '---',
      '',
      '# Trial',
      '',
      '<!-- scie_md:lock:start reason="approved" -->',
      'Approved wording.',
      '<!-- scie_md:lock:end -->',
      '',
      '<!-- scie_md:lock target="quote" quote="Measured endpoint" prefix="The " suffix=" remained stable" -->',
      'The Measured endpoint remained stable.',
      '',
      '<!-- scie_md:note id="llm-1" kind="llm" target="quote" quote="Target sentence": Tighten this. -->',
      'Target sentence.',
      '',
      '<!-- scie_md:note id="human-1" kind="human" source="llm-1" target="cursor": Review the tightened sentence. -->',
      '<!-- scie_md:instruction target="next-block" prompt="Make the finding more direct." -->',
      'Finding is promising.',
      '',
      '<!-- scie_md:variant:group id="claim-tone" active="v2" -->',
      '<!-- scie_md:variant:item id="v1" name="Original" -->',
      'This improves performance.',
      '<!-- scie_md:variant:item id="v2" name="Cautious" -->',
      'This is consistent with improved performance.',
      '<!-- scie_md:variant:end -->',
    ].join('\n'), 'trial.md', 'style-guide');

    expect(payload).toContain('Title: Trial');
    expect(payload).toContain('ScieMD document type: paper');
    expect(payload).toContain('Protected sections: Locked section');
    expect(payload).toContain('approved');
    expect(payload).toContain('Protected quotes: Locked quote');
    expect(payload).toContain('Measured endpoint');
    expect(payload).toContain('Notes to LLM: id llm-1');
    expect(payload).toContain('quote "Target sentence"');
    expect(payload).toContain('Notes to Human: id human-1');
    expect(payload).toContain('source llm-1');
    expect(payload).toContain('Targeted instructions: line');
    expect(payload).toContain('next-block: Make the finding more direct.');
    expect(payload).toContain('Variant groups: claim-tone: active v2 of 2');
  });

  it('generates a reusable external LLM style guide', () => {
    expect(createLlmStyleGuide()).toContain('ScieMD Markdown Style Guide');
    expect(createLlmStyleGuide()).toContain('Allowed directive names');
    expect(createLlmStyleGuide()).toContain('Preserve optional quote selector context');
    expect(createLlmStyleGuide()).not.toContain('* Keep the file as readable Markdown.');
  });

  it('generates complete ScieMD LLM skill instructions for external LLMs', () => {
    const skill = createScieMDLlmSkill();

    expect(skill).toContain('name: sciemd-authoring');
    expect(skill).toContain('# ScieMD LLM Skill');
    expect(skill).toContain('Dynamic Variables');
    expect(skill).toContain('Actively look for variable opportunities during every edit');
    expect(skill).toContain('If no front matter exists and a variable is clearly useful');
    expect(skill).toContain('Variable upgrade example');
    expect(skill).toContain('Set it to `XXX`, use the token in the prose');
    expect(skill).toContain('target_humidity: XXX');
    expect(skill).toContain('Locked Sections');
    expect(skill).toContain('LLM Notes');
    expect(skill).toContain('Find every `scie_md:note` with `kind="llm"`');
    expect(skill).toContain('source` equal to the completed LLM note id');
    expect(skill).toContain('Do not treat Note to Human as another edit request');
    expect(skill).toContain('LLM Instructions');
    expect(skill).toContain('Text Versions');
    expect(skill).toContain('Actively consider text versions');
    expect(skill).toContain('Anchored sentence-level version example');
    expect(skill).toContain('Block-level version example');
    expect(skill).toContain('keep the original wording as version 1');
    expect(skill).toContain('Before editing each target, choose the editing strategy');
    expect(skill).toContain('Mention any variables or text versions you added');
    expect(skill).toContain('Semantic Blocks');
    expect(skill).toContain('Conflict Markers');
    expect(skill).toContain('<<<<<<< ScieMD local edits');
    expect(skill).toContain('>>>>>>> Disk changes');
    expect(skill).toContain('resolve them before finalizing');
    expect(skill).toContain('Verify no `<<<<<<<`, `=======`, or `>>>>>>>` conflict markers remain');
    expect(skill).toContain('Do not replace dynamic variable tokens');
    expect(skill).toContain(':::references');
    expect(skill).toContain('- Return valid Markdown unless the user explicitly asks for another format.');
    expect(skill).not.toContain('* Return valid Markdown unless the user explicitly asks for another format.');
  });
});
