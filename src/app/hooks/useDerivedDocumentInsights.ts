import { useMemo } from 'react';
import type { DocumentInsights } from '../../markdown/documentIntelligence';
import { extractHeadings, headingPathForLine } from '@sciemd/core';
import type { MarkdownHeading } from '@sciemd/core';
import type { ValidationIssue } from '../../markdown/markdownValidation';

interface UseDerivedDocumentInsightsParams {
  markdown: string;
  documentInsights: DocumentInsights;
  headings?: MarkdownHeading[];
  currentLine: number;
  validationIssues: ValidationIssue[];
  missingImageCount: number;
}

export function useDerivedDocumentInsights({
  markdown,
  documentInsights,
  headings: providedHeadings,
  currentLine,
  validationIssues,
  missingImageCount,
}: UseDerivedDocumentInsightsParams) {
  const headings = useMemo(() => providedHeadings ?? extractHeadings(markdown), [markdown, providedHeadings]);
  const currentHeadingPath = useMemo(() => headingPathForLine(headings, currentLine), [currentLine, headings]);
  const activeHeadingId = currentHeadingPath.at(-1)?.id ?? null;
  const ambientIssues = useMemo<ValidationIssue[]>(() => {
    if (missingImageCount === 0) return validationIssues;
    return [
      ...validationIssues,
      {
        severity: 'warning',
        code: 'missing-images',
        message: `${missingImageCount} local image file${missingImageCount === 1 ? '' : 's'} missing.`,
      },
    ];
  }, [missingImageCount, validationIssues]);

  return {
    headings: headings as MarkdownHeading[],
    documentInsights,
    currentHeadingPath,
    activeHeadingId,
    ambientIssues,
  };
}
