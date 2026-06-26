import { describe, expect, it } from 'vitest';
import { optimizeSvgSource, sanitizeSvg } from './svgSanitizer';

describe('svgSanitizer', () => {
  it('keeps safe geometry and text', () => {
    const result = sanitizeSvg('<svg viewBox="0 0 100 50"><rect width="100" height="50"/><text x="4" y="20">n=42</text></svg>');

    expect(result.svg).toContain('<rect');
    expect(result.svg).toContain('<text');
    expect(result.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(result.svg).toContain('<title');
    expect(result.svg).toContain('>n=42</title>');
    expect(result.warnings).toHaveLength(0);
  });

  it('removes scripts, event handlers, foreignObject, and external resources', () => {
    const result = sanitizeSvg([
      '<svg viewBox="0 0 100 50" onload="alert(1)">',
      '<script>alert(1)</script>',
      '<foreignObject><body>unsafe</body></foreignObject>',
      '<image href="https://example.com/a.png" />',
      '<rect fill="url(https://example.com/x)" onclick="steal()" />',
      '<circle fill="url(#safe)" />',
      '</svg>',
    ].join(''));

    expect(result.svg).not.toContain('<script');
    expect(result.svg).not.toContain('foreignObject');
    expect(result.svg).not.toContain('onload');
    expect(result.svg).not.toContain('onclick');
    expect(result.svg).not.toContain('https://example.com');
    expect(result.svg).toContain('url(#safe)');
    expect(result.warnings.length).toBeGreaterThanOrEqual(4);
  });

  it('allows internal use references but removes external use references', () => {
    const result = sanitizeSvg([
      '<svg viewBox="0 0 40 20">',
      '<defs><circle id="dot" cx="5" cy="5" r="4"/></defs>',
      '<use href="#dot" x="4"/>',
      '<use href="external.svg#payload" x="20"/>',
      '</svg>',
    ].join(''));

    expect(result.svg).toContain('<use href="#dot"');
    expect(result.svg).not.toContain('external.svg');
    expect(result.warnings.some((warning) => warning.includes('href'))).toBe(true);
  });

  it('keeps safe inline style declarations while removing unsafe CSS', () => {
    const result = sanitizeSvg('<svg viewBox="0 0 20 20"><rect width="20" height="20" style="fill: red; background: url(https://example.com/x)"/></svg>');

    expect(result.svg).toContain('<rect');
    expect(result.svg).toContain('style="fill: red"');
    expect(result.svg).not.toContain('background');
    expect(result.svg).not.toContain('https://example.com');
  });

  it('allows scientific SVG style attributes with internal paint references', () => {
    const result = sanitizeSvg([
      '<svg viewBox="0 0 20 20">',
      '<defs><linearGradient id="g"><stop offset="0" style="stop-color:#fff;stop-opacity:1"/></linearGradient></defs>',
      '<path d="M0 0L20 20" style="fill:none;stroke:url(#g);stroke-width:2;stroke-linecap:round"/>',
      '</svg>',
    ].join(''));

    expect(result.svg).toContain('stop-color: #fff');
    expect(result.svg).toContain('stroke: url(#g)');
    expect(result.svg).toContain('stroke-width: 2');
    expect(result.warnings).toHaveLength(0);
  });

  it('rejects very large SVG sources before parsing', () => {
    const result = sanitizeSvg(`<svg>${' '.repeat(2_000_001)}</svg>`);

    expect(result.svg).toBeNull();
    expect(result.warnings[0]).toContain('2 MB');
  });

  it('rejects malformed or non-svg input', () => {
    expect(sanitizeSvg('<div>not svg</div>').svg).toBeNull();
    expect(sanitizeSvg('<svg><g></svg>').svg).toBeNull();
  });

  it('rejects SVG doctype and entity declarations before parsing', () => {
    const result = sanitizeSvg('<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg><text>&xxe;</text></svg>');

    expect(result.svg).toBeNull();
    expect(result.warnings[0]).toContain('DOCTYPE');
  });

  it('removes common Inkscape metadata bloat from round-tripped SVG source', () => {
    const optimized = optimizeSvgSource([
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" inkscape:version="1.3" sodipodi:docname="figure.svg">',
      '<!-- editor comment -->',
      '<g inkscape:label="Layer 1"><rect width="10" height="10"/></g>',
      '</svg>',
    ].join(''));

    expect(optimized).toContain('<rect');
    expect(optimized).not.toContain('inkscape:');
    expect(optimized).not.toContain('sodipodi:');
    expect(optimized).not.toContain('editor comment');
  });

  it('keeps a representative tutorial workflow SVG visible after sanitization', () => {
    const result = sanitizeSvg([
      '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="260" viewBox="0 0 900 260" role="img" aria-label="SVG workflow in ScieMD">',
      '<rect x="40" y="42" width="230" height="140" rx="18" fill="#eef4ff" stroke="#7892e8" stroke-width="2"/>',
      '<text x="155" y="77" text-anchor="middle">Markdown source</text>',
      '<text x="455" y="68" text-anchor="middle">Visual figure</text>',
      '<text x="750" y="77" text-anchor="middle">Inkscape</text>',
      '</svg>',
    ].join(''));

    expect(result.svg).toContain('width="900"');
    expect(result.svg).toContain('Markdown source');
    expect(result.svg).toContain('Visual figure');
    expect(result.svg).toContain('Inkscape');
    expect(result.svg).toContain('<rect');
    expect(result.svg).toContain('<text');
    expect(result.warnings).toHaveLength(0);
  });
});
