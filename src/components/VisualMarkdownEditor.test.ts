import { describe, expect, it, vi } from 'vitest';
import { equivalentVisualMarkdown, readVisualEditorStateSnapshot } from './VisualMarkdownEditor';

describe('equivalentVisualMarkdown', () => {
  it('treats first-mount line ending and trailing whitespace normalization as equivalent', () => {
    expect(equivalentVisualMarkdown('---\ntitle: Demo\n---\n# Title  \n', '---\r\ntitle: Demo\r\n---\r\n# Title\n')).toBe(true);
  });

  it('does not hide meaningful content changes', () => {
    expect(equivalentVisualMarkdown('# Title\n\nA', '# Title\n\nB')).toBe(false);
  });
});

describe('readVisualEditorStateSnapshot', () => {
  it('returns the React source markdown without serializing when visual and metadata state are clean', () => {
    const flushPendingMetadataEdits = vi.fn(() => false);
    const readFullMarkdown = vi.fn(() => '# Serialized\n');

    expect(readVisualEditorStateSnapshot({
      visualContentMutated: false,
      sourceMarkdown: '# Source\n',
      lastEmittedMarkdown: '# Source\n',
      flushPendingMetadataEdits,
      readFullMarkdown,
      markCommitted: vi.fn(),
    })).toEqual({
      surface: 'visual',
      markdown: '# Source\n',
      changed: false,
    });
    expect(flushPendingMetadataEdits).toHaveBeenCalledTimes(1);
    expect(readFullMarkdown).not.toHaveBeenCalled();
  });

  it('serializes the full editor when metadata node views flush pending textarea edits', () => {
    const markCommitted = vi.fn();
    const result = readVisualEditorStateSnapshot({
      visualContentMutated: false,
      sourceMarkdown: '<!-- scie_md:note id="n1": Old note. -->',
      lastEmittedMarkdown: '<!-- scie_md:note id="n1": Old note. -->',
      flushPendingMetadataEdits: vi.fn(() => true),
      readFullMarkdown: vi.fn(() => '<!-- scie_md:note id="n1": Pending note. -->'),
      markCommitted,
    });

    expect(result).toMatchObject({
      surface: 'visual',
      markdown: '<!-- scie_md:note id="n1": Pending note. -->',
      changed: true,
    });
    expect(result?.markCommitted).toEqual(expect.any(Function));

    result?.markCommitted?.();
    expect(markCommitted).toHaveBeenCalledWith('<!-- scie_md:note id="n1": Pending note. -->');
  });

  it('does not mark committed when the serialized editor remains equivalent', () => {
    const markCommitted = vi.fn();
    const result = readVisualEditorStateSnapshot({
      visualContentMutated: false,
      sourceMarkdown: '# Source\n',
      lastEmittedMarkdown: '# Source\n',
      flushPendingMetadataEdits: vi.fn(() => true),
      readFullMarkdown: vi.fn(() => '# Source  \n'),
      markCommitted,
    });

    expect(result).toMatchObject({
      surface: 'visual',
      markdown: '# Source  \n',
      changed: false,
    });
    expect(result?.markCommitted).toBeUndefined();
  });
});
