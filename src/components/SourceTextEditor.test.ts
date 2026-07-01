import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, vi } from 'vitest';
import { describe, expect, it } from 'vitest';
import { SourceTextEditor, formatDiagnosticsForCodeMirror, type SourceTextContextMenuRequest, type SourceTextEditorProps, type SourceTextFind, type SourceTextSelection } from './SourceTextEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SourceTextEditor diagnostics', () => {
  it('maps format diagnostic offsets into CodeMirror diagnostics', () => {
    const diagnostics = formatDiagnosticsForCodeMirror([
      {
        severity: 'error',
        code: 'json-syntax',
        message: 'Expected a JSON value.',
        offset: 8,
        length: 2,
        source: 'json',
      },
    ], '{\n  "a": \n}');

    expect(diagnostics).toEqual([{
      from: 8,
      to: 10,
      severity: 'error',
      source: 'json',
      message: 'Expected a JSON value.',
    }]);
  });

  it('falls back to line and column when offsets are unavailable', () => {
    const diagnostics = formatDiagnosticsForCodeMirror([
      {
        severity: 'warning',
        code: 'json-health',
        message: 'Array has mixed values.',
        line: 3,
        column: 5,
        source: 'json',
      },
    ], '{\n  "a": [\n    1\n  ]\n}');

    expect(diagnostics[0]).toMatchObject({
      from: 15,
      to: 16,
      severity: 'warning',
      source: 'json',
    });
  });
});

