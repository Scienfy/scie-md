import { describe, expect, it } from 'vitest';
import {
  buildNormalizedMarkdownTextIndex,
  createQuoteAnchorSelector,
  findQuoteSelectorRangeInTextIndex,
} from './quoteAnchors';

describe('quoteAnchors', () => {
  it('uses prefix and suffix context to choose the intended duplicate quote', () => {
    const markdown = 'Alpha repeated sentence one. Beta repeated sentence two.';
    const index = buildNormalizedMarkdownTextIndex(markdown);

    const match = findQuoteSelectorRangeInTextIndex(index, {
      quote: 'repeated sentence',
      prefix: 'Beta',
      suffix: 'two',
    });

    expect(match).not.toBeNull();
    expect(markdown.slice(match?.from ?? 0, match?.to ?? 0)).toBe('repeated sentence');
    expect(markdown.slice(0, match?.from ?? 0)).toContain('Beta ');
  });

  it('derives compact context from the selected occurrence near the source line', () => {
    const markdown = [
      'Alpha repeated sentence one.',
      'Beta repeated sentence two.',
    ].join('\n');

    const selector = createQuoteAnchorSelector(markdown, 'repeated sentence', { selectionLine: 2 });

    expect(selector).toMatchObject({
      quote: 'repeated sentence',
      prefix: 'sentence one. Beta',
      suffix: 'two.',
    });
  });
});
