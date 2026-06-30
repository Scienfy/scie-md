import { lineStartOffsets, offsetToLine } from './textOffsets';
import { fencedCodeRanges, isOffsetInsideRanges } from './markdownRanges';

export type TargetedInstructionTarget = 'next-block' | 'previous-block' | 'selection' | 'section';

export interface TargetedInstruction {
  line: number;
  start: number;
  end: number;
  target: TargetedInstructionTarget;
  prompt: string;
}

export interface ResolvedInstructionTarget {
  instruction: TargetedInstruction;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  markdown: string;
}

const instructionPattern = /<!--\s*scie_md:instruction(?:\s+target=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?(?:\s+prompt=(?:"([^"]*)"|'([^']*)'))?\s*(?::\s*([\s\S]*?))?\s*-->/gi;
const fullInstructionPattern = /^\s*<!--\s*scie_md:instruction(?:\s+target=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?(?:\s+prompt=(?:"([^"]*)"|'([^']*)'))?\s*(?::\s*([\s\S]*?))?\s*-->\s*$/i;

export function parseTargetedInstructions(markdown: string): TargetedInstruction[] {
  const lineStarts = lineStartOffsets(markdown);
  const ignoredRanges = fencedCodeRanges(markdown);
  const instructions: TargetedInstruction[] = [];
  instructionPattern.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = instructionPattern.exec(markdown))) {
    if (isOffsetInsideRanges(match.index, ignoredRanges)) continue;
    const prompt = decodeInstructionPrompt(match[4] ?? match[5] ?? match[6] ?? '').trim();
    if (!prompt) continue;
    instructions.push({
      line: offsetToLine(lineStarts, match.index),
      start: match.index,
      end: match.index + match[0].length,
      target: normalizeTarget(match[1] ?? match[2] ?? match[3] ?? 'next-block'),
      prompt,
    });
  }

  return instructions;
}

export function parseTargetedInstructionRaw(raw: string): Omit<TargetedInstruction, 'line'> | null {
  const match = raw.match(fullInstructionPattern);
  if (!match) return null;
  const prompt = decodeInstructionPrompt(match[4] ?? match[5] ?? match[6] ?? '').trim();
  if (!prompt) return null;
  return {
    start: 0,
    end: raw.length,
    target: normalizeTarget(match[1] ?? match[2] ?? match[3] ?? 'next-block'),
    prompt,
  };
}

export function resolveInstructionTarget(markdown: string, instruction: TargetedInstruction): ResolvedInstructionTarget | null {
  if (instruction.target === 'selection') return null;
  const lineStarts = lineStartOffsets(markdown);
  const lines = markdown.split(/\r?\n/);
  const instructionStartLine = offsetToLine(lineStarts, instruction.start);
  const instructionEndLine = offsetToLine(lineStarts, instruction.end);
  const lineIndex = instruction.target === 'previous-block'
    ? findPreviousBlockStart(lines, instructionStartLine - 2)
    : instruction.target === 'section'
      ? findSectionStart(lines, instructionStartLine - 1)
      : findNextBlockStart(lines, instructionEndLine);
  if (lineIndex === null) return null;
  const endLineIndex = instruction.target === 'section'
    ? findSectionEnd(lines, lineIndex)
    : findBlockEnd(lines, lineIndex);
  const start = lineStarts[lineIndex] ?? markdown.length;
  const end = endLineIndex + 1 < lineStarts.length ? lineStarts[endLineIndex + 1] : markdown.length;
  return {
    instruction,
    start,
    end,
    startLine: lineIndex + 1,
    endLine: endLineIndex + 1,
    markdown: markdown.slice(start, end).replace(/\s+$/g, ''),
  };
}

export function resolveInstructionTargets(markdown: string): ResolvedInstructionTarget[] {
  return parseTargetedInstructions(markdown)
    .map((instruction) => resolveInstructionTarget(markdown, instruction))
    .filter((target): target is ResolvedInstructionTarget => Boolean(target));
}

export function createTargetedInstructionSnippet(
  prompt = 'Make the next paragraph clearer and preserve the technical meaning.',
  target: TargetedInstructionTarget = 'next-block',
): string {
  return `<!-- scie_md:instruction target="${target}" prompt="${escapeAttribute(prompt)}" -->\n`;
}

function normalizeTarget(value: string): TargetedInstructionTarget {
  if (value === 'previous-block' || value === 'selection' || value === 'section') return value;
  return 'next-block';
}

function findNextBlockStart(lines: string[], startIndex: number): number | null {
  for (let index = Math.max(0, startIndex); index < lines.length; index += 1) {
    if (lines[index].trim()) return index;
  }
  return null;
}

function findPreviousBlockStart(lines: string[], startIndex: number): number | null {
  let index = Math.min(lines.length - 1, startIndex);
  while (index >= 0 && !lines[index].trim()) index -= 1;
  if (index < 0) return null;
  while (index > 0 && lines[index - 1].trim()) index -= 1;
  return index;
}

function findBlockEnd(lines: string[], startIndex: number): number {
  if (isFenceStart(lines[startIndex])) return findFenceEnd(lines, startIndex);
  if (isDirectiveStart(lines[startIndex])) return findDirectiveEnd(lines, startIndex);

  let index = startIndex;
  while (index + 1 < lines.length && lines[index + 1].trim()) {
    if (isBlockBoundary(lines[index + 1])) break;
    index += 1;
  }
  return index;
}

function findSectionStart(lines: string[], lineIndex: number): number {
  for (let index = Math.max(0, lineIndex); index >= 0; index -= 1) {
    if (/^#{1,6}\s+/.test(lines[index])) return index;
  }
  return 0;
}

function findSectionEnd(lines: string[], headingIndex: number): number {
  const heading = lines[headingIndex].match(/^(#{1,6})\s+/);
  const level = heading?.[1].length ?? 0;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const next = lines[index].match(/^(#{1,6})\s+/);
    if (next && next[1].length <= level) return Math.max(headingIndex, index - 1);
  }
  return lines.length - 1;
}

function isBlockBoundary(line: string): boolean {
  return /^#{1,6}\s+/.test(line)
    || /^:::[A-Za-z]/.test(line)
    || /^(`{3,}|~{3,})/.test(line)
    || /^---\s*$/.test(line);
}

function isFenceStart(line: string): boolean {
  return /^\s*(`{3,}|~{3,})/.test(line);
}

function findFenceEnd(lines: string[], startIndex: number): number {
  const start = lines[startIndex].match(/^\s*(`{3,}|~{3,})/);
  if (!start) return startIndex;
  const char = start[1][0];
  const length = start[1].length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const end = lines[index].match(/^\s*(`{3,}|~{3,})/);
    if (end && end[1][0] === char && end[1].length >= length) return index;
  }
  return lines.length - 1;
}

function isDirectiveStart(line: string): boolean {
  return /^:::[A-Za-z][A-Za-z0-9-]*(?:\s|\{|$)/.test(line);
}

function findDirectiveEnd(lines: string[], startIndex: number): number {
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (/^:::\s*$/.test(lines[index])) return index;
  }
  return lines.length - 1;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function decodeInstructionPrompt(value: string): string {
  return decodeHtmlAttribute(value.replace(/--&gt;/g, '-->'));
}
