import { useCallback } from 'react';
import { DEFAULT_METADATA } from '../documentState';
import {
  checkPandocAvailable,
  defaultPandocExportPath,
  exportHtmlToDocxNative,
  exportHtmlWithPandoc,
  exportStyledHtmlToPdf,
  exportWithPandoc,
} from '../../services/exportService';
import type { PandocExportFormat } from '../../services/exportService';
import { pickExportSavePath, pickHtmlSavePath, writeTextFileAtomic } from '../../services/fileService';
import type { VariableDefinition } from '../../domain/variables/variableIndex';
import type { BibtexEntry } from '../../domain/citations/bibtex';
import { prepareMarkdownForHtmlExport, prepareMarkdownForPandocExport, prepareMarkdownForRichText } from '../../markdown/outputPipeline';
import { findSvgFenceBlocks } from '../../markdown/svgBlocks';
import { exportSvgWithInkscape } from '../../services/inkscapeService';
import { isTauriRuntime } from '../runtime';
import type { ThemeMode } from '../../services/settingsService';
import type { VisualStyleId } from '../../services/visualStyleService';
import type { CapturedEditorHtml } from '../../export/renderCapture';
import type { ExportFormat, ExportLogEntry, ExportRequestOptions, ExportRunResult } from '../../export/exportTypes';
import { DEFAULT_EXPORT_OPTIONS, ensureExportFileExtension } from '../../export/exportTypes';

interface ExportLogger {
  info: (phase: ExportLogEntry['phase'], message: string) => void;
  warn: (phase: ExportLogEntry['phase'], message: string) => void;
  error: (phase: ExportLogEntry['phase'], message: string) => void;
  flush: () => void;
}

