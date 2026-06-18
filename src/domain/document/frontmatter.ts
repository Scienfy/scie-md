import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface FrontmatterParseResult {
  hasFrontmatter: boolean;
  raw: string;
  body: string;
  data: Record<string, unknown>;
  error: string | null;
  startLine: number;
  endLine: number;
  openingFence: string;
  closingFence: string;
}

export function parseFrontmatter(markdown: string): FrontmatterParseResult {
  const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return {
      hasFrontmatter: false,
      raw: '',
      body: markdown,
      data: {},
      error: null,
      startLine: 0,
      endLine: 0,
      openingFence: '',
      closingFence: '',
    };
  }

  const lines = normalized.split('\n');
  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[index])) {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex < 0) {
    return {
      hasFrontmatter: true,
      raw: normalized,
      body: '',
      data: {},
      error: 'Front matter is missing a closing --- fence.',
      startLine: 1,
      endLine: lines.length,
      openingFence: '---',
      closingFence: '',
    };
  }

  const raw = lines.slice(1, closingIndex).join('\n');
  let data: Record<string, unknown> = {};
  let error: string | null = null;
  try {
    const parsed = parseYaml(raw, { maxAliasCount: 100 });
    data = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch (parseError) {
    error = parseError instanceof Error ? parseError.message : 'Front matter is not valid YAML.';
  }

  return {
    hasFrontmatter: true,
    raw,
    body: lines.slice(closingIndex + 1).join('\n'),
    data,
    error,
    startLine: 1,
    endLine: closingIndex + 1,
    openingFence: '---',
    closingFence: lines[closingIndex].trim(),
  };
}

export function serializeFrontmatter(data: Record<string, unknown>, body: string): string {
  const yaml = stringifyYaml(data).trimEnd();
  const separator = body.startsWith('\n') ? '' : '\n';
  return `---\n${yaml}\n---${separator}${body}`;
}

export function getScienfyMetadata(frontmatter: Record<string, unknown>): Record<string, unknown> {
  const value = frontmatter.scienfy;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function getStringField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function getStringArrayField(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}
