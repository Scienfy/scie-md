import { describe, expect, it } from 'vitest';
import { resolveCommandPaletteItems } from './CommandPalette';
import type { CommandItem } from './CommandPalette';

const noop = () => undefined;

describe('resolveCommandPaletteItems', () => {
  const commands: CommandItem[] = [
    { id: 'save', label: 'Save', run: noop },
    { id: 'export-html', label: 'Export HTML', run: noop },
  ];

  it('prepends dynamic semantic results ahead of static matches', () => {
    const resolved = resolveCommandPaletteItems(commands, '@smith', () => [
      { id: 'citation-smith2026', label: 'Insert citation @smith2026', run: noop },
    ]);

    expect(resolved[0]?.id).toBe('citation-smith2026');
  });

  it('deduplicates dynamic and static commands by id', () => {
    const resolved = resolveCommandPaletteItems(commands, 'save', () => [
      { id: 'save', label: 'Save', run: noop },
    ]);

    expect(resolved.map((command) => command.id)).toEqual(['save']);
  });
});
