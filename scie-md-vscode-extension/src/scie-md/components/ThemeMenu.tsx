import { Monitor, Moon, Sun, Sunset } from 'lucide-react';
import type { ThemeMode } from '../services/settingsService';

const THEME_OPTIONS: Array<{
  id: ThemeMode;
  label: string;
  icon: typeof Monitor;
}> = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'sepia', label: 'Sepia', icon: Sunset },
  { id: 'system', label: 'System', icon: Monitor },
];

interface ThemeMenuProps {
  themeMode: ThemeMode;
  open: boolean;
  onToggle: () => void;
  onSelect: (themeMode: ThemeMode) => void;
}

export function ThemeMenu({ themeMode, open, onToggle, onSelect }: ThemeMenuProps) {
  const current = THEME_OPTIONS.find((option) => option.id === themeMode) ?? THEME_OPTIONS[0];
  const CurrentIcon = current.icon;

  return (
    <div className="menu-button">
      <button
        title={`Theme: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="theme-menu"
        onClick={onToggle}
      >
        <CurrentIcon size={16} />Theme: {current.label}
      </button>
      {open && (
        <div id="theme-menu" className="llm-menu style-menu" role="menu" aria-label="Theme options">
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                role="menuitemradio"
                aria-checked={option.id === themeMode}
                className={option.id === themeMode ? 'selected' : ''}
                onClick={() => onSelect(option.id)}
              >
                <Icon size={15} />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
