import { useEffect, useMemo, useRef, useState } from 'react';
import { focusFirstElement, trapTabKey } from './focusUtils';

export interface SlashCommandItem {
  id: string;
  label: string;
  detail: string;
  markdown: string;
  preview?: 'figure' | 'note' | 'callout' | 'tip' | 'important' | 'warning' | 'result' | 'table' | 'code' | 'diagram' | 'citation' | 'variable';
  children?: SlashCommandItem[];
}

interface SlashCommandMenuProps {
  open: boolean;
  top: number;
  left: number;
  initialCommandId?: string;
  commands: SlashCommandItem[];
  onSelect: (command: SlashCommandItem) => void;
  onClose: () => void;
}

export function SlashCommandMenu({ open, top, left, initialCommandId, commands, onSelect, onClose }: SlashCommandMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [tableCommand, setTableCommand] = useState<SlashCommandItem | null>(null);
  const [nestedCommand, setNestedCommand] = useState<SlashCommandItem | null>(null);
  const [tableRows, setTableRows] = useState(2);
  const [tableColumns, setTableColumns] = useState(3);
  const visibleCommands = nestedCommand?.children ?? commands;
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return visibleCommands;
    return visibleCommands.filter((command) => `${command.label} ${command.detail}`.toLowerCase().includes(normalized));
  }, [query, visibleCommands]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTableCommand(null);
      setNestedCommand(null);
      setTableRows(2);
      setTableColumns(3);
      if (initialCommandId === 'table') {
        setTableCommand(commands.find((command) => command.id === 'table') ?? null);
      }
    }
  }, [commands, initialCommandId, open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setTableCommand(null);
      setNestedCommand(null);
      return undefined;
    }
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => focusFirstElement(menuRef.current), 0);
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    const trapFloatingFocus = (event: KeyboardEvent) => {
      trapTabKey(menuRef.current, event);
    };
    window.addEventListener('pointerdown', closeOnPointerDown);
    window.addEventListener('keydown', closeOnEscape);
    menuRef.current?.addEventListener('keydown', trapFloatingFocus, true);
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown);
      window.removeEventListener('keydown', closeOnEscape);
      menuRef.current?.removeEventListener('keydown', trapFloatingFocus, true);
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
    };
  }, [onClose, open]);

  useEffect(() => {
    setSelectedIndex(0);
    if (initialCommandId !== 'table') setTableCommand(null);
  }, [initialCommandId, query]);

  const selected = filtered[Math.min(selectedIndex, Math.max(0, filtered.length - 1))];

  useEffect(() => {
    if (!open || !selected || tableCommand) return;
    const activeElement = optionRefs.current.get(selected.id);
    if (typeof activeElement?.scrollIntoView === 'function') {
      activeElement.scrollIntoView({ block: 'nearest' });
    }
  }, [open, selected, tableCommand]);

  if (!open) return null;

  const listId = 'slash-command-list';
  const selectCommand = (command: SlashCommandItem) => {
    if (command.children && command.children.length > 0) {
      setNestedCommand(command);
      setQuery('');
      setSelectedIndex(0);
      setTableCommand(null);
      return;
    }
    if (command.id === 'table') {
      setTableCommand(command);
      setTableRows(2);
      setTableColumns(3);
      return;
    }
    onSelect(command);
  };
  const insertTable = () => {
    if (!tableCommand) return;
    onSelect({ ...tableCommand, markdown: createMarkdownTable(tableRows, tableColumns) });
  };
  return (
    <div ref={menuRef} className="slash-menu" style={{ top, left }} role="dialog" aria-modal="true" aria-labelledby="slash-command-title" tabIndex={-1}>
      <h2 id="slash-command-title" className="sr-only">Slash commands</h2>
      {tableCommand ? (
        <TableSizePicker
          rows={tableRows}
          columns={tableColumns}
          onPreview={(rows, columns) => {
            setTableRows(rows);
            setTableColumns(columns);
          }}
          onBack={() => setTableCommand(null)}
          onInsert={insertTable}
          onClose={onClose}
        />
      ) : (
        <>
          {nestedCommand && (
            <div className="slash-submenu-header">
              <button
                type="button"
                onClick={() => {
                  setNestedCommand(null);
                  setQuery('');
                  setSelectedIndex(0);
                }}
                aria-label="Back to insert actions"
              >
                Back
              </button>
              <span>{nestedCommand.label}</span>
            </div>
          )}
          <input
            autoFocus
            role="combobox"
            aria-label={nestedCommand ? `Search ${nestedCommand.label} actions` : 'Search insert actions'}
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={selected ? `slash-command-option-${selected.id}` : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelectedIndex((current) => filtered.length === 0 ? 0 : (current + 1) % filtered.length);
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelectedIndex((current) => filtered.length === 0 ? 0 : (current - 1 + filtered.length) % filtered.length);
              }
              if (event.key === 'Enter' && selected) {
                event.preventDefault();
                selectCommand(selected);
              }
            }}
            placeholder={nestedCommand ? 'Search block types' : 'Search insert actions'}
          />
          <div id={listId} className="slash-list" role="listbox" aria-label="Insert actions">
            {filtered.map((command, index) => (
              <button
                key={command.id}
                ref={(element) => {
                  if (element) optionRefs.current.set(command.id, element);
                  else optionRefs.current.delete(command.id);
                }}
                id={`slash-command-option-${command.id}`}
                role="option"
                aria-selected={index === selectedIndex}
                className={index === selectedIndex ? 'selected' : ''}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => selectCommand(command)}
              >
                {command.preview && <SlashPreview kind={command.preview} />}
                <span className="slash-command-copy">
                  <span>{command.label}</span>
                  <small>{command.detail}</small>
                </span>
              </button>
            ))}
            {filtered.length === 0 && <p>No commands</p>}
          </div>
        </>
      )}
    </div>
  );
}

