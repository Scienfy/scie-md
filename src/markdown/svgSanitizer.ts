export interface SanitizedSvgResult {
  svg: string | null;
  warnings: string[];
}

const MAX_SVG_SOURCE_CHARS = 2_000_000;
const svgNamespace = 'http://www.w3.org/2000/svg';

const allowedElements = new Set([
  'svg',
  'g',
  'use',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'defs',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
  'pattern',
  'marker',
  'title',
  'desc',
]);

const bannedElements = new Set([
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'canvas',
  'link',
  'meta',
  'style',
  'animate',
  'animatetransform',
  'animatemotion',
  'set',
]);

const urlAttributeNames = new Set([
  'href',
  'xlink:href',
  'src',
  'data',
  'poster',
  'filter',
  'clip-path',
  'mask',
  'marker-start',
  'marker-mid',
  'marker-end',
]);

const safeStyleProperties = new Set([
  'baseline-shift',
  'clip-rule',
  'color',
  'display',
  'dominant-baseline',
  'fill',
  'fill-opacity',
  'fill-rule',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'marker-end',
  'marker-mid',
  'marker-start',
  'opacity',
  'paint-order',
  'pointer-events',
  'shape-rendering',
  'stop-color',
  'stop-opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'text-anchor',
  'vector-effect',
  'visibility',
]);

export function sanitizeSvg(svgSource: string): SanitizedSvgResult {
  const warnings: string[] = [];
  const source = svgSource.trim();
  if (!source) return { svg: null, warnings: ['SVG source is empty.'] };
  if (source.length > MAX_SVG_SOURCE_CHARS) {
    return { svg: null, warnings: ['SVG exceeds the 2 MB inline rendering limit.'] };
  }
  if (hasSvgDoctypeOrEntity(source)) {
    return { svg: null, warnings: ['SVG DOCTYPE and entity declarations are not allowed.'] };
  }
  if (!/<svg[\s>]/i.test(source)) return { svg: null, warnings: ['SVG source must contain an <svg> root.'] };

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(source, 'image/svg+xml');
  if (documentNode.querySelector('parsererror')) {
    return { svg: null, warnings: ['SVG could not be parsed.'] };
  }

  const root = documentNode.documentElement;
  if (!root || root.localName.toLowerCase() !== 'svg') {
    return { svg: null, warnings: ['SVG source must start with an <svg> root.'] };
  }

  sanitizeElement(root, warnings);
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', svgNamespace);
  root.setAttribute('role', root.getAttribute('role') || 'img');
  ensureAccessibleTitle(documentNode, root);
  return { svg: new XMLSerializer().serializeToString(root), warnings };
}

