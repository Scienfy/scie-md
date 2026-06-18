export type KeyboardShortcutAction =
  | 'save'
  | 'saveAs'
  | 'open'
  | 'new'
  | 'find'
  | 'print'
  | 'commandPalette'
  | 'toggleOutline'
  | 'shortcutSheet'
  | 'increaseFont'
  | 'decreaseFont'
  | 'resetFont'
  | 'undo'
  | 'redo';

export interface KeyboardShortcutChord {
  key: string;
  display: string;
  ctrlOrMeta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface KeyboardShortcutDefinition {
  action: KeyboardShortcutAction;
  label: string;
  chords: KeyboardShortcutChord[];
}

export const KEYBOARD_SHORTCUTS: KeyboardShortcutDefinition[] = [
  { action: 'commandPalette', label: 'Command palette', chords: [{ key: 'k', ctrlOrMeta: true, display: 'Ctrl/Cmd+K' }, { key: 'p', ctrlOrMeta: true, shift: true, display: 'Ctrl/Cmd+Shift+P' }] },
  { action: 'save', label: 'Save', chords: [{ key: 's', ctrlOrMeta: true, display: 'Ctrl/Cmd+S' }] },
  { action: 'saveAs', label: 'Save As', chords: [{ key: 's', ctrlOrMeta: true, shift: true, display: 'Ctrl/Cmd+Shift+S' }] },
  { action: 'open', label: 'Open', chords: [{ key: 'o', ctrlOrMeta: true, display: 'Ctrl/Cmd+O' }] },
  { action: 'new', label: 'New', chords: [{ key: 'n', ctrlOrMeta: true, display: 'Ctrl/Cmd+N' }] },
  { action: 'find', label: 'Find and replace', chords: [{ key: 'f', ctrlOrMeta: true, display: 'Ctrl/Cmd+F' }] },
  { action: 'print', label: 'Print preview', chords: [{ key: 'p', ctrlOrMeta: true, display: 'Ctrl/Cmd+P' }] },
  { action: 'toggleOutline', label: 'Toggle navigation sidebar', chords: [{ key: '\\', ctrlOrMeta: true, display: 'Ctrl/Cmd+\\' }] },
  { action: 'increaseFont', label: 'Increase font size', chords: [{ key: '+', ctrlOrMeta: true, shift: true, display: 'Ctrl/Cmd++' }, { key: '=', ctrlOrMeta: true, display: 'Ctrl/Cmd+=' }] },
  { action: 'decreaseFont', label: 'Decrease font size', chords: [{ key: '-', ctrlOrMeta: true, display: 'Ctrl/Cmd+-' }] },
  { action: 'resetFont', label: 'Reset font size', chords: [{ key: '0', ctrlOrMeta: true, display: 'Ctrl/Cmd+0' }] },
  { action: 'undo', label: 'Undo', chords: [{ key: 'z', ctrlOrMeta: true, display: 'Ctrl/Cmd+Z' }] },
  { action: 'redo', label: 'Redo', chords: [{ key: 'z', ctrlOrMeta: true, shift: true, display: 'Ctrl/Cmd+Shift+Z' }, { key: 'y', ctrlOrMeta: true, display: 'Ctrl/Cmd+Y' }] },
  { action: 'shortcutSheet', label: 'Shortcut sheet', chords: [{ key: '/', ctrlOrMeta: true, display: 'Ctrl/Cmd+/' }] },
];

export function findKeyboardShortcut(event: KeyboardEvent): KeyboardShortcutDefinition | null {
  return KEYBOARD_SHORTCUTS.find((definition) => definition.chords.some((chord) => matchesShortcutChord(event, chord))) ?? null;
}

export function getKeyboardShortcutDisplay(action: KeyboardShortcutAction): string {
  return KEYBOARD_SHORTCUTS.find((shortcut) => shortcut.action === action)?.chords.map((chord) => chord.display).join(' / ') ?? '';
}

export function matchesShortcutChord(event: KeyboardEvent, chord: KeyboardShortcutChord): boolean {
  const key = normalizeKey(event.key);
  if (key !== normalizeKey(chord.key)) return false;
  if ((event.ctrlKey || event.metaKey) !== Boolean(chord.ctrlOrMeta)) return false;
  if (event.shiftKey !== Boolean(chord.shift)) return false;
  if (event.altKey !== Boolean(chord.alt)) return false;
  return true;
}

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}
