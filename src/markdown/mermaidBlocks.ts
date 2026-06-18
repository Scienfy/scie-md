import { lineStartOffsets, offsetToLine } from './textOffsets';

export interface MermaidFenceBlock {
  raw: string;
  code: string;
  start: number;
  end: number;
  line: number;
}

export function findMermaidFenceBlocks(markdown: string): MermaidFenceBlock[] {
  const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const starts = lineStartOffsets(normalized);
  const lines = normalized.split('\n');
  const blocks: MermaidFenceBlock[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const opening = lines[lineIndex].match(/^[ \t]*(`{3,}|~{3,})[ \t]*mermaid(?:[ \t].*)?$/i);
    if (!opening) continue;
    const marker = opening[1];
    const markerChar = marker[0];
    const markerLength = marker.length;

    for (let closeIndex = lineIndex + 1; closeIndex < lines.length; closeIndex += 1) {
      const closing = lines[closeIndex].match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
      if (!closing || closing[1][0] !== markerChar || closing[1].length < markerLength) continue;

      const start = starts[lineIndex] ?? 0;
      const end = closeIndex + 1 < starts.length
        ? (starts[closeIndex + 1] ?? normalized.length) - 1
        : normalized.length;
      const raw = normalized.slice(start, end);
      blocks.push({
        raw,
        code: mermaidFenceBody(raw),
        start,
        end,
        line: offsetToLine(starts, start),
      });
      lineIndex = closeIndex;
      break;
    }
  }

  return blocks;
}

export function mermaidFenceBody(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .slice(1, -1)
    .join('\n')
    .trim();
}
