import type { Editor } from '@milkdown/kit/core';
import { useEffect, useRef, useState } from 'react';
import {
  createCodeBlockCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark';
import { callCommand } from '@milkdown/kit/utils';
import {
  Bold,
  ChevronDown,
  Code,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Heading1,
  Heading2,
  Italic,
  ImagePlus,
  GitBranch,
  Link,
  List,
  ListOrdered,
  MessageSquareText,
  Minus,
  MoreHorizontal,
  Quote,
  Redo2,
  Sigma,
  Table,
  Undo2,
  Variable,
} from 'lucide-react';
import type { EditorMode } from '../app/documentState';

interface MarkdownToolbarProps {
  mode: EditorMode;
  visualEditor: Editor | undefined;
  onInsertMarkdown: (markdown: string) => void;
  onInsertImage: () => void;
  onInsertCitation: () => void;
  onInsertVariable: () => void;
  onInsertLlmNote: () => void;
  onInsertHumanNote: () => void;
  onInsertVariantGroup: () => void;
  onOpenTablePicker: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onInsertLink: () => void;
  nextFigureLabel: string;
}

const extraHeadingOptions = [
  { level: 3, label: 'Heading 3', icon: Heading3 },
  { level: 4, label: 'Heading 4', icon: Heading4 },
  { level: 5, label: 'Heading 5', icon: Heading5 },
  { level: 6, label: 'Heading 6', icon: Heading6 },
] as const;

export function MarkdownToolbar({
  mode,
  visualEditor,
  onInsertMarkdown,
  onInsertImage,
  onInsertCitation,
  onInsertVariable,
  onInsertLlmNote,
  onInsertHumanNote,
  onInsertVariantGroup,
  onOpenTablePicker,
  onUndo,
  onRedo,
  onInsertLink,
  nextFigureLabel,
}: MarkdownToolbarProps) {
  const [headingMenuOpen, setHeadingMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const headingMenuRef = useRef<HTMLDivElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  const runVisualCommand = (callback: (editor: Editor) => void, fallback: string) => {
    if (mode === 'visual' && visualEditor) {
      callback(visualEditor);
      return;
    }
    onInsertMarkdown(fallback);
  };

  const insertMarkdownVisualAware = (markdown: string) => {
    onInsertMarkdown(markdown);
  };

  const applyHeading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
    runVisualCommand(
      (editor) => editor.action(callCommand(wrapInHeadingCommand.key, level)),
      `${'#'.repeat(level)} Heading\n\n`,
    );
    setHeadingMenuOpen(false);
  };

  useEffect(() => {
    if (!headingMenuOpen && !moreMenuOpen) return undefined;
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && headingMenuRef.current?.contains(target)) return;
      if (target && moreMenuRef.current?.contains(target)) return;
      setHeadingMenuOpen(false);
      setMoreMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHeadingMenuOpen(false);
        setMoreMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [headingMenuOpen, moreMenuOpen]);

  const runMoreAction = (action: () => void) => {
    action();
    setMoreMenuOpen(false);
  };

  return (
    <div
      className="toolbar"
      role="toolbar"
      aria-label="Markdown formatting toolbar"
      onMouseDown={(event) => {
        if ((event.target as HTMLElement | null)?.closest('button')) event.preventDefault();
      }}
    >
      <button aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" onClick={onUndo}>
        <Undo2 size={18} />
      </button>
      <button aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y)" onClick={onRedo}>
        <Redo2 size={18} />
      </button>
      <span className="toolbar-separator" />
      <button aria-label="Heading 1" title="Heading 1" onClick={() => applyHeading(1)}>
        <Heading1 size={18} />
      </button>
      <button aria-label="Heading 2" title="Heading 2" onClick={() => applyHeading(2)}>
        <Heading2 size={18} />
      </button>
      <div ref={headingMenuRef} className="toolbar-menu-button">
        <button
          aria-label="More heading levels"
          title="More heading levels (H3-H6)"
          aria-haspopup="menu"
          aria-expanded={headingMenuOpen}
          onClick={() => setHeadingMenuOpen((open) => !open)}
        >
          <span className="toolbar-heading-label">H3</span><ChevronDown size={14} />
        </button>
        {headingMenuOpen && (
          <div className="toolbar-menu" role="menu" aria-label="Heading levels">
            {extraHeadingOptions.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.level}
                  role="menuitem"
                  type="button"
                  onClick={() => applyHeading(option.level)}
                >
                  <Icon size={16} />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <span className="toolbar-separator" />
      <button aria-label="Bold" title="Bold: make selected text strong" onClick={() => runVisualCommand((editor) => editor.action(callCommand(toggleStrongCommand.key)), '**bold**')}>
        <Bold size={18} />
      </button>
      <button aria-label="Italic" title="Italic: emphasize selected text" onClick={() => runVisualCommand((editor) => editor.action(callCommand(toggleEmphasisCommand.key)), '*italic*')}>
        <Italic size={18} />
      </button>
      <button aria-label="Inline code" title="Inline code: format selected text as code" onClick={() => runVisualCommand((editor) => editor.action(callCommand(toggleInlineCodeCommand.key)), '`code`')}>
        <Code size={18} />
      </button>
      <button
        aria-label="Link"
        title="Link: add or edit a Markdown link"
        onClick={onInsertLink}
      >
        <Link size={18} />
      </button>
      <span className="toolbar-separator" />
      <button aria-label="Bullet list" title="Bullet list: turn text into unordered list items" onClick={() => runVisualCommand((editor) => editor.action(callCommand(wrapInBulletListCommand.key)), '- Item\n')}>
        <List size={18} />
      </button>
      <button aria-label="Ordered list" title="Ordered list: turn text into numbered list items" onClick={() => runVisualCommand((editor) => editor.action(callCommand(wrapInOrderedListCommand.key)), '1. Item\n')}>
        <ListOrdered size={18} />
      </button>
      <button aria-label="Blockquote" title="Blockquote: format text as a quoted block" onClick={() => runVisualCommand((editor) => editor.action(callCommand(wrapInBlockquoteCommand.key)), '> Quote\n\n')}>
        <Quote size={18} />
      </button>
      <button aria-label="Table" title="Table: choose rows and columns" onClick={onOpenTablePicker}>
        <Table size={18} />
      </button>
      <button className="text-tool" aria-label="Citation" title="Citation: insert or create a citation" onClick={onInsertCitation}>
        Citation
      </button>
      <div ref={moreMenuRef} className="toolbar-menu-button">
        <button
          aria-label="More insert tools"
          title="More insert tools"
          aria-haspopup="menu"
          aria-expanded={moreMenuOpen}
          onClick={() => setMoreMenuOpen((open) => !open)}
        >
          <MoreHorizontal size={18} />
        </button>
        {moreMenuOpen && (
          <div className="toolbar-menu toolbar-more-menu" role="menu" aria-label="More insert tools">
            <button aria-label="Variable" role="menuitem" type="button" onClick={() => runMoreAction(onInsertVariable)}>
              <Variable size={17} />
              <span className="toolbar-more-copy">
                <span>Variable</span>
                <small>Insert or create a reusable value</small>
              </span>
            </button>
            <button aria-label="Note to LLM" role="menuitem" type="button" onClick={() => runMoreAction(onInsertLlmNote)}>
              <MessageSquareText size={17} />
              <span className="toolbar-more-copy">
                <span>Note to LLM</span>
                <small>Anchored guidance for external revision</small>
              </span>
            </button>
            <button aria-label="Text versions" role="menuitem" type="button" onClick={() => runMoreAction(onInsertVariantGroup)}>
              <GitBranch size={17} />
              <span className="toolbar-more-copy">
                <span>Text versions</span>
                <small>Store alternate drafts</small>
              </span>
            </button>
            <span className="toolbar-more-divider" aria-hidden="true" />
            <button role="menuitem" type="button" onClick={() => runMoreAction(() => insertMarkdownVisualAware('- [ ] Task\n'))}>
              <List size={17} />
              <span className="toolbar-more-copy">
                <span>Task</span>
                <small>Checkbox list item</small>
              </span>
            </button>
            <button role="menuitem" type="button" onClick={() => runMoreAction(() => runVisualCommand((editor) => editor.action(callCommand(createCodeBlockCommand.key)), '```text\ncode\n```\n\n'))}>
              <Code size={17} />
              <span className="toolbar-more-copy">
                <span>Code block</span>
                <small>Fenced source code</small>
              </span>
            </button>
            <button role="menuitem" type="button" onClick={() => runMoreAction(() => insertMarkdownVisualAware('$x^2$'))}>
              <Sigma size={17} />
              <span className="toolbar-more-copy">
                <span>Inline math</span>
                <small>Short equation inside text</small>
              </span>
            </button>
            <button role="menuitem" type="button" onClick={() => runMoreAction(() => insertMarkdownVisualAware('$$\nx^2\n$$\n\n'))}>
              <Sigma size={17} />
              <span className="toolbar-more-copy">
                <span>Math block</span>
                <small>Displayed equation</small>
              </span>
            </button>
            <button role="menuitem" type="button" onClick={() => runMoreAction(() => insertMarkdownVisualAware(`:::figure {#${nextFigureLabel}}\n![Figure alt text](assets/figure.png)\n\nFigure caption.\n:::\n\n`))}>
              <Table size={17} />
              <span className="toolbar-more-copy">
                <span>Figure block</span>
                <small>Labeled figure with caption</small>
              </span>
            </button>
            <button role="menuitem" type="button" onClick={() => runMoreAction(onInsertImage)}>
              <ImagePlus size={17} />
              <span className="toolbar-more-copy">
                <span>Image</span>
                <small>Copy into assets and insert</small>
              </span>
            </button>
            <button role="menuitem" type="button" onClick={() => runMoreAction(onInsertHumanNote)}>
              <MessageSquareText size={17} />
              <span className="toolbar-more-copy">
                <span>Note to Human</span>
                <small>Anchored review note</small>
              </span>
            </button>
            <button role="menuitem" type="button" onClick={() => runMoreAction(() => insertMarkdownVisualAware('\n---\n\n'))}>
              <Minus size={17} />
              <span className="toolbar-more-copy">
                <span>Horizontal rule</span>
                <small>Section divider</small>
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