export function optimizeSvgSource(svgSource: string): string {
  const source = svgSource.trim();
  if (!source || source.length > MAX_SVG_SOURCE_CHARS || !/<svg[\s>]/i.test(source)) return svgSource;
  if (hasSvgDoctypeOrEntity(source)) return svgSource;
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(source, 'image/svg+xml');
  if (documentNode.querySelector('parsererror')) return svgSource;
  removeComments(documentNode);
  for (const element of Array.from(documentNode.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('inkscape:') || name.startsWith('sodipodi:') || name === 'xmlns:inkscape' || name === 'xmlns:sodipodi') {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return new XMLSerializer().serializeToString(documentNode.documentElement).trim();
}

function hasSvgDoctypeOrEntity(source: string): boolean {
  return /<!DOCTYPE\b|<!ENTITY\b/i.test(source);
}

function sanitizeElement(element: Element, warnings: string[]): boolean {
  const name = element.localName.toLowerCase();
  if (bannedElements.has(name) || !allowedElements.has(name)) {
    warnings.push(`Removed unsupported SVG element <${name}>.`);
    element.remove();
    return false;
  }

  for (const child of Array.from(element.children)) {
    sanitizeElement(child, warnings);
  }

  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value.trim();
    if (name === 'style') {
      const sanitizedStyle = sanitizeStyleAttribute(value, warnings);
      if (sanitizedStyle) {
        element.setAttribute(attribute.name, sanitizedStyle);
      } else {
        warnings.push(`Removed unsafe SVG attribute ${attribute.name}.`);
        element.removeAttribute(attribute.name);
      }
      continue;
    }
    if (shouldRemoveAttribute(name, value)) {
      warnings.push(`Removed unsafe SVG attribute ${attribute.name}.`);
      element.removeAttribute(attribute.name);
    }
  }
  return true;
}

function shouldRemoveAttribute(name: string, value: string): boolean {
  if (name.startsWith('on')) return true;
  if (name === 'xmlns' || name === 'viewbox' || name === 'role' || name === 'aria-label') return false;
  if (name.startsWith('aria-')) return false;
  if (name.startsWith('data-')) return true;
  if (urlAttributeNames.has(name)) return isUnsafeUrlAttribute(name, value);
  if (/url\s*\(/i.test(value) && !/url\s*\(\s*#[-_a-z0-9:.]+\s*\)/i.test(value)) return true;
  if (/javascript:|vbscript:|data:|file:|https?:|\/\/|@import|expression\s*\(/i.test(value)) return true;
  return false;
}

function sanitizeStyleAttribute(value: string, warnings: string[]): string | null {
  const declarations: string[] = [];
  for (const rawDeclaration of value.split(';')) {
    const declaration = rawDeclaration.trim();
    if (!declaration) continue;
    const separator = declaration.indexOf(':');
    if (separator <= 0) {
      warnings.push('Removed malformed SVG style declaration.');
      continue;
    }
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const propertyValue = declaration.slice(separator + 1).trim();
    if (!safeStyleProperties.has(property) || isUnsafeStyleValue(propertyValue)) {
      warnings.push(`Removed unsafe SVG style declaration ${property}.`);
      continue;
    }
    declarations.push(`${property}: ${propertyValue}`);
  }
  return declarations.length > 0 ? declarations.join('; ') : null;
}

function isUnsafeStyleValue(value: string): boolean {
  if (/[<>{}]/.test(value)) return true;
  if (/javascript:|vbscript:|data:|file:|https?:|\/\/|@import|expression\s*\(/i.test(value)) return true;
  return hasUnsafeCssUrl(value);
}

function hasUnsafeCssUrl(value: string): boolean {
  const urlPattern = /url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let match: RegExpExecArray | null;
  let inspected = value;
  while ((match = urlPattern.exec(value))) {
    const target = match[2].trim();
    if (!isSafeInternalSvgUrlTarget(target)) return true;
    inspected = inspected.replace(match[0], '');
  }
  return /url\s*\(/i.test(inspected);
}

function isSafeInternalSvgUrlTarget(value: string): boolean {
  return /^#[-_a-z0-9:.]+$/i.test(value);
}

function isUnsafeUrlAttribute(name: string, value: string): boolean {
  if (!value) return false;
  if ((name === 'href' || name === 'xlink:href') && value.startsWith('#')) return false;
  if (/^url\s*\(\s*#[-_a-z0-9:.]+\s*\)$/i.test(value)) return false;
  if (value.startsWith('#') && !['src', 'data', 'poster'].includes(name)) return false;
  return true;
}

function ensureAccessibleTitle(documentNode: Document, root: Element): void {
  if (root.querySelector('title')) return;
  const label = root.getAttribute('aria-label')?.trim()
    || root.querySelector('text')?.textContent?.replace(/\s+/g, ' ').trim()
    || 'SVG figure';
  const title = documentNode.createElementNS(svgNamespace, 'title');
  title.textContent = label;
  root.insertBefore(title, root.firstChild);
}

function removeComments(node: Node): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.COMMENT_NODE) {
      child.parentNode?.removeChild(child);
    } else {
      removeComments(child);
    }
  }
}
