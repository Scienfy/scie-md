import { act } from 'react';
import type { ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJsonContent, createYamlContent, parseJsonDocument, parseYamlDocument, validateJsonValueAgainstSchema } from '@sciemd/core';
import {
  buildJsonTreeModel,
  findJsonTreeNode,
  JsonTreeView,
  jsonPathForProperty,
  jsonValueToClipboardText,
} from './JsonTreeView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

describe('JsonTreeView', () => {
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

  it('builds stable JSONPath-like paths for object and array nodes', () => {
    const tree = buildJsonTreeModel({ sample: [{ name: 'A' }], 'has.dot': true });

    expect(findJsonTreeNode(tree, '$.sample[0].name')?.value).toBe('A');
    expect(jsonPathForProperty('$', 'has.dot')).toBe('$["has.dot"]');
  });

  it('carries parser-backed node references when a source map is available', () => {
    const text = '{"sample":[{"name":"A"}],"status":"draft"}';
    const parsed = parseJsonDocument(createJsonContent(text)).parsed;
    expect(parsed).not.toBeNull();

    const tree = buildJsonTreeModel(parsed?.value, parsed?.sourceMap);
    const nameNode = findJsonTreeNode(tree, '$.sample[0].name');

    expect(nameNode).toMatchObject({
      path: '$.sample[0].name',
      pointer: '/sample/0/name',
      pathSegments: ['sample', 0, 'name'],
      editable: true,
      lossy: false,
    });
    expect(nameNode?.sourceRef).toMatchObject({
      pointer: '/sample/0/name',
      displayPath: '$.sample[0].name',
      type: 'string',
    });
    expect(nameNode?.valueSpan).toMatchObject({
      offset: text.indexOf('"A"'),
      length: 3,
    });
  });

  it('renders a read-only tree and reports selected paths', () => {
    const onSelectedPathChange = vi.fn();

    renderTree({
      sample: [{ name: 'A' }],
      ok: true,
    }, {
      selectedPath: '$.sample',
      onSelectedPathChange,
    });

    expect(container.querySelector('[role="tree"]')).not.toBeNull();
    expect(container.querySelector('[role="treeitem"][aria-selected="true"]')?.textContent).toContain('sample');

    clickTreeToggle('Expand $.sample');
    clickButton('[0]');
    expect(onSelectedPathChange).toHaveBeenCalledWith('$.sample[0]');
  });

  it('starts containers collapsed below the root overview', () => {
    renderTree({
      sample: [{ name: 'A' }],
      meta: { status: 'ready' },
    });

    expect(container.querySelector('[data-json-pointer="/sample"]')).not.toBeNull();
    expect(container.querySelector('[data-json-pointer="/meta"]')).not.toBeNull();
    expect(container.querySelector('[data-json-pointer="/sample/0"]')).toBeNull();
    expect(container.querySelector('[data-json-pointer="/meta/status"]')).toBeNull();
  });

  it('preserves expanded branches when a refreshed value arrives after an edit', () => {
    renderTree({
      sample: [{ name: 'A' }],
      meta: { status: 'ready' },
    });

    clickTreeToggle('Expand $.sample');
    clickTreeToggle('Expand $.sample[0]');
    expect(container.querySelector('[data-json-pointer="/sample/0"]')).not.toBeNull();
    expect(container.querySelector('[data-json-pointer="/sample/0/name"]')).not.toBeNull();

    renderTree({
      sample: [{ name: 'B' }],
      meta: { status: 'ready' },
    });

    expect(container.querySelector('[data-json-pointer="/sample/0"]')).not.toBeNull();
    expect(container.querySelector('[data-json-pointer="/sample/0/name"]')?.textContent).toContain('B');
  });

  it('shows string values without source-mode quotes in the visual tree', () => {
    renderTree({
      name: 'Alpha',
      ok: true,
    });

    expect(container.querySelector('[data-json-pointer="/name"] .json-tree-preview')?.textContent).toBe('Alpha');
  });

  it('opens row actions on double click and copies the targeted node path', async () => {
    const writeText = vi.fn((value: string) => Promise.resolve(value));
    const onSelectedPathChange = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    renderTree({
      sample: [{ name: 'A' }],
      ok: true,
    }, {
      selectedPath: '$',
      onSelectedPathChange,
    });

    clickTreeToggle('Expand $.sample');
    doubleClickTreeRow('[0]');

    expect(onSelectedPathChange).toHaveBeenCalledWith('$.sample[0]');
    expect(container.querySelector('.json-tree-floating-toolbar')?.getAttribute('aria-label')).toBe('Actions for $.sample[0]');

    await clickFloatingToolbarButtonAsync('Copy path');
    expect(writeText).toHaveBeenCalledWith('$.sample[0]');
  });

  it('reveals parser-backed nodes in source from double-click row actions', () => {
    const onRevealSource = vi.fn();
    const text = '{"sample":[{"name":"A"}],"ok":true}';
    const parsed = parseJsonDocument(createJsonContent(text)).parsed;

    renderTree(parsed?.value, {
      sourceMap: parsed?.sourceMap,
      selectedPath: '$',
      onRevealSource,
    });

    clickTreeToggle('Expand $.sample');
    clickTreeToggle('Expand $.sample[0]');
    doubleClickTreeRow('name');
    clickFloatingToolbarButton('Reveal in source');

    expect(onRevealSource).toHaveBeenCalledWith(expect.objectContaining({
      pointer: '/sample/0/name',
      displayPath: '$.sample[0].name',
      valueSpan: expect.objectContaining({
        offset: text.indexOf('"A"'),
        length: 3,
      }),
    }));
  });

  it('opens a target-specific context menu on right click and selects the clicked row', () => {
    const onSelectedPathChange = vi.fn();

    renderTree({
      sample: [{ name: 'A' }],
      ok: true,
    }, {
      selectedPath: '$',
      onSelectedPathChange,
    });

    clickTreeToggle('Expand $.sample');
    rightClickTreeRow('[0]');

    expect(onSelectedPathChange).toHaveBeenCalledWith('$.sample[0]');
    expect(container.querySelector('.context-menu-card')?.getAttribute('aria-label')).toBe('Actions for $.sample[0]');
    expect(findContextMenuButton('Copy')).not.toBeNull();
  });

  it('adds reveal-source to context menus only when a source span is available', () => {
    const onRevealSource = vi.fn();
    const text = '{"sample":[{"name":"A"}],"ok":true}';
    const parsed = parseJsonDocument(createJsonContent(text)).parsed;

    renderTree(parsed?.value, {
      sourceMap: parsed?.sourceMap,
      selectedPath: '$',
      onRevealSource,
    });

    rightClickTreeRow('ok');
    clickContextMenuButton('Reveal in source');

    expect(onRevealSource).toHaveBeenCalledWith(expect.objectContaining({
      pointer: '/ok',
      displayPath: '$.ok',
    }));
  });

  it('opens row context menus from the keyboard and restores row focus on close', async () => {
    const onSelectedPathChange = vi.fn();

    renderTree({
      sample: [{ name: 'A' }],
      ok: true,
    }, {
      selectedPath: '$',
      onSelectedPathChange,
    });

    clickTreeToggle('Expand $.sample');
    const row = keyboardOpenTreeRow('[0]');

    expect(onSelectedPathChange).toHaveBeenCalledWith('$.sample[0]');
    expect(container.querySelector('.context-menu-card')?.getAttribute('aria-label')).toBe('Actions for $.sample[0]');

    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await nextAnimationFrame();
    });

    expect(container.querySelector('.context-menu-card')).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it('copies the right-clicked node path, JSON, and text from the context menu copy submenu', async () => {
    const writeText = vi.fn((value: string) => Promise.resolve(value));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    renderTree({
      sample: [{ name: 'A' }],
      ok: true,
    });

    clickTreeToggle('Expand $.sample');
    await copyFromContextMenu('[0]', 'Copy path');
    await copyFromContextMenu('[0]', 'Copy JSON');
    await copyFromContextMenu('[0]', 'Copy text');

    expect(writeText).toHaveBeenNthCalledWith(1, '$.sample[0]');
    expect(writeText).toHaveBeenNthCalledWith(2, '{\n  "name": "A"\n}');
    expect(writeText).toHaveBeenNthCalledWith(3, '{\n  "name": "A"\n}');
  });

  it('exposes edit, rename, delete, and add actions from editable JSON context menus', () => {
    const onEditIntent = vi.fn();
    const text = '{"sample":[{"name":"A"}],"status":"draft"}';
    const parsed = parseJsonDocument(createJsonContent(text)).parsed;

    renderTree(parsed?.value, {
      sourceMap: parsed?.sourceMap,
      sourceText: text,
      editable: true,
      selectedPath: '$',
      onEditIntent,
    });

    rightClickTreeRow('status');
    expect(findContextMenuButton('Edit value')).not.toBeNull();
    expect(findContextMenuButton('Rename key')).not.toBeNull();
    expect(findContextMenuButton('Delete field')).not.toBeNull();

    rightClickTreeRow('sample');
    hoverContextMenuButton('Add');
    expect(findContextMenuButton('Add item')).not.toBeNull();
  });

  it('opens the existing scalar edit dialog from the context menu', () => {
    const onEditIntent = vi.fn();
    const text = '{"sample":[{"name":"A"}],"status":"draft"}';
    const parsed = parseJsonDocument(createJsonContent(text)).parsed;

    renderTree(parsed?.value, {
      sourceMap: parsed?.sourceMap,
      sourceText: text,
      editable: true,
      selectedPath: '$',
      onEditIntent,
    });

    rightClickTreeRow('status');
    clickContextMenuButton('Edit value');

    expect(container.textContent).toContain('Edit JSON value');
  });

  it('keeps read-only structured projections safe in context menus while allowing source reveal for mapped nodes', () => {
    const onRevealSource = vi.fn();
    const parsed = parseYamlDocument(createYamlContent('name: Alpha # source-only comment\n')).parsed;

    renderTree(parsed?.value, {
      label: 'YAML tree',
      sourceMap: parsed?.sourceMap,
      preservationWarnings: parsed?.warnings,
      jsonPreview: parsed?.jsonPreview,
      onRevealSource,
    });

    rightClickTreeRow('name');

    expect(findContextMenuButton('Reveal in source')).not.toBeNull();
    expect(findContextMenuButton('Edit value')).toBeNull();
    expect(findContextMenuButton('Rename key')).toBeNull();
    expect(findContextMenuButton('Delete field')).toBeNull();
    expect(findContextMenuButton('Add')).toBeNull();

    clickContextMenuButton('Reveal in source');
    expect(onRevealSource).toHaveBeenCalledWith(expect.objectContaining({
      pointer: '/name',
      displayPath: '$.name',
    }));
  });

  it('dismisses context menus with Escape and outside pointer down', () => {
    renderTree({
      sample: [{ name: 'A' }],
    });

    rightClickTreeRow('sample');
    expect(container.querySelector('.context-menu-card')).not.toBeNull();

    act(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelector('.context-menu-card')).toBeNull();

    rightClickTreeRow('sample');
    expect(container.querySelector('.context-menu-card')).not.toBeNull();

    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(container.querySelector('.context-menu-card')).toBeNull();
  });

  it('preserves tree expansion state after context menu copy actions', async () => {
    const writeText = vi.fn((value: string) => Promise.resolve(value));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    renderTree({
      sample: [{ name: 'A' }],
      meta: { status: 'ready' },
    });

    clickTreeToggle('Expand $.sample');
    expect(container.querySelector('[data-json-pointer="/sample/0"]')).not.toBeNull();

    rightClickTreeRow('sample');
    hoverContextMenuButton('Copy');
    await clickContextMenuButtonAsync('Copy path');

    expect(writeText).toHaveBeenCalledWith('$.sample');
    expect(container.querySelector('[data-json-pointer="/sample/0"]')).not.toBeNull();
  });

  it('dismisses double-click row actions with Escape', () => {
    renderTree({
      sample: [{ name: 'A' }],
    });

    clickTreeToggle('Expand $.sample');
    doubleClickTreeRow('[0]');
    expect(container.querySelector('.json-tree-floating-toolbar')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(container.querySelector('.json-tree-floating-toolbar')).toBeNull();
  });

  it('can label the same read-only tree for other structured formats', () => {
    renderTree({ sample: true }, { label: 'YAML tree' });

    expect(container.querySelector('section[aria-label="YAML tree"]')).not.toBeNull();
    expect(container.textContent).toContain('YAML tree');
    expect(container.textContent).toContain('Read-only');
  });

  it('shows preservation badges and copies JSON previews for lossy structured formats', async () => {
    const writeText = vi.fn((value: string) => Promise.resolve(value));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const parsed = parseYamlDocument(createYamlContent('name: Alpha # source-only comment\n')).parsed;

    renderTree(parsed?.value, {
      label: 'YAML tree',
      sourceMap: parsed?.sourceMap,
      preservationWarnings: parsed?.warnings,
      jsonPreview: parsed?.jsonPreview,
    });

    expect(container.textContent).toContain('YAML tree');
    expect(container.textContent).toContain('Read-only - 1 preservation warning');
    expect(container.textContent).toContain('comments');
    expect(container.textContent).toContain('Lossy');

    await clickButtonAsync('Copy JSON preview');
    expect(writeText).toHaveBeenCalledWith('{\n  "name": "Alpha"\n}\n');
  });

  it('does not expose edit controls before range-preserving JSON edits are wired into the UI', () => {
    const parsed = parseJsonDocument(createJsonContent('{"sample":[{"name":"A"}],"ok":true}')).parsed;

    renderTree(parsed?.value, { sourceMap: parsed?.sourceMap });

    expect(container.textContent).toContain('Read-only');
    expect(container.querySelector('[data-json-pointer="/sample"]')?.getAttribute('data-json-editable')).toBe('true');
    expect(findButton('Add')).toBeUndefined();
    expect(findButton('Rename')).toBeUndefined();
    expect(findButton('Delete')).toBeUndefined();
    expect(findButton('Format JSON')).toBeUndefined();
  });

  it('opens a scalar edit dialog and emits a source-hashed replace intent', () => {
    const onEditIntent = vi.fn();
    const text = '{"sample":[{"name":"A"}],"ok":true}';
    const parsed = parseJsonDocument(createJsonContent(text)).parsed;

    renderTree(parsed?.value, {
      sourceMap: parsed?.sourceMap,
      sourceText: text,
      editable: true,
      selectedPath: '$.sample[0].name',
      onEditIntent,
    });

    clickButton('Edit value');
    setTextInput('Text', 'B');
    clickDialogPrimary();

    expect(onEditIntent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'replaceScalar',
      path: ['sample', 0, 'name'],
      nextValue: 'B',
      expectedSourceHash: expect.any(String),
    }));
  });

  it('emits raw JSON number tokens from scalar tree edits', () => {
    const onEditIntent = vi.fn();
    const text = '{"large":900719925474099312345}';
    const parsed = parseJsonDocument(createJsonContent(text)).parsed;

    renderTree(parsed?.value, {
      sourceMap: parsed?.sourceMap,
      sourceText: text,
      editable: true,
      selectedPath: '$.large',
      onEditIntent,
    });

    clickButton('Edit value');
    const numberLabel = Array.from(container.querySelectorAll<HTMLLabelElement>('label'))
      .find((candidate) => candidate.querySelector('span')?.textContent === 'Number');
    const numberInput = numberLabel?.querySelector<HTMLInputElement>('input');
    expect(numberInput?.value).toBe('900719925474099312345');
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(numberInput, '1.2300e+12');
      numberInput?.dispatchEvent(new Event('input', { bubbles: true }));
      numberInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    clickDialogPrimary();

    expect(onEditIntent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'replaceScalar',
      path: ['large'],
      nextValue: { kind: 'raw-json-number', raw: '1.2300e+12' },
    }));
  });

  it('starts inline scalar editing from double-click rows', () => {
    const onEditIntent = vi.fn();
    const text = '{"sample":[{"name":"A"}],"status":"draft"}';
    const parsed = parseJsonDocument(createJsonContent(text)).parsed;

    renderTree(parsed?.value, {
      sourceMap: parsed?.sourceMap,
      sourceText: text,
      editable: true,
      selectedPath: '$',
      onEditIntent,
    });

    doubleClickTreeRow('status');
    setInlineInputValue('Inline edit $.status', 'final');
    pressInlineEditorKey('Inline edit $.status', 'Enter');

    expect(onEditIntent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'replaceScalar',
      path: ['status'],
      nextValue: 'final',
    }));
  });

  it('cancels inline scalar edits with Escape', () => {
    const onEditIntent = vi.fn();
    const text = '{"status":"draft"}';
    const parsed = parseJsonDocument(createJsonContent(text)).parsed;

    renderTree(parsed?.value, {
      sourceMap: parsed?.sourceMap,
      sourceText: text,
      editable: true,
      selectedPath: '$',
      onEditIntent,
    });

    doubleClickTreeRow('status');
    setInlineInputValue('Inline edit $.status', 'final');
    pressInlineEditorKey('Inline edit $.status', 'Escape');

    expect(onEditIntent).not.toHaveBeenCalled();
    expect(container.querySelector('input[aria-label="Inline edit $.status"]')).toBeNull();
    expect(container.textContent).toContain('draft');
  });

  it('emits object key rename and delete intents only when editing is enabled', () => {
    const onEditIntent = vi.fn();
    const text = '{"sample":[{"name":"A"}],"ok":true}';
    const parsed = parseJsonDocument(createJsonContent(text)).parsed;

    renderTree(parsed?.value, {
      sourceMap: parsed?.sourceMap,
      sourceText: text,
      editable: true,
      selectedPath: '$.ok',
      onEditIntent,
    });

    clickButton('Rename key');
    setTextInput('Key', 'enabled');
    clickDialogPrimary();

    expect(onEditIntent).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'renameObjectKey',
      path: ['ok'],
      newKey: 'enabled',
    }));

    clickButton('Delete field');
    clickDialogPrimary();

    expect(onEditIntent).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'deleteObjectField',
      path: ['ok'],
    }));
  });

  it('emits add field, add item, and delete item intents from container selections', () => {
    const onEditIntent = vi.fn();
    const text = '{"sample":[{"name":"A"}],"meta":{}}';
    const parsed = parseJsonDocument(createJsonContent(text)).parsed;

    renderTree(parsed?.value, {
      sourceMap: parsed?.sourceMap,
      sourceText: text,
      editable: true,
      selectedPath: '$.meta',
      onEditIntent,
    });

    clickButton('Add field');
    setTextInput('New key', 'created');
    setTextInput('Text', 'yes');
    clickDialogPrimary();
    expect(onEditIntent).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'addObjectField',
      path: ['meta'],
      key: 'created',
      value: 'yes',
    }));

    renderTree(parsed?.value, {
      sourceMap: parsed?.sourceMap,
      sourceText: text,
      editable: true,
      selectedPath: '$.sample',
      onEditIntent,
    });
    clickButton('Add item');
    setTextInput('Text', 'next');
    clickDialogPrimary();
    expect(onEditIntent).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'addArrayItem',
      path: ['sample'],
      index: 1,
      value: 'next',
    }));

    renderTree(parsed?.value, {
      sourceMap: parsed?.sourceMap,
      sourceText: text,
      editable: true,
      selectedPath: '$.sample[0]',
      onEditIntent,
    });
    clickButton('Delete item');
    clickDialogPrimary();
    expect(onEditIntent).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'deleteArrayItem',
      path: ['sample', 0],
    }));
  });

  it('uses schema enum options when replacing scalar values', () => {
    const onEditIntent = vi.fn();
    const text = '{"status":"draft"}';
    const parsed = parseJsonDocument(createJsonContent(text)).parsed;
    const schemaValidation = validateJsonValueAgainstSchema(parsed?.value, {
      kind: 'explicit',
      path: 'C:\\lab\\result.schema.json',
      text: JSON.stringify({
        type: 'object',
        properties: {
          status: { enum: ['draft', 'final'] },
        },
      }),
    }, { sourceMap: parsed?.sourceMap });

    renderTree(parsed?.value, {
      sourceMap: parsed?.sourceMap,
      sourceText: text,
      schemaValidation,
      editable: true,
      selectedPath: '$.status',
      onEditIntent,
    });

    clickButton('Edit value');
    setSelectInput('Enum', '"final"');
    clickDialogPrimary();

    expect(onEditIntent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'replaceScalar',
      path: ['status'],
      nextValue: 'final',
    }));
  });

  it('adds missing required scalar fields from schema suggestions', () => {
    const onEditIntent = vi.fn();
    const text = '{"meta":{}}';
    const parsed = parseJsonDocument(createJsonContent(text)).parsed;
    const schemaValidation = validateJsonValueAgainstSchema(parsed?.value, {
      kind: 'explicit',
      path: 'C:\\lab\\result.schema.json',
      text: JSON.stringify({
        type: 'object',
        required: ['id'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', default: 'sample-1', description: 'Identifier.' },
          meta: { type: 'object' },
        },
      }),
    }, { sourceMap: parsed?.sourceMap });

    renderTree(parsed?.value, {
      sourceMap: parsed?.sourceMap,
      sourceText: text,
      schemaValidation,
      editable: true,
      selectedPath: '$',
      onEditIntent,
    });

    clickButton('Add required');
    expect(container.textContent).toContain('Identifier.');
    clickDialogPrimary();

    expect(onEditIntent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'addObjectField',
      path: [],
      key: 'id',
      value: 'sample-1',
    }));
  });

  it('adds missing required generated object fields from schema suggestions', () => {
    const onEditIntent = vi.fn();
    const text = '{"meta":{}}';
    const parsed = parseJsonDocument(createJsonContent(text)).parsed;
    const schemaValidation = validateJsonValueAgainstSchema(parsed?.value, {
      kind: 'explicit',
      path: 'C:\\lab\\result.schema.json',
      text: JSON.stringify({
        type: 'object',
        properties: {
          meta: {
            type: 'object',
            required: ['settings'],
            additionalProperties: false,
            properties: {
              settings: {
                type: 'object',
                required: ['enabled', 'threshold'],
                additionalProperties: false,
                properties: {
                  enabled: { type: 'boolean', default: true },
                  threshold: { type: 'number' },
                },
              },
            },
          },
        },
      }),
    }, { sourceMap: parsed?.sourceMap });

    renderTree(parsed?.value, {
      sourceMap: parsed?.sourceMap,
      sourceText: text,
      schemaValidation,
      editable: true,
      selectedPath: '$.meta',
      onEditIntent,
    });

    clickButton('Add required');
    expect(container.textContent).toContain('Generated value');
    expect(container.textContent).toContain('"enabled": true');
    clickDialogPrimary();

    expect(onEditIntent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'addObjectField',
      path: ['meta'],
      key: 'settings',
      value: { enabled: true, threshold: 0 },
      schemaGeneratedValueExplanation: expect.stringContaining('required schema fields'),
    }));
  });

  it('shows disabled reasons for unsupported required schema fields', () => {
    const onEditIntent = vi.fn();
    const text = '{"meta":{}}';
    const parsed = parseJsonDocument(createJsonContent(text)).parsed;
    const schemaValidation = validateJsonValueAgainstSchema(parsed?.value, {
      kind: 'explicit',
      path: 'C:\\lab\\result.schema.json',
      text: JSON.stringify({
        type: 'object',
        properties: {
          meta: {
            type: 'object',
            required: ['choice'],
            additionalProperties: false,
            properties: {
              choice: { oneOf: [{ type: 'string' }, { type: 'number' }] },
            },
          },
        },
      }),
    }, { sourceMap: parsed?.sourceMap });

    renderTree(parsed?.value, {
      sourceMap: parsed?.sourceMap,
      sourceText: text,
      schemaValidation,
      editable: true,
      selectedPath: '$.meta',
      onEditIntent,
    });

    clickButton('Add required');
    expect(container.textContent).toContain('oneOf');
    expect(container.querySelector<HTMLButtonElement>('.json-tree-edit-dialog .primary')?.disabled).toBe(true);
  });

  it('copies the selected path and value representations', async () => {
    const writeText = vi.fn((value: string) => Promise.resolve(value));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    renderTree({
      sample: [{ name: 'A' }],
    }, {
      selectedPath: '$.sample[0].name',
    });

    await clickButtonAsync('Copy path');
    await clickButtonAsync('Copy JSON');
    await clickButtonAsync('Copy text');

    expect(writeText).toHaveBeenNthCalledWith(1, '$.sample[0].name');
    expect(writeText).toHaveBeenNthCalledWith(2, '"A"');
    expect(writeText).toHaveBeenNthCalledWith(3, 'A');
  });

  it('serializes selected values without mutating them', () => {
    const value = { ok: true, nested: [1] };

    expect(jsonValueToClipboardText(value, 'json')).toBe(JSON.stringify(value, null, 2));
    expect(jsonValueToClipboardText('plain', 'text')).toBe('plain');
  });
});

