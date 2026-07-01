import { useCallback, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import type { EditorMode } from '../documentState';
import type { FormatUiCapabilities } from '../formatCapabilities';
import type { SlashCommandItem } from '../../components/SlashCommandMenu';
import { createSemanticBlockMarkdown } from '@sciemd/core';

interface SlashMenuState {
  top: number;
  left: number;
  initialCommandId?: string;
}

interface SlashCommandMenuParams {
  mode: EditorMode;
  formatCapabilities: FormatUiCapabilities;
  markdown: string;
  currentLine: number;
  currentColumn: number;
  editorStageRef: RefObject<HTMLElement | null>;
  insertMarkdown: (markdown: string) => void;
  onVariableCommand?: () => void;
  onCitationCommand?: () => void;
  onImageCommand?: () => void;
  onLockedSectionCommand?: () => void;
  onLlmNoteCommand?: () => void;
  onHumanNoteCommand?: () => void;
  onLlmInstructionCommand?: () => void;
  onVersionCommand?: () => void;
  nextFigureLabel: string;
}

const SLASH_MENU_ESTIMATED_HEIGHT = 430;
const SLASH_MENU_VIEWPORT_MARGIN = 16;

export function useSlashCommandMenu({
  mode,
  formatCapabilities,
  markdown,
  currentLine,
  currentColumn,
  editorStageRef,
  insertMarkdown,
  onVariableCommand,
  onCitationCommand,
  onImageCommand,
  onLockedSectionCommand,
  onLlmNoteCommand,
  onHumanNoteCommand,
  onLlmInstructionCommand,
  onVersionCommand,
  nextFigureLabel,
}: SlashCommandMenuParams) {
  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);

  const blockCommands = useMemo<SlashCommandItem[]>(() => [
    { id: 'figure-block', label: 'Figure block', detail: 'Captioned figure or diagram', markdown: createSemanticBlockMarkdown('figure', { figureLabel: nextFigureLabel }), preview: 'figure' },
    { id: 'note-block', label: 'Note block', detail: 'Supporting note that stays with the text', markdown: createSemanticBlockMarkdown('note'), preview: 'note' },
    { id: 'callout-block', label: 'Callout block', detail: 'Highlighted takeaway for the reader', markdown: createSemanticBlockMarkdown('callout'), preview: 'callout' },
    { id: 'tip-block', label: 'Tip block', detail: 'Practical recommendation or next step', markdown: createSemanticBlockMarkdown('tip'), preview: 'tip' },
    { id: 'important-block', label: 'Important block', detail: 'High-priority claim or constraint', markdown: createSemanticBlockMarkdown('important'), preview: 'important' },
    { id: 'warning-block', label: 'Warning block', detail: 'Limitation, caveat, or risk', markdown: createSemanticBlockMarkdown('warning'), preview: 'warning' },
    { id: 'result-block', label: 'Result block', detail: 'Result plus interpretation', markdown: createSemanticBlockMarkdown('result'), preview: 'result' },
  ], [nextFigureLabel]);

  const slashCommands = useMemo<SlashCommandItem[]>(() => [
    { id: 'block', label: 'Block', detail: 'Figure, note, callout, tip, important, warning, or result', markdown: '', preview: 'note', children: blockCommands },
    { id: 'table', label: 'Table', detail: 'Choose rows and columns', markdown: '', preview: 'table' },
    ...(formatCapabilities.canUseVariablesPanel ? [{ id: 'variable', label: 'Variable', detail: 'Resolved from front matter or linked JSON/CSV data', markdown: '{{ variable_name }}', preview: 'variable' } satisfies SlashCommandItem] : []),
    ...(formatCapabilities.canUseCitations ? [{ id: 'citation', label: 'Citation', detail: 'Pandoc citation key', markdown: '[@citation-key]', preview: 'citation' } satisfies SlashCommandItem] : []),
    ...(formatCapabilities.canUseImageInsertion ? [{ id: 'image', label: 'Image', detail: 'Copy image into assets and insert Markdown', markdown: '', preview: 'figure' } satisfies SlashCommandItem] : []),
    { id: 'code', label: 'Code fence', detail: 'Fenced source snippet', markdown: '```text\ncode\n```\n\n', preview: 'code' },
    { id: 'mermaid', label: 'Mermaid diagram', detail: 'Scientific flowchart or process diagram', markdown: '```mermaid\nflowchart LR\n  A[Question] --> B[Experiment]\n  B --> C[Result]\n```\n\n', preview: 'diagram' },
    { id: 'svg', label: 'SVG figure', detail: 'Editable text-based vector graphic', preview: 'figure', markdown: `:::figure {#${nextFigureLabel}}\n\`\`\`svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 180" role="img" aria-label="Text based SVG workflow">\n  <rect x="24" y="42" width="150" height="64" rx="14" fill="#e7f0ff" stroke="#6b8cff"/>\n  <text x="99" y="80" text-anchor="middle" font-family="Scie Sans, sans-serif" font-size="18" fill="#1f2a44">Draft</text>\n  <path d="M 188 74 H 284" stroke="#6b7280" stroke-width="3" marker-end="url(#arrow)"/>\n  <rect x="300" y="42" width="150" height="64" rx="14" fill="#eef8ec" stroke="#5aa469"/>\n  <text x="375" y="80" text-anchor="middle" font-family="Scie Sans, sans-serif" font-size="18" fill="#203824">Revise</text>\n  <path d="M 464 74 H 560" stroke="#6b7280" stroke-width="3" marker-end="url(#arrow)"/>\n  <circle cx="598" cy="74" r="34" fill="#fff4db" stroke="#c48a2c"/>\n  <text x="598" y="80" text-anchor="middle" font-family="Scie Sans, sans-serif" font-size="18" fill="#4b3417">Submit</text>\n  <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#6b7280"/></marker></defs>\n</svg>\n\`\`\`\n\nVector caption.\n:::\n\n` },
    ...(formatCapabilities.canUseLLMMarkdownMarkers ? [
      { id: 'locked-section', label: 'Locked section', detail: 'Protect text from external LLM edits', markdown: '' },
      { id: 'llm-note', label: 'Note to LLM', detail: 'Add anchored guidance for external LLM revision', markdown: '' },
      { id: 'human-note', label: 'Note to Human', detail: 'Add an anchored review note for the author', markdown: '' },
      { id: 'llm-instruction', label: 'LLM instruction', detail: 'Ask an external LLM to edit a nearby block', markdown: '' },
      { id: 'versions', label: 'Text versions', detail: 'Store alternative drafts and export one active version', markdown: '' },
    ] satisfies SlashCommandItem[] : []),
    { id: 'quote', label: 'Quote', detail: 'Blockquote', markdown: '> Quote\n\n' },
  ], [blockCommands, formatCapabilities, nextFigureLabel]);

  const shouldOpenSlashMenu = useCallback((target: EventTarget | null) => {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement || target instanceof HTMLSelectElement) return false;
    if (!formatCapabilities.canUseMarkdownToolbar) return false;
    if (mode === 'source') {
      const line = markdown.split(/\r?\n/)[Math.max(0, currentLine - 1)] ?? '';
      return line.slice(0, Math.max(0, currentColumn - 1)).trim() === '';
    }

    const selection = window.getSelection();
    if (!selection || !selection.isCollapsed) return false;
    if (selection.anchorNode?.nodeType === Node.TEXT_NODE) {
      return (selection.anchorNode.textContent ?? '').slice(0, selection.anchorOffset).trim() === '';
    }
    return selection.anchorOffset === 0;
  }, [currentColumn, currentLine, formatCapabilities.canUseMarkdownToolbar, markdown, mode]);

  const openSlashMenu = useCallback((initialCommandId?: string) => {
    if (!formatCapabilities.canUseMarkdownToolbar) return;
    const rect = editorStageRef.current?.getBoundingClientRect();
    const preferredTop = (rect?.top ?? 120) + 36;
    const maxTop = Math.max(SLASH_MENU_VIEWPORT_MARGIN, window.innerHeight - SLASH_MENU_ESTIMATED_HEIGHT - SLASH_MENU_VIEWPORT_MARGIN);
    const top = Math.max(SLASH_MENU_VIEWPORT_MARGIN, Math.min(Math.max(88, preferredTop), maxTop));
    const left = Math.max(16, Math.min((rect?.left ?? 0) + 48, window.innerWidth - 340));
    setSlashMenu({ top, left, initialCommandId });
  }, [editorStageRef, formatCapabilities.canUseMarkdownToolbar]);

  const handleEditorKeyDownCapture = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!shouldOpenSlashMenu(event.target)) return;
    event.preventDefault();
    openSlashMenu();
  }, [openSlashMenu, shouldOpenSlashMenu]);

  const insertSlashCommand = useCallback((command: SlashCommandItem) => {
    setSlashMenu(null);
    if (command.id === 'variable' && onVariableCommand) {
      onVariableCommand();
      return;
    }
    if (command.id === 'citation' && onCitationCommand) {
      onCitationCommand();
      return;
    }
    if (command.id === 'image' && onImageCommand) {
      onImageCommand();
      return;
    }
    if (command.id === 'locked-section' && onLockedSectionCommand) {
      onLockedSectionCommand();
      return;
    }
    if (command.id === 'llm-note' && onLlmNoteCommand) {
      onLlmNoteCommand();
      return;
    }
    if (command.id === 'human-note' && onHumanNoteCommand) {
      onHumanNoteCommand();
      return;
    }
    if (command.id === 'llm-instruction' && onLlmInstructionCommand) {
      onLlmInstructionCommand();
      return;
    }
    if (command.id === 'versions' && onVersionCommand) {
      onVersionCommand();
      return;
    }
    insertMarkdown(command.markdown);
  }, [insertMarkdown, onCitationCommand, onHumanNoteCommand, onImageCommand, onLlmInstructionCommand, onLlmNoteCommand, onLockedSectionCommand, onVariableCommand, onVersionCommand]);

  return {
    slashMenu,
    slashCommands,
    openSlashMenu,
    handleEditorKeyDownCapture,
    insertSlashCommand,
    closeSlashMenu: () => setSlashMenu(null),
  };
}
