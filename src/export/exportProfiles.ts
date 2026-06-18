import type { ExportProfile, ExportRequestOptions } from './exportTypes';
import { DEFAULT_EXPORT_OPTIONS, DEFAULT_PDF_EXPORT_OPTIONS } from './exportTypes';

export const BUILTIN_EXPORT_PROFILES: ExportProfile[] = [
  {
    id: 'default',
    name: 'Current document style',
    description: 'Uses the visible ScieMD style, theme, bundled fonts, and standard academic margins.',
    formats: ['html', 'pdf', 'docx', 'epub', 'latex', 'odt', 'jats', 'plain', 'rst', 'asciidoc', 'docbook'],
    pdf: DEFAULT_PDF_EXPORT_OPTIONS,
  },
  {
    id: 'manuscript-a4',
    name: 'Manuscript A4',
    description: 'Readable review draft with wider margins and bottom page numbers.',
    formats: ['pdf', 'docx', 'latex', 'odt'],
    pdf: {
      paperSize: 'A4',
      orientation: 'portrait',
      margins: { top: '22mm', right: '22mm', bottom: '24mm', left: '22mm' },
      pageNumbers: 'bottom-center',
      runningHeader: '',
      runningFooter: '',
    },
  },
  {
    id: 'lab-notebook',
    name: 'Lab notebook',
    description: 'Compact single-column export for internal notes and reproducibility records.',
    formats: ['html', 'pdf', 'docx', 'odt'],
    pdf: {
      paperSize: 'Letter',
      orientation: 'portrait',
      margins: { top: '14mm', right: '14mm', bottom: '16mm', left: '14mm' },
      pageNumbers: 'bottom-right',
      runningHeader: '',
      runningFooter: '',
    },
  },
  {
    id: 'preprint-review',
    name: 'Preprint review',
    description: 'A restrained review PDF profile with extra side margins for annotations.',
    formats: ['pdf', 'docx', 'latex'],
    pdf: {
      paperSize: 'A4',
      orientation: 'portrait',
      margins: { top: '20mm', right: '26mm', bottom: '22mm', left: '26mm' },
      pageNumbers: 'bottom-center',
      runningHeader: '',
      runningFooter: '',
    },
  },
  {
    id: 'conference-two-column',
    name: 'Conference two-column draft',
    description: 'Generic two-column PDF/HTML review layout. Not an official IEEE or ACM template.',
    formats: ['html', 'pdf'],
    pdf: {
      paperSize: 'Letter',
      orientation: 'portrait',
      margins: { top: '18mm', right: '14mm', bottom: '18mm', left: '14mm' },
      pageNumbers: 'bottom-center',
      runningHeader: '',
      runningFooter: '',
    },
    cssOverrides: `
      @media print {
        .scie-md-export-page .visual-editor .ProseMirror {
          column-count: 2;
          column-gap: 9mm;
        }
        .scie-md-export-page .visual-editor .ProseMirror > h1,
        .scie-md-export-page .visual-editor .ProseMirror > h2,
        .scie-md-export-page .visual-editor .ProseMirror > .directive-figure {
          break-after: avoid;
        }
      }
    `,
  },
  {
    id: 'archive-clean',
    name: 'Clean archive copy',
    description: 'Single-column PDF/HTML export with no page numbers and conservative margins.',
    formats: ['html', 'pdf', 'docx', 'odt'],
    pdf: {
      paperSize: 'A4',
      orientation: 'portrait',
      margins: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
      pageNumbers: 'none',
      runningHeader: '',
      runningFooter: '',
    },
  },
];

export function exportProfileById(id: string): ExportProfile {
  return BUILTIN_EXPORT_PROFILES.find((profile) => profile.id === id) ?? BUILTIN_EXPORT_PROFILES[0];
}

export function exportOptionsFromProfile(profileId: string, overrides?: Partial<ExportRequestOptions>): ExportRequestOptions {
  const profile = exportProfileById(profileId);
  const { pdf: overridePdf, ...restOverrides } = overrides ?? {};
  return {
    ...DEFAULT_EXPORT_OPTIONS,
    profileId: profile.id,
    citationStylePath: profile.citationStylePath ?? null,
    extraPandocArgs: profile.extraPandocArgs,
    cssOverrides: profile.cssOverrides,
    ...restOverrides,
    pdf: overridePdf ?? profile.pdf,
  };
}
