import { describe, expect, it } from 'vitest';
import { toggleMarkdownHeadingSelection } from './headingToggle';

describe('toggleMarkdownHeadingSelection', () => {
  it('converts plain text to the requested heading level', () => {
    expect(toggleMarkdownHeadingSelection('Methods', 1)).toBe('# Methods\n\n');
    expect(toggleMarkdownHeadingSelection('Methods', 2)).toBe('## Methods\n\n');
  });

  it('turns the same heading level back into plain text', () => {
    expect(toggleMarkdownHeadingSelection('# Methods\n', 1)).toBe('Methods\n\n');
    expect(toggleMarkdownHeadingSelection('## Methods ##\n', 2)).toBe('Methods\n\n');
  });

  it('changes a different heading level instead of removing heading formatting', () => {
    expect(toggleMarkdownHeadingSelection('# Methods\n', 2)).toBe('## Methods\n\n');
  });
});
