import { act, createElement } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EXPORT_OPTIONS } from '../../export/exportTypes';
import { createStyledExportHtml, useExportActions } from './useExportActions';
import type { DesktopPlatformHost } from '../host/platformHost';
import { appendDiagnosticsEvent } from '../../services/nativeRecoveryService';

vi.mock('../../services/nativeRecoveryService', () => ({
  appendDiagnosticsEvent: vi.fn(async () => true),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('createStyledExportHtml', () => {
  let container: HTMLDivElement;
  let root: Root;
  let platformHost: DesktopPlatformHost;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    platformHost = createFakePlatformHost();
    vi.mocked(appendDiagnosticsEvent).mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('fails loudly instead of using a second renderer when visual capture is unavailable', async () => {
    const pushToast = vi.fn();
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      flush: vi.fn(),
    };

    await expect(createStyledExportHtml({
      markdown: '# Fallback export\n\nBody text.',
      filePath: null,
      variableDefinitions: [],
      citationEntries: [],
      themeMode: 'dark',
      resolvedTheme: 'dark',
      visualStyle: 'scienfy',
      fontScale: 1,
      exportOptions: DEFAULT_EXPORT_OPTIONS,
      captureVisualHtml: () => null,
      renderVisualExportHtml: async () => null,
      pushToast,
      log,
    })).rejects.toThrow('Visual export capture failed');

    expect(log.error).toHaveBeenCalledWith('render', expect.stringContaining('different renderer'));
    expect(log.warn).not.toHaveBeenCalledWith('render', expect.stringContaining('Markdown fallback'));
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('different renderer'), 'error');
  });

  it('blocks HTML export before choosing a path or rendering when preflight has blockers', async () => {
    const pushToast = vi.fn();
    const onExportLog = vi.fn();
    const captureVisualHtml = vi.fn();
    let actions: ReturnType<typeof useExportActions> | undefined;

    function Harness() {
      actions = useExportActions({
        markdown: 'Result is {{ missing_value }}.',
        filePath: null,
        variableDefinitions: [],
        citationEntries: [],
        themeMode: 'light',
        resolvedTheme: 'light',
        visualStyle: 'scienfy',
        fontScale: 1,
        exportOptions: DEFAULT_EXPORT_OPTIONS,
        captureVisualHtml,
        onExportLog,
        pushToast,
        platformHost,
      });
      return null;
    }

    act(() => {
      root.render(createElement(Harness));
    });

    expect(actions).toBeDefined();
    const result = await actions!.exportHtml();

    expect(result).toMatchObject({ ok: false, format: 'html' });
    expect(result?.message).toContain('Export blocked');
    expect(platformHost.export.pickHtmlSavePath).not.toHaveBeenCalled();
    expect(captureVisualHtml).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('Export blocked'), 'error');
    expect(appendDiagnosticsEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'html-export-preflight-blocked',
      documentPath: null,
      markdownBytes: expect.any(Number),
    }));
    expect(onExportLog).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ level: 'error', phase: 'validate' }),
    ]));
  });

  it('logs visual source mode and structured remote asset warnings for HTML export', async () => {
    const pushToast = vi.fn();
    const onExportLog = vi.fn();
    vi.mocked(platformHost.export.pickHtmlSavePath).mockResolvedValue('C:\\docs\\paper.html');
    vi.mocked(platformHost.export.writeTextFileAtomic).mockResolvedValue({
      lastKnownMtimeMs: 1,
      lastKnownSizeBytes: 10,
      lineEnding: 'lf',
      encoding: 'utf8',
      hasBom: false,
      hasMixedLineEndings: false,
      contentHash: null,
      cloudState: 'local',
    });
    let actions: ReturnType<typeof useExportActions> | undefined;

    function Harness() {
      actions = useExportActions({
        markdown: '# Paper\n\nBody.',
        filePath: 'C:\\docs\\paper.md',
        variableDefinitions: [],
        citationEntries: [],
        themeMode: 'light',
        resolvedTheme: 'light',
        visualStyle: 'scienfy',
        fontScale: 1,
        exportOptions: DEFAULT_EXPORT_OPTIONS,
        captureVisualHtml: () => ({
          bodyHtml: '<section class="visual-editor"><article class="ProseMirror"><img src="https://example.test/figure.png" data-scie-md-export-issue="remote-image-kept" data-scie-md-export-source="https://example.test/figure.png"></article></section>',
          warnings: ['Remote image "https://example.test/figure.png" could not be embedded; the export keeps its URL and may need network access.'],
          issues: [{
            severity: 'warning',
            code: 'remote-image-kept',
            message: 'Remote image "https://example.test/figure.png" could not be embedded; the export keeps its URL and may need network access.',
            source: 'https://example.test/figure.png',
          }],
          isFullVisualFrame: true,
        }),
        onExportLog,
        pushToast,
        platformHost,
      });
      return null;
    }

    act(() => {
      root.render(createElement(Harness));
    });

    expect(actions).toBeDefined();
    const result = await actions!.exportHtml();

    expect(result).toMatchObject({ ok: true, format: 'html', outputPath: 'C:\\docs\\paper.html' });
    expect(platformHost.export.writeTextFileAtomic).toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('remote image'), 'warning');
    expect(onExportLog).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ level: 'info', phase: 'render', message: expect.stringContaining('Export source: live visual HTML capture') }),
      expect.objectContaining({ level: 'warn', phase: 'write', message: expect.stringContaining('remote image') }),
    ]));
  });

  it('uses the current output markdown for HTML preflight and offscreen visual rendering', async () => {
    const pushToast = vi.fn();
    const onExportLog = vi.fn();
    const renderVisualExportHtml = vi.fn(async (preparedMarkdown: string) => ({
      bodyHtml: `<section class="visual-editor"><article class="ProseMirror"><pre>${preparedMarkdown}</pre></article></section>`,
      warnings: [],
      issues: [],
      isFullVisualFrame: true,
    }));
    vi.mocked(platformHost.export.pickHtmlSavePath).mockResolvedValue('C:\\docs\\fresh.html');
    vi.mocked(platformHost.export.writeTextFileAtomic).mockResolvedValue({
      lastKnownMtimeMs: 1,
      lastKnownSizeBytes: 10,
      lineEnding: 'lf',
      encoding: 'utf8',
      hasBom: false,
      hasMixedLineEndings: false,
      contentHash: null,
      cloudState: 'local',
    });
    let actions: ReturnType<typeof useExportActions> | undefined;

    function Harness() {
      actions = useExportActions({
        markdown: 'Stale {{ missing_value }}.',
        filePath: 'C:\\docs\\paper.md',
        variableDefinitions: [],
        citationEntries: [],
        themeMode: 'light',
        resolvedTheme: 'light',
        visualStyle: 'scienfy',
        fontScale: 1,
        exportOptions: DEFAULT_EXPORT_OPTIONS,
        getCurrentOutputMarkdown: () => '# Fresh\n\nReady.',
        captureVisualHtml: () => null,
        renderVisualExportHtml,
        onExportLog,
        pushToast,
        platformHost,
      });
      return null;
    }

    act(() => {
      root.render(createElement(Harness));
    });

    expect(actions).toBeDefined();
    const result = await actions!.exportHtml();

    expect(result).toMatchObject({ ok: true, format: 'html', outputPath: 'C:\\docs\\fresh.html' });
    expect(renderVisualExportHtml).toHaveBeenCalledWith(expect.stringContaining('# Fresh'));
    expect(pushToast).not.toHaveBeenCalledWith(expect.stringContaining('Export blocked'), 'error');
  });

  it('labels DOCX native fallback as a basic fallback after Pandoc fails', async () => {
    const pushToast = vi.fn();
    const onExportLog = vi.fn();
    vi.mocked(platformHost.runtime.isDesktopRuntime).mockReturnValue(true);
    vi.mocked(platformHost.export.pickExportSavePath).mockResolvedValue('C:\\docs\\paper.docx');
    vi.mocked(platformHost.export.checkPandocAvailable).mockRejectedValue(new Error('Pandoc missing'));
    vi.mocked(platformHost.export.exportHtmlToDocxNative).mockResolvedValue({
      outputPath: 'C:\\docs\\paper.docx',
      stderr: 'fallback',
    });
    let actions: ReturnType<typeof useExportActions> | undefined;

    function Harness() {
      actions = useExportActions({
        markdown: '# Paper\n\nBody.',
        filePath: 'C:\\docs\\paper.md',
        variableDefinitions: [],
        citationEntries: [],
        themeMode: 'light',
        resolvedTheme: 'light',
        visualStyle: 'scienfy',
        fontScale: 1,
        exportOptions: DEFAULT_EXPORT_OPTIONS,
        captureVisualHtml: () => ({
          bodyHtml: '<section class="visual-editor"><article class="ProseMirror"><h1>Paper</h1><p>Body.</p></article></section>',
          warnings: [],
          issues: [],
          isFullVisualFrame: true,
        }),
        onExportLog,
        pushToast,
        platformHost,
      });
      return null;
    }

    act(() => {
      root.render(createElement(Harness));
    });

    expect(actions).toBeDefined();
    const result = await actions!.exportPandoc('docx');

    expect(result).toMatchObject({ ok: true, format: 'docx', outputPath: 'C:\\docs\\paper.docx' });
    expect(platformHost.export.exportHtmlToDocxNative).toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('built-in Word fallback'), 'warning');
    expect(onExportLog).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ level: 'warn', phase: 'convert', message: expect.stringContaining('basic WordprocessingML fallback') }),
      expect.objectContaining({ level: 'warn', phase: 'convert', message: expect.stringContaining('fallback quality') }),
    ]));
  });

  it('uses the current output markdown for semantic Pandoc export', async () => {
    const pushToast = vi.fn();
    const onExportLog = vi.fn();
    vi.mocked(platformHost.runtime.isDesktopRuntime).mockReturnValue(true);
    vi.mocked(platformHost.export.pickExportSavePath).mockResolvedValue('C:\\docs\\paper.tex');
    vi.mocked(platformHost.export.checkPandocAvailable).mockResolvedValue('pandoc 3');
    vi.mocked(platformHost.export.exportWithPandoc).mockResolvedValue({
      outputPath: 'C:\\docs\\paper.tex',
      stderr: '',
    });
    let actions: ReturnType<typeof useExportActions> | undefined;

    function Harness() {
      actions = useExportActions({
        markdown: 'Stale {{ missing_value }}.',
        filePath: 'C:\\docs\\paper.md',
        variableDefinitions: [],
        citationEntries: [],
        themeMode: 'light',
        resolvedTheme: 'light',
        visualStyle: 'scienfy',
        fontScale: 1,
        exportOptions: DEFAULT_EXPORT_OPTIONS,
        getCurrentOutputMarkdown: () => '# Fresh semantic export\n\nReady.',
        onExportLog,
        pushToast,
        platformHost,
      });
      return null;
    }

    act(() => {
      root.render(createElement(Harness));
    });

    expect(actions).toBeDefined();
    const result = await actions!.exportPandoc('latex');

    expect(result).toMatchObject({ ok: true, format: 'latex', outputPath: 'C:\\docs\\paper.tex' });
    expect(platformHost.export.exportWithPandoc).toHaveBeenCalledWith(
      expect.stringContaining('# Fresh semantic export'),
      'C:\\docs\\paper.md',
      'C:\\docs\\paper.tex',
      'latex',
      expect.any(Object),
    );
    expect(pushToast).not.toHaveBeenCalledWith(expect.stringContaining('Export blocked'), 'error');
  });
});

