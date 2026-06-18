import { describe, expect, it } from 'vitest';
import { findKeyboardShortcut, getKeyboardShortcutDisplay, KEYBOARD_SHORTCUTS } from './keyboardShortcuts';

describe('keyboardShortcuts', () => {
  it('uses one registry for displayed shortcuts', () => {
    expect(KEYBOARD_SHORTCUTS.map((shortcut) => shortcut.action)).toContain('commandPalette');
    expect(getKeyboardShortcutDisplay('saveAs')).toBe('Ctrl/Cmd+Shift+S');
  });

  it('distinguishes overlapping shortcuts by modifiers', () => {
    expect(actionFor({ key: 's', ctrlKey: true })).toBe('save');
    expect(actionFor({ key: 's', ctrlKey: true, shiftKey: true })).toBe('saveAs');
    expect(actionFor({ key: 'z', metaKey: true })).toBe('undo');
    expect(actionFor({ key: 'z', metaKey: true, shiftKey: true })).toBe('redo');
  });

  it('supports alternate command palette and font size chords', () => {
    expect(actionFor({ key: 'p', ctrlKey: true, shiftKey: true })).toBe('commandPalette');
    expect(actionFor({ key: '+', ctrlKey: true, shiftKey: true })).toBe('increaseFont');
    expect(actionFor({ key: '=', ctrlKey: true })).toBe('increaseFont');
  });

  it('registers print preview without colliding with the command palette chord', () => {
    expect(getKeyboardShortcutDisplay('print')).toBe('Ctrl/Cmd+P');
    expect(actionFor({ key: 'p', ctrlKey: true })).toBe('print');
    expect(actionFor({ key: 'p', ctrlKey: true, shiftKey: true })).toBe('commandPalette');
  });
});

function actionFor(init: KeyboardEventInit): string | null {
  return findKeyboardShortcut(new KeyboardEvent('keydown', init))?.action ?? null;
}
