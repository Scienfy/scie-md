import { useEffect, useMemo, useState } from 'react';
import { Clipboard, Table2, X } from 'lucide-react';
import { tabularSourceHash, type DelimitedTextConversionFormat, type DelimitedTextConversionPreview } from '@sciemd/core';
import type { StructuredConversionAction, StructuredConversionRequest } from '../app/structuredConversionActions';
import { DialogActions } from './DialogActions';
import { ModalShell } from './ModalShell';

interface TabularPasteDialogProps {
  open: boolean;
  preview: DelimitedTextConversionPreview | null;
  sourceText?: string;
  defaultFormat?: DelimitedTextConversionFormat;
  onInsert: (content: string, format: DelimitedTextConversionFormat) => void;
  onCopy: (content: string, format: DelimitedTextConversionFormat) => void;
  onConversionAction?: (request: StructuredConversionRequest) => void;
  onCancel: () => void;
}

export function TabularPasteDialog({
  open,
  preview,
  sourceText,
  defaultFormat = 'markdown',
  onInsert,
  onCopy,
  onConversionAction,
  onCancel,
}: TabularPasteDialogProps) {
  const [selectedFormat, setSelectedFormat] = useState<DelimitedTextConversionFormat>(defaultFormat);

  useEffect(() => {
    setSelectedFormat(defaultFormat);
  }, [defaultFormat, preview]);

  const options = useMemo(() => preview ? [
    preview.markdown,
    preview.json,
    preview.jsonl,
    preview.yaml,
    preview.toml,
  ] : [], [preview]);
  const selected = options.find((option) => option.format === selectedFormat) ?? options[0];
  const warnings = selected?.diagnostics.filter((diagnostic) => diagnostic.severity !== 'info') ?? [];
  const dispatchConversionAction = (action: StructuredConversionAction) => {
    if (!preview || !selected || !onConversionAction) return;
    onConversionAction({
      action,
      content: selected.content,
      format: selected.format,
      label: selected.label,
      sourceFormat: preview.parsed.delimiter === '\t' ? 'tsv' : 'csv',
      sourceHash: sourceText === undefined ? undefined : tabularSourceHash(sourceText),
      warnings: warnings.map((warning) => warning.message),
    });
    onCancel();
  };

  if (!open || !preview || !selected) return null;

  return (
    <ModalShell open={open} titleId="tabular-paste-title" className="tabular-paste-dialog" onCancel={onCancel}>
      <header className="tabular-paste-header">
        <div>
          <h2 id="tabular-paste-title">Delimited Paste</h2>
          <p>{preview.parsed.dataRowCount} rows, {preview.parsed.columnCount} columns, {preview.parsed.delimiterLabel.toLowerCase()} delimiter.</p>
        </div>
        <button type="button" aria-label="Close delimited paste preview" onClick={onCancel}><X size={16} /></button>
      </header>

      <div className="tabular-paste-options" role="radiogroup" aria-label="Conversion format">
        {options.map((option) => (
          <label key={option.format} className={selectedFormat === option.format ? 'selected' : ''}>
            <input
              type="radio"
              name="tabular-paste-format"
              checked={selectedFormat === option.format}
              onChange={() => setSelectedFormat(option.format)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>

      {warnings.length > 0 && (
        <section className="tabular-paste-warnings" aria-label="Conversion warnings">
          {warnings.slice(0, 5).map((warning, index) => (
            <p key={`${warning.code}:${warning.line ?? 0}:${warning.column ?? 0}:${index}`}>{warning.message}</p>
          ))}
          {warnings.length > 5 && <p>{warnings.length - 5} more warnings in this paste.</p>}
        </section>
      )}

      <section className="tabular-paste-preview" aria-label={`${selected.label} preview`}>
        <div>
          <Table2 size={15} />
          <strong>{selected.label}</strong>
        </div>
        <pre>{truncatePreview(selected.content)}</pre>
      </section>

      <DialogActions>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" onClick={() => onCopy(selected.content, selected.format)}>
          <Clipboard size={15} />
          Copy
        </button>
        <button type="button" disabled={!onConversionAction} onClick={() => dispatchConversionAction('open-new')}>Open as new</button>
        <button type="button" disabled={!onConversionAction} onClick={() => dispatchConversionAction('save-as')}>Save as</button>
        <button type="button" className="primary" onClick={() => onInsert(selected.content, selected.format)}>
          Insert
        </button>
      </DialogActions>
    </ModalShell>
  );
}

function truncatePreview(value: string): string {
  return value.length > 6000 ? `${value.slice(0, 6000)}\n...` : value;
}
