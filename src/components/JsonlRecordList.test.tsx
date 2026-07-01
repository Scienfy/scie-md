import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSourceFormatDiagnostics } from '../app/formatDiagnostics';
import { JsonlRecordList, jsonlRecordStatusLabel } from './JsonlRecordList';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

describe('JsonlRecordList', () => {
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

  it('renders valid records with record indexes and field summaries', () => {
    const analysis = parseSourceFormatDiagnostics('jsonl', '{"id":1,"score":2}\n{"id":2}\n', null).jsonlAnalysis;

    render(<JsonlRecordList analysis={analysis} />);

    expect(container.querySelector('.jsonl-record-list')?.textContent).toContain('2 records');
    expect(container.querySelector('.jsonl-field-summary')?.textContent).toContain('id');
    expect(container.querySelector('.jsonl-field-summary')?.textContent).toContain('score');
    expect(container.querySelector('.jsonl-field-table')?.textContent).toContain('score');
    expect(Array.from(container.querySelectorAll('.jsonl-record-row')).map((row) => row.textContent)).toEqual([
      'LineRecordTypePreviewActions',
      '11object{"id":1,"score":2}',
      '22object{"id":2}',
    ]);
  });

  it('keeps invalid lines visible in the bounded record list', () => {
    const analysis = parseSourceFormatDiagnostics('jsonl', '{"id":1}\n\n{"id":}\n', null).jsonlAnalysis;

    render(<JsonlRecordList analysis={analysis} />);

    expect(jsonlRecordStatusLabel(analysis)).toBe('2 invalid lines');
    expect(container.querySelectorAll('.jsonl-record-row.invalid')).toHaveLength(2);
    expect(container.textContent).toContain('Blank lines are not valid JSON Lines records.');
    expect(container.textContent).toContain('Expected a JSON value on this line.');
  });

  it('reports truncated previews instead of rendering unbounded rows', () => {
    const source = Array.from({ length: 225 }, (_, index) => JSON.stringify({ id: index })).join('\n');
    const analysis = parseSourceFormatDiagnostics('jsonl', source, null).jsonlAnalysis;

    render(<JsonlRecordList analysis={analysis} />);

    expect(jsonlRecordStatusLabel(analysis)).toBe('Previewing 200 of 225 lines');
    expect(container.querySelectorAll('.jsonl-record-row')).toHaveLength(51);
    expect(container.querySelector('.jsonl-record-window-controls')?.textContent).toContain('1-50 of 200 parsed / 225 total');
    expect(container.querySelector('.jsonl-record-truncated')?.textContent).toContain('Parsed preview covers first 200 lines of 225');

    clickButton('Next');
    expect(container.querySelector('.jsonl-record-window-controls')?.textContent).toContain('51-100 of 200 parsed / 225 total');
    expect(container.textContent).toContain('{"id":50}');
    expect(container.textContent).not.toContain('{"id":0}');
  });

  it('filters the bounded preview to invalid JSONL lines and jumps to source lines', () => {
    const source = '{"id":1}\n\n{"id":2}\n{"id":}\n{"id":3}\n';
    const analysis = parseSourceFormatDiagnostics('jsonl', source, null).jsonlAnalysis;
    const onJumpToLine = vi.fn();

    render(<JsonlRecordList analysis={analysis} sourceText={source} onJumpToLine={onJumpToLine} />);

    selectRowFilter('Invalid only');
    expect(container.querySelector('.jsonl-record-window-controls')?.textContent).toContain('1-2 of 2 total');
    expect(container.querySelectorAll('.jsonl-record-row.invalid')).toHaveLength(2);
    expect(container.textContent).toContain('Blank lines are not valid JSON Lines records.');
    expect(container.textContent).toContain('Expected a JSON value on this line.');
    clickButtonByLabel('Jump to JSONL line 4');
    expect(onJumpToLine).toHaveBeenCalledWith(4);
  });

  it('searches parsed records and jumps to matching JSONL lines', () => {
    const source = Array.from({ length: 60 }, (_, index) => JSON.stringify({
      id: index + 1,
      note: index === 53 ? 'needle' : 'ordinary',
    })).join('\n');
    const analysis = parseSourceFormatDiagnostics('jsonl', source, null).jsonlAnalysis;
    const onJumpToLine = vi.fn();

    render(<JsonlRecordList analysis={analysis} sourceText={source} onJumpToLine={onJumpToLine} />);

    setInputValueByLabel('Search JSONL parsed preview', 'needle');
    expect(container.querySelector('.jsonl-record-window-controls')?.textContent).toContain('1-1 of 1 total');
    expect(container.querySelector('.jsonl-record-grid')?.textContent).toContain('needle');
    expect(container.querySelector('.jsonl-record-grid')?.textContent).not.toContain('"id":1');

    setInputValueByLabel('Jump to JSONL line or record', '54');
    clickButton('Go');
    expect(onJumpToLine).toHaveBeenCalledWith(54);
  });

  it('moves JSONL row focus with arrow keys and opens the row editor with Enter', async () => {
    const source = '{"id":1}\n{"id":2}\n';
    const analysis = parseSourceFormatDiagnostics('jsonl', source, null).jsonlAnalysis;

    render(<JsonlRecordList analysis={analysis} sourceText={source} onEditIntent={vi.fn()} />);

    const firstRow = Array.from(container.querySelectorAll<HTMLElement>('.jsonl-record-row:not(.header)'))
      .find((candidate) => candidate.textContent?.includes('{"id":1}'));
    expect(firstRow).not.toBeUndefined();

    await act(async () => {
      firstRow?.focus();
      firstRow?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' }));
      await nextAnimationFrame();
    });

    expect(document.activeElement?.textContent).toContain('{"id":2}');

    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));
      await nextAnimationFrame();
    });

    expect(container.textContent).toContain('Replace JSONL line 2');
  });

  it('emits targeted record edit intents and disables invalid-line actions', () => {
    const source = '{"id":1}\n\n{"id":2}\n';
    const analysis = parseSourceFormatDiagnostics('jsonl', source, null).jsonlAnalysis;
    const onEditIntent = vi.fn();

    render(<JsonlRecordList analysis={analysis} sourceText={source} onEditIntent={onEditIntent} />);

    const invalidDelete = container.querySelector<HTMLButtonElement>('button[aria-label="Delete JSONL line 2"]');
    expect(invalidDelete?.disabled).toBe(true);

    clickButtonByLabel('Duplicate JSONL line 1');
    expect(onEditIntent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'duplicateRecord',
      lineNumber: 1,
      expectedOffset: 0,
      expectedLength: 8,
      expectedLineText: '{"id":1}',
    }));

    clickButton('Append');
    setTextareaValue('textarea[aria-label="JSONL record JSON input"]', '{ "id": 3 }');
    clickDialogPrimary();
    expect(onEditIntent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'appendRecord',
      value: { id: 3 },
    }));

    clickButtonByLabel('Replace JSONL line 3');
    setTextareaValue('textarea[aria-label="JSONL record JSON input"]', '{ "id": 20, "ok": true }');
    clickDialogPrimary();
    expect(onEditIntent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'replaceRecord',
      lineNumber: 3,
      value: { id: 20, ok: true },
      expectedLineText: '{"id":2}',
    }));
  });

  it('opens valid record context menus with copy, replace, duplicate, and delete actions', async () => {
    const source = '{"id":1}\n{"id":2}\n';
    const analysis = parseSourceFormatDiagnostics('jsonl', source, null).jsonlAnalysis;
    const onEditIntent = vi.fn();
    const onCopyText = vi.fn();

    render(<JsonlRecordList analysis={analysis} sourceText={source} onEditIntent={onEditIntent} onCopyText={onCopyText} />);

    rightClickRecordRow('{"id":1}');
    expect(container.querySelector('.context-menu-card')?.getAttribute('aria-label')).toBe('Actions for JSONL line 1');
    expect(findContextMenuButton('Replace record')).not.toBeNull();
    expect(findContextMenuButton('Duplicate record')).not.toBeNull();
    expect(findContextMenuButton('Delete record')).not.toBeNull();

    hoverContextMenuButton('Copy');
    await clickContextMenuButtonAsync('Copy line');
    expect(onCopyText).toHaveBeenCalledWith('{"id":1}', 'JSONL line 1');

    rightClickRecordRow('{"id":1}');
    hoverContextMenuButton('Copy');
    await clickContextMenuButtonAsync('Copy record JSON');
    expect(onCopyText).toHaveBeenCalledWith('{\n  "id": 1\n}', 'JSONL record 1');

    rightClickRecordRow('{"id":1}');
    clickContextMenuButton('Duplicate record');
    expect(onEditIntent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'duplicateRecord',
      lineNumber: 1,
    }));

    rightClickRecordRow('{"id":1}');
    clickContextMenuButton('Replace record');
    expect(container.textContent).toContain('Replace JSONL line 1');
  });

  it('opens record context menus from the keyboard and restores row focus on close', async () => {
    const source = '{"id":1}\n{"id":2}\n';
    const analysis = parseSourceFormatDiagnostics('jsonl', source, null).jsonlAnalysis;

    render(<JsonlRecordList analysis={analysis} sourceText={source} onEditIntent={vi.fn()} />);

    const row = keyboardOpenRecordRow('{"id":1}');
    expect(container.querySelector('.context-menu-card')?.getAttribute('aria-label')).toBe('Actions for JSONL line 1');

    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await nextAnimationFrame();
    });

    expect(container.querySelector('.context-menu-card')).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it('keeps invalid record context menus safe and copy-oriented', () => {
    const source = '{"id":1}\n{"id":}\n';
    const analysis = parseSourceFormatDiagnostics('jsonl', source, null).jsonlAnalysis;
    const onEditIntent = vi.fn();

    render(<JsonlRecordList analysis={analysis} sourceText={source} onEditIntent={onEditIntent} />);

    rightClickRecordRow('Expected a JSON value');
    hoverContextMenuButton('Copy');

    expect(findContextMenuButton('Copy line')).not.toBeNull();
    expect(findContextMenuButton('Copy record JSON')?.getAttribute('aria-disabled')).toBe('true');
    expect(findContextMenuButton('Record actions unavailable')?.getAttribute('aria-disabled')).toBe('true');
    expect(findContextMenuButton('Replace record')).toBeNull();
    expect(findContextMenuButton('Duplicate record')).toBeNull();
    expect(findContextMenuButton('Delete record')).toBeNull();
  });

  it('opens header context menus for append and conversion actions', () => {
    const source = '{"id":1}\n';
    const analysis = parseSourceFormatDiagnostics('jsonl', source, null).jsonlAnalysis;
    const onEditIntent = vi.fn();

    render(<JsonlRecordList analysis={analysis} sourceText={source} onEditIntent={onEditIntent} onCopyText={vi.fn()} />);

    rightClickJsonlHeader();
    expect(findContextMenuButton('Append record')).not.toBeNull();
    expect(findContextMenuButton('Convert JSONL')).not.toBeNull();

    clickContextMenuButton('Convert JSONL');
    expect(container.querySelector('.jsonl-conversion-dialog')?.textContent).toContain('JSONL to JSON array');
  });

  it('keeps malformed record drafts in the editor until valid JSON is supplied', () => {
    const source = '{"id":1}\n';
    const analysis = parseSourceFormatDiagnostics('jsonl', source, null).jsonlAnalysis;
    const onEditIntent = vi.fn();

    render(<JsonlRecordList analysis={analysis} sourceText={source} onEditIntent={onEditIntent} />);

    clickButtonByLabel('Replace JSONL line 1');
    setTextareaValue('textarea[aria-label="JSONL record JSON input"]', '{ "id": }');
    clickDialogPrimary();

    expect(onEditIntent).not.toHaveBeenCalled();
    expect(container.querySelector('.jsonl-dialog-error')?.textContent).toContain('Unexpected');
  });

  it('previews explicit JSONL conversion directions and copies selected output', () => {
    const source = '{"id":1}\n{"id":2}\n';
    const analysis = parseSourceFormatDiagnostics('jsonl', source, null).jsonlAnalysis;
    const onCopyText = vi.fn();

    render(<JsonlRecordList analysis={analysis} sourceText={source} onCopyText={onCopyText} />);

    clickButton('Convert');
    expect(container.querySelector('.jsonl-conversion-dialog')?.textContent).toContain('JSONL to JSON array');
    expect(container.querySelector('.jsonl-conversion-dialog')?.textContent).toContain('"id": 1');

    clickButton('Copy array');
    expect(onCopyText).toHaveBeenCalledWith('[\n  {\n    "id": 1\n  },\n  {\n    "id": 2\n  }\n]\n', 'JSON array');

    setTextareaValue('textarea[aria-label="JSON array input"]', '[{"id":3}]');
    expect(container.querySelector('.jsonl-conversion-dialog')?.textContent).toContain('{"id":3}');
    clickButton('Copy JSONL');
    expect(onCopyText).toHaveBeenCalledWith('{"id":3}\n', 'JSONL');
  });

  it('dispatches reviewed JSONL conversion actions', () => {
    const source = '{"id":1}\n{"id":2}\n';
    const analysis = parseSourceFormatDiagnostics('jsonl', source, null).jsonlAnalysis;
    const onConversionAction = vi.fn();

    render(<JsonlRecordList analysis={analysis} sourceText={source} onConversionAction={onConversionAction} />);

    clickButton('Convert');
    clickButton('Open as new');

    expect(onConversionAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'open-new',
      format: 'json',
      label: 'JSON array',
      content: expect.stringContaining('"id": 1'),
      sourceFormat: 'jsonl',
      sourceHash: expect.any(String),
    }));
  });
});

