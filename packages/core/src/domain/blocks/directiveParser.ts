export const KNOWN_DIRECTIVE_NAMES = new Set([
  'figure',
  'result',
  'note',
  'callout',
  'tip',
  'important',
  'warning',
  'references',
]);

export interface DirectiveBlock {
  name: string;
  line: number;
  endLine: number | null;
  opening: string;
  label: string | null;
  classes: string[];
  attributes: Record<string, string>;
  known: boolean;
  raw: string;
}

export function parseDirectiveBlocks(markdown: string): DirectiveBlock[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: DirectiveBlock[] = [];
  let fenceChar: '`' | '~' | null = null;
  let fenceLength = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const fenceMatch = lines[index].match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const markerChar = marker[0] as '`' | '~';
      if (!fenceChar) {
        fenceChar = markerChar;
        fenceLength = marker.length;
        continue;
      }
      if (markerChar === fenceChar && marker.length >= fenceLength) {
        fenceChar = null;
        fenceLength = 0;
        continue;
      }
    }

    if (fenceChar) continue;

    const inlineMatch = lines[index].match(/^:::\s*([A-Za-z][\w-]*)?(\s+\{[^}]*})?\s+(.+?)\s+:::\s*$/);
    if (inlineMatch) {
      const parsedAttributes = parseDirectiveAttributes(inlineMatch[2] ?? '');
      const className = inlineMatch[1] ?? parsedAttributes.classes[0] ?? 'block';
      const opening = createDirectiveOpening(className, inlineMatch[2] ?? '');
      blocks.push({
        name: className,
        line: index + 1,
        endLine: index + 1,
        opening,
        label: parsedAttributes.label,
        classes: parsedAttributes.classes,
        attributes: parsedAttributes.attributes,
        known: KNOWN_DIRECTIVE_NAMES.has(className) || parsedAttributes.classes.some((item) => KNOWN_DIRECTIVE_NAMES.has(item)),
        raw: lines[index],
      });
      continue;
    }

    const match = lines[index].match(/^:::\s*([A-Za-z][\w-]*)?(\s+\{[^}]*})?\s*$/);
    if (!match) continue;

    const opening = lines[index];
    const parsedAttributes = parseDirectiveAttributes(match[2] ?? '');
    const className = match[1] ?? parsedAttributes.classes[0] ?? 'block';
    const endIndex = findDirectiveEnd(lines, index + 1);
    blocks.push({
      name: className,
      line: index + 1,
      endLine: endIndex === null ? null : endIndex + 1,
      opening,
      label: parsedAttributes.label,
      classes: parsedAttributes.classes,
      attributes: parsedAttributes.attributes,
      known: KNOWN_DIRECTIVE_NAMES.has(className) || parsedAttributes.classes.some((item) => KNOWN_DIRECTIVE_NAMES.has(item)),
      raw: lines.slice(index, endIndex === null ? lines.length : endIndex + 1).join('\n'),
    });
    if (endIndex !== null) index = endIndex;
  }

  return blocks;
}

export function directiveBody(raw: string): string {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const inline = normalized.match(/^:::\s*([A-Za-z][\w-]*)?(\s+\{[^}]*})?\s+(.+?)\s+:::\s*$/);
  if (inline) return inline[3].trim();
  const lines = normalized.split('\n');
  return lines.slice(1, -1).join('\n').trim();
}

export function hasDirectiveOpeningOutsideFences(markdown: string): boolean {
  return parseDirectiveBlocks(removeFencedCodeBlocks(markdown)).length > 0;
}

function findDirectiveEnd(lines: string[], startIndex: number): number | null {
  let fenceChar: '`' | '~' | null = null;
  let fenceLength = 0;
  for (let index = startIndex; index < lines.length; index += 1) {
    const fenceMatch = lines[index].match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const markerChar = marker[0] as '`' | '~';
      if (!fenceChar) {
        fenceChar = markerChar;
        fenceLength = marker.length;
        continue;
      }
      if (markerChar === fenceChar && marker.length >= fenceLength) {
        fenceChar = null;
        fenceLength = 0;
        continue;
      }
    }
    if (!fenceChar && lines[index].trim() === ':::') return index;
  }
  return null;
}

function createDirectiveOpening(name: string, attributes: string): string {
  const trimmedAttributes = attributes.trim();
  return trimmedAttributes ? `:::${name} ${trimmedAttributes}` : `:::${name}`;
}

function parseDirectiveAttributes(value: string): { label: string | null; classes: string[]; attributes: Record<string, string> } {
  const content = value.trim().replace(/^\{/, '').replace(/}$/, '').trim();
  const classes: string[] = [];
  const attributes: Record<string, string> = {};
  let label: string | null = null;
  if (!content) return { label, classes, attributes };

  const tokens = tokenizeDirectiveAttributes(content);
  for (const token of tokens) {
    if (token.startsWith('#')) {
      label = token.slice(1);
    } else if (token.startsWith('.')) {
      classes.push(token.slice(1));
    } else {
      const [key, ...rest] = token.split('=');
      if (key && rest.length > 0) {
        attributes[key] = unquoteDirectiveAttribute(rest.join('='));
      }
    }
  }

  return { label, classes, attributes };
}

function tokenizeDirectiveAttributes(content: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of content) {
    if (escaping) {
      current += `\\${char}`;
      escaping = false;
      continue;
    }
    if (char === '\\' && quote) {
      escaping = true;
      continue;
    }
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      current += char;
      continue;
    }
    if (char === quote) {
      quote = null;
      current += char;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (escaping) current += '\\';
  if (current) tokens.push(current);
  return tokens;
}

function unquoteDirectiveAttribute(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed.at(-1) !== quote) return trimmed;
  return trimmed
    .slice(1, -1)
    .replace(/\\(["'\\])/g, '$1');
}

function removeFencedCodeBlocks(markdown: string): string {
  const lines = markdown.split('\n');
  let fenceChar: '`' | '~' | null = null;
  let fenceLength = 0;

  return lines
    .map((line) => {
      const match = line.match(/^\s*(`{3,}|~{3,})/);
      if (match) {
        const marker = match[1];
        const markerChar = marker[0] as '`' | '~';
        if (!fenceChar) {
          fenceChar = markerChar;
          fenceLength = marker.length;
          return '';
        }
        if (markerChar === fenceChar && marker.length >= fenceLength) {
          fenceChar = null;
          fenceLength = 0;
          return '';
        }
      }

      return fenceChar ? '' : line;
    })
    .join('\n');
}
