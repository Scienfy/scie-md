import { createDiffHunks } from './diffReview';
import type { DiffHunk } from './diffReview';
import { parseEditorComments } from './editorComments';
import type { EditorComment } from './editorComments';

export interface ReviewUnitNoteChange {
  kind: 'added' | 'removed';
  note: EditorComment;
}

export interface ReviewUnit {
  id: string;
  beforeStart: number;
  beforeEnd: number;
  afterStart: number;
  afterEnd: number;
  rawHunkIds: string[];
  textHunkIds: string[];
  attachedMetadataHunkIds: string[];
  beforeMarkdown: string;
  afterMarkdown: string;
  displayHunk: DiffHunk;
  noteChanges: ReviewUnitNoteChange[];
  relatedNoteIds: string[];
}

export interface ReviewAutoAcceptedMetadata {
  hunkId: string;
  afterLines: string[];
}

export interface ReviewPlan {
  rawHunks: DiffHunk[];
  units: ReviewUnit[];
  autoAcceptedMetadataHunkIds: string[];
  autoAcceptedMetadata: ReviewAutoAcceptedMetadata[];
}

interface MetadataLineBlock {
  startIndex: number;
  endIndex: number;
  lines: string[];
  raw: string;
  notes: EditorComment[];
  hasInstruction: boolean;
}

interface MetadataHunkInfo {
  hunk: DiffHunk;
  beforeNotes: EditorComment[];
  afterNotes: EditorComment[];
  beforeMetadataBlocks: MetadataLineBlock[];
  afterMetadataBlocks: MetadataLineBlock[];
  beforeHasInstruction: boolean;
  afterHasInstruction: boolean;
  rawBefore: string;
  rawAfter: string;
  assigned: boolean;
}

const METADATA_ATTACHMENT_LINE_WINDOW = 8;

export function createReviewPlan(before: string, after: string, rawHunks = createDiffHunks(before, after)): ReviewPlan {
  const initialUnits: ReviewUnit[] = [];
  const metadataHunks: MetadataHunkInfo[] = [];
  const autoAcceptedMetadata: ReviewAutoAcceptedMetadata[] = [];

  for (const hunk of rawHunks) {
    const info = createMetadataHunkInfo(hunk);
    if (hunkHasReaderVisibleChange(hunk)) {
      const unit = createReviewUnit(initialUnits.length, hunk, info);
      initialUnits.push(unit);
      autoAcceptedMetadata.push(...autoAcceptedAddedHumanNotes(info));
      continue;
    }
    metadataHunks.push(info);
  }

  const units = mergeConnectedTextUnits(initialUnits);

  for (const info of metadataHunks) {
    const unit = findUnitByNoteTarget(info, units);
    if (unit) attachMetadataHunk(unit, info);
  }

  for (const info of metadataHunks) {
    if (info.assigned) continue;
    const unit = findUnitBySourceNote(info, units);
    if (unit) attachMetadataHunk(unit, info);
  }

  for (const info of metadataHunks) {
    if (info.assigned || !metadataNeedsTextDecision(info)) continue;
    const unit = nearestUnit(info.hunk, units, METADATA_ATTACHMENT_LINE_WINDOW);
    if (unit) attachMetadataHunk(unit, info);
  }

  for (const info of metadataHunks) {
    if (!info.assigned) autoAcceptedMetadata.push(...autoAcceptedAddedHumanNotes(info));
  }

  const autoAcceptedMetadataHunkIds = new Set<string>(metadataHunks
    .filter((info) => !info.assigned)
    .map((info) => info.hunk.id));
  for (const metadata of autoAcceptedMetadata) autoAcceptedMetadataHunkIds.add(metadata.hunkId);

  return {
    rawHunks,
    units,
    autoAcceptedMetadataHunkIds: Array.from(autoAcceptedMetadataHunkIds),
    autoAcceptedMetadata,
  };
}

export function reviewUnitIdsForRawHunkIds(plan: ReviewPlan, rawHunkIds: Set<string>): Set<string> {
  const ids = new Set<string>();
  for (const unit of plan.units) {
    if (unit.rawHunkIds.some((id) => rawHunkIds.has(id))) ids.add(unit.id);
  }
  return ids;
}