describe('SourceTextEditor context menu requests', () => {
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

  it('emits a selected source payload and prevents the native menu only when handled', () => {
    let findSelection: SourceTextFind | undefined;
    const requests: SourceTextContextMenuRequest[] = [];
    const onContextMenuRequest = vi.fn((request: SourceTextContextMenuRequest) => {
      requests.push(request);
      return true;
    });

    renderSourceTextEditor({
      value: 'alpha\nbeta\n',
      language: 'json',
      diagnostics: [{
        severity: 'error',
        code: 'json-test',
        message: 'Line issue.',
        line: 1,
        column: 2,
        source: 'json',
      }],
      onFindReady: (handler) => {
        findSelection = handler;
      },
      onContextMenuRequest,
    });

    act(() => {
      findSelection?.(0, 5);
    });
    const event = dispatchSourceContextMenu();

    expect(event.defaultPrevented).toBe(true);
    expect(onContextMenuRequest).toHaveBeenCalledTimes(1);
    expect(requests[0]).toMatchObject({
      kind: 'selection',
      position: { x: 210, y: 120 },
      language: 'json',
      text: 'alpha',
      lineText: 'alpha',
      selectedLinesText: 'alpha',
      line: 1,
      endLine: 1,
      from: 0,
      to: 5,
      diagnostics: [{
        severity: 'error',
        code: 'json-test',
        message: 'Line issue.',
        line: 1,
        column: 2,
        source: 'json',
      }],
    });
  });

  it('emits a line source payload when no text is selected', () => {
    let findSelection: SourceTextFind | undefined;
    let getSelection: SourceTextSelection | undefined;
    const requests: SourceTextContextMenuRequest[] = [];
    const onContextMenuRequest = vi.fn((request: SourceTextContextMenuRequest) => {
      requests.push(request);
      return true;
    });

    renderSourceTextEditor({
      value: 'alpha\nbeta\n',
      language: 'json',
      diagnostics: [{
        severity: 'warning',
        code: 'json-line',
        message: 'Beta issue.',
        line: 2,
        source: 'json',
      }],
      onFindReady: (handler) => {
        findSelection = handler;
      },
      onSelectionTextReady: (handler) => {
        getSelection = handler;
      },
      onContextMenuRequest,
    });

    act(() => {
      findSelection?.(6, 6);
    });
    const event = dispatchSourceContextMenu();

    expect(event.defaultPrevented).toBe(true);
    expect(onContextMenuRequest).toHaveBeenCalledTimes(1);
    expect(requests[0]).toMatchObject({
      kind: 'line',
      language: 'json',
      text: 'beta',
      lineText: 'beta',
      selectedLinesText: 'beta',
      line: 2,
      endLine: 2,
      diagnostics: [{
        severity: 'warning',
        code: 'json-line',
        message: 'Beta issue.',
        line: 2,
        source: 'json',
      }],
    });

    act(() => {
      requests[0].selectLine();
    });

    expect(getSelection?.()).toMatchObject({
      text: 'beta',
      line: 2,
      endLine: 2,
      surface: 'source',
    });
  });

  it('leaves the native source context menu alone when the app does not handle a request', () => {
    const onContextMenuRequest = vi.fn(() => false);

    renderSourceTextEditor({
      value: 'alpha\nbeta\n',
      language: 'json',
      onContextMenuRequest,
    });

    const event = dispatchSourceContextMenu();

    expect(onContextMenuRequest).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it('keeps normal text update wiring intact', () => {
    let insertText: ((text: string) => void) | undefined;
    const onChange = vi.fn();

    renderSourceTextEditor({
      value: 'alpha',
      language: 'markdown',
      onChange,
      onInsertReady: (handler) => {
        insertText = handler;
      },
    });

    act(() => {
      insertText?.(' beta');
    });

    expect(onChange).toHaveBeenCalledWith(' betaalpha');
  });

  it('uses adapter source metadata for language and status presentation', () => {
    renderSourceTextEditor({
      value: 'sample:\n  id: S-001\n',
      language: 'yaml',
    });

    expect(container.querySelector('.source-editor')?.getAttribute('data-source-editor-codemirror')).toBe('yaml');
    expect(container.querySelector('.source-editor')?.getAttribute('data-source-editor-lint')).toBe('structured');
    expect(container.querySelector('.source-editor-status-strip')?.textContent).toContain('YAML');
    expect(container.querySelector('.source-editor-status-strip')?.textContent).toContain('Parser OK');
  });

  it('shows format-aware source warnings without changing default Markdown source mode', () => {
    renderSourceTextEditor({
      value: '# Intro\n',
      language: 'markdown',
    });

    expect(container.querySelector('.source-editor-status-strip')).toBeNull();

    act(() => {
      root.render(createElement(SourceTextEditor, {
        value: 'a = [\r\nb = 1\n',
        language: 'toml',
        diagnostics: [
          {
            severity: 'error',
            code: 'toml-syntax',
            message: 'Invalid TOML.',
            line: 1,
            source: 'toml',
          },
          {
            severity: 'warning',
            code: 'toml-source-only-large-file',
            message: 'TOML exceeds the parser budget.',
            source: 'toml',
          },
        ],
        autosavePausedReason: 'Autosave paused: TOML syntax is invalid.',
        onChange: vi.fn(),
      }));
    });

    const statusText = container.querySelector('.source-editor-status-strip')?.textContent ?? '';
    expect(container.querySelector('.source-editor')?.getAttribute('data-source-editor-codemirror')).toBe('plainText');
    expect(statusText).toContain('TOML');
    expect(statusText).toContain('1 syntax error');
    expect(statusText).toContain('Source-only');
    expect(statusText).toContain('Plain text');
    expect(statusText).toContain('Mixed line endings');
    expect(statusText).toContain('Autosave paused');
  });

  it('shows one source status badge for true plain text documents', () => {
    renderSourceTextEditor({
      value: 'Header\n\nMain text\n',
      language: 'plainText',
    });

    const badgeLabels = Array.from(container.querySelectorAll('.source-editor-status-badge'))
      .map((badge) => badge.textContent);
    expect(badgeLabels).toEqual(['Plain Text']);
  });

  function renderSourceTextEditor(overrides: Partial<SourceTextEditorProps> = {}) {
    act(() => {
      root.render(createElement(SourceTextEditor, {
        value: '',
        language: 'markdown',
        diagnostics: [],
        onChange: vi.fn(),
        ...overrides,
      }));
    });
  }

  function dispatchSourceContextMenu(): MouseEvent {
    const target = container.querySelector<HTMLElement>('.cm-content');
    expect(target).not.toBeNull();
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 210,
      clientY: 120,
      button: 2,
    });
    act(() => {
      target?.dispatchEvent(event);
    });
    return event;
  }
});