interface ExportActionsParams {
  markdown: string;
  filePath: string | null;
  variableDefinitions?: VariableDefinition[];
  citationEntries?: BibtexEntry[];
  themeMode: ThemeMode;
  resolvedTheme: Exclude<ThemeMode, 'system'>;
  visualStyle: VisualStyleId;
  fontScale: number;
  exportOptions?: ExportRequestOptions;
  captureVisualHtml?: () => CapturedEditorHtml | Promise<CapturedEditorHtml | null> | null;
  renderVisualExportHtml?: (preparedMarkdown: string) => Promise<CapturedEditorHtml | null>;
  onExportLog?: (entries: ExportLogEntry[]) => void;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function useExportActions({
  markdown,
  filePath,
  variableDefinitions = [],
  citationEntries = [],
  themeMode,
  resolvedTheme,
  visualStyle,
  fontScale,
  exportOptions = DEFAULT_EXPORT_OPTIONS,
  captureVisualHtml,
  renderVisualExportHtml,
  onExportLog,
  pushToast,
}: ExportActionsParams) {
  const copyRichText = useCallback(async () => {
    const outputMarkdown = prepareMarkdownForRichText(markdown, variableDefinitions);
    try {
      const { renderMarkdownHtmlFragment } = await import('../../markdown/htmlExport');
      const html = await renderMarkdownHtmlFragment(outputMarkdown, filePath, { citationEntries });
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([outputMarkdown], { type: 'text/plain' }),
        }),
      ]);
    } catch {
      try {
        await navigator.clipboard.writeText(outputMarkdown);
      } catch (error) {
        pushToast(error instanceof Error ? error.message : 'Could not copy rich text.', 'error');
        return;
      }
    }
    pushToast('Copied rich text', 'success');
  }, [citationEntries, filePath, markdown, pushToast, variableDefinitions]);

  const exportHtml = useCallback(async (options: ExportRequestOptions = exportOptions): Promise<ExportRunResult> => {
    const log = createExportLogger(onExportLog);
    const effectiveOptions = currentVisualExportOptions(options);
    try {
      const { defaultHtmlExportPath } = await import('../../markdown/htmlExport');
      log.info('prepare', 'Preparing styled HTML export.');
      const html = await createStyledExportHtml({
        markdown,
        filePath,
        variableDefinitions,
        citationEntries,
        themeMode,
        resolvedTheme,
        visualStyle,
        fontScale,
        exportOptions: effectiveOptions,
        captureVisualHtml,
        renderVisualExportHtml,
        pushToast,
        log,
      });
      const selectedPath = await pickHtmlSavePath(defaultHtmlExportPath(filePath));
      if (!selectedPath) {
        log.info('write', 'HTML export cancelled before choosing an output file.');
        log.flush();
        return exportCancelled('html', 'HTML export cancelled.');
      }
      const targetPath = ensureExportFileExtension(selectedPath, 'html');
      log.info('write', `Writing HTML export to ${targetPath}.`);
      await writeTextFileAtomic(targetPath, html, DEFAULT_METADATA);
      warnAboutMissingExportImages(html, pushToast);
      log.flush();
      const message = `Styled HTML export created at ${targetPath}.`;
      pushToast(message, 'success');
      return exportSucceeded('html', message, targetPath);
    } catch (error) {
      const message = errorMessage(error);
      log.error('write', message);
      log.flush();
      pushToast(message || 'HTML export failed.', 'error');
      return exportFailed('html', message || 'HTML export failed.');
    }
  }, [captureVisualHtml, citationEntries, exportOptions, filePath, fontScale, markdown, onExportLog, pushToast, renderVisualExportHtml, resolvedTheme, themeMode, variableDefinitions, visualStyle]);

  const exportPandoc = useCallback(async (format: PandocExportFormat, options: ExportRequestOptions = exportOptions): Promise<ExportRunResult> => {
    const log = createExportLogger(onExportLog);
    const effectiveOptions = currentVisualExportOptions(options);
    if (!isTauriRuntime()) {
      const message = 'PDF/DOCX export is available in the desktop app.';
      pushToast(message, 'warning');
      return exportFailed(format, message);
    }
    try {
      log.info('write', `Choosing ${format.toUpperCase()} export destination.`);
      const selectedPath = await pickExportSavePath(format, defaultPandocExportPath(filePath, format));
      if (!selectedPath) {
        log.info('write', `${format.toUpperCase()} export cancelled before choosing an output file.`);
        log.flush();
        return exportCancelled(format, `${format.toUpperCase()} export cancelled.`);
      }
      const targetPath = ensureExportFileExtension(selectedPath, format);
      if (format === 'pdf') {
        log.info('prepare', 'Preparing styled PDF export.');
        const html = await createStyledExportHtml({
          markdown,
          filePath,
          variableDefinitions,
          citationEntries,
          themeMode,
          resolvedTheme,
          visualStyle,
          fontScale,
          exportOptions: effectiveOptions,
          captureVisualHtml,
          renderVisualExportHtml,
          pushToast,
          log,
        });
        try {
          log.info('convert', 'Exporting PDF with headless browser renderer.');
          const response = await exportStyledHtmlToPdf(html, targetPath);
          warnAboutMissingExportImages(html, pushToast);
          log.flush();
          const outputPath = response.outputPath || targetPath;
          const message = `Exported styled PDF to ${outputPath}.`;
          pushToast(message, 'success');
          return exportSucceeded(format, message, outputPath);
        } catch (rendererError) {
          throw new Error(`Styled PDF export failed: ${errorMessage(rendererError)}`);
        }
      }

      if (format === 'docx' || format === 'epub' || format === 'odt') {
        log.info('prepare', `Preparing styled ${format.toUpperCase()} export.`);
        const html = await createStyledExportHtml({
          markdown,
          filePath,
          variableDefinitions,
          citationEntries,
          themeMode,
          resolvedTheme,
          visualStyle,
          fontScale,
          exportOptions: effectiveOptions,
          captureVisualHtml,
          renderVisualExportHtml,
          pushToast,
          log,
        });
        if (format === 'docx') {
          try {
            await checkPandocAvailable();
            log.info('convert', 'Exporting styled HTML through Pandoc.');
            const preparedHtml = await prepareHtmlForPandocExport(html, filePath, format);
            if (preparedHtml.skipped > 0) {
              pushToast(`${preparedHtml.skipped} vector figure${preparedHtml.skipped === 1 ? '' : 's'} could not be converted for DOCX; export will keep the inline SVG fallback.`, 'warning');
            }
            const response = await exportHtmlWithPandoc(preparedHtml.html, filePath, targetPath, format, effectiveOptions);
            warnAboutMissingExportImages(html, pushToast);
            log.flush();
            const outputPath = response.outputPath || targetPath;
            const message = `Exported DOCX to ${outputPath}.`;
            pushToast(message, 'success');
            return exportSucceeded(format, message, outputPath);
          } catch (pandocError) {
            log.warn('convert', `Pandoc DOCX failed; using built-in fallback: ${errorMessage(pandocError)}`);
            const response = await exportHtmlToDocxNative(html, targetPath);
            warnAboutMissingExportImages(html, pushToast);
            log.flush();
            const outputPath = response.outputPath || targetPath;
            const message = `Exported DOCX to ${outputPath} with the built-in Word fallback. Install or repair Pandoc for richer DOCX conversion.`;
            pushToast(message, 'warning');
            return exportSucceeded(format, message, outputPath);
          }
        }
        await checkPandocAvailable();
        const preparedHtml = await prepareHtmlForPandocExport(html, filePath, format);
        if (preparedHtml.skipped > 0) {
          pushToast(`${preparedHtml.skipped} vector figure${preparedHtml.skipped === 1 ? '' : 's'} could not be converted for ${format.toUpperCase()}; export will keep the inline SVG fallback.`, 'warning');
        }
        const response = await exportHtmlWithPandoc(preparedHtml.html, filePath, targetPath, format, effectiveOptions);
        warnAboutMissingExportImages(html, pushToast);
        log.flush();
        const outputPath = response.outputPath || targetPath;
        const message = `Exported ${format.toUpperCase()} to ${outputPath}.`;
        pushToast(message, 'success');
        return exportSucceeded(format, message, outputPath);
      }

      await checkPandocAvailable();
      log.info('prepare', `Preparing Markdown for ${format.toUpperCase()} export.`);
      const prepared = prepareMarkdownForPandocExport(markdown, variableDefinitions);
      const { markdown: markdownWithSvgAssets, skipped } = await replaceSvgFencesForPandoc(prepared, filePath, format);
      if (skipped > 0) {
        pushToast(`${skipped} SVG figure${skipped === 1 ? '' : 's'} could not be converted because Inkscape was unavailable or failed. Export will keep their source blocks.`, 'warning');
      }
      const response = await exportWithPandoc(markdownWithSvgAssets, filePath, targetPath, format, effectiveOptions);
      log.flush();
      const outputPath = response.outputPath || targetPath;
      const message = `Exported ${format.toUpperCase()} to ${outputPath}.`;
      pushToast(message, 'success');
      return exportSucceeded(format, message, outputPath);
    } catch (error) {
      const message = errorMessage(error);
      log.error('convert', message);
      log.flush();
      pushToast(message || `Pandoc ${format.toUpperCase()} export failed.`, 'error');
      return exportFailed(format, message || `Pandoc ${format.toUpperCase()} export failed.`);
    }
  }, [captureVisualHtml, citationEntries, exportOptions, filePath, fontScale, markdown, onExportLog, pushToast, renderVisualExportHtml, resolvedTheme, themeMode, variableDefinitions, visualStyle]);

  const printPreview = useCallback(async (options: ExportRequestOptions = exportOptions): Promise<void> => {
    const log = createExportLogger(onExportLog);
    const effectiveOptions = currentVisualExportOptions(options);
    try {
      log.info('prepare', 'Preparing print preview from the current visual document.');
      const html = await createStyledExportHtml({
        markdown,
        filePath,
        variableDefinitions,
        citationEntries,
        themeMode,
        resolvedTheme,
        visualStyle,
        fontScale,
        exportOptions: effectiveOptions,
        captureVisualHtml,
        renderVisualExportHtml,
        pushToast,
        log,
      });
      await openPrintPreview(html);
      log.flush();
      pushToast('Print preview opened from the current visual document.', 'info');
    } catch (error) {
      const message = errorMessage(error);
      log.error('render', message);
      log.flush();
      pushToast(message || 'Print preview failed.', 'error');
    }
  }, [captureVisualHtml, citationEntries, exportOptions, filePath, fontScale, markdown, onExportLog, pushToast, renderVisualExportHtml, resolvedTheme, themeMode, variableDefinitions, visualStyle]);

  return { copyRichText, exportHtml, exportPandoc, printPreview };
}

