import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDelimitedTextConversionPreview } from '@sciemd/core';
import { TabularPasteDialog } from './TabularPasteDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

describe('TabularPasteDialog', () => {
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

  it('renders warnings and inserts the selected JSONL conversion', () => {
    const onInsert = vi.fn();
    const preview = createDelimitedTextConversionPreview('id,count\n001,12\n002,13\n');
    renderDialog({ preview, onInsert });

    expect(container.textContent).toContain('Delimited Paste');
    expect(container.textContent).toContain('2 rows, 2 columns');
    expect(container.textContent).toContain('Conversion keeps them as strings');

    selectFormat('JSON Lines');
    clickButton('Insert');

    expect(onInsert).toHaveBeenCalledWith(
      '{"id":"001","count":"12"}\n{"id":"002","count":"13"}\n',
      'jsonl',
    );
  });

  it('copies the selected conversion without inserting', () => {
    const onCopy = vi.fn();
    const onInsert = vi.fn();
    const preview = createDelimitedTextConversionPreview('name\tvalue\nalpha\t1\n');
    renderDialog({ preview, onCopy, onInsert });

    selectFormat('JSON array');
    clickButton('Copy');

    expect(onCopy).toHaveBeenCalledWith(expect.stringContaining('"name": "alpha"'), 'json');
    expect(onInsert).not.toHaveBeenCalled();
  });

  it('dispatches reviewed paste conversion actions', () => {
    const onConversionAction = vi.fn();
    const preview = createDelimitedTextConversionPreview('name\tvalue\nalpha\t1\n');
    renderDialog({ preview, sourceText: 'name\tvalue\nalpha\t1\n', onConversionAction });

    selectFormat('JSON array');
    clickButton('Save as');

    expect(onConversionAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'save-as',
      format: 'json',
      label: 'JSON array',
      content: expect.stringContaining('"name": "alpha"'),
      sourceFormat: 'tsv',
      sourceHash: expect.any(String),
    }));
  });

  it('offers string-preserving YAML and TOML conversions', () => {
    const onCopy = vi.fn();
    const onInsert = vi.fn();
    const preview = createDelimitedTextConversionPreview('id,count\n001,12\n');
    renderDialog({ preview, onCopy, onInsert });

    selectFormat('TOML array of tables');
    expect(container.textContent).toContain('TOML conversion writes rows as [[rows]] tables');
    clickButton('Copy');

    expect(onCopy).toHaveBeenCalledWith(expect.stringContaining('[[rows]]'), 'toml');
    expect(onInsert).not.toHaveBeenCalled();

    selectFormat('YAML list');
    clickButton('Insert');

    expect(onInsert).toHaveBeenCalledWith(expect.stringContaining('id: "001"'), 'yaml');
  });
});

function renderDialog(overrides: Partial<Parameters<typeof TabularPasteDialog>[0]> = {}): void {
  const preview = overrides.preview ?? createDelimitedTextConversionPreview('name\tvalue\nalpha\t1\n');
  act(() => {
    root.render(
      <TabularPasteDialog
        open
        preview={preview}
        onInsert={vi.fn()}
        onCopy={vi.fn()}
        onCancel={vi.fn()}
        {...overrides}
      />,
    );
  });
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

function clickButton(label: string): void {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent === label);
  expect(button, `button "${label}"`).not.toBeUndefined();
  act(() => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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
