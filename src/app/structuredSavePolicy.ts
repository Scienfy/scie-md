import type { DocumentFormat, FormatDiagnostic } from '@sciemd/core';

export interface StructuredSavePolicy {
  format: DocumentFormat;
  autosaveBlocked: boolean;
  manualSaveRequiresConfirmation: boolean;
  reason: string | null;
  diagnostic: FormatDiagnostic | null;
}

export const DEFAULT_STRUCTURED_SAVE_POLICY: StructuredSavePolicy = {
  format: 'markdown',
  autosaveBlocked: false,
  manualSaveRequiresConfirmation: false,
  reason: null,
  diagnostic: null,
};

export function createStructuredSavePolicy({
  format,
  diagnostics,
}: {
  format: DocumentFormat;
  diagnostics: readonly FormatDiagnostic[];
}): StructuredSavePolicy {
  if (!isAutosaveSensitiveStructuredFormat(format)) {
    return { ...DEFAULT_STRUCTURED_SAVE_POLICY, format };
  }

  const parserError = diagnostics.find((diagnostic) => (
    diagnostic.severity === 'error'
    && diagnostic.source === format
    && (diagnostic.category === 'parser' || diagnostic.blocking === true)
  )) ?? null;

  if (!parserError) {
    return { ...DEFAULT_STRUCTURED_SAVE_POLICY, format };
  }

  const location = parserError.line
    ? ` at line ${parserError.line}${parserError.column ? `, column ${parserError.column}` : ''}`
    : '';
  return {
    format,
    autosaveBlocked: true,
    manualSaveRequiresConfirmation: true,
    reason: `Autosave paused: ${formatLabel(format)} syntax is invalid${location}.`,
    diagnostic: parserError,
  };
}

export function structuredSavePolicyEquals(left: StructuredSavePolicy, right: StructuredSavePolicy): boolean {
  return left.format === right.format
    && left.autosaveBlocked === right.autosaveBlocked
    && left.manualSaveRequiresConfirmation === right.manualSaveRequiresConfirmation
    && left.reason === right.reason
    && left.diagnostic?.code === right.diagnostic?.code
    && left.diagnostic?.message === right.diagnostic?.message
    && left.diagnostic?.line === right.diagnostic?.line
    && left.diagnostic?.column === right.diagnostic?.column;
}

export function isAutosaveSensitiveStructuredFormat(format: DocumentFormat): boolean {
  return format === 'json'
    || format === 'jsonl'
    || format === 'yaml'
    || format === 'toml'
    || format === 'xml'
    || format === 'csv'
    || format === 'tsv';
}

export function formatStructuredSaveConfirmation(policy: StructuredSavePolicy): {
  title: string;
  message: string;
  okLabel: string;
  cancelLabel: string;
} {
  const diagnostic = policy.diagnostic;
  const detail = diagnostic
    ? `${diagnostic.message}${diagnostic.line ? ` (line ${diagnostic.line}${diagnostic.column ? `, column ${diagnostic.column}` : ''})` : ''}`
    : 'The current source has parser errors.';
  return {
    title: `Save invalid ${formatLabel(policy.format)} source?`,
    message: [
      `${formatLabel(policy.format)} parser errors mean ScieMD cannot safely validate or visually project this source right now.`,
      '',
      detail,
      '',
      'Save Anyway will write the text exactly as shown in source mode. Recovery draft storage remains active until the save succeeds.',
    ].join('\n'),
    okLabel: 'Save Anyway',
    cancelLabel: 'Cancel',
  };
}

function formatLabel(format: DocumentFormat): string {
  switch (format) {
    case 'json':
      return 'JSON';
    case 'jsonl':
      return 'JSONL';
    case 'yaml':
      return 'YAML';
    case 'toml':
      return 'TOML';
    case 'xml':
      return 'XML';
    case 'csv':
      return 'CSV';
    case 'tsv':
      return 'TSV';
    case 'plainText':
      return 'Plain text';
    case 'markdown':
      return 'Markdown';
  }
}
