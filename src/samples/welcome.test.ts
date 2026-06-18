import { describe, expect, it } from 'vitest';
import { parseScienfyDocument } from '../domain/document/documentModel';
import { parseEditorComments } from '../markdown/editorComments';
import { validateMarkdown } from '../markdown/markdownValidation';
import welcomeMarkdown from './welcome.md?raw';

describe('welcome tutorial sample', () => {
  it('opens in visual mode and exercises ScieMD tutorial features without parser side effects', () => {
    const parsed = parseScienfyDocument(welcomeMarkdown);
    const validation = validateMarkdown(welcomeMarkdown, new TextEncoder().encode(welcomeMarkdown).length, parsed);

    expect(validation.sourceOnly).toBe(false);
    expect(parsed.title).toBe('ScieMD Tutorial');
    expect(parsed.directives.length).toBeGreaterThan(0);
    expect(parsed.variables.definitions.map((definition) => definition.name)).toEqual(
      expect.arrayContaining(['sample_count', 'throughput_gain', 'hands_on_reduction', 'p_value', 'target_humidity']),
    );
    expect(parsed.variantGroups).toHaveLength(1);
    expect(parsed.variantGroups[0]).toMatchObject({ id: 'abstract-claim', active: 'balanced' });
    expect(parsed.variantGroups[0].items.map((item) => item.id)).toEqual(
      expect.arrayContaining(['original', 'balanced', 'cautious']),
    );
    const comments = parseEditorComments(welcomeMarkdown);
    expect(comments).toHaveLength(2);
    expect(comments.find((comment) => comment.id === 'llm-quick-abstract')).toMatchObject({
      audience: 'llm',
      body: 'Revise this abstract candidate for a journal audience. Preserve the variables, keep the claim cautious, and create text versions if there are two strong options.',
    });
    expect(comments.find((comment) => comment.id === 'human-quick-abstract')).toMatchObject({
      audience: 'human',
      sourceNoteId: 'llm-quick-abstract',
    });
    expect(welcomeMarkdown).toContain('hybrid manuscript work');
    expect(welcomeMarkdown).toContain('document-first');
    expect(welcomeMarkdown).toContain('Note to LLM');
    expect(welcomeMarkdown).toContain('Note to Human');
    expect(welcomeMarkdown).toContain('Text versions');
    expect(welcomeMarkdown).toContain('Variables are the paper equivalent of named constants in code');
    expect(welcomeMarkdown).toContain('Lock text that should not move');
    expect(welcomeMarkdown).toContain('Use blocks to make the paper skimmable');
    expect(welcomeMarkdown).toContain('Save this tutorial as your own `.md` file');
    expect(welcomeMarkdown).toContain('{{ sample_count }} linked SEM-image and process-metadata records');
    expect(welcomeMarkdown).toContain('p = {{ p_value }}');
  });
});
