import type { DocumentFormat } from '@sciemd/core';

export type StructuredConversionAction = 'copy' | 'replace-current' | 'open-new' | 'save-as';

export interface StructuredConversionRequest {
  action: StructuredConversionAction;
  content: string;
  format: DocumentFormat;
  label: string;
  sourceFormat?: DocumentFormat;
  sourceHash?: string;
  warnings?: readonly string[];
}

export function conversionActionLabel(action: StructuredConversionAction): string {
  switch (action) {
    case 'copy':
      return 'Copy';
    case 'replace-current':
      return 'Replace current';
    case 'open-new':
      return 'Open as new';
    case 'save-as':
      return 'Save as';
  }
}
