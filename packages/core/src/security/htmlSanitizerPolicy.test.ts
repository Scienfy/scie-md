import { describe, expect, it } from 'vitest';
import { isAllowedHtmlSanitizerUri } from './htmlSanitizerPolicy';

describe('htmlSanitizerPolicy', () => {
  it('allows the active export/editor image URI surface', () => {
    expect(isAllowedHtmlSanitizerUri('https://example.test/figure.png')).toBe(true);
    expect(isAllowedHtmlSanitizerUri('blob:https://example.test/id')).toBe(true);
    expect(isAllowedHtmlSanitizerUri('scie-md-local-image://localhost/QzpcUGFwZXJcYXNzZXRzXGZpZ3VyZS5wbmc')).toBe(true);
    expect(isAllowedHtmlSanitizerUri('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(true);
  });

  it('blocks executable and retired protocol URI surfaces', () => {
    expect(isAllowedHtmlSanitizerUri('javascript:alert(1)')).toBe(false);
    expect(isAllowedHtmlSanitizerUri('vbscript:alert(1)')).toBe(false);
    expect(isAllowedHtmlSanitizerUri('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isAllowedHtmlSanitizerUri('file:///C:/paper/assets/figure.png')).toBe(false);
    expect(isAllowedHtmlSanitizerUri('asset://localhost/C:/paper/assets/figure.png')).toBe(false);
  });
});