function exportSucceeded(format: ExportFormat, message: string, outputPath: string): ExportRunResult {
  return { ok: true, format, message, outputPath };
}

function exportFailed(format: ExportFormat, message: string): ExportRunResult {
  return { ok: false, format, message };
}

function exportCancelled(format: ExportFormat, message: string): ExportRunResult {
  return { ok: false, format, message, cancelled: true };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown export error.';
}

function warnAboutMissingExportImages(
  html: string,
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void,
): void {
  const missingCount = (html.match(/Missing%20image/g) ?? []).length;
  if (missingCount === 0) return;
  pushToast(
    `${missingCount} image${missingCount === 1 ? '' : 's'} could not be embedded and were exported as missing-image placeholders.`,
    'warning',
  );
}

function openPrintPreview(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.className = 'print-preview-frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.onload = () => {
      try {
        const printWindow = frame.contentWindow;
        if (!printWindow) throw new Error('Print preview frame was not available.');
        printWindow.focus();
        printWindow.print();
        window.setTimeout(() => frame.remove(), 1000);
        resolve();
      } catch (error) {
        frame.remove();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    frame.onerror = () => {
      frame.remove();
      reject(new Error('Could not open print preview.'));
    };
    frame.srcdoc = html;
    document.body.append(frame);
  });
}