function createFakePlatformHost(): DesktopPlatformHost {
  return {
    runtime: {
      isDesktopRuntime: vi.fn(() => false),
    },
    assets: {
      pickImageFile: vi.fn(),
      grantExternalImagePath: vi.fn(),
      copyImageToAssets: vi.fn(),
      saveImageBytesToAssets: vi.fn(),
      defaultImageAlt: vi.fn((path: string) => path),
      markdownImageSyntax: vi.fn((alt: string, path: string) => `![${alt}](${path})`),
      isImagePath: vi.fn((path: string) => /\.(png|jpe?g|gif|webp|svg)$/i.test(path)),
      imageFileNameFromBlob: vi.fn((_blob: Blob, preferredName?: string) => preferredName ?? 'image.png'),
      blobToByteArray: vi.fn(async () => []),
    },
    export: {
      pickHtmlSavePath: vi.fn(),
      pickExportSavePath: vi.fn(),
      writeTextFileAtomic: vi.fn(),
      defaultPandocExportPath: vi.fn(() => 'export.pdf'),
      checkPandocAvailable: vi.fn(async () => 'pandoc 3'),
      exportStyledHtmlToPdf: vi.fn(),
      exportHtmlToDocxNative: vi.fn(),
      exportHtmlWithPandoc: vi.fn(),
      exportWithPandoc: vi.fn(),
    },
    inkscape: {
      checkAvailable: vi.fn(),
      exportSvg: vi.fn(),
    },
    fileBrowser: {
      pickFolder: vi.fn(),
      listReadableFiles: vi.fn(),
    },
    watcher: {
      listenFileWatchChanges: vi.fn(async () => vi.fn()),
      updateWatchedFiles: vi.fn(async () => true),
      clearWatchedFiles: vi.fn(async () => true),
    },
    dragDrop: {
      listenDroppedPaths: vi.fn(async () => vi.fn()),
    },
    reveal: {
      revealInFileManager: vi.fn(),
    },
    maintenance: {
      cleanupStaleTempFilesForPaths: vi.fn(),
    },
  };
}
