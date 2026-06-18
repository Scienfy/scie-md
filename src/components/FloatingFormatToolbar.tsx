import type { Editor } from '@milkdown/kit/core';
import { toggleEmphasisCommand, toggleStrongCommand } from '@milkdown/kit/preset/commonmark';
import { callCommand } from '@milkdown/kit/utils';
import { Bold, Copy, GitBranch, Heading1, Heading2, Italic, LockKeyhole, MessageSquareText, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EditorSelectionSnapshot } from './editorSelection';

interface FloatingFormatToolbarProps {
  enabled: boolean;
  visualEditor: Editor | undefined;
  selectionRoot: HTMLElement | null;
  getSelectionSnapshot: () => EditorSelectionSnapshot;
  onLockSelection: () => void;
  onCommentSelection: (selection: EditorSelectionSnapshot) => void;
  onHumanCommentSelection: (selection: EditorSelectionSnapshot) => void;
  onVariantSelection: () => void;
  onCopySelection: () => void;
  onHeadingSelection: (level: 1 | 2) => void;
  onBlockSelection: () => void;
}

interface ToolbarPosition {
  top: number;
  left: number;
}

export function FloatingFormatToolbar({
  enabled,
  visualEditor,
  selectionRoot,
  getSelectionSnapshot,
  onLockSelection,
  onCommentSelection,
  onHumanCommentSelection,
  onVariantSelection,
  onCopySelection,
  onHeadingSelection,
  onBlockSelection,
}: FloatingFormatToolbarProps) {
  const [position, setPosition] = useState<ToolbarPosition | null>(null);
  const currentSelectionSnapshot = () => getSelectionSnapshot();

  useEffect(() => {
    if (!enabled) {
      setPosition(null);
      return undefined;
    }

    const update = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !selection.toString().trim()) {
        setPosition(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const anchor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
      if (!selectionRoot || !anchor || !selectionRoot.contains(anchor)) {
        setPosition(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setPosition(null);
        return;
      }
      setPosition({
        top: Math.max(56, rect.top - 44),
        left: Math.min(window.innerWidth - 420, Math.max(12, rect.left + rect.width / 2 - 210)),
      });
    };

    document.addEventListener('selectionchange', update);
    window.addEventListener('scroll', update, true);
    return () => {
      document.removeEventListener('selectionchange', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [enabled, selectionRoot]);

  if (!enabled || !visualEditor || !position) return null;

  return (
    <div className="floating-toolbar" role="toolbar" aria-label="Selected text formatting" style={{ top: position.top, left: position.left }}>
      <button aria-label="Bold" onMouseDown={(event) => event.preventDefault()} onClick={() => visualEditor.action(callCommand(toggleStrongCommand.key))}><Bold size={16} /></button>
      <button aria-label="Italic" onMouseDown={(event) => event.preventDefault()} onClick={() => visualEditor.action(callCommand(toggleEmphasisCommand.key))}><Italic size={16} /></button>
      <button aria-label="Create locked section" title="Locked section" onMouseDown={(event) => event.preventDefault()} onClick={onLockSelection}><LockKeyhole size={16} /></button>
      <button aria-label="Add Note to LLM for selection" title="Note to LLM" onMouseDown={(event) => event.preventDefault()} onClick={() => onCommentSelection(currentSelectionSnapshot())}><MessageSquareText size={16} /></button>
      <button aria-label="Add Note to Human for selection" title="Note to Human" onMouseDown={(event) => event.preventDefault()} onClick={() => onHumanCommentSelection(currentSelectionSnapshot())}><UserRound size={16} /></button>
      <button aria-label="Create text versions" title="Text versions" onMouseDown={(event) => event.preventDefault()} onClick={onVariantSelection}><GitBranch size={16} /></button>
      <button aria-label="Copy selection" title="Copy" onMouseDown={(event) => event.preventDefault()} onClick={onCopySelection}><Copy size={16} /></button>
      <button aria-label="Convert selection to H1" title="H1" className="text-tool" onMouseDown={(event) => event.preventDefault()} onClick={() => onHeadingSelection(1)}><Heading1 size={16} /></button>
      <button aria-label="Convert selection to H2" title="H2" className="text-tool" onMouseDown={(event) => event.preventDefault()} onClick={() => onHeadingSelection(2)}><Heading2 size={16} /></button>
      <button aria-label="Wrap selection in block" title="Block" className="text-tool wide" onMouseDown={(event) => event.preventDefault()} onClick={onBlockSelection}>Block</button>
    </div>
  );
}
