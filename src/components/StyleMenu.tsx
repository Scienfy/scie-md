import { Palette } from 'lucide-react';
import { VISUAL_STYLE_OPTIONS } from '../services/visualStyleService';
import type { VisualStyleId } from '../services/visualStyleService';

interface StyleMenuProps {
  currentStyle: {
    label: string;
    shortLabel: string;
  };
  selectedStyleId: VisualStyleId;
  open: boolean;
  onToggle: () => void;
  onSelect: (style: VisualStyleId) => void;
}

export function StyleMenu({ currentStyle, selectedStyleId, open, onToggle, onSelect }: StyleMenuProps) {
  return (
    <div className="menu-button">
      <button
        title={`Visual style: ${currentStyle.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="visual-style-menu"
        onClick={onToggle}
      >
        <Palette size={16} />Style: {currentStyle.shortLabel}
      </button>
      {open && (
        <div id="visual-style-menu" className="llm-menu style-menu" role="menu" aria-label="Visual style presets">
          {VISUAL_STYLE_OPTIONS.map((style) => (
            <button
              key={style.id}
              role="menuitemradio"
              aria-checked={style.id === selectedStyleId}
              className={style.id === selectedStyleId ? 'selected' : ''}
              onClick={() => onSelect(style.id)}
            >
              <span className="style-menu-copy">
                <span>{style.label}</span>
                <small>{style.detail}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
