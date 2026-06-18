import { useEffect, useMemo, useState } from 'react';
import { Database, Plus, Save } from 'lucide-react';
import { ModalShell } from './ModalShell';
import { DialogActions } from './DialogActions';
import type { VariableDefinition } from '../domain/variables/variableIndex';
import { VARIABLE_NAME_PATTERN } from '../domain/variables/variableEditing';

export type VariableDialogState =
  | { mode: 'insert' }
  | { mode: 'edit'; name: string };

interface VariableDialogProps {
  state: VariableDialogState | null;
  definitions: VariableDefinition[];
  suggestedName: string;
  onUseExisting: (name: string) => void;
  onCreate: (name: string, value: string) => void;
  onSave: (originalName: string, nextName: string, value: string) => void;
  onCancel: () => void;
}

export function VariableDialog({
  state,
  definitions,
  suggestedName,
  onUseExisting,
  onCreate,
  onSave,
  onCancel,
}: VariableDialogProps) {
  const open = Boolean(state);
  const uniqueDefinitions = useMemo(() => uniqueVariables(definitions), [definitions]);
  const editedDefinition = state?.mode === 'edit'
    ? uniqueDefinitions.find((definition) => definition.name === state.name)
    : undefined;
  const [name, setName] = useState(suggestedName);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!state) return;
    if (state.mode === 'insert') {
      setName(suggestedName);
      setValue('');
      return;
    }
    setName(state.name);
    setValue(editedDefinition?.value ?? '');
  }, [editedDefinition?.value, state, suggestedName]);

  if (!state) return null;

  const trimmedName = name.trim();
  const validName = VARIABLE_NAME_PATTERN.test(trimmedName);
  const trimmedValue = value.trim();

  const submit = () => {
    if (!validName) return;
    if (state.mode === 'edit') {
      onSave(state.name, trimmedName, trimmedValue);
      return;
    }
    onCreate(trimmedName, trimmedValue);
  };

  return (
    <ModalShell open={open} titleId="variable-dialog-title" className="variable-dialog" onCancel={onCancel}>
      <div className="variable-dialog-header">
        <Database size={18} />
        <div>
          <h2 id="variable-dialog-title">{state.mode === 'edit' ? 'Edit variable' : 'Insert variable'}</h2>
          <p>{state.mode === 'edit' ? 'Update the variable name or value from Visual mode.' : 'Use an existing value or create a new front matter variable.'}</p>
        </div>
      </div>

      {state.mode === 'insert' && (
        <section className="variable-dialog-section">
          <strong>Use existing</strong>
          {uniqueDefinitions.length === 0 ? (
            <p className="outline-empty">No variables yet.</p>
          ) : (
            <div className="variable-choice-list">
              {uniqueDefinitions.map((definition) => (
                <button key={`${definition.source}-${definition.name}`} type="button" onClick={() => onUseExisting(definition.name)}>
                  <span>{definition.name}</span>
                  <code>{definition.value}</code>
                  <small>{definition.file ?? definition.source}</small>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="variable-dialog-section">
        <strong>{state.mode === 'edit' ? 'Variable details' : 'Create new'}</strong>
        {state.mode === 'edit' && editedDefinition?.source === 'external' && (
          <p className="variable-dialog-note">
            This value came from {editedDefinition.file ?? 'a linked data file'}. Saving here creates a front matter override for this document.
          </p>
        )}
        <label>
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>
        <label>
          <span>Value</span>
          <input value={value} placeholder="Value, label, number, or leave blank" onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }} />
        </label>
        {!validName && (
          <p className="variable-dialog-error">Use a name like sample_count, exp1.p_value, or reactor-temp.</p>
        )}
      </section>

      <DialogActions>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" disabled={!validName} onClick={submit}>
          {state.mode === 'edit' ? <Save size={15} /> : <Plus size={15} />}
          {state.mode === 'edit' ? 'Save variable' : 'Create and insert'}
        </button>
      </DialogActions>
    </ModalShell>
  );
}

function uniqueVariables(definitions: VariableDefinition[]): VariableDefinition[] {
  const map = new Map<string, VariableDefinition>();
  for (const definition of definitions) {
    map.set(definition.name, definition);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}
