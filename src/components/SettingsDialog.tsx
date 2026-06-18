import type { DocumentType, PersistedSettings, ThemeMode } from '../services/settingsService';
import { VISUAL_STYLE_OPTIONS } from '../services/visualStyleService';
import type { VisualStyleId } from '../services/visualStyleService';
import { ModalShell } from './ModalShell';
import { DialogActions } from './DialogActions';

interface SettingsDialogProps {
  open: boolean;
  settings: PersistedSettings;
  onUpdate: (patch: Partial<PersistedSettings>) => void;
  onCheckInkscape: () => void;
  onSetInkscapePath: () => void;
  onOpenWritingDefaults: () => void;
  onClose: () => void;
}

const THEME_OPTIONS: Array<{ id: ThemeMode; label: string }> = [
  { id: 'system', label: 'System' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'sepia', label: 'Sepia' },
];

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  'lab-note': 'Lab note',
  report: 'Report',
  memo: 'Memo',
  notes: 'Notes',
  other: 'Other',
};

export function SettingsDialog({
  open,
  settings,
  onUpdate,
  onCheckInkscape,
  onSetInkscapePath,
  onOpenWritingDefaults,
  onClose,
}: SettingsDialogProps) {
  const selectedStyle = VISUAL_STYLE_OPTIONS.find((style) => style.id === settings.visualStyle) ?? VISUAL_STYLE_OPTIONS[0];

  return (
    <ModalShell open={open} titleId="settings-title" className="settings-dialog" onCancel={onClose}>
      <header className="dialog-header">
        <div>
          <h2 id="settings-title">Settings</h2>
          <p>Adjust app appearance, writing surface defaults, and local tool paths.</p>
        </div>
      </header>

      <div className="settings-grid">
        <section aria-labelledby="settings-appearance-title">
          <h3 id="settings-appearance-title">Appearance</h3>
          <label>
            <span>Theme</span>
            <select value={settings.themeMode} onChange={(event) => onUpdate({ themeMode: event.target.value as ThemeMode })}>
              {THEME_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span>Visual style</span>
            <select value={settings.visualStyle} onChange={(event) => onUpdate({ visualStyle: event.target.value as VisualStyleId })}>
              {VISUAL_STYLE_OPTIONS.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}
            </select>
          </label>
          <p className="settings-hint">{selectedStyle.detail}</p>
          <div className="settings-stepper" aria-label="Font size">
            <span>Font size</span>
            <button type="button" onClick={() => onUpdate({ fontScale: stepFontScale(settings.fontScale, -0.05) })}>-</button>
            <output>{Math.round(settings.fontScale * 100)}%</output>
            <button type="button" onClick={() => onUpdate({ fontScale: stepFontScale(settings.fontScale, 0.05) })}>+</button>
            <button type="button" onClick={() => onUpdate({ fontScale: 1 })}>Reset</button>
          </div>
        </section>

        <section aria-labelledby="settings-surface-title">
          <h3 id="settings-surface-title">Writing Surface</h3>
          <label className="settings-check">
            <input type="checkbox" checked={settings.focusMode} onChange={(event) => onUpdate({ focusMode: event.target.checked })} />
            <span>Focus mode</span>
          </label>
          <label className="settings-check">
            <input type="checkbox" checked={settings.outlineOpen} onChange={(event) => onUpdate({ outlineOpen: event.target.checked })} />
            <span>Show navigation sidebar</span>
          </label>
          <label className="settings-check">
            <input type="checkbox" checked={settings.inspectorOpen} onChange={(event) => onUpdate({ inspectorOpen: event.target.checked })} />
            <span>Show inspector</span>
          </label>
          <label className="settings-check">
            <input type="checkbox" checked={settings.authorshipVisible} onChange={(event) => onUpdate({ authorshipVisible: event.target.checked })} />
            <span>Show authorship/review marks</span>
          </label>
          <div className="settings-defaults">
            <span>Writing defaults</span>
            <strong>{DOCUMENT_TYPE_LABELS[settings.documentType]}</strong>
            <button type="button" onClick={onOpenWritingDefaults}>Choose defaults</button>
          </div>
        </section>

        <section aria-labelledby="settings-tools-title">
          <h3 id="settings-tools-title">Local Tools</h3>
          <div className="settings-tool-row">
            <div>
              <span>Inkscape path</span>
              <small>{settings.inkscapePath || 'Search common install locations'}</small>
            </div>
            <button type="button" onClick={onSetInkscapePath}>Set path</button>
            <button type="button" onClick={onCheckInkscape}>Check</button>
          </div>
          <p className="settings-hint">Inkscape enables external SVG editing and vector conversion for formats that need image assets.</p>
        </section>
      </div>

      <DialogActions>
        <button type="button" className="primary" onClick={onClose}>Done</button>
      </DialogActions>
    </ModalShell>
  );
}

function stepFontScale(current: number, delta: number): number {
  return Math.min(1.35, Math.max(0.85, Math.round((current + delta) * 20) / 20));
}
