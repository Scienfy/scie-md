import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSourceFormatDiagnostics } from '../app/formatDiagnostics';
import { TabularTablePreview } from './TabularTablePreview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

describe('TabularTablePreview', () => {
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

  it('renders a bounded table preview and copies document-level conversions', () => {
    const onCopyText = vi.fn();
    const analysis = parseSourceFormatDiagnostics('csv', largeCsv(), 'C:\\lab\\samples.csv').tabularAnalysis;

    renderPreview({ analysis, onCopyText });

    expect(container.textContent).toContain('CSV table');
    expect(container.textContent).toContain('Rows');
    expect(container.textContent).toContain('60');
    expect(container.textContent).toContain('Columns');
    expect(container.textContent).toContain('14');
    expect(container.textContent).toContain('c12');
    expect(container.querySelector('thead')?.textContent).not.toContain('c13');
    expect(container.querySelector('select[aria-label="Choose visible table column"]')?.textContent).toContain('c13');
    expect(container.textContent).toContain('+2');
    expect(container.textContent).toContain('Showing 50 of 60 rows and 12 of 14 columns.');
    expect(container.textContent).toContain('r50c1');
    expect(container.textContent).not.toContain('r51c1');

    clickButton('Convert');
    selectFormat('YAML list');
    expect(container.textContent).toContain('YAML conversion keeps every cell as a quoted string');
    clickButton('Copy');

    expect(onCopyText).toHaveBeenCalledWith(expect.stringContaining('c1: "r1c1"'), 'YAML list');
  });

  it('pages and pins wide table columns without losing source column indexes', () => {
    const onEditIntent = vi.fn();
    const source = largeCsv();
    const analysis = parseSourceFormatDiagnostics('csv', source, 'C:\\lab\\samples.csv').tabularAnalysis;

    renderPreview({ analysis, sourceText: source, editable: true, onEditIntent });

    selectColumn('13. c13');
    expect(container.querySelector('thead')?.textContent).toContain('c13');
    expect(tableHeaderLabels()).not.toContain('c1');

    clickButton('Pin');
    clickButton('Previous columns');
    expect(container.querySelector('thead')?.textContent).toContain('c13');
    expect(container.querySelector('.tabular-column-controls')?.textContent).toContain('pinned 13');

    clickButton('r1c13');
    setInputValueByLabel('Inline edit row 1, column 13', 'updated-c13');
    pressInputKeyByLabel('Inline edit row 1, column 13', 'Enter');

    expect(onEditIntent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'replaceCell',
      dataRowIndex: 0,
      columnIndex: 12,
      nextValue: 'updated-c13',
    }));
  });

  it('searches parsed table rows and jumps to matching source rows', () => {
    const onJumpToLine = vi.fn();
    const analysis = parseSourceFormatDiagnostics('csv', largeCsv(), 'C:\\lab\\samples.csv').tabularAnalysis;

    renderPreview({ analysis, onJumpToLine });

    setInputValueByLabel('Search table parsed preview', 'r54c1');
    expect(container.querySelector('.tabular-table-window-controls')?.textContent).toContain('1-1 of 1 total');
    expect(container.textContent).toContain('r54c1');
    expect(container.textContent).not.toContain('r1c1');

    setInputValueByLabel('Jump to table row', '54');
    clickButton('Go');
    expect(onJumpToLine).toHaveBeenCalledWith(55);
  });

  it('dispatches reviewed table conversion actions', () => {
    const onConversionAction = vi.fn();
    const source = 'sample,count\nA,1\nB,2\n';
    const analysis = parseSourceFormatDiagnostics('csv', source, 'C:\\lab\\samples.csv').tabularAnalysis;

    renderPreview({ analysis, sourceText: source, onConversionAction });

    clickButton('Convert');
    selectFormat('JSON array');
    clickButton('Save as');

    expect(onConversionAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'save-as',
      format: 'json',
      label: 'JSON array',
      content: expect.stringContaining('"sample": "A"'),
      sourceFormat: 'csv',
      sourceHash: expect.any(String),
    }));
  });

  it('pages through parsed table rows and jumps to source lines', () => {
    const onJumpToLine = vi.fn();
    const analysis = parseSourceFormatDiagnostics('csv', largeCsv(), 'C:\\lab\\samples.csv').tabularAnalysis;

    renderPreview({ analysis, onJumpToLine });

    expect(container.querySelector('.tabular-table-window-controls')?.textContent).toContain('1-50 of 60 total');
    expect(container.textContent).toContain('r50c1');
    expect(container.textContent).not.toContain('r51c1');

    clickButton('Next');
    expect(container.querySelector('.tabular-table-window-controls')?.textContent).toContain('51-60 of 60 total');
    expect(container.textContent).toContain('r51c1');
    expect(container.textContent).not.toContain('r50c1');

    clickButtonByLabel('Jump to table row 51');
    expect(onJumpToLine).toHaveBeenCalledWith(52);
  });

  it('emits source-hashed cell replacement intents for visible cells', () => {
    const onEditIntent = vi.fn();
    const source = 'id,note\n001,"Alpha, A"\n002,Beta\n';
    const analysis = parseSourceFormatDiagnostics('csv', source, 'C:\\lab\\samples.csv').tabularAnalysis;

    renderPreview({ analysis, sourceText: source, editable: true, onEditIntent });

    clickButton('Alpha, A');
    setInputValueByLabel('Inline edit row 1, column 2', 'Gamma, "quoted"');
    pressInputKeyByLabel('Inline edit row 1, column 2', 'Enter');

    expect(onEditIntent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'replaceCell',
      format: 'csv',
      dataRowIndex: 0,
      columnIndex: 1,
      nextValue: 'Gamma, "quoted"',
      expectedSourceHash: expect.any(String),
    }));
  });

  it('opens cell context menus with copy and edit actions', async () => {
    const onCopyText = vi.fn();
    const onEditIntent = vi.fn();
    const source = 'id,note\n001,"Alpha, A"\n002,Beta\n';
    const analysis = parseSourceFormatDiagnostics('csv', source, 'C:\\lab\\samples.csv').tabularAnalysis;

    renderPreview({ analysis, sourceText: source, editable: true, onEditIntent, onCopyText });

    rightClickCell('Alpha, A');
    expect(container.querySelector('.context-menu-card')?.getAttribute('aria-label')).toBe('Actions for row 1, note');
    expect(findContextMenuButton('Edit cell')).not.toBeNull();

    hoverContextMenuButton('Copy');
    await clickContextMenuButtonAsync('Copy cell');
    expect(onCopyText).toHaveBeenCalledWith('Alpha, A', 'note cell');

    rightClickCell('Alpha, A');
    hoverContextMenuButton('Copy');
    await clickContextMenuButtonAsync('Copy row');
    expect(onCopyText).toHaveBeenCalledWith('001\tAlpha, A', 'Row 1');

    rightClickCell('Alpha, A');
    clickContextMenuButton('Edit cell');
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Inline edit row 1, column 2"]')?.value).toBe('Alpha, A');
  });

  it('cancels inline table cell edits with Escape', () => {
    const onEditIntent = vi.fn();
    const source = 'id,note\n001,Alpha\n';
    const analysis = parseSourceFormatDiagnostics('csv', source, 'C:\\lab\\samples.csv').tabularAnalysis;

    renderPreview({ analysis, sourceText: source, editable: true, onEditIntent });

    clickButton('Alpha');
    setInputValueByLabel('Inline edit row 1, column 2', 'Changed');
    pressInputKeyByLabel('Inline edit row 1, column 2', 'Escape');

    expect(onEditIntent).not.toHaveBeenCalled();
    expect(container.querySelector('input[aria-label="Inline edit row 1, column 2"]')).toBeNull();
    expect(container.textContent).toContain('Alpha');
  });

  it('emits row append intents only when all columns are visible', () => {
    const onEditIntent = vi.fn();
    const source = 'id,count\n001,12\n';
    const analysis = parseSourceFormatDiagnostics('csv', source, 'C:\\lab\\samples.csv').tabularAnalysis;

    renderPreview({ analysis, sourceText: source, editable: true, onEditIntent });

    clickButton('Add row');
    setInputValue('id', '002');
    setInputValue('count', '13');
    clickButton('Append row');

    expect(onEditIntent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'appendRow',
      format: 'csv',
      values: ['002', '13'],
      expectedSourceHash: expect.any(String),
    }));
  });

  it('opens header context menus for column copy actions', async () => {
    const onCopyText = vi.fn();
    const source = 'id,note\n001,Alpha\n002,Beta\n';
    const analysis = parseSourceFormatDiagnostics('csv', source, 'C:\\lab\\samples.csv').tabularAnalysis;

    renderPreview({ analysis, sourceText: source, onCopyText });

    rightClickColumnHeader('note');
    expect(container.querySelector('.context-menu-card')?.getAttribute('aria-label')).toBe('Actions for note');
    hoverContextMenuButton('Copy');
    await clickContextMenuButtonAsync('Copy column name');
    expect(onCopyText).toHaveBeenCalledWith('note', 'note column name');

    rightClickColumnHeader('note');
    hoverContextMenuButton('Copy');
    await clickContextMenuButtonAsync('Copy visible column values');
    expect(onCopyText).toHaveBeenCalledWith('Alpha\nBeta', 'note visible values');
  });

  it('opens column context menus from the keyboard and restores header focus on close', async () => {
    const source = 'id,note\n001,Alpha\n002,Beta\n';
    const analysis = parseSourceFormatDiagnostics('csv', source, 'C:\\lab\\samples.csv').tabularAnalysis;

    renderPreview({ analysis, sourceText: source, onCopyText: vi.fn() });

    const header = keyboardOpenColumnHeader('note');
    expect(container.querySelector('.context-menu-card')?.getAttribute('aria-label')).toBe('Actions for note');

    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await nextAnimationFrame();
    });

    expect(container.querySelector('.context-menu-card')).toBeNull();
    expect(document.activeElement).toBe(header);
  });

  it('keeps inconsistent-width tables visibly read-only', () => {
    const onEditIntent = vi.fn();
    const onUnsupportedEdit = vi.fn();
    const source = 'id,count\n001\n002,13\n';
    const analysis = parseSourceFormatDiagnostics('csv', source, 'C:\\lab\\samples.csv').tabularAnalysis;

    renderPreview({ analysis, sourceText: source, editable: true, onEditIntent, onUnsupportedEdit });

    expect(container.textContent).toContain('expected');
    expect(findButton('Add row')?.disabled).toBe(true);
    expect(findButton('001')?.disabled).toBe(true);
    expect(onEditIntent).not.toHaveBeenCalled();
  });

  it('keeps inconsistent-width table context menus read-only where editing is unsafe', () => {
    const onCopyText = vi.fn();
    const source = 'id,count\n001\n002,13\n';
    const analysis = parseSourceFormatDiagnostics('csv', source, 'C:\\lab\\samples.csv').tabularAnalysis;

    renderPreview({ analysis, sourceText: source, editable: true, onEditIntent: vi.fn(), onCopyText });

    rightClickCell('001');
    expect(findContextMenuButton('Edit cell')?.getAttribute('aria-disabled')).toBe('true');
    hoverContextMenuButton('Copy');
    expect(findContextMenuButton('Copy cell')).not.toBeNull();

    rightClickTableHeader();
    expect(findContextMenuButton('Add row')?.getAttribute('aria-disabled')).toBe('true');
    expect(findContextMenuButton('Convert table')).not.toBeNull();
  });
});

