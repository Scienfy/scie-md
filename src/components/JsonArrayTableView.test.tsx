import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJsonArrayTableModel } from '@sciemd/core';
import { createJsonContent, parseJsonDocument } from '@sciemd/core';
import { JsonArrayTableView } from './JsonArrayTableView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

describe('JsonArrayTableView', () => {
  beforeEach(() => {
    patchDialogMethods();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders object arrays as editable scalar tables and emits JSON replacement intents', () => {
    const source = '[{"id":"S-001","score":1},{"id":"S-002","score":2}]';
    const model = parseModel(source);
    const onEditIntent = vi.fn();

    renderView({ model, sourceText: source, editable: true, onEditIntent });

    expect(container.textContent).toContain('JSON table');
    expect(container.textContent).toContain('Rows');
    expect(container.textContent).toContain('Columns');
    expect(container.textContent).toContain('S-001');

    clickButton('1');
    setInlineInputValue('Inline edit JSON cell', '3.5');
    pressInlineEditorKey('Inline edit JSON cell', 'Enter');

    expect(onEditIntent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'replaceScalar',
      path: [0, 'score'],
      nextValue: { kind: 'raw-json-number', raw: '3.5' },
      expectedSourceHash: expect.any(String),
    }));
  });

  it('uses the source token when opening precision-sensitive number cells', () => {
    const source = '[{"id":"S-001","score":900719925474099312345}]';
    const model = parseModel(source);
    const onEditIntent = vi.fn();

    renderView({ model, sourceText: source, editable: true, onEditIntent });

    clickButton('900719925474099300000');
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Inline edit JSON cell"]')?.value).toBe('900719925474099312345');
    setInlineInputValue('Inline edit JSON cell', '1.2300e+12');
    pressInlineEditorKey('Inline edit JSON cell', 'Enter');

    expect(onEditIntent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'replaceScalar',
      path: [0, 'score'],
      nextValue: { kind: 'raw-json-number', raw: '1.2300e+12' },
    }));
  });

  it('copies table previews, cell values, and row JSON from context menus', async () => {
    const source = '[{"id":"S-001","score":1},{"id":"S-002","score":2}]';
    const model = parseModel(source);
    const onCopyText = vi.fn();

    renderView({ model, sourceText: source, onCopyText });

    clickButton('Copy table');
    expect(onCopyText).toHaveBeenCalledWith('id\tscore\nS-001\t1\nS-002\t2\n', '$ table preview');

    rightClickCell('S-001');
    hoverContextMenuButton('Copy');
    await clickContextMenuButtonAsync('Copy cell');
    expect(onCopyText).toHaveBeenCalledWith('S-001', '$[0].id cell');

    rightClickCell('S-001');
    hoverContextMenuButton('Copy');
    await clickContextMenuButtonAsync('Copy row');
    expect(onCopyText).toHaveBeenCalledWith('{\n  "id": "S-001",\n  "score": 1\n}', 'JSON row 1');
  });

  it('moves JSON table focus with arrow keys and opens focused cells with Enter', async () => {
    const source = '[{"id":"S-001","score":1},{"id":"S-002","score":2}]';
    const model = parseModel(source);

    renderView({ model, sourceText: source, editable: true, onEditIntent: vi.fn() });

    const firstRowHeader = Array.from(container.querySelectorAll<HTMLElement>('tbody th'))
      .find((candidate) => candidate.textContent?.trim() === '1');
    expect(firstRowHeader).not.toBeUndefined();

    await act(async () => {
      firstRowHeader?.focus();
      firstRowHeader?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' }));
      await nextAnimationFrame();
    });

    expect(document.activeElement?.textContent).toContain('S-001');

    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));
      await nextAnimationFrame();
    });

    expect(container.querySelector<HTMLInputElement>('input[aria-label="Inline edit JSON cell"]')?.value).toBe('S-001');
  });

  it('cancels inline JSON table edits with Escape', () => {
    const source = '[{"id":"S-001","score":1}]';
    const model = parseModel(source);
    const onEditIntent = vi.fn();

    renderView({ model, sourceText: source, editable: true, onEditIntent });

    clickButton('S-001');
    setInlineInputValue('Inline edit JSON cell', 'S-999');
    pressInlineEditorKey('Inline edit JSON cell', 'Escape');

    expect(onEditIntent).not.toHaveBeenCalled();
    expect(container.querySelector('input[aria-label="Inline edit JSON cell"]')).toBeNull();
    expect(container.textContent).toContain('S-001');
  });

  it('reveals row and cell source locations from context menus', () => {
    const source = '[{"id":"S-001","score":1},{"id":"S-002","score":2}]';
    const model = parseModel(source);
    const onRevealSource = vi.fn();

    renderView({ model, sourceText: source, onRevealSource });

    rightClickRowHeader('1');
    clickContextMenuButton('Reveal in source');
    expect(onRevealSource).toHaveBeenCalledWith(expect.objectContaining({
      pointer: '/0',
      displayPath: '$[0]',
    }));

    rightClickCell('S-002');
    clickContextMenuButton('Reveal in source');
    expect(onRevealSource).toHaveBeenCalledWith(expect.objectContaining({
      pointer: '/1/id',
      displayPath: '$[1].id',
    }));
  });

  it('switches wide object arrays into row cards without losing scalar edit actions', () => {
    const row = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`c${index + 1}`, index + 1]));
    const source = JSON.stringify([row]);
    const model = parseModel(source);

    renderView({ model, sourceText: source, editable: true, onEditIntent: vi.fn() });

    expect(container.textContent).toContain('JSON cards');
    expect(container.textContent).toContain('Row 1');
    expect(container.querySelector('.json-array-card')).not.toBeNull();
    expect(container.querySelector('.json-array-table-scroll table')).toBeNull();

    clickButton('1');
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Inline edit JSON cell"]')?.value).toBe('1');
  });

  it('keeps nested object cells copy/reveal only', () => {
    const source = '[{"id":"S-001","meta":{"batch":"B1"}}]';
    const model = parseModel(source);
    const onEditIntent = vi.fn();

    renderView({ model, sourceText: source, editable: true, onEditIntent });

    rightClickCell('{"batch":"B1"}');
    expect(findContextMenuButton('Edit cell')?.getAttribute('aria-disabled')).toBe('true');
    clickContextMenuButton('Edit cell');
    expect(onEditIntent).not.toHaveBeenCalled();
  });
});