function currentVisualExportOptions(options: ExportRequestOptions): ExportRequestOptions {
  return {
    ...DEFAULT_EXPORT_OPTIONS,
    ...options,
    pdf: {
      ...DEFAULT_EXPORT_OPTIONS.pdf,
      ...(options.pdf ?? {}),
    },
  };
}

export async function createStyledExportHtml({
  markdown,
  filePath,
  variableDefinitions,
  citationEntries,
  themeMode,
  resolvedTheme,
  visualStyle,
  fontScale,
  exportOptions,
  captureVisualHtml,
  renderVisualExportHtml,
  pushToast,
  log,
}: {
  markdown: string;
  filePath: string | null;
  variableDefinitions: VariableDefinition[];
  citationEntries: BibtexEntry[];
  themeMode: ThemeMode;
  resolvedTheme: Exclude<ThemeMode, 'system'>;
  visualStyle: VisualStyleId;
  fontScale: number;
  exportOptions: ExportRequestOptions;
  captureVisualHtml?: () => CapturedEditorHtml | Promise<CapturedEditorHtml | null> | null;
  renderVisualExportHtml?: (preparedMarkdown: string) => Promise<CapturedEditorHtml | null>;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  log: ExportLogger;
}): Promise<string> {
  const preparedMarkdown = prepareMarkdownForHtmlExport(markdown, variableDefinitions);
  const liveCapture = captureVisualHtml ? await captureVisualHtml() : null;
  const offscreenCapture = liveCapture ? null : (renderVisualExportHtml ? await renderVisualExportHtml(preparedMarkdown) : null);
  const captured = liveCapture ?? offscreenCapture;
  if (captured) {
    const { createHtmlDocument, exportedDocumentTitle } = await import('../../markdown/htmlExport');
    log.info('render', liveCapture ? 'Captured HTML from the live visual document frame.' : 'Captured HTML from an offscreen visual document frame.');
    for (const warning of captured.warnings) {
      log.warn('render', warning);
      pushToast(warning, 'warning');
    }
    return createHtmlDocument(captured.bodyHtml, exportedDocumentTitle(markdown, filePath), {
      themeMode,
      resolvedTheme,
      visualStyle,
      fontScale,
      embedFonts: true,
      exportOptions,
      bodyIsFullVisualFrame: captured.isFullVisualFrame,
      exportLayout: captured.exportLayout,
      citationEntries,
    });
  }
  const message = 'Visual export capture failed. ScieMD did not write a styled export because that would use a different renderer than the editor.';
  log.error('render', message);
  pushToast(message, 'error');
  throw new Error(message);
}

