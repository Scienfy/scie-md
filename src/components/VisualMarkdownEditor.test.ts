import { describe, expect, it } from 'vitest';
import { equivalentVisualMarkdown } from './VisualMarkdownEditor';

describe('equivalentVisualMarkdown', () => {
  it('treats first-mount line ending and trailing whitespace normalization as equivalent', () => {
    expect(equivalentVisualMarkdown('---\ntitle: Demo\n---\n# Title  \n', '---\r\ntitle: Demo\r\n---\r\n# Title\n')).toBe(true);
  });

  it('does not hide meaningful content changes', () => {
    expect(equivalentVisualMarkdown('# Title\n\nA', '# Title\n\nB')).toBe(false);
  });
});