export function rejectedRawHunkIdsForReviewPlan(
  plan: ReviewPlan,
  rejectedUnitIds: Set<string>,
  rejectedRawHunkIds: Set<string> = new Set(),
): Set<string> {
  const rejected = new Set(rejectedRawHunkIds);
  for (const unit of plan.units) {
    if (!rejectedUnitIds.has(unit.id)) continue;
    for (const id of unit.rawHunkIds) rejected.add(id);
  }
  return rejected;
}

export function applyReviewPlanDecisions(
  before: string,
  after: string,
  plan: ReviewPlan,
  rejectedUnitIds: Set<string>,
  rejectedRawHunkIds: Set<string> = new Set(),
): string {
  const rejectedHunkIds = rejectedRawHunkIdsForReviewPlan(plan, rejectedUnitIds, rejectedRawHunkIds);
  if (rejectedHunkIds.size === 0) return after;

  const beforeLines = splitLines(before);
  const output: string[] = [];
  let beforeIndex = 0;

  for (const hunk of plan.rawHunks) {
    output.push(...beforeLines.slice(beforeIndex, hunk.beforeStart));
    if (rejectedHunkIds.has(hunk.id)) {
      output.push(...hunk.beforeLines);
      output.push(...autoAcceptedLinesForRejectedHunk(plan, hunk.id));
    } else {
      output.push(...hunk.afterLines);
    }
    beforeIndex = hunk.beforeEnd;
  }

  output.push(...beforeLines.slice(beforeIndex));
  return joinLines(output, after.endsWith('\n') || before.endsWith('\n'));
}

function createReviewUnit(index: number, hunk: DiffHunk, info: MetadataHunkInfo): ReviewUnit {
  const beforeLines = visibleReviewLines(hunk.beforeLines);
  const afterLines = visibleReviewLines(hunk.afterLines);
  const displayHunk = createDisplayHunk(`review-${index + 1}`, hunk, beforeLines, afterLines);
  const beforeMarkdown = joinFragment(beforeLines);
  const afterMarkdown = joinFragment(afterLines);
  const unit: ReviewUnit = {
    id: `review-${index + 1}`,
    beforeStart: hunk.beforeStart,
    beforeEnd: hunk.beforeEnd,
    afterStart: hunk.afterStart,
    afterEnd: hunk.afterEnd,
    rawHunkIds: [hunk.id],
    textHunkIds: [hunk.id],
    attachedMetadataHunkIds: [],
    beforeMarkdown,
    afterMarkdown,
    displayHunk,
    noteChanges: [],
    relatedNoteIds: [],
  };
  attachMixedMetadataIfRelated(unit, info);
  return unit;
}

function createDisplayHunk(id: string, sourceHunk: DiffHunk, beforeLines: string[], afterLines: string[]): DiffHunk {
  const beforeMarkdown = joinFragment(beforeLines);
  const afterMarkdown = joinFragment(afterLines);
  const displayHunks = createDiffHunks(beforeMarkdown, afterMarkdown);
  return {
    id,
    beforeStart: sourceHunk.beforeStart,
    beforeEnd: sourceHunk.beforeEnd,
    afterStart: sourceHunk.afterStart,
    afterEnd: sourceHunk.afterEnd,
    beforeLines,
    afterLines,
    diffLines: displayHunks.flatMap((hunk) => hunk.diffLines),
  };
}

function createMetadataHunkInfo(hunk: DiffHunk): MetadataHunkInfo {
  const rawBefore = joinFragment(hunk.beforeLines);
  const rawAfter = joinFragment(hunk.afterLines);
  const beforeMetadataBlocks = extractMetadataLineBlocks(hunk.beforeLines);
  const afterMetadataBlocks = extractMetadataLineBlocks(hunk.afterLines);
  return {
    hunk,
    beforeNotes: parseEditorComments(rawBefore),
    afterNotes: parseEditorComments(rawAfter),
    beforeMetadataBlocks,
    afterMetadataBlocks,
    beforeHasInstruction: beforeMetadataBlocks.some((block) => block.hasInstruction),
    afterHasInstruction: afterMetadataBlocks.some((block) => block.hasInstruction),
    rawBefore,
    rawAfter,
    assigned: false,
  };
}