function SlashPreview({ kind }: { kind: NonNullable<SlashCommandItem['preview']> }) {
  return (
    <span className={`slash-preview slash-preview-${kind}`} aria-hidden="true">
      <i />
      <b />
      <em />
    </span>
  );
}

interface TableSizePickerProps {
  rows: number;
  columns: number;
  onPreview: (rows: number, columns: number) => void;
  onBack: () => void;
  onInsert: () => void;
  onClose: () => void;
}

function TableSizePicker({ rows, columns, onPreview, onBack, onInsert, onClose }: TableSizePickerProps) {
  const maxRows = 7;
  const maxColumns = 7;

  return (
    <div
      className="slash-table-picker"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          onInsert();
        }
      }}
    >
      <div className="slash-table-header">
        <button type="button" onClick={onBack} aria-label="Back to insert actions">Back</button>
        <span>{rows} rows x {columns} columns</span>
      </div>
      <div className="slash-table-grid" role="grid" aria-label="Choose table size">
        {Array.from({ length: maxRows }).map((_, rowIndex) => (
          Array.from({ length: maxColumns }).map((__, columnIndex) => {
            const previewRows = rowIndex + 1;
            const previewColumns = columnIndex + 1;
            const active = previewRows <= rows && previewColumns <= columns;
            return (
              <button
                key={`${previewRows}-${previewColumns}`}
                type="button"
                className={active ? 'active' : ''}
                autoFocus={previewRows === rows && previewColumns === columns}
                aria-label={`${previewRows} rows by ${previewColumns} columns`}
                onMouseEnter={() => onPreview(previewRows, previewColumns)}
                onFocus={() => onPreview(previewRows, previewColumns)}
                onClick={onInsert}
              />
            );
          })
        ))}
      </div>
      <p>Click a size to insert. Edit cells directly after insertion.</p>
    </div>
  );
}

function createMarkdownTable(rows: number, columns: number): string {
  const headers = Array.from({ length: columns }, (_, index) => `Column ${index + 1}`);
  const separator = Array.from({ length: columns }, () => '---');
  const bodyRows = Array.from({ length: rows }, () => Array.from({ length: columns }, () => ' ').join(' | '));
  return [
    `| ${headers.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...bodyRows.map((row) => `| ${row} |`),
    '',
    '',
  ].join('\n');
}
