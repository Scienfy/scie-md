import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlashCommandMenu } from './SlashCommandMenu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SlashCommandMenu', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  it('renders the floating command surface as a modal dialog', async () => {
    act(() => {
      root.render(
        <SlashCommandMenu
          open
          top={10}
          left={10}
          commands={[
            { id: 'figure', label: 'Figure', detail: 'Insert figure', markdown: ':::figure\n:::' },
            { id: 'note', label: 'Note', detail: 'Insert note', markdown: ':::note\n:::' },
          ]}
          onSelect={() => undefined}
          onClose={() => undefined}
        />,
      );
    });
    await act(async () => undefined);

    const menu = container.querySelector('.slash-menu')!;

    expect(menu.getAttribute('role')).toBe('dialog');
    expect(menu.getAttribute('aria-modal')).toBe('true');
    expect(menu.getAttribute('aria-labelledby')).toBe('slash-command-title');
    const input = container.querySelector('input');
    expect(input?.getAttribute('placeholder')).toBe('Search insert actions');
    expect(input?.getAttribute('role')).toBe('combobox');
    expect(input?.getAttribute('aria-controls')).toBe('slash-command-list');
    expect(container.querySelector('#slash-command-list')?.getAttribute('role')).toBe('listbox');
    expect(container.querySelector('#slash-command-option-figure')?.getAttribute('role')).toBe('option');
  });

  it('keeps block types nested behind the Block command', async () => {
    const onSelect = vi.fn();
    act(() => {
      root.render(
        <SlashCommandMenu
          open
          top={10}
          left={10}
          commands={[
            {
              id: 'block',
              label: 'Block',
              detail: 'Figure, note, callout, tip, warning, or result',
              markdown: '',
              children: [
                { id: 'callout-block', label: 'Callout block', detail: 'Highlighted takeaway', markdown: ':::callout\n:::' },
                { id: 'tip-block', label: 'Tip block', detail: 'Practical recommendation', markdown: ':::tip\n:::' },
              ],
            },
            { id: 'citation', label: 'Citation', detail: 'Pandoc citation key', markdown: '[@key]' },
          ]}
          onSelect={onSelect}
          onClose={() => undefined}
        />,
      );
    });
    await act(async () => undefined);

    expect(container.textContent).toContain('Block');
    expect(container.textContent).toContain('Citation');
    expect(container.textContent).not.toContain('Callout block');
    expect(container.textContent).not.toContain('Tip block');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('#slash-command-option-block')?.click();
    });

    expect(container.querySelector('input')?.getAttribute('placeholder')).toBe('Search block types');
    expect(container.textContent).toContain('Callout block');
    expect(container.textContent).toContain('Tip block');
    expect(container.textContent).not.toContain('Citation');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('#slash-command-option-callout-block')?.click();
    });

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'callout-block' }));
  });

  it('can open directly into the same table picker used by slash Table', async () => {
    const onSelect = vi.fn();
    act(() => {
      root.render(
        <SlashCommandMenu
          open
          top={10}
          left={10}
          initialCommandId="table"
          commands={[{ id: 'table', label: 'Table', detail: 'Choose rows and columns', markdown: '' }]}
          onSelect={onSelect}
          onClose={() => undefined}
        />,
      );
    });
    await act(async () => undefined);

    expect(container.querySelector('.slash-table-picker')).not.toBeNull();
    expect(container.textContent).toContain('2 rows x 3 columns');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.slash-table-grid button')?.click();
    });

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      id: 'table',
      markdown: expect.stringContaining('| Column 1 |'),
    }));
  });
});
