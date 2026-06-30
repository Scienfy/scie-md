import { describe, expect, it } from 'vitest';
import { createSemanticBlockMarkdown } from './semanticBlocks';

describe('createSemanticBlockMarkdown', () => {
  it('creates a semantic callout block with supplied body', () => {
    expect(createSemanticBlockMarkdown('callout', { body: 'Selected text.' })).toBe(':::callout\nSelected text.\n:::\n\n');
  });

  it('creates a labeled figure block with a default body', () => {
    expect(createSemanticBlockMarkdown('figure', { figureLabel: 'fig-1' })).toContain(':::figure {#fig-1}');
    expect(createSemanticBlockMarkdown('figure', { figureLabel: 'fig-1' })).toContain('![Figure alt text](assets/figure.png)');
  });
});
