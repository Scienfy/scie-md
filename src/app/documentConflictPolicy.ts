import type { DocumentFormat } from '@sciemd/core';
import { adapterForFormat, documentFormatDefinitions, isMarkdownFormat } from '@sciemd/core';

export type ExternalConflictReviewKind = 'line-review' | 'structured-source';

export function canUseLineConflictReview(format: DocumentFormat): boolean {
  const adapter = adapterForFormat(format);
  return isMarkdownFormat(format) && adapter?.capabilities.conflictMarkersAllowed === true;
}

export function conflictReviewKindForFormat(format: DocumentFormat): ExternalConflictReviewKind {
  return canUseLineConflictReview(format) ? 'line-review' : 'structured-source';
}

export function labelForDocumentFormat(format: DocumentFormat): string {
  return documentFormatDefinitions.find((definition) => definition.format === format)?.label
    ?? adapterForFormat(format)?.label
    ?? format;
}