function renderView(props: Partial<Parameters<typeof JsonArrayTableView>[0]> & {
  model: Parameters<typeof JsonArrayTableView>[0]['model'];
}): void {
  act(() => {
    root.render(<JsonArrayTableView {...props} />);
  });
}

function parseModel(source: string): NonNullable<ReturnType<typeof createJsonArrayTableModel>> {
  const parsed = parseJsonDocument(createJsonContent(source)).parsed;
  const model = createJsonArrayTableModel(parsed?.value, parsed?.sourceMap ?? null);
  expect(model).not.toBeNull();
  return model!;
}

function clickButton(label: string): void {
  const button = findButton(label);
  expect(button, `button "${label}"`).not.toBeUndefined();
  act(() => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent?.trim() === label);
}

function rightClickCell(text: string): void {
  const cell = Array.from(container.querySelectorAll<HTMLTableCellElement>('tbody td, .json-array-card-field'))
    .find((candidate) => candidate.textContent?.includes(text));
  expect(cell, `cell "${text}"`).not.toBeUndefined();
  act(() => {
    cell?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 240,
      clientY: 180,
      button: 2,
    }));
  });
}

function rightClickRowHeader(text: string): void {
  const rowHeader = Array.from(container.querySelectorAll<HTMLTableCellElement>('tbody th'))
    .find((candidate) => candidate.textContent?.trim() === text);
  expect(rowHeader, `row "${text}"`).not.toBeUndefined();
  act(() => {
    rowHeader?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 160,
      clientY: 150,
      button: 2,
    }));
  });
}

function clickContextMenuButton(label: string): void {
  const button = findContextMenuButton(label);
  expect(button, `context menu button "${label}"`).not.toBeNull();
  act(() => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function clickContextMenuButtonAsync(label: string): Promise<void> {
  const button = findContextMenuButton(label);
  expect(button, `context menu button "${label}"`).not.toBeNull();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

function hoverContextMenuButton(label: string): void {
  const button = findContextMenuButton(label);
  expect(button, `context menu button "${label}"`).not.toBeNull();
  act(() => {
    button?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
  });
}

function findContextMenuButton(label: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.context-menu-card .context-menu-item'))
    .find((button) => button.querySelector('.context-menu-label')?.textContent === label) ?? null;
}

function setTextareaValue(value: string): void {
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea');
  expect(textarea, 'textarea').not.toBeNull();
  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    valueSetter?.call(textarea, value);
    textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    textarea?.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function setInlineInputValue(ariaLabel: string, value: string): void {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${ariaLabel}"]`);
  expect(input, `input "${ariaLabel}"`).not.toBeNull();
  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    valueSetter?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
    input?.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function pressInlineEditorKey(ariaLabel: string, key: string): void {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${ariaLabel}"]`);
  expect(input, `input "${ariaLabel}"`).not.toBeNull();
  act(() => {
    input?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }));
  });
}

function patchDialogMethods() {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false;
    },
  });
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}
