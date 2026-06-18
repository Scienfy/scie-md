export interface TextMatch {
  from: number;
  to: number;
}

export function findTextMatches(text: string, query: string, caseSensitive = false): TextMatch[] {
  if (!query) return [];
  if (!caseSensitive) return findCaseFoldedTextMatches(text, query);
  const matches: TextMatch[] = [];
  let offset = 0;

  while (offset <= text.length) {
    const found = text.indexOf(query, offset);
    if (found === -1) break;
    matches.push({ from: found, to: found + query.length });
    offset = found + Math.max(1, query.length);
  }

  return matches;
}

function findCaseFoldedTextMatches(text: string, query: string): TextMatch[] {
  const needle = foldSearchText(query);
  if (!needle) return [];
  const segments = Array.from(text.matchAll(/[\s\S]/gu)).map((match) => ({
    text: match[0],
    from: match.index ?? 0,
    to: (match.index ?? 0) + match[0].length,
  }));
  const matches: TextMatch[] = [];

  for (let startIndex = 0; startIndex < segments.length; startIndex += 1) {
    let folded = '';
    let endIndex = startIndex;
    while (endIndex < segments.length && folded.length < needle.length) {
      folded += foldSearchText(segments[endIndex].text);
      endIndex += 1;
    }
    if (folded === needle) {
      matches.push({ from: segments[startIndex].from, to: segments[endIndex - 1].to });
      startIndex = Math.max(startIndex, endIndex - 1);
    }
  }

  return matches;
}

function foldSearchText(value: string): string {
  return value.normalize('NFC').toUpperCase().toLowerCase();
}

export function replaceTextMatch(text: string, match: TextMatch | undefined, replacement: string): string {
  if (!match) return text;
  return `${text.slice(0, match.from)}${replacement}${text.slice(match.to)}`;
}

export function replaceTextMatches(text: string, matches: TextMatch[], replacement: string): string {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    text = replaceTextMatch(text, matches[index], replacement);
  }
  return text;
}

export function replaceAllTextMatches(text: string, query: string, replacement: string, caseSensitive = false): string {
  const matches = findTextMatches(text, query, caseSensitive);
  return replaceTextMatches(text, matches, replacement);
}
