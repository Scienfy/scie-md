import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureEditorHtmlForExport } from './renderCapture';
import { readBinaryFileBase64 } from '../services/fileService';

vi.mock('../services/fileService', () => ({
  readBinaryFileBase64: vi.fn(async () => 'ZmFrZS1pbWFnZQ=='),
}));

describe('renderCapture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('captures the visual editor frame while removing editor-only controls and metadata', async () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <main class="editor-stage">
        <div class="save-pill">Autosave</div>
        <div class="quick-outline">Outline</div>
        <section class="visual-editor">
          <article class="ProseMirror ProseMirror-focused" contenteditable="true">
            <div class="scie-md-lock-boundary">Lock</div>
            <p class="locked-range-block locked-range-first focus-dimmed-block">Important text</p>
            <ul class="focus-active-block"><li>Active list item</li></ul>
            <section class="directive-card">
              <div class="scie-md-visual-atom-controls"><button>Edit</button></div>
              <p>Rendered block</p>
            </section>
            <div class="scie-md-note-card">LLM note</div>
            <div class="scie-md-variant-rail">...</div>
          </article>
        </section>
      </main>
    `;

    const captured = await captureEditorHtmlForExport(root);

    expect(captured?.isFullVisualFrame).toBe(true);
    expect(captured?.bodyHtml).toContain('editor-stage');
    expect(captured?.bodyHtml).toContain('export-captured-stage');
    expect(captured?.bodyHtml).toContain('Important text');
    expect(captured?.bodyHtml).toContain('Rendered block');
    expect(captured?.bodyHtml).not.toContain('Autosave');
    expect(captured?.bodyHtml).not.toContain('Outline');
    expect(captured?.bodyHtml).not.toContain('Lock');
    expect(captured?.bodyHtml).not.toContain('LLM note');
    expect(captured?.bodyHtml).not.toContain('Edit');
    expect(captured?.bodyHtml).not.toContain('locked-range-block');
    expect(captured?.bodyHtml).not.toContain('focus-dimmed-block');
    expect(captured?.bodyHtml).not.toContain('focus-active-block');
  });

  it('inlines Tauri asset image URLs instead of failing visual capture', async () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <section class="visual-editor">
        <article class="ProseMirror"><p><img src="asset://localhost/C:/docs/assets/figure.png" alt="Figure"></p></article>
      </section>
    `;

    const captured = await captureEditorHtmlForExport(root);

    expect(readBinaryFileBase64).toHaveBeenCalledWith('C:\\docs\\assets\\figure.png');
    expect(captured?.bodyHtml).toContain('data:image/png;base64,ZmFrZS1pbWFnZQ==');
  });

  it('preserves POSIX file URL paths when embedding local images', async () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <section class="visual-editor">
        <article class="ProseMirror"><p><img src="file:///Users/amin/paper/assets/figure.png" alt="Figure"></p></article>
      </section>
    `;

    await captureEditorHtmlForExport(root);

    expect(readBinaryFileBase64).toHaveBeenCalledWith('/Users/amin/paper/assets/figure.png');
  });

  it('fetches WebView-served asset.localhost images before falling back to disk grants', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      blob: async () => ({
        type: 'image/png',
        arrayBuffer: async () => new TextEncoder().encode('webview-image').buffer,
      }),
    } as Response);
    const root = document.createElement('div');
    root.innerHTML = `
      <section class="visual-editor">
        <article class="ProseMirror"><p><img src="http://asset.localhost/C:/docs/assets/figure.png" alt="Figure"></p></article>
      </section>
    `;

    const captured = await captureEditorHtmlForExport(root);

    expect(fetchMock).toHaveBeenCalledWith('http://asset.localhost/C:/docs/assets/figure.png');
    expect(readBinaryFileBase64).not.toHaveBeenCalledWith('C:\\docs\\assets\\figure.png');
    expect(captured?.bodyHtml).toContain('data:image/png;base64,d2Vidmlldy1pbWFnZQ==');
    fetchMock.mockRestore();
  });
});