function renderPreview(props: Partial<Parameters<typeof TabularTablePreview>[0]> & {
  analysis: Parameters<typeof TabularTablePreview>[0]['analysis'];
}): void {
  act(() => {
    root.render(<TabularTablePreview {...props} />);
  });
}

function largeCsv(): string {
  const headers = Array.from({ length: 14 }, (_, index) => `c${index + 1}`);
  const rows = Array.from({ length: 60 }, (_, rowIndex) => (
    Array.from({ length: 14 }, (_, columnIndex) => `r${rowIndex + 1}c${columnIndex + 1}`).join(',')
  ));
  return `${headers.join(',')}\n${rows.join('\n')}\n`;
}

function selectFormat(label: string): void {
  const radioLabel = Array.from(container.querySelectorAll<HTMLLabelElement>('label'))
    .find((candidate) => candidate.textContent === label);
  const input = radioLabel?.querySelector<HTMLInputElement>('input');
  expect(input, `radio "${label}"`).not.toBeUndefined();
  act(() => {
    input?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function selectColumn(label: string): void {
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="Choose visible table column"]');
  expect(select, 'column selector').not.toBeNull();
  const option = Array.from(select?.options ?? []).find((candidate) => candidate.textContent === label);
  expect(option, `column "${label}"`).not.toBeUndefined();
  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
    valueSetter?.call(select, option?.value);
    select?.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function tableHeaderLabels(): string[] {
  return Array.from(container.querySelectorAll<HTMLTableCellElement>('thead th'))
    .map((header) => header.textContent?.trim() ?? '');
}


function clickButton(label: string): void {
  const button = findButton(label);
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

function rightClickCell(text: string): void {
  const cell = Array.from(container.querySelectorAll<HTMLTableCellElement>('tbody td'))
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

function rightClickColumnHeader(text: string): void {
  const header = Array.from(container.querySelectorAll<HTMLTableCellElement>('thead th'))
    .find((candidate) => candidate.textContent === text);
  expect(header, `column header "${text}"`).not.toBeUndefined();
  act(() => {
    header?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 220,
      clientY: 120,
      button: 2,
    }));
  });
}

function keyboardOpenColumnHeader(text: string): HTMLTableCellElement {
  const header = Array.from(container.querySelectorAll<HTMLTableCellElement>('thead th'))
    .find((candidate) => candidate.textContent === text);
  expect(header, `column header "${text}"`).not.toBeUndefined();
  act(() => {
    header?.focus();
    header?.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'F10',
      shiftKey: true,
    }));
  });
  return header!;
}

function rightClickTableHeader(): void {
  const header = container.querySelector<HTMLElement>('.tabular-table-header');
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

function findButton(label: string): HTMLButtonElement | undefined {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent?.includes(label));
  return button;
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

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function setInputValue(labelText: string, value: string): void {
  const label = Array.from(container.querySelectorAll<HTMLLabelElement>('.tabular-edit-dialog label'))
    .find((candidate) => candidate.textContent?.includes(labelText));
  const input = label?.querySelector<HTMLInputElement>('input');
  expect(input, `input "${labelText}"`).not.toBeUndefined();
  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    valueSetter?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
    input?.dispatchEvent(new Event('change', { bubbles: true }));
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

function pressInputKeyByLabel(ariaLabel: string, key: string): void {
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
