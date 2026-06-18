import { applyThreeWayDiffDecisions, createDiffHunks } from '../shared/markdown/diffReview';
import { computeMinimalTextReplacement } from './textEdit';

export interface DocumentReplacementPlan {
  text: string;
  replacement: ReturnType<typeof computeMinimalTextReplacement>;
  mergedStaleBase: boolean;
}

export interface DocumentReplacementInput {
  currentText: string;
  currentVersion?: number;
  requestedText: string;
  baseText?: string;
  baseVersion?: number;
  lastAppliedWebviewText?: string;
  rejectedHunkIds?: Set<string>;
}

export function createDocumentReplacementPlan(input: DocumentReplacementInput): DocumentReplacementPlan {
  const text = shouldMergeAgainstCurrentDocument(input)
    ? mergeWebviewEditWithCurrentDocument(input.baseText as string, input.requestedText, input.currentText, input.rejectedHunkIds ?? new Set())
    : input.requestedText;

  return {
    text,
    replacement: computeMinimalTextReplacement(input.currentText, text),
    mergedStaleBase: text !== input.requestedText,
  };
}

function shouldMergeAgainstCurrentDocument({
  currentText,
  currentVersion,
  requestedText,
  baseText,
  baseVersion,
  lastAppliedWebviewText,
}: DocumentReplacementInput): boolean {
  if (baseText === undefined) return false;
  if (baseVersion !== undefined && currentVersion !== undefined && currentVersion === baseVersion) return false;
  if (currentText === baseText) return false;
  if (currentText === requestedText) return false;
  if (lastAppliedWebviewText !== undefined && currentText === lastAppliedWebviewText) return false;
  return true;
}

function mergeWebviewEditWithCurrentDocument(baseText: string, requestedText: string, currentText: string, rejectedHunkIds: Set<string>): string {
  return applyThreeWayDiffDecisions(
    baseText,
    requestedText,
    currentText,
    createDiffHunks(baseText, currentText),
    rejectedHunkIds,
  );
}
