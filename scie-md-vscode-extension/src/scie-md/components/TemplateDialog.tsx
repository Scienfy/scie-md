import type { ScienfyTemplateId } from '../domain/document/templates';
import { ModalShell } from './ModalShell';
import { DialogActions } from './DialogActions';

interface TemplateDialogProps {
  open: boolean;
  onCreate: (template: ScienfyTemplateId) => void;
  onCancel: () => void;
}

const TEMPLATES: Array<{ id: ScienfyTemplateId; label: string; detail: string; preview: string }> = [
  {
    id: 'paper',
    label: 'Scientific paper',
    detail: 'Structured manuscript with abstract, methods, results, figures, and references.',
    preview: 'Best for papers, preprints, and journal-style reports.',
  },
  {
    id: 'research-statement',
    label: 'Research statement',
    detail: 'Narrative sections for motivation, agenda, fit, and future directions.',
    preview: 'Best for applications, proposals, and lab/program statements.',
  },
  {
    id: 'lab-note',
    label: 'Lab note',
    detail: 'Daily record with goals, protocol, observations, variables, and next steps.',
    preview: 'Best for bench notes, computational logs, and reproducibility records.',
  },
];

export function TemplateDialog({ open, onCreate, onCancel }: TemplateDialogProps) {
  return (
    <ModalShell open={open} titleId="template-title" className="template-dialog" onCancel={onCancel}>
      <header className="dialog-header">
        <div>
          <h2 id="template-title">New From Template</h2>
          <p>Choose a starter document. ScieMD will keep the result as ordinary Markdown.</p>
        </div>
      </header>

      <div className="template-options">
        {TEMPLATES.map((template) => (
          <button key={template.id} type="button" onClick={() => onCreate(template.id)}>
            <span>{template.label}</span>
            <small>{template.detail}</small>
            <em>{template.preview}</em>
          </button>
        ))}
      </div>

      <DialogActions>
        <button type="button" onClick={onCancel}>Cancel</button>
      </DialogActions>
    </ModalShell>
  );
}
