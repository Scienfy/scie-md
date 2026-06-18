import { describe, expect, it } from 'vitest';
import { sanitizeHtmlFragment } from './htmlSanitizer';

describe('sanitizeHtmlFragment', () => {
  it('removes executable HTML and SVG content before live DOM insertion', () => {
    const sanitized = sanitizeHtmlFragment([
      '<p onclick="alert(1)">Text</p>',
      '<svg><script>alert(1)</script><foreignObject><div>bad</div></foreignObject><rect width="10"/></svg>',
      '<img src="javascript:alert(1)" onerror="alert(1)">',
    ].join(''));

    expect(sanitized).toContain('<p>Text</p>');
    expect(sanitized).toContain('<rect width="10"></rect>');
    expect(sanitized).not.toMatch(/onclick|onerror|script|foreignObject|javascript:/i);
  });

  it('keeps app image protocols used by the visual editor', () => {
    const sanitized = sanitizeHtmlFragment('<img src="asset://localhost/C:/paper/assets/figure.png" alt="Figure">');

    expect(sanitized).toContain('asset://localhost/C:/paper/assets/figure.png');
  });
});
