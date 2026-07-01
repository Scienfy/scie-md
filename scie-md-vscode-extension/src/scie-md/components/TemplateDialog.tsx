import {
  SCIEMD_TEMPLATES,
  type ScieMdTemplateDefinition,
  type ScienfyTemplateId,
} from '../domain/document/templates';
import { ModalShell } from './ModalShell';
import { DialogActions } from './DialogActions';

interface TemplateDialogProps {
  open: boolean;
  onCreate: (template: ScienfyTemplateId) => void;
  onCancel: () => void;
}

export function TemplateDialog({ open, onCreate, onCancel }: TemplateDialogProps) {
  return (
    <ModalShell open={open} titleId="template-title" className="template-dialog" onCancel={onCancel}>
      <header className="dialog-header">
        <div>
          <h2 id="template-title">New Document</h2>
          <p>Choose a file format. ScieMD will create a small valid starting point and open it in the matching editor view.</p>
        </div>
      </header>

      <div className="template-option-groups">
        <TemplateGroup title="Document" templates={templatesByGroup('writing')} onCreate={onCreate} />
        <TemplateGroup title="Structured data" templates={templatesByGroup('structured')} onCreate={onCreate} />
        <TemplateGroup title="Plain text" templates={templatesByGroup('plain')} onCreate={onCreate} />
      </div>

      <DialogActions>
        <button type="button" onClick={onCancel}>Cancel</button>
      </DialogActions>
    </ModalShell>
  );
}

function TemplateGroup({
  title,
  templates,
  onCreate,
}: {
  title: string;
  templates: readonly ScieMdTemplateDefinition[];
  onCreate: (template: ScienfyTemplateId) => void;
}) {
  if (templates.length === 0) return null;
  return (
    <section className="template-option-group" aria-label={title}>
      <h3>{title}</h3>
      <div className="template-options">
        {templates.map((template) => (
          <button key={template.id} type="button" onClick={() => onCreate(template.id)}>
            <span>{template.label}</span>
            <small>{template.detail}</small>
            <em>{template.preview}</em>
          </button>
        ))}
      </div>
    </section>
  );
}

function templatesByGroup(group: ScieMdTemplateDefinition['group']): readonly ScieMdTemplateDefinition[] {
  return SCIEMD_TEMPLATES.filter((template) => template.group === group);
}
