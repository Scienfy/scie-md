import { describe, expect, it } from 'vitest';
import { ensureExportFileExtension, exportFileExtension, normalizeExportOptions } from './exportTypes';

describe('exportTypes', () => {
  it('maps extended export formats to save extensions', () => {
    expect(exportFileExtension('pdf')).toBe('pdf');
    expect(exportFileExtension('latex')).toBe('tex');
    expect(exportFileExtension('jats')).toBe('xml');
    expect(exportFileExtension('docbook')).toBe('xml');
    expect(exportFileExtension('plain')).toBe('txt');
    expect(exportFileExtension('asciidoc')).toBe('adoc');
  });

  it('adds the expected extension when a save path has none', () => {
    expect(ensureExportFileExtension('C:\\Users\\Amin\\Downloads\\Paper', 'pdf')).toBe('C:\\Users\\Amin\\Downloads\\Paper.pdf');
    expect(ensureExportFileExtension('exports/paper', 'html')).toBe('exports/paper.html');
    expect(ensureExportFileExtension('exports/paper.tex', 'latex')).toBe('exports/paper.tex');
  });

  it('replaces mismatched extensions with the selected export format', () => {
    expect(ensureExportFileExtension('exports/paper.docx', 'pdf')).toBe('exports/paper.pdf');
    expect(ensureExportFileExtension('C:\\Users\\Amin\\Downloads\\Paper.pdf', 'docx')).toBe('C:\\Users\\Amin\\Downloads\\Paper.docx');
    expect(ensureExportFileExtension('exports/paper.md', 'plain')).toBe('exports/paper.txt');
  });

  it('normalizes invalid persisted export options safely', () => {
    const options = normalizeExportOptions({
      profileId: '',
      pdf: {
        paperSize: 'Huge',
        orientation: 'sideways',
        margins: { top: 'bad', right: '11mm', bottom: '12px', left: '2em' },
        pageNumbers: 'middle',
      },
      citationStylePath: '  C:/styles/nature.csl  ',
    });

    expect(options.profileId).toBe('default');
    expect(options.pdf.paperSize).toBe('A4');
    expect(options.pdf.orientation).toBe('portrait');
    expect(options.pdf.margins.right).toBe('11mm');
    expect(options.pdf.margins.left).toBe('16mm');
    expect(options.pdf.pageNumbers).toBe('bottom-center');
    expect(options.citationStylePath).toBe('C:/styles/nature.csl');
  });
});
