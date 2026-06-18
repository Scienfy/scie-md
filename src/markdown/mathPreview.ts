export interface MathRange {
  from: number;
  to: number;
  content: string;
}

export function findInlineMathRanges(text: string, offset = 0): MathRange[] {
  const ranges: MathRange[] = [];
  let index = 0;

  while (index < text.length) {
    const start = findNextInlineDollar(text, index);
    if (start === -1) break;
    const end = findClosingInlineDollar(text, start + 1);
    if (end === -1) {
      index = start + 1;
      continue;
    }

    const content = text.slice(start + 1, end).trim();
    if (content) {
      ranges.push({
        from: offset + start,
        to: offset + end + 1,
        content,
      });
    }
    index = end + 1;
  }

  return ranges;
}

export function findBlockMathRange(text: string, offset = 0): MathRange | null {
  const startMatch = text.match(/^\s*\$\$\s*/);
  const endMatch = text.match(/\s*\$\$\s*$/);
  if (!startMatch || !endMatch || startMatch[0].length >= text.length - endMatch[0].length) return null;

  const start = startMatch[0].length;
  const end = text.length - endMatch[0].length;
  const content = text.slice(start, end).trim();
  if (!content) return null;

  return {
    from: offset,
    to: offset + text.length,
    content,
  };
}

function findNextInlineDollar(text: string, startIndex: number): number {
  for (let index = startIndex; index < text.length; index += 1) {
    if (text[index] !== '$') continue;
    if (text[index + 1] === '$' || text[index - 1] === '$') continue;
    if (isEscaped(text, index)) continue;
    return index;
  }
  return -1;
}

function findClosingInlineDollar(text: string, startIndex: number): number {
  for (let index = startIndex; index < text.length; index += 1) {
    if (text[index] !== '$') continue;
    if (text[index + 1] === '$' || text[index - 1] === '$') continue;
    if (isEscaped(text, index)) continue;
    return index;
  }
  return -1;
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}
