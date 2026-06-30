import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureEditorHtmlForExport } from './renderCapture';
import { readBinaryFileBase64 } from '../services/fileService';
import { localImageDisplayUrl } from '../markdown/imagePaths';

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

  it('sanitizes executable captured DOM before export generation', async () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <section class="visual-editor">
        <article class="ProseMirror">
          <p onclick="alert(1)">Text</p>
          <iframe srcdoc="<p>bad</p>"></iframe>
          <img src="javascript:alert(1)" onerror="alert(1)" alt="Bad">
          <svg><script>alert(1)</script><foreignObject><div>bad</div></foreignObject><rect width="10"></rect></svg>
        </article>
      </section>
    `;

    const captured = await captureEditorHtmlForExport(root);

    expect(captured?.bodyHtml).toContain('<p>Text</p>');
    expect(captured?.bodyHtml).toContain('<rect width="10"></rect>');
    expect(captured?.bodyHtml).not.toMatch(/onclick|onerror|script|foreignObject|iframe|srcdoc|javascript:/i);
  });

  it('keeps allowed scientific captured output while sanitizing the export body', async () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <section class="visual-editor">
        <article class="ProseMirror">
          <p><span class="katex"><span class="mord mathnormal">x</span></span></p>
          <svg viewBox="0 0 12 12" aria-label="Trend"><path d="M1 10L11 2"></path></svg>
          <p><img src="${localImageDisplayUrl('D:\\external-lab\\paper\\assets\\figure.svg')}" alt="Figure"></p>
        </article>
      </section>
    `;

    const captured = await captureEditorHtmlForExport(root);

    expect(captured?.bodyHtml).toContain('class="katex"');
    expect(captured?.bodyHtml).toContain('mathnormal');
    expect(captured?.bodyHtml).toContain('<svg');
    expect(captured?.bodyHtml).toContain('<path d="M1 10L11 2"></path>');
    expect(captured?.bodyHtml).toContain('data:image/svg+xml;base64,ZmFrZS1pbWFnZQ==');
  });

  it('does not treat legacy Tauri asset URLs as active local-image grants', async () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <section class="visual-editor">
        <article class="ProseMirror"><p><img src="asset://localhost/C:/docs/assets/figure.png" alt="Figure"></p></article>
      </section>
    `;

    const captured = await captureEditorHtmlForExport(root);

    expect(readBinaryFileBase64).not.toHaveBeenCalled();
    expect(captured?.bodyHtml).not.toContain('asset://localhost/C:/docs/assets/figure.png');
    expect(captured?.bodyHtml).toContain('<img alt="Figure">');
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

  it('inlines ScieMD grant-checked local image protocol URLs', async () => {
    const src = localImageDisplayUrl('D:\\external-lab\\paper\\assets\\figure.svg');
    const root = document.createElement('div');
    root.innerHTML = `
      <section class="visual-editor">
        <article class="ProseMirror"><p><img src="${src}" alt="Figure"></p></article>
      </section>
    `;

    const captured = await captureEditorHtmlForExport(root);

    expect(readBinaryFileBase64).toHaveBeenCalledWith('D:\\external-lab\\paper\\assets\\figure.svg');
    expect(captured?.bodyHtml).toContain('data:image/svg+xml;base64,ZmFrZS1pbWFnZQ==');
  });

  it('fetches WebView-served grant-checked local image protocol URLs before falling back to disk grants', async () => {
    const src = localImageDisplayUrl('C:\\docs\\assets\\figure.png')
      .replace('scie-md-local-image://localhost/', 'http://scie-md-local-image.localhost/');
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
        <article class="ProseMirror"><p><img src="${src}" alt="Figure"></p></article>
      </section>
    `;

    const captured = await captureEditorHtmlForExport(root);

    expect(fetchMock).toHaveBeenCalledWith(src);
    expect(readBinaryFileBase64).not.toHaveBeenCalledWith('C:\\docs\\assets\\figure.png');
    expect(captured?.bodyHtml).toContain('data:image/png;base64,d2Vidmlldy1pbWFnZQ==');
    fetchMock.mockRestore();
  });

  it('marks remote images that cannot be embedded as export warnings', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    const root = document.createElement('div');
    root.innerHTML = `
      <section class="visual-editor">
        <article class="ProseMirror"><p><img src="https://example.test/figure.png" alt="Remote"></p></article>
      </section>
    `;

    const captured = await captureEditorHtmlForExport(root);

    expect(captured?.issues).toEqual([
      expect.objectContaining({
        code: 'remote-image-kept',
        source: 'https://example.test/figure.png',
      }),
    ]);
    expect(captured?.warnings[0]).toContain('Remote image');
    expect(captured?.bodyHtml).toContain('data-scie-md-export-issue="remote-image-kept"');
    expect(captured?.bodyHtml).toContain('data-scie-md-export-source="https://example.test/figure.png"');
    fetchMock.mockRestore();
  });
});
