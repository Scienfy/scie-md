import { AlertTriangle, FileText, Image as ImageIcon, Lightbulb, MessageSquareText, Star, TrendingUp } from 'lucide-react';
import { ModalShell } from './ModalShell';
import { DialogActions } from './DialogActions';
import type { SemanticBlockType } from '@sciemd/core';

export type SelectionBlockType = SemanticBlockType;

interface BlockTypeDialogProps {
  open: boolean;
  mode?: 'insert' | 'wrap';
  onSelect: (type: SelectionBlockType) => void;
  onCancel: () => void;
}

const BLOCK_OPTIONS: Array<{
  id: SelectionBlockType;
  label: string;
  detail: string;
  icon: typeof FileText;
}> = [
  { id: 'figure', label: 'Figure', detail: 'Captioned figure or diagram', icon: ImageIcon },
  { id: 'note', label: 'Note', detail: 'Neutral supporting context', icon: FileText },
  { id: 'callout', label: 'Callout', detail: 'A highlighted takeaway', icon: MessageSquareText },
  { id: 'tip', label: 'Tip', detail: 'A practical recommendation', icon: Lightbulb },
  { id: 'important', label: 'Important', detail: 'A high-priority claim', icon: Star },
  { id: 'warning', label: 'Warning', detail: 'A caveat, risk, or limitation', icon: AlertTriangle },
  { id: 'result', label: 'Result', detail: 'A finding or measurement summary', icon: TrendingUp },
];

export function BlockTypeDialog({ open, mode = 'wrap', onSelect, onCancel }: BlockTypeDialogProps) {
  return (
    <ModalShell open={open} titleId="block-type-title" className="block-type-dialog" onCancel={onCancel}>
      <h2 id="block-type-title">{mode === 'insert' ? 'Insert block' : 'Wrap selection as block'}</h2>
      <p>{mode === 'insert' ? 'Choose the semantic block type to insert.' : 'Choose the semantic block type. The selected text will become the block body.'}</p>
      <div className="block-type-grid">
        {BLOCK_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <button key={option.id} type="button" onClick={() => onSelect(option.id)}>
              <Icon size={18} />
              <span>{option.label}</span>
              <small>{option.detail}</small>
            </button>
          );
        })}
      </div>
      <DialogActions>
        <button type="button" onClick={onCancel}>Cancel</button>
      </DialogActions>
    </ModalShell>
  );
}
