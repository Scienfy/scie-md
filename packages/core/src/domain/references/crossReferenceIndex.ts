import { lineStartOffsets, offsetToLine } from '../../markdown/textOffsets';
import { fencedCodeRanges, inlineCodeRanges, isOffsetInsideRanges, mergeRanges, scieMdCommentRanges } from '../../markdown/markdownRanges';

export const CROSS_REFERENCE_PREFIXES = ['fig', 'tbl', 'eq', 'sec', 'lst', 'nte', 'tip', 'wrn', 'imp', 'cau'] as const;

export interface CrossReferenceLabel {
  id: string;
  prefix: string;
  line: number;
}

export interface CrossReferenceUsage {
  id: string;
  prefix: string;
  line: number;
}

export interface CrossReferenceIndex {
  labels: CrossReferenceLabel[];
  usages: CrossReferenceUsage[];
  duplicateLabels: string[];
  missingLabels: string[];
}

export function buildCrossReferenceIndex(markdown: string, lineOffset = 0): CrossReferenceIndex {
  const labels = extractLabels(markdown, lineOffset);
  const usages = extractReferenceUsages(markdown, lineOffset);
  const labelCounts = labels.reduce<Record<string, number>>((counts, label) => {
    counts[label.id] = (counts[label.id] ?? 0) + 1;
    return counts;
  }, {});
  const knownLabels = new Set(labels.map((label) => label.id));
  const duplicateLabels = Object.entries(labelCounts)
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  const missingLabels = Array.from(new Set(usages.map((usage) => usage.id).filter((id) => !knownLabels.has(id))));

  return {
    labels,
    usages,
    duplicateLabels,
    missingLabels,
  };
}

export function extractLabels(markdown: string, lineOffset = 0): CrossReferenceLabel[] {
  const labels: CrossReferenceLabel[] = [];
  const lineStarts = lineStartOffsets(markdown);
  const ignoredRanges = crossReferenceIgnoredRanges(markdown);
  const labelPattern = /\{[^}]*#((fig|tbl|eq|sec|lst|nte|tip|wrn|imp|cau)[-:][A-Za-z0-9][A-Za-z0-9_:.-]*)[^}]*}/g;
  let match: RegExpExecArray | null;

  while ((match = labelPattern.exec(markdown))) {
    if (isOffsetInsideRanges(match.index, ignoredRanges)) continue;
    labels.push({
      id: match[1],
      prefix: match[2],
      line: offsetToLine(lineStarts, match.index) + lineOffset,
    });
  }

  return labels;
}

export function extractReferenceUsages(markdown: string, lineOffset = 0): CrossReferenceUsage[] {
  const usages: CrossReferenceUsage[] = [];
  const lineStarts = lineStartOffsets(markdown);
  const ignoredRanges = crossReferenceIgnoredRanges(markdown);
  const usagePattern = /(^|[^\w/])@((fig|tbl|eq|sec|lst|nte|tip|wrn|imp|cau)[-:][A-Za-z0-9][A-Za-z0-9_:.-]*)/g;
  let match: RegExpExecArray | null;

  while ((match = usagePattern.exec(markdown))) {
    const atOffset = match.index + match[1].length;
    if (isOffsetInsideRanges(atOffset, ignoredRanges)) continue;
    const id = match[2].replace(/[.,;]+$/, '');
    usages.push({
      id,
      prefix: match[3],
      line: offsetToLine(lineStarts, atOffset) + lineOffset,
    });
  }

  return usages;
}

function crossReferenceIgnoredRanges(markdown: string) {
  return mergeRanges([
    ...fencedCodeRanges(markdown),
    ...inlineCodeRanges(markdown),
    ...scieMdCommentRanges(markdown),
  ]);
}