function attachMetadataHunk(unit: ReviewUnit, info: MetadataHunkInfo): void {
  if (info.assigned) return;
  info.assigned = true;
  unit.rawHunkIds.push(info.hunk.id);
  unit.attachedMetadataHunkIds.push(info.hunk.id);
  for (const note of info.beforeNotes) {
    unit.noteChanges.push({ kind: 'removed', note });
    addRelatedNoteIds(unit, note);
  }
  for (const note of info.afterNotes) {
    unit.noteChanges.push({ kind: 'added', note });
    addRelatedNoteIds(unit, note);
  }
  unit.relatedNoteIds = Array.from(new Set(unit.relatedNoteIds));
}

function attachMixedMetadataIfRelated(unit: ReviewUnit, info: MetadataHunkInfo): void {
  const beforeNotes = info.beforeNotes.filter((note) => note.audience === 'llm' || noteRelatesToUnit(note, unit));
  const afterNotes = info.afterNotes.filter((note) => Boolean(note.sourceNoteId) || noteRelatesToUnit(note, unit));
  if (!info.beforeHasInstruction && beforeNotes.length === 0 && afterNotes.length === 0) return;

  if (!unit.attachedMetadataHunkIds.includes(info.hunk.id)) unit.attachedMetadataHunkIds.push(info.hunk.id);
  for (const note of beforeNotes) {
    unit.noteChanges.push({ kind: 'removed', note });
    addRelatedNoteIds(unit, note);
  }
  for (const note of afterNotes) {
    unit.noteChanges.push({ kind: 'added', note });
    addRelatedNoteIds(unit, note);
  }
  unit.relatedNoteIds = Array.from(new Set(unit.relatedNoteIds));
}

function addRelatedNoteIds(unit: ReviewUnit, note: EditorComment): void {
  if (note.id) unit.relatedNoteIds.push(note.id);
  if (note.sourceNoteId) unit.relatedNoteIds.push(note.sourceNoteId);
}

function noteRelatesToUnit(note: EditorComment, unit: ReviewUnit): boolean {
  return Boolean(note.quote && quoteRelatesToUnit(note.quote, unit));
}

function hunkHasReaderVisibleChange(hunk: DiffHunk): boolean {
  const before = normalizeReaderVisibleMarkdown(hunk.beforeLines);
  const after = normalizeReaderVisibleMarkdown(hunk.afterLines);
  return before !== after;
}

function normalizeReaderVisibleMarkdown(lines: string[]): string {
  return visibleReviewLines(lines)
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function visibleReviewLines(lines: string[]): string[] {
  return trimBoundaryBlankLines(stripReviewMetadataLines(lines));
}

function stripReviewMetadataLines(lines: string[]): string[] {
  const output: string[] = [];
  let inStandaloneMetadataComment = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (inStandaloneMetadataComment) {
      if (trimmed.includes('-->')) inStandaloneMetadataComment = false;
      continue;
    }

    if (startsStandaloneMetadataComment(trimmed)) {
      if (!trimmed.includes('-->')) inStandaloneMetadataComment = true;
      continue;
    }

    if (isMetadataBoundaryLine(trimmed)) continue;
    output.push(line);
  }

  return output;
}

function startsStandaloneMetadataComment(trimmedLine: string): boolean {
  return /^<!--\s*scie_md:(?:note|instruction)\b/i.test(trimmedLine)
    || /^<!--\s*scie_md:comment(?!:)\b[^>]*:/i.test(trimmedLine);
}

function isMetadataBoundaryLine(trimmedLine: string): boolean {
  return /^<!--\s*scie_md:comment(?!:)\b[^>]*-->\s*$/i.test(trimmedLine)
    || /^<!--\s*scie_md:comment:end\s*-->\s*$/i.test(trimmedLine);
}

