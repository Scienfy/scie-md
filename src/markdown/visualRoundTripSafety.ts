import type { ValidationIssue } from './markdownValidation';

const MAX_VISUAL_ROUND_TRIP_ISSUES = 12;

interface VisualRoundTripRisk {
  line: number;
  message: string;
}

export function detectVisualRoundTripRisks(markdown: string): ValidationIssue[] {
  const maskedMarkdown = maskYamlFrontmatter(maskFencedCodeBlocks(markdown));
  const lines = maskedMarkdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const risks: VisualRoundTripRisk[] = [];
  let previousUnorderedListLine = false;
  let previousLineWasBlank = true;

  const addRisk = (line: number, message: string) => {
    if (risks.length >= MAX_VISUAL_ROUND_TRIP_ISSUES) return;
    risks.push({ line, message });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const rawLine = lines[index];
    const line = maskInlineCode(rawLine);
    const trimmed = line.trim();

    if (!trimmed) {
      previousUnorderedListLine = false;
      previousLineWasBlank = true;
      continue;
    }

    if (isSetextHeadingUnderline(line) && index > 0 && lines[index - 1].trim()) {
      addRisk(lineNumber, 'Setext headings are rewritten as ATX headings in visual mode.');
    }

    const unorderedListMatch = line.match(/^ {0,3}([-+*])\s+(?:\[[ xX]\]\s+)?/);
    if (unorderedListMatch) {
      const marker = unorderedListMatch[1];
      if (marker === '+' || marker === '*') {
        addRisk(lineNumber, 'Unordered list markers are normalized to `-` in visual mode.');
      } else if (previousUnorderedListLine && !previousLineWasBlank) {
        addRisk(lineNumber, 'Compact unordered lists are expanded with blank lines in visual mode.');
      }
      previousUnorderedListLine = true;
    } else {
      previousUnorderedListLine = false;
    }

    if (/^ {0,3}\d+\)\s+/.test(line)) {
      addRisk(lineNumber, 'Ordered lists using `1)` are rewritten as `1.` in visual mode.');
    }

    if (/^ {0,3}\[[^\]\n]+]:[ \t]*\S/.test(line)) {
      addRisk(lineNumber, 'Reference-style link definitions are inlined by visual mode.');
    }

    if (/(^|[^!])\[[^\]\n]+]\[[^\]\n]*]/.test(line)) {
      addRisk(lineNumber, 'Reference-style links are inlined by visual mode.');
    }

    if (/[ \t]{2,}$/.test(rawLine)) {
      addRisk(lineNumber, 'Trailing-space hard breaks are rewritten; use a backslash hard break instead.');
    }

    if (rawLine.includes('\t')) {
      addRisk(lineNumber, 'Tabs can be normalized by visual editing; use spaces in source intended for visual mode.');
    }

    previousLineWasBlank = false;
  }

  if (risks.length === MAX_VISUAL_ROUND_TRIP_ISSUES) {
    risks.push({
      line: lines.length,
      message: 'Additional visual round-trip risks were omitted.',
    });
  }

  return risks.map((risk) => ({
    severity: 'warning' as const,
    code: 'visual-roundtrip-risk',
    message: `${risk.message} (line ${risk.line})`,
  }));
}

function isSetextHeadingUnderline(line: string): boolean {
  return /^ {0,3}(?:=+|-+)[ \t]*$/.test(line);
}

function maskInlineCode(line: string): string {
  let output = '';
  for (let index = 0; index < line.length;) {
    if (line[index] !== '`') {
      output += line[index];
      index += 1;
      continue;
    }

    let runLength = 1;
    while (line[index + runLength] === '`') runLength += 1;
    const marker = '`'.repeat(runLength);
    const closeIndex = line.indexOf(marker, index + runLength);
    if (closeIndex < 0) {
      output += line.slice(index);
      break;
    }

    output += ' '.repeat(closeIndex + runLength - index);
    index = closeIndex + runLength;
  }
  return output;
}

function maskYamlFrontmatter(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  if (!/^---[ \t]*$/.test(lines[0] ?? '')) return markdown;
  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[index])) {
      closingIndex = index;
      break;
    }
  }
  if (closingIndex < 0) return markdown;
  return lines
    .map((line, index) => index <= closingIndex ? ' '.repeat(line.length) : line)
    .join('\n');
}

function maskFencedCodeBlocks(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let fenceChar: '`' | '~' | null = null;
  let fenceLength = 0;
  return lines
    .map((line) => {
      const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (!match) return fenceChar ? ' '.repeat(line.length) : line;
      const marker = match[1];
      const markerChar = marker[0] as '`' | '~';
      if (!fenceChar) {
        fenceChar = markerChar;
        fenceLength = marker.length;
        return ' '.repeat(line.length);
      }
      if (markerChar === fenceChar && marker.length >= fenceLength) {
        fenceChar = null;
        fenceLength = 0;
      }
      return ' '.repeat(line.length);
    })
    .join('\n');
}
