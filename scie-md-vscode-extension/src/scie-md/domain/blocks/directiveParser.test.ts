import { describe, expect, it } from 'vitest';
import { directiveBody, parseDirectiveBlocks } from './directiveParser';

describe('directiveParser', () => {
  it('parses quoted attributes with spaces and escaped quotes', () => {
    const [directive] = parseDirectiveBlocks(':::figure {#fig-a layout="wide panel" title="alpha \\" beta"}\nBody\n:::');

    expect(directive.label).toBe('fig-a');
    expect(directive.attributes.layout).toBe('wide panel');
    expect(directive.attributes.title).toBe('alpha " beta');
  });

  it('parses compact one-line directives used by the tutorial', () => {
    const [directive] = parseDirectiveBlocks(':::tip {#tip-first-tour} Visual mode renders this as a tip. :::');

    expect(directive).toMatchObject({
      name: 'tip',
      label: 'tip-first-tour',
      line: 1,
      endLine: 1,
      known: true,
    });
    expect(directiveBody(directive.raw)).toBe('Visual mode renders this as a tip.');
  });

  it('does not treat unsupported directive names as known blocks', () => {
    const [directive] = parseDirectiveBlocks(':::aside\n# Unsupported block\n:::');

    expect(directive.known).toBe(false);
  });

  it('does not close a directive on ::: text inside a fenced code block', () => {
    const [directive] = parseDirectiveBlocks([
      ':::note',
      '```markdown',
      ':::',
      '```',
      'Actual note text.',
      ':::',
    ].join('\n'));

    expect(directive.endLine).toBe(6);
    expect(directive.raw).toContain('Actual note text.');
  });
});