function extractMetadataLineBlocks(lines: string[]): MetadataLineBlock[] {
  const blocks: MetadataLineBlock[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!startsStandaloneMetadataComment(trimmed) && !isMetadataBoundaryLine(trimmed)) continue;

    const startIndex = index;
    const blockLines = [lines[index]];
    while (!blockLines.at(-1)?.includes('-->') && index + 1 < lines.length) {
      index += 1;
      blockLines.push(lines[index]);
    }
    const raw = joinFragment(blockLines);
    blocks.push({
      startIndex,
      endIndex: index + 1,
      lines: blockLines,
      raw,
      notes: parseEditorComments(raw),
      hasInstruction: /^<!--\s*scie_md:instruction\b/i.test(trimmed),
    });
  }
  return blocks;
}

function findUnitByNoteTarget(info: MetadataHunkInfo, units: ReviewUnit[]): ReviewUnit | null {
  for (const note of [...info.beforeNotes, ...info.afterNotes]) {
    if (!note.quote) continue;
    const unit = units.find((candidate) => quoteRelatesToUnit(note.quote ?? '', candidate));
    if (unit) return unit;
  }
  return null;
}

function findUnitBySourceNote(info: MetadataHunkInfo, units: ReviewUnit[]): ReviewUnit | null {
  for (const note of info.afterNotes) {
    if (!note.sourceNoteId) continue;
    const unit = units.find((candidate) => candidate.relatedNoteIds.includes(note.sourceNoteId ?? ''));
    if (unit) return unit;
  }
  return null;
}

function quoteRelatesToUnit(quote: string, unit: ReviewUnit): boolean {
  const normalizedQuote = normalizeSearchText(quote);
  if (!normalizedQuote) return false;
  return normalizeSearchText(unit.beforeMarkdown).includes(normalizedQuote)
    || normalizeSearchText(unit.afterMarkdown).includes(normalizedQuote);
}

function metadataNeedsTextDecision(info: MetadataHunkInfo): boolean {
  if (info.beforeNotes.some((note) => note.audience === 'llm')) return true;
  if (info.beforeHasInstruction) return true;
  return false;
}

function nearestUnit(hunk: DiffHunk, units: ReviewUnit[], maxDistance: number): ReviewUnit | null {
  let best: { unit: ReviewUnit; distance: number } | null = null;
  for (const unit of units) {
    const distance = hunkLineDistance(hunk, unit);
    if (distance > maxDistance) continue;
    if (!best || distance < best.distance) best = { unit, distance };
  }
  return best?.unit ?? null;
}

function hunkLineDistance(hunk: DiffHunk, unit: ReviewUnit): number {
  const beforeDistance = rangeDistance(hunk.beforeStart, hunk.beforeEnd, unit.beforeStart, unit.beforeEnd);
  const afterDistance = rangeDistance(hunk.afterStart, hunk.afterEnd, unit.afterStart, unit.afterEnd);
  return Math.min(beforeDistance, afterDistance);
}

function rangeDistance(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): number {
  const leftTo = Math.max(leftStart, leftEnd);
  const rightTo = Math.max(rightStart, rightEnd);
  if (leftTo < rightStart) return rightStart - leftTo;
  if (rightTo < leftStart) return leftStart - rightTo;
  return 0;
}

function normalizeSearchText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function joinFragment(lines: string[]): string {
  return lines.join('\n');
}

function splitLines(value: string): string[] {
  if (!value) return [];
  const lines = value.split('\n');
  if (value.endsWith('\n')) lines.pop();
  return lines;
}

function joinLines(lines: string[], trailingNewline: boolean): string {
  return `${lines.join('\n')}${trailingNewline ? '\n' : ''}`;
}

function trimBoundaryBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

function mergeConnectedTextUnits(units: ReviewUnit[]): ReviewUnit[] {
  const merged: ReviewUnit[] = [];
  for (const unit of units) {
    const previous = merged.at(-1);
    if (previous && shouldMergeReviewUnits(previous, unit)) {
      mergeReviewUnit(previous, unit);
    } else {
      merged.push(cloneReviewUnit(unit));
    }
  }
  return merged.map((unit, index) => normalizeReviewUnitId(unit, index));
}

function shouldMergeReviewUnits(left: ReviewUnit, right: ReviewUnit): boolean {
  if (hunkLineDistance(
    {
      id: right.id,
      beforeStart: right.beforeStart,
      beforeEnd: right.beforeEnd,
      afterStart: right.afterStart,
      afterEnd: right.afterEnd,
      beforeLines: [],
      afterLines: [],
      diffLines: [],
    },
    left,
  ) > METADATA_ATTACHMENT_LINE_WINDOW) return false;
  if (reviewUnitsShareRelatedNote(left, right)) return true;
  return isOneSidedTextChange(left) || isOneSidedTextChange(right);
}