function render(element: ReactElement): void {
  act(() => {
    root.render(element);
  });
}

function clickButton(label: string): void {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent === label);
  expect(button, `button "${label}"`).not.toBeUndefined();
  act(() => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function clickButtonByLabel(label: string): void {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button, `button "${label}"`).not.toBeNull();
  act(() => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function selectRowFilter(label: string): void {
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="JSONL row filter"]');
  expect(select, 'JSONL row filter').not.toBeNull();
  const option = Array.from(select?.options ?? []).find((candidate) => candidate.textContent === label);
  expect(option, `option "${label}"`).not.toBeUndefined();
  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
    valueSetter?.call(select, option?.value);
    select?.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function rightClickRecordRow(text: string): void {
  const row = Array.from(container.querySelectorAll<HTMLElement>('.jsonl-record-row:not(.header)'))
    .find((candidate) => candidate.textContent?.includes(text));
  expect(row, `record row "${text}"`).not.toBeUndefined();
  act(() => {
    row?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 220,
      clientY: 180,
      button: 2,
    }));
  });
}

function keyboardOpenRecordRow(text: string): HTMLElement {
  const row = Array.from(container.querySelectorAll<HTMLElement>('.jsonl-record-row:not(.header)'))
    .find((candidate) => candidate.textContent?.includes(text));
  expect(row, `record row "${text}"`).not.toBeUndefined();
  act(() => {
    row?.focus();
    row?.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ContextMenu',
    }));
  });
  return row!;
}

function rightClickJsonlHeader(): void {
  const header = container.querySelector<HTMLElement>('.jsonl-record-header');
  expect(header).not.toBeNull();
  act(() => {
    header?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 80,
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
    button?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
}

function findContextMenuButton(label: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.context-menu-card .context-menu-item'))
    .find((button) => button.querySelector('.context-menu-label')?.textContent === label) ?? null;
}

function clickDialogPrimary(): void {
  const button = container.querySelector<HTMLButtonElement>('.jsonl-record-editor-dialog .primary');
  expect(button).not.toBeNull();
  act(() => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function setTextareaValue(selector: string, value: string): void {
  const textarea = container.querySelector<HTMLTextAreaElement>(selector);
  expect(textarea, selector).not.toBeNull();
  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    valueSetter?.call(textarea, value);
    textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    textarea?.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function setInputValueByLabel(ariaLabel: string, value: string): void {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${ariaLabel}"]`);
  expect(input, `input "${ariaLabel}"`).not.toBeNull();
  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    valueSetter?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
    input?.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}
