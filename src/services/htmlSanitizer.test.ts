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

  it('keeps only the grant-checked app image protocol used by the visual editor', () => {
    const sanitized = sanitizeHtmlFragment([
      '<img src="asset://localhost/C:/paper/assets/figure.png" alt="Figure">',
      '<img src="scie-md-local-image://localhost/QzpcUGFwZXJcYXNzZXRzXGZpZ3VyZS5wbmc" alt="Local figure">',
    ].join(''));

    expect(sanitized).not.toContain('asset://localhost/C:/paper/assets/figure.png');
    expect(sanitized).toContain('scie-md-local-image://localhost/QzpcUGFwZXJcYXNzZXRzXGZpZ3VyZS5wbmc');
  });

  it('keeps export issue attributes without reopening arbitrary data attributes', () => {
    const sanitized = sanitizeHtmlFragment([
      '<img',
      ' src="https://example.test/figure.png"',
      ' alt="Remote"',
      ' data-scie-md-export-issue="remote-image-kept"',
      ' data-scie-md-export-source="https://example.test/figure.png"',
      ' data-scie-md-export-message="Remote image kept"',
      ' data-user-token="secret"',
      '>',
    ].join(''));

    expect(sanitized).toContain('data-scie-md-export-issue="remote-image-kept"');
    expect(sanitized).toContain('data-scie-md-export-source="https://example.test/figure.png"');
    expect(sanitized).toContain('data-scie-md-export-message="Remote image kept"');
    expect(sanitized).not.toContain('data-user-token');
  });

  it('keeps KaTeX-style math spans and safe inline SVG', () => {
    const sanitized = sanitizeHtmlFragment([
      '<span class="katex"><span class="mord mathnormal">x</span></span>',
      '<svg viewBox="0 0 12 12" aria-label="Trend"><path d="M1 10L11 2"></path></svg>',
    ].join(''));

    expect(sanitized).toContain('class="katex"');
    expect(sanitized).toContain('mathnormal');
    expect(sanitized).toContain('<svg');
    expect(sanitized).toContain('<path d="M1 10L11 2"></path>');
  });
});
