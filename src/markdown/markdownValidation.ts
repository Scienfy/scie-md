import { LARGE_FILE_WARNING_BYTES, SOURCE_ONLY_FILE_BYTES } from './supportedMarkdown';
import { safeParseScienfyDocument } from '@sciemd/core';
import type { ParsedScienfyDocument } from '@sciemd/core';
import { extractVisualPlaceholderMarkers } from './visualMarkers';
import { detectVisualRoundTripRisks } from './visualRoundTripSafety';
import { frontmatterRanges } from '@sciemd/core';

export type ValidationSeverity = 'warning' | 'error';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
}

export interface MarkdownValidation {
  issues: ValidationIssue[];
  sourceOnly: boolean;
  formattingWillNormalize: boolean;
  wordCount: number;
}

export function validateMarkdown(
  markdown: string,
  sizeBytes = new TextEncoder().encode(markdown).length,
  parsedDocument?: ParsedScienfyDocument,
): MarkdownValidation {
  const issues: ValidationIssue[] = [];
  const markdownBodyOnly = removeRanges(markdown, frontmatterRanges(markdown));
  const markdownWithoutFences = removeFencedCodeBlocks(markdownBodyOnly);
  const sourceOnly = sizeBytes > SOURCE_ONLY_FILE_BYTES;
  const shouldDeferLargeParse = sourceOnly && !parsedDocument;
  const layerTwoDocument = parsedDocument ?? (shouldDeferLargeParse ? null : safeParseScienfyDocument(markdown));

  if (sizeBytes > LARGE_FILE_WARNING_BYTES) {
    issues.push({
      severity: 'warning',
      code: 'large-file',
      message: 'Large document: visual mode may be slower.',
    });
  }

  if (sizeBytes > SOURCE_ONLY_FILE_BYTES) {
    issues.push({
      severity: 'error',
      code: 'source-only-size',
      message: 'Documents over 5 MB open in Source by default to keep the app responsive.',
    });
  }

  if (extractVisualPlaceholderMarkers(markdown).size > 0) {
    issues.push({
      severity: 'error',
      code: 'internal-visual-marker',
      message: 'An internal Scienfy visual marker leaked into the document. Do not send or save this form for LLM editing.',
    });
  }

  if (hasConflictMarkers(markdownWithoutFences)) {
    issues.push({
      severity: 'error',
      code: 'conflict-marker',
      message: 'Unresolved conflict markers are present. Resolve the conflict before continuing in visual mode.',
    });
  }

  if (layerTwoDocument) {
    issues.push(...layerTwoDocument.diagnostics.map((diagnostic) => ({
      severity: diagnostic.severity === 'info' ? 'warning' as const : diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.line ? `${diagnostic.message} (line ${diagnostic.line})` : diagnostic.message,
    })));

    const unknownDirectives = layerTwoDocument.directives.filter((directive) => !directive.known);
    if (unknownDirectives.length > 0) {
      issues.push({
        severity: 'error',
        code: 'directive-unknown-visual',
        message: 'Unknown directive blocks are shown as raw Markdown in visual mode.',
      });
    }
  } else {
    issues.push({
      severity: 'warning',
      code: 'large-file-parser-deferred',
      message: 'Deep document diagnostics are deferred until the background parser catches up.',
    });
  }

  if (hasRawHtml(markdownWithoutFences)) {
    issues.push({
      severity: 'error',
      code: 'raw-html',
      message: 'Raw HTML is shown as raw Markdown in visual mode.',
    });
  }

  const fenceCount = (markdown.match(/^```/gm) ?? []).length + (markdown.match(/^~~~/gm) ?? []).length;
  if (fenceCount % 2 !== 0) {
    issues.push({
      severity: 'error',
      code: 'unclosed-fence',
      message: 'A fenced code block appears to be unclosed.',
    });
  }

  if (hasMalformedTable(markdownWithoutFences)) {
    issues.push({
      severity: 'warning',
      code: 'table-syntax',
      message: 'A table-like block may not be valid GFM table syntax.',
    });
  }

  issues.push(...detectVisualRoundTripRisks(markdown));
  const formattingWillNormalize = issues.some((issue) => issue.code === 'visual-roundtrip-risk');

  return {
    issues,
    sourceOnly,
    formattingWillNormalize,
    wordCount: countRenderedWords(markdown),
  };
}

export function removeFencedCodeBlocks(markdown: string): string {
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

function removeRanges(markdown: string, ranges: Array<{ start: number; end: number }>): string {
  if (ranges.length === 0) return markdown;
  let output = '';
  let offset = 0;
  for (const range of ranges) {
    output += markdown.slice(offset, range.start);
    output += '\n'.repeat((markdown.slice(range.start, range.end).match(/\n/g) ?? []).length);
    offset = range.end;
  }
  return output + markdown.slice(offset);
}

export function countRenderedWords(markdown: string): number {
  const withoutCodeBlocks = markdown.replace(/(```|~~~)[\s\S]*?\1/g, ' ');
  const withoutInlineCode = withoutCodeBlocks.replace(/`[^`]*`/g, ' ');
  const withoutImages = withoutInlineCode.replace(/!\[[^\]]*]\([^)]+\)/g, ' ');
  const linkTextOnly = withoutImages.replace(/\[([^\]]+)]\([^)]+\)/g, '$1');
  const withoutMarkdownSyntax = linkTextOnly
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+[.)]\s+/gm, '')
    .replace(/[*_~>#|`[\]()]/g, ' ')
    .replace(/-{3,}/g, ' ');

  return (withoutMarkdownSyntax.match(/\b[\p{L}\p{N}][\p{L}\p{N}'-]*\b/gu) ?? []).length;
}

export function hasRawHtml(markdown: string): boolean {
  const rawHtmlPattern = /<!--[\s\S]*?-->|<![a-z][\s\S]*?>|<\?[\s\S]*?\?>|<\/?[a-z][a-z0-9-]*(?=[\s>/])[^<>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = rawHtmlPattern.exec(markdown))) {
    if (isVisualSafeHtml(match[0])) continue;
    return true;
  }
  return false;
}

export function hasConflictMarkers(markdown: string): boolean {
  return /^<<<<<<< .+$/m.test(markdown)
    || /^=======$/m.test(markdown)
    || /^>>>>>>> .+$/m.test(markdown);
}

function isVisualSafeHtml(value: string): boolean {
  const trimmed = value.trim();
  return /^<br\s*\/?>$/i.test(trimmed) || /^<!--[\s\S]*-->$/.test(trimmed);
}

function hasMalformedTable(markdown: string): boolean {
  const lines = markdown.split('\n');
  let inTable = false;
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index].trim();
    const next = lines[index + 1].trim();
    const looksLikeTableHeader = line.startsWith('|') && line.endsWith('|');
    if (isTableSeparator(line)) {
      inTable = index > 0 && lines[index - 1].trim().startsWith('|');
      continue;
    }
    if (inTable && looksLikeTableHeader) continue;
    if (!looksLikeTableHeader) inTable = false;
    const nextIsSeparator = isTableSeparator(next);
    if (looksLikeTableHeader && !nextIsSeparator && next.includes('|')) {
      return true;
    }
  }
  return false;
}

function isTableSeparator(line: string): boolean {
  const cells = line
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}
