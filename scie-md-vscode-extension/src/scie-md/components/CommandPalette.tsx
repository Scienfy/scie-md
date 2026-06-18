import { Command, Search, X } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ModalShell } from './ModalShell';

export interface CommandItem {
  id: string;
  label: string;
  detail?: string;
  shortcut?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  commands: CommandItem[];
  dynamicCommands?: (query: string) => CommandItem[];
  onClose: () => void;
}

export const CommandPalette = memo(function CommandPalette({ open, commands, dynamicCommands, onClose }: CommandPaletteProps) {
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const filtered = useMemo(
    () => resolveCommandPaletteItems(commands, query, dynamicCommands),
    [commands, dynamicCommands, query],
  );

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const activeCommand = filtered[selectedIndex];
  const activeOptionId = activeCommand ? commandOptionDomId(activeCommand, selectedIndex) : undefined;

  useEffect(() => {
    if (!open || !activeCommand) return;
    const activeElement = activeOptionId ? optionRefs.current.get(activeOptionId) : undefined;
    if (typeof activeElement?.scrollIntoView === 'function') {
      activeElement.scrollIntoView({ block: 'nearest' });
    }
  }, [activeCommand, activeOptionId, open]);

  if (!open) return null;

  const execute = (command: CommandItem) => {
    command.run();
    setQuery('');
    onClose();
  };
  const listId = 'command-palette-list';

  return (
    <ModalShell open={open} titleId="command-palette-title" className="command-palette" backdropClassName="command-backdrop" onCancel={onClose}>
      <h2 id="command-palette-title" className="sr-only">Command palette</h2>
        <div className="command-search">
          <Command size={18} />
          <Search size={16} />
          <input
            autoFocus
            role="combobox"
            aria-label="Search commands"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeOptionId}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelectedIndex((current) => Math.min(filtered.length - 1, current + 1));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelectedIndex((current) => Math.max(0, current - 1));
              }
              if (event.key === 'Enter' && filtered[selectedIndex]) {
                event.preventDefault();
                execute(filtered[selectedIndex]);
              }
            }}
            placeholder="Search app actions; use / in the editor for inserts, @ for citations, # for headings"
          />
          <button aria-label="Close command palette" title="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <div id={listId} className="command-list" role="listbox" aria-label="Command results">
          {filtered.map((command, index) => {
            const optionId = commandOptionDomId(command, index);
            return (
            <button
              key={`${command.id}-${index}`}
              ref={(element) => {
                if (element) optionRefs.current.set(optionId, element);
                else optionRefs.current.delete(optionId);
              }}
              id={optionId}
              role="option"
              aria-selected={index === selectedIndex}
              className={index === selectedIndex ? 'selected' : ''}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => execute(command)}
            >
              <span className="command-main">
                <span>{command.label}</span>
                {command.detail && !looksLikeShortcut(command.detail) && <small>{command.detail}</small>}
              </span>
              {(command.shortcut ?? (command.detail && looksLikeShortcut(command.detail) ? command.detail : null)) && (
                <kbd>{command.shortcut ?? command.detail}</kbd>
              )}
            </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="command-empty">No commands. Try a heading name, citation key, or action such as export.</p>
          )}
        </div>
    </ModalShell>
  );
});

export function resolveCommandPaletteItems(
  commands: CommandItem[],
  query: string,
  dynamicCommands?: (query: string) => CommandItem[],
): CommandItem[] {
  const normalized = query.trim().toLowerCase();
  const staticMatches = normalized
    ? commands.filter((command) => `${command.label} ${command.detail ?? ''}`.toLowerCase().includes(normalized))
    : commands;
  const dynamicMatches = dynamicCommands?.(query) ?? [];
  const seen = new Set<string>();
  return [...dynamicMatches, ...staticMatches]
    .filter((command) => {
      if (seen.has(command.id)) return false;
      seen.add(command.id);
      return true;
    })
    .slice(0, 16);
}

function looksLikeShortcut(value: string): boolean {
  return /\b(Ctrl|Cmd|Alt|Shift|Enter|Esc|Tab)\b/i.test(value);
}

function commandOptionDomId(command: CommandItem, index: number): string {
  return `command-palette-option-${index}-${hashForDomId(command.id)}`;
}

function hashForDomId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