function renderTree(
  value: unknown,
  props: Partial<ComponentProps<typeof JsonTreeView>> = {},
) {
  act(() => {
    root.render(<JsonTreeView value={value} {...props} />);
  });
}

function clickButton(text: string): void {
  const button = findButton(text);
  expect(button, `button "${text}"`).not.toBeUndefined();
  act(() => {
    button?.click();
  });
}

function doubleClickTreeRow(text: string): void {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('.json-tree-select'))
    .find((candidate) => candidate.textContent?.includes(text));
  expect(button, `tree row "${text}"`).not.toBeUndefined();
  act(() => {
    button?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
}

function rightClickTreeRow(text: string): void {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('.json-tree-select'))
    .find((candidate) => candidate.textContent?.includes(text));
  expect(button, `tree row "${text}"`).not.toBeUndefined();
  act(() => {
    button?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 180,
      clientY: 140,
      button: 2,
    }));
  });
}

function keyboardOpenTreeRow(text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('.json-tree-select'))
    .find((candidate) => candidate.textContent?.includes(text));
  expect(button, `tree row "${text}"`).not.toBeUndefined();
  act(() => {
    button?.focus();
    button?.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'F10',
      shiftKey: true,
    }));
  });
  return button!;
}

function clickTreeToggle(ariaLabel: string): void {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('.json-tree-toggle'))
    .find((candidate) => candidate.getAttribute('aria-label') === ariaLabel);
  expect(button, `tree toggle "${ariaLabel}"`).not.toBeUndefined();
  act(() => {
    button?.click();
  });
}

