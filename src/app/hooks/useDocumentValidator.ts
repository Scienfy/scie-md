import { useCallback, useEffect, useState } from 'react';
import type { MarkdownValidation } from '../../markdown/markdownValidation';
import { validateMarkdown } from '../../markdown/markdownValidation';
import type { ParsedScienfyDocument } from '../../domain/document/documentModel';

export function useDocumentValidator(
  markdown: string,
  parsedDocument: ParsedScienfyDocument,
  parsedMarkdown = markdown,
) {
  const currentParsedDocument = parsedMarkdown === markdown ? parsedDocument : undefined;
  const [validation, setValidation] = useState<MarkdownValidation>(() => validateMarkdown(markdown, undefined, currentParsedDocument));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setValidation(validateMarkdown(markdown, undefined, currentParsedDocument));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [currentParsedDocument, markdown]);

  const validateNow = useCallback((nextMarkdown = markdown, sizeBytes?: number, nextParsedDocument?: ParsedScienfyDocument) => {
    const nextValidation = validateMarkdown(nextMarkdown, sizeBytes, nextParsedDocument ?? (
      nextMarkdown === markdown ? currentParsedDocument : undefined
    ));
    setValidation(nextValidation);
    return nextValidation;
  }, [currentParsedDocument, markdown]);

  return { validation, setValidation, validateNow };
}