function mergeReviewUnit(target: ReviewUnit, source: ReviewUnit): void {
  target.beforeStart = Math.min(target.beforeStart, source.beforeStart);
  target.beforeEnd = Math.max(target.beforeEnd, source.beforeEnd);
  target.afterStart = Math.min(target.afterStart, source.afterStart);
  target.afterEnd = Math.max(target.afterEnd, source.afterEnd);
  target.rawHunkIds = uniqueStrings([...target.rawHunkIds, ...source.rawHunkIds]);
  target.textHunkIds = uniqueStrings([...target.textHunkIds, ...source.textHunkIds]);
  target.attachedMetadataHunkIds = uniqueStrings([...target.attachedMetadataHunkIds, ...source.attachedMetadataHunkIds]);
  target.beforeMarkdown = joinFragment([...splitLines(target.beforeMarkdown), ...splitLines(source.beforeMarkdown)]);
  target.afterMarkdown = joinFragment([...splitLines(target.afterMarkdown), ...splitLines(source.afterMarkdown)]);
  target.displayHunk = createDisplayHunk(target.id, target.displayHunk, splitLines(target.beforeMarkdown), splitLines(target.afterMarkdown));
  target.noteChanges = [...target.noteChanges, ...source.noteChanges];
  target.relatedNoteIds = uniqueStrings([...target.relatedNoteIds, ...source.relatedNoteIds]);
}

function cloneReviewUnit(unit: ReviewUnit): ReviewUnit {
  return {
    ...unit,
    rawHunkIds: [...unit.rawHunkIds],
    textHunkIds: [...unit.textHunkIds],
    attachedMetadataHunkIds: [...unit.attachedMetadataHunkIds],
    noteChanges: [...unit.noteChanges],
    relatedNoteIds: [...unit.relatedNoteIds],
  };
}

function normalizeReviewUnitId(unit: ReviewUnit, index: number): ReviewUnit {
  const id = `review-${index + 1}`;
  return {
    ...unit,
    id,
    displayHunk: createDisplayHunk(id, unit.displayHunk, splitLines(unit.beforeMarkdown), splitLines(unit.afterMarkdown)),
  };
}

function reviewUnitsShareRelatedNote(left: ReviewUnit, right: ReviewUnit): boolean {
  if (left.relatedNoteIds.length === 0 || right.relatedNoteIds.length === 0) return false;
  const rightIds = new Set(right.relatedNoteIds);
  return left.relatedNoteIds.some((id) => rightIds.has(id));
}

function isOneSidedTextChange(unit: ReviewUnit): boolean {
  return !unit.beforeMarkdown.trim() || !unit.afterMarkdown.trim();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function autoAcceptedAddedHumanNotes(info: MetadataHunkInfo): ReviewAutoAcceptedMetadata[] {
  const beforeRawBlocks = new Set(info.beforeMetadataBlocks.map((block) => block.raw));
  const afterLines: string[] = [];
  for (const block of info.afterMetadataBlocks) {
    if (beforeRawBlocks.has(block.raw)) continue;
    if (!isAutoAcceptedHumanNoteBlock(block)) continue;
    if (block.startIndex > 0 && !info.hunk.afterLines[block.startIndex - 1].trim()) afterLines.push('');
    afterLines.push(...block.lines);
  }
  return afterLines.length === 0 ? [] : [{ hunkId: info.hunk.id, afterLines }];
}

function isAutoAcceptedHumanNoteBlock(block: MetadataLineBlock): boolean {
  return block.notes.length > 0 && block.notes.every((note) => (
    note.audience === 'human' && !note.sourceNoteId && !note.quote
  ));
}

function autoAcceptedLinesForRejectedHunk(plan: ReviewPlan, hunkId: string): string[] {
  return plan.autoAcceptedMetadata
    .filter((metadata) => metadata.hunkId === hunkId)
    .flatMap((metadata) => metadata.afterLines);
}
