import { useDeferredValue, useEffect, useState } from 'react';
import type { DocumentFormat } from '@sciemd/core';
import { isTransientFormatParserWorkerFailure, parseFormatDocumentAsync } from '../../domain/formats/formatParserWorker';
import {
  createFormatParserFailureDiagnosticState,
  parseSourceFormatDiagnostics,
  shouldUseSourceOnlyFormatParsing,
  sourceFormatDiagnosticsFromParseResult,
} from '../formatDiagnostics';
import type { SourceFormatDiagnosticState, SourceFormatDiagnosticsOptions } from '../formatDiagnostics';

export interface AsyncSourceFormatDiagnosticState extends SourceFormatDiagnosticState {
  parsingPending: boolean;
}

interface ParsedSourceFormatState {
  format: DocumentFormat;
  text: string;
  path: string | null;
  schemaKey: string;
  diagnostics: SourceFormatDiagnosticState;
  parsingPending: boolean;
}

const EMPTY_SOURCE_DIAGNOSTICS: SourceFormatDiagnosticState = {
  diagnostics: [],
  structuredModel: null,
  jsonAnalysis: null,
  jsonlAnalysis: null,
  structuredAnalysis: null,
  tabularAnalysis: null,
};

export function useSourceFormatDiagnostics(
  format: DocumentFormat,
  text: string,
  path: string | null,
  options: SourceFormatDiagnosticsOptions = {},
): AsyncSourceFormatDiagnosticState {
  const deferredText = useDeferredValue(text);
  const deferredJsonSchema = useDeferredValue(options.jsonSchema ?? null);
  const [parsedState, setParsedState] = useState<ParsedSourceFormatState>(() => ({
    format: 'markdown',
    text: '',
    path: null,
    schemaKey: '',
    diagnostics: EMPTY_SOURCE_DIAGNOSTICS,
    parsingPending: false,
  }));

  useEffect(() => {
    const schemaKey = jsonSchemaKey(deferredJsonSchema);
    if (format === 'markdown') {
      setParsedState((current) => current.format === 'markdown' && !current.parsingPending
        ? current
        : {
          format,
          text: deferredText,
          path,
          schemaKey,
          diagnostics: EMPTY_SOURCE_DIAGNOSTICS,
          parsingPending: false,
        });
      return undefined;
    }

    if (shouldUseSourceOnlyFormatParsing(format, deferredText)) {
      setParsedState({
        format,
        text: deferredText,
        path,
        schemaKey,
        diagnostics: parseSourceFormatDiagnostics(format, deferredText, path, { jsonSchema: deferredJsonSchema }),
        parsingPending: false,
      });
      return undefined;
    }

    let cancelled = false;
    setParsedState((current) => ({
      format,
      text: deferredText,
      path,
      schemaKey,
      diagnostics: canReusePendingDiagnostics(current, format, path, schemaKey)
        ? current.diagnostics
        : EMPTY_SOURCE_DIAGNOSTICS,
      parsingPending: true,
    }));
    const parsePromise = format === 'json'
      ? parseFormatDocumentAsync(format, deferredText, path, { schema: deferredJsonSchema })
      : parseFormatDocumentAsync(format, deferredText, path);
    void parsePromise
      .then((parseResult) => {
        if (cancelled) return;
        setParsedState({
          format,
          text: deferredText,
          path,
          schemaKey,
          diagnostics: sourceFormatDiagnosticsFromParseResult(parseResult),
          parsingPending: false,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        if (isTransientFormatParserWorkerFailure(error)) {
          console.warn('Format parser worker could not complete; source editing remains available.', error);
          setParsedState({
            format,
            text: deferredText,
            path,
            schemaKey,
            diagnostics: createFormatParserFailureDiagnosticState(format, deferredText, path, error),
            parsingPending: false,
          });
          return;
        }
        console.warn('Format parser worker failed; falling back to synchronous diagnostics.', error);
        setParsedState({
          format,
          text: deferredText,
          path,
          schemaKey,
          diagnostics: parseSourceFormatDiagnostics(format, deferredText, path, { jsonSchema: deferredJsonSchema }),
          parsingPending: false,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [deferredJsonSchema, deferredText, format, path]);

  if (format === 'markdown') return { ...EMPTY_SOURCE_DIAGNOSTICS, parsingPending: false };
  const schemaKey = jsonSchemaKey(options.jsonSchema ?? null);
  const sameDocument = parsedState.format === format
    && parsedState.path === path
    && parsedState.schemaKey === schemaKey;
  if (!sameDocument) return { ...EMPTY_SOURCE_DIAGNOSTICS, parsingPending: true };
  const current = parsedState.text === text;
  if (!current) {
    return {
      ...parsedState.diagnostics,
      parsingPending: true,
    };
  }
  return {
    ...parsedState.diagnostics,
    parsingPending: parsedState.parsingPending,
  };
}

function canReusePendingDiagnostics(
  current: ParsedSourceFormatState,
  format: DocumentFormat,
  path: string | null,
  schemaKey: string,
): boolean {
  return current.format === format
    && current.path === path
    && current.schemaKey === schemaKey;
}

function jsonSchemaKey(schema: SourceFormatDiagnosticsOptions['jsonSchema']): string {
  if (!schema) return '';
  return `${schema.kind}:${schema.path ?? ''}:${schema.text.length}:${schema.text.slice(0, 128)}`;
}
