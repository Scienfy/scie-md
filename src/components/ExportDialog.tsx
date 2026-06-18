import { useEffect, useState } from 'react';
import type { ExportFormat, ExportRequestOptions, PageNumberMode, PageOrientation, PaperSize } from '../export/exportTypes';
import { normalizeExportOptions } from '../export/exportTypes';
import { ModalShell } from './ModalShell';
import { DialogActions } from './DialogActions';

interface ExportDialogProps {
  open: boolean;
  format: ExportFormat | null;
  initialOptions: ExportRequestOptions;
  onCancel: () => void;
  onExport: (format: ExportFormat, options: ExportRequestOptions) => void;
}

export function ExportDialog({ open, format, initialOptions, onCancel, onExport }: ExportDialogProps) {
  const [options, setOptions] = useState<ExportRequestOptions>(() => normalizeExportOptions(initialOptions));

  useEffect(() => {
    if (!open) return;
    setOptions(normalizeExportOptions(initialOptions));
  }, [initialOptions, open]);

  if (!format) return null;
  const title = format === 'html' ? 'Export HTML' : `Export ${format.toUpperCase()}`;
  const formatDetail = exportFormatDetail(format);
  function updatePdf<K extends keyof ExportRequestOptions['pdf']>(key: K, value: ExportRequestOptions['pdf'][K]) {
    setOptions((current) => ({
      ...current,
      pdf: {
        ...current.pdf,
        [key]: value,
      },
    }));
  }
  function updateMargin(key: keyof ExportRequestOptions['pdf']['margins'], value: string) {
    setOptions((current) => ({
      ...current,
      pdf: {
        ...current.pdf,
        margins: {
          ...current.pdf.margins,
          [key]: value,
        },
      },
    }));
  }

  return (
    <ModalShell open={open} titleId="export-dialog-title" className="export-dialog export-dialog-compact" onCancel={onCancel}>
      <header className="dialog-header">
        <div>
          <h2 id="export-dialog-title">{title}</h2>
          <p>{formatDetail}</p>
        </div>
      </header>

      <div className="export-compact-summary">
        <strong>Current view only</strong>
        <span>ScieMD will use the visible document style, theme, width, spacing, blocks, figures, and bundled fonts. If the visual frame cannot be captured, no export file will be written.</span>
      </div>

      {format === 'pdf' && (
        <section className="export-options-panel" aria-label="PDF export options">
          <div className="export-options-grid">
            <label className="export-field">
              <span>Paper size</span>
              <select value={options.pdf.paperSize} onChange={(event) => updatePdf('paperSize', event.target.value as PaperSize)}>
                {paperSizes.map((paperSize) => <option key={paperSize} value={paperSize}>{paperSize}</option>)}
              </select>
            </label>
            <label className="export-field">
              <span>Orientation</span>
              <select value={options.pdf.orientation} onChange={(event) => updatePdf('orientation', event.target.value as PageOrientation)}>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </label>
            <label className="export-field">
              <span>Page numbers</span>
              <select value={options.pdf.pageNumbers} onChange={(event) => updatePdf('pageNumbers', event.target.value as PageNumberMode)}>
                <option value="none">None</option>
                <option value="bottom-center">Bottom center</option>
                <option value="bottom-right">Bottom right</option>
                <option value="top-right">Top right</option>
              </select>
            </label>
            <label className="export-field">
              <span>Running header</span>
              <input value={options.pdf.runningHeader} onChange={(event) => updatePdf('runningHeader', event.target.value)} placeholder="Optional header text" />
            </label>
            <label className="export-field">
              <span>Running footer</span>
              <input value={options.pdf.runningFooter} onChange={(event) => updatePdf('runningFooter', event.target.value)} placeholder="Optional footer text" />
            </label>
          </div>
          <fieldset className="export-margin-grid">
            <legend>Margins</legend>
            {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
              <label key={side}>
                <span>{side}</span>
                <input value={options.pdf.margins[side]} onChange={(event) => updateMargin(side, event.target.value)} />
              </label>
            ))}
          </fieldset>
        </section>
      )}

      <DialogActions>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" onClick={() => onExport(format, normalizeExportOptions(options))}>Export</button>
      </DialogActions>
    </ModalShell>
  );
}

const paperSizes: PaperSize[] = ['A4', 'Letter', 'Legal', 'A5', 'B5'];

function exportFormatDetail(format: ExportFormat): string {
  switch (format) {
    case 'pdf':
      return 'Creates a PDF from the current visual document view.';
    case 'docx':
      return 'Creates a Word document from the current visual document view.';
    case 'html':
      return 'Creates a standalone HTML file from the current visual document view.';
    case 'epub':
      return 'Creates an EPUB package through Pandoc.';
    case 'latex':
      return 'Creates a LaTeX source file through Pandoc.';
    case 'odt':
      return 'Creates an OpenDocument text file through Pandoc.';
    case 'jats':
      return 'Creates JATS XML for journal submission pipelines.';
    case 'rst':
      return 'Creates reStructuredText through Pandoc.';
    case 'asciidoc':
      return 'Creates AsciiDoc through Pandoc.';
    case 'docbook':
      return 'Creates DocBook XML through Pandoc.';
    case 'plain':
      return 'Creates a plain text export through Pandoc.';
    default:
      return 'Creates an export from the current visual document view.';
  }
}