function clickFloatingToolbarButton(ariaLabel: string): void {
  const button = findFloatingToolbarButton(ariaLabel);
  expect(button, `floating toolbar button "${ariaLabel}"`).not.toBeUndefined();
  act(() => {
    button?.click();
  });
}

async function clickFloatingToolbarButtonAsync(ariaLabel: string): Promise<void> {
  const button = findFloatingToolbarButton(ariaLabel);
  expect(button, `floating toolbar button "${ariaLabel}"`).not.toBeUndefined();
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
}

function findFloatingToolbarButton(ariaLabel: string): HTMLButtonElement | undefined {
  const toolbar = container.querySelector('.json-tree-floating-toolbar');
  return Array.from(toolbar?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    .find((button) => button.getAttribute('aria-label') === ariaLabel);
}

function clickContextMenuButton(text: string): void {
  const button = findContextMenuButton(text);
  expect(button, `context menu button "${text}"`).not.toBeNull();
  act(() => {
    button?.click();
  });
}

async function clickContextMenuButtonAsync(text: string): Promise<void> {
  const button = findContextMenuButton(text);
  expect(button, `context menu button "${text}"`).not.toBeNull();
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
}

function hoverContextMenuButton(text: string): void {
  const button = findContextMenuButton(text);
  expect(button, `context menu button "${text}"`).not.toBeNull();
  act(() => {
    button?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
}

async function copyFromContextMenu(rowText: string, copyAction: string): Promise<void> {
  rightClickTreeRow(rowText);
  hoverContextMenuButton('Copy');
  await clickContextMenuButtonAsync(copyAction);
}

function findContextMenuButton(text: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.context-menu-card .context-menu-item'))
    .find((button) => button.textContent?.includes(text)) ?? null;
}

async function clickButtonAsync(text: string): Promise<void> {
  const button = findButton(text);
  expect(button, `button "${text}"`).not.toBeUndefined();
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
}

function findButton(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => button.textContent?.includes(text));
}

function setTextInput(labelText: string, value: string): void {
  const label = Array.from(container.querySelectorAll<HTMLLabelElement>('label'))
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

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function setSelectInput(labelText: string, value: string): void {
  const label = Array.from(container.querySelectorAll<HTMLLabelElement>('label'))
    .find((candidate) => candidate.textContent?.includes(labelText));
  const select = label?.querySelector<HTMLSelectElement>('select');
  expect(select, `select "${labelText}"`).not.toBeUndefined();
  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
    valueSetter?.call(select, value);
    select?.dispatchEvent(new Event('input', { bubbles: true }));
    select?.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function clickDialogPrimary(): void {
  const button = container.querySelector<HTMLButtonElement>('.json-tree-edit-dialog .primary, .json-tree-edit-dialog .danger');
  expect(button, 'dialog primary button').not.toBeNull();
  act(() => {
    button?.click();
  });
}

function patchDialogMethods() {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
}
