export function toggleMarkdownHeadingSelection(rawSelection: string, level: 1 | 2 | 3 | 4 | 5 | 6): string {
  const marker = '#'.repeat(level);
  const normalized = rawSelection.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const contentLines = lines.filter((line) => line.trim().length > 0);
  const headingMatches = contentLines.map((line) => line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/));
  const isSameHeadingLevel = headingMatches.length > 0
    && headingMatches.every((match) => match && match[1].length === level);

  if (isSameHeadingLevel) {
    const plainText = headingMatches.map((match) => match?.[2].trim() ?? '').join('\n').trim();
    return `${plainText}\n\n`;
  }

  const text = normalized
    .replace(/^\s{0,3}(?:[-+*]|\d+[.)])\s+/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\s+#{1,6}\s*$/gm, '')
    .trim();

  return `${marker} ${text}\n\n`;
}