async function replaceSvgFencesForPandoc(markdown: string, filePath: string | null, format: PandocExportFormat): Promise<{ markdown: string; skipped: number }> {
  if (!filePath) return { markdown, skipped: 0 };
  const blocks = findSvgFenceBlocks(markdown);
  if (blocks.length === 0) return { markdown, skipped: 0 };

  let output = markdown;
  let skipped = 0;
  const exportedBySource = new Map<string, string>();
  const svgFormat = format === 'latex' || format === 'pdf' ? 'pdf' : 'png';
  for (const block of blocks) {
    try {
      const cacheKey = `${svgFormat}\n${block.code}`;
      let outputPath = exportedBySource.get(cacheKey);
      if (!outputPath) {
        const exported = await exportSvgWithInkscape(block.code, filePath, svgFormat);
        outputPath = exported.outputPath;
        exportedBySource.set(cacheKey, outputPath);
      }
      output = output.replace(block.raw, `![SVG figure](${relativeGeneratedAssetPath(filePath, outputPath)})`);
    } catch {
      skipped += 1;
      output = output.replace(block.raw, `<!-- SVG conversion skipped because Inkscape was unavailable or failed. -->\n${block.raw}`);
    }
  }
  return { markdown: output, skipped };
}

async function prepareHtmlForPandocExport(
  html: string,
  filePath: string | null,
  format: PandocExportFormat,
): Promise<{ html: string; skipped: number }> {
  if (!filePath || format === 'epub') return { html, skipped: 0 };
  const svgFormat = format === 'pdf' ? 'pdf' : 'png';
  const figurePattern = /<figure\b[^>]*class="[^"]*(?:svg-figure|mermaid-figure)[^"]*"[^>]*>[\s\S]*?<\/figure>/gi;
  const figures = Array.from(html.matchAll(figurePattern));
  if (figures.length === 0) return { html, skipped: 0 };

  let output = html;
  let skipped = 0;
  const exportedBySource = new Map<string, string>();
  for (const figure of figures) {
    const figureHtml = figure[0];
    const svgMatch = figureHtml.match(/<svg\b[\s\S]*?<\/svg>/i);
    if (!svgMatch) continue;
    const svgSource = svgMatch[0];
    try {
      const cacheKey = `${svgFormat}\n${svgSource}`;
      let outputPath = exportedBySource.get(cacheKey);
      if (!outputPath) {
        const exported = await exportSvgWithInkscape(svgSource, filePath, svgFormat);
        outputPath = exported.outputPath;
        exportedBySource.set(cacheKey, outputPath);
      }
      const imagePath = relativeGeneratedAssetPath(filePath, outputPath);
      output = output.replace(
        figureHtml,
        `<figure class="exported-vector-figure"><img src="${escapeHtmlAttribute(imagePath)}" alt="Exported vector figure"></figure>`,
      );
    } catch {
      skipped += 1;
    }
  }
  return { html: output, skipped };
}

function relativeGeneratedAssetPath(documentPath: string, assetPath: string): string {
  const normalizedDocument = documentPath.replace(/\\/g, '/');
  const normalizedAsset = assetPath.replace(/\\/g, '/');
  const documentDir = normalizedDocument.slice(0, normalizedDocument.lastIndexOf('/') + 1);
  if (documentDir && normalizedAsset.startsWith(documentDir)) {
    return normalizedAsset.slice(documentDir.length);
  }
  return normalizedAsset.split('/').at(-1) ?? normalizedAsset;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function createExportLogger(onExportLog?: (entries: ExportLogEntry[]) => void) {
  const entries: ExportLogEntry[] = [];
  const add = (level: ExportLogEntry['level'], phase: ExportLogEntry['phase'], message: string, durationMs?: number) => {
    entries.push({ timestamp: Date.now(), level, phase, message, durationMs });
    onExportLog?.(entries.slice());
  };
  return {
    info: (phase: ExportLogEntry['phase'], message: string, durationMs?: number) => add('info', phase, message, durationMs),
    warn: (phase: ExportLogEntry['phase'], message: string, durationMs?: number) => add('warn', phase, message, durationMs),
    error: (phase: ExportLogEntry['phase'], message: string, durationMs?: number) => add('error', phase, message, durationMs),
    flush: () => onExportLog?.(entries.slice()),
  };
}
