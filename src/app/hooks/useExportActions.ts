import { useCallback } from 'react';
import { DEFAULT_METADATA } from '../documentState';
import type { VariableDefinition } from '@sciemd/core';
import type { BibtexEntry } from '@sciemd/core';
import { prepareMarkdownForHtmlExport, prepareMarkdownForPandocExport, prepareMarkdownForRichText } from '../../markdown/outputPipeline';
import { findSvgFenceBlocks } from '../../markdown/svgBlocks';
import type { ThemeMode } from '../../services/settingsService';
import type { VisualStyleId } from '../../services/visualStyleService';
import type { CapturedEditorHtml } from '../../export/renderCapture';
import type { ExportFormat, ExportLogEntry, ExportRequestOptions, ExportRunResult, PandocExportFormat } from '../../export/exportTypes';
import { DEFAULT_EXPORT_OPTIONS, ensureExportFileExtension } from '../../export/exportTypes';
import { preflightSummary, runExportPreflight } from '../../export/exportPreflight';
import type { ExportPreflightResult } from '../../export/exportPreflight';
import { extractExportArtifactIssues, summarizeExportArtifactIssues } from '../../export/exportArtifactIssues';
import { desktopPlatformHost } from '../host/desktopPlatformHost';
import type { DesktopPlatformHost } from '../host/platformHost';
import { appendDiagnosticsEvent } from '../../services/nativeRecoveryService';

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
  getCurrentOutputMarkdown?: () => string;
  captureVisualHtml?: () => CapturedEditorHtml | Promise<CapturedEditorHtml | null> | null;
  renderVisualExportHtml?: (preparedMarkdown: string) => Promise<CapturedEditorHtml | null>;
  onExportLog?: (entries: ExportLogEntry[]) => void;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  platformHost?: DesktopPlatformHost;
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
  getCurrentOutputMarkdown,
  captureVisualHtml,
  renderVisualExportHtml,
  onExportLog,
  pushToast,
  platformHost = desktopPlatformHost,
}: ExportActionsParams) {
  const resolveOutputMarkdown = useCallback(() => getCurrentOutputMarkdown?.() ?? markdown, [getCurrentOutputMarkdown, markdown]);

  const copyRichText = useCallback(async () => {
    const outputMarkdown = prepareMarkdownForRichText(resolveOutputMarkdown(), variableDefinitions);
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
  }, [citationEntries, filePath, pushToast, resolveOutputMarkdown, variableDefinitions]);

  const exportHtml = useCallback(async (options: ExportRequestOptions = exportOptions): Promise<ExportRunResult> => {
    const log = createExportLogger(onExportLog);
    const effectiveOptions = currentVisualExportOptions(options);
    const outputMarkdown = resolveOutputMarkdown();
    try {
      const { defaultHtmlExportPath } = await import('../../markdown/htmlExport');
      const preflight = runExportPreflight({ markdown: outputMarkdown, format: 'html', variableDefinitions, citationEntries, exportOptions: effectiveOptions });
      logExportPreflight(preflight, log);
      if (!preflight.ok) {
        log.flush();
        const message = preflightSummary(preflight);
        recordExportDiagnostic('html-export-preflight-blocked', message, 'html', filePath, outputMarkdown);
        pushToast(message, 'error');
        return exportFailed('html', message);
      }
      log.info('prepare', 'Preparing styled HTML export.');
      const html = await createStyledExportHtml({
        markdown: outputMarkdown,
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
      const selectedPath = await platformHost.export.pickHtmlSavePath(defaultHtmlExportPath(filePath));
      if (!selectedPath) {
        log.info('write', 'HTML export cancelled before choosing an output file.');
        log.flush();
        return exportCancelled('html', 'HTML export cancelled.');
      }
      const targetPath = ensureExportFileExtension(selectedPath, 'html');
      log.info('write', `Writing HTML export to ${targetPath}.`);
      await platformHost.export.writeTextFileAtomic(targetPath, html, DEFAULT_METADATA);
      warnAboutExportArtifactIssues(html, pushToast, log);
      log.flush();
      const message = `Styled HTML export created at ${targetPath}.`;
      pushToast(message, 'success');
      return exportSucceeded('html', message, targetPath);
    } catch (error) {
      const message = errorMessage(error);
      log.error('write', message);
      log.flush();
      recordExportDiagnostic('html-export-failed', message || 'HTML export failed.', 'html', filePath, outputMarkdown);
      pushToast(message || 'HTML export failed.', 'error');
      return exportFailed('html', message || 'HTML export failed.');
    }
  }, [captureVisualHtml, citationEntries, exportOptions, filePath, fontScale, onExportLog, platformHost, pushToast, renderVisualExportHtml, resolveOutputMarkdown, resolvedTheme, themeMode, variableDefinitions, visualStyle]);

  const exportPandoc = useCallback(async (format: PandocExportFormat, options: ExportRequestOptions = exportOptions): Promise<ExportRunResult> => {
    const log = createExportLogger(onExportLog);
    const effectiveOptions = currentVisualExportOptions(options);
    const outputMarkdown = resolveOutputMarkdown();
    if (!platformHost.runtime.isDesktopRuntime()) {
      const message = 'PDF/DOCX export is available in the desktop app.';
      recordExportDiagnostic('pandoc-export-unavailable', message, format, filePath, outputMarkdown);
      pushToast(message, 'warning');
      return exportFailed(format, message);
    }
    try {
      const preflight = runExportPreflight({ markdown: outputMarkdown, format, variableDefinitions, citationEntries, exportOptions: effectiveOptions });
      logExportPreflight(preflight, log);
      if (!preflight.ok) {
        log.flush();
        const message = preflightSummary(preflight);
        recordExportDiagnostic('pandoc-export-preflight-blocked', message, format, filePath, outputMarkdown);
        pushToast(message, 'error');
        return exportFailed(format, message);
      }
      log.info('write', `Choosing ${format.toUpperCase()} export destination.`);
      const selectedPath = await platformHost.export.pickExportSavePath(format, platformHost.export.defaultPandocExportPath(filePath, format));
      if (!selectedPath) {
        log.info('write', `${format.toUpperCase()} export cancelled before choosing an output file.`);
        log.flush();
        return exportCancelled(format, `${format.toUpperCase()} export cancelled.`);
      }
      const targetPath = ensureExportFileExtension(selectedPath, format);
      if (format === 'pdf') {
        log.info('prepare', 'Preparing styled PDF export.');
        const html = await createStyledExportHtml({
          markdown: outputMarkdown,
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
          const response = await platformHost.export.exportStyledHtmlToPdf(html, targetPath);
          warnAboutExportArtifactIssues(html, pushToast, log);
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
          markdown: outputMarkdown,
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
            await platformHost.export.checkPandocAvailable();
            log.info('convert', 'Exporting styled visual HTML through Pandoc.');
            const preparedHtml = await prepareHtmlForPandocExport(html, filePath, format, platformHost);
            if (preparedHtml.skipped > 0) {
              pushToast(`${preparedHtml.skipped} vector figure${preparedHtml.skipped === 1 ? '' : 's'} could not be converted for DOCX; export will keep the inline SVG fallback.`, 'warning');
            }
            const response = await platformHost.export.exportHtmlWithPandoc(preparedHtml.html, filePath, targetPath, format, effectiveOptions);
            warnAboutExportArtifactIssues(html, pushToast, log);
            log.flush();
            const outputPath = response.outputPath || targetPath;
            const message = `Exported DOCX to ${outputPath}.`;
            pushToast(message, 'success');
            return exportSucceeded(format, message, outputPath);
          } catch (pandocError) {
            log.warn('convert', `Pandoc DOCX failed; using built-in basic WordprocessingML fallback: ${errorMessage(pandocError)}`);
            log.warn('convert', 'DOCX fallback quality: basic text and simple styling are preserved; install or repair Pandoc for richer DOCX conversion.');
            const response = await platformHost.export.exportHtmlToDocxNative(html, targetPath);
            warnAboutExportArtifactIssues(html, pushToast, log);
            log.flush();
            const outputPath = response.outputPath || targetPath;
            const message = `Exported DOCX to ${outputPath} with the built-in Word fallback. Install or repair Pandoc for richer DOCX conversion.`;
            pushToast(message, 'warning');
            return exportSucceeded(format, message, outputPath);
          }
        }
        await platformHost.export.checkPandocAvailable();
        const preparedHtml = await prepareHtmlForPandocExport(html, filePath, format, platformHost);
        if (preparedHtml.skipped > 0) {
          pushToast(`${preparedHtml.skipped} vector figure${preparedHtml.skipped === 1 ? '' : 's'} could not be converted for ${format.toUpperCase()}; export will keep the inline SVG fallback.`, 'warning');
        }
        const response = await platformHost.export.exportHtmlWithPandoc(preparedHtml.html, filePath, targetPath, format, effectiveOptions);
        warnAboutExportArtifactIssues(html, pushToast, log);
        log.flush();
        const outputPath = response.outputPath || targetPath;
        const message = `Exported ${format.toUpperCase()} to ${outputPath}.`;
        pushToast(message, 'success');
        return exportSucceeded(format, message, outputPath);
      }

      await platformHost.export.checkPandocAvailable();
      log.info('prepare', `Preparing Markdown for ${format.toUpperCase()} export.`);
      log.info('render', 'Export source: semantic Markdown prepared from the document text.');
      const prepared = prepareMarkdownForPandocExport(outputMarkdown, variableDefinitions);
      const { markdown: markdownWithSvgAssets, skipped } = await replaceSvgFencesForPandoc(prepared, filePath, format, platformHost);
      if (skipped > 0) {
        pushToast(`${skipped} SVG figure${skipped === 1 ? '' : 's'} could not be converted because Inkscape was unavailable or failed. Export will keep their source blocks.`, 'warning');
      }
      const response = await platformHost.export.exportWithPandoc(markdownWithSvgAssets, filePath, targetPath, format, effectiveOptions);
      log.flush();
      const outputPath = response.outputPath || targetPath;
      const message = `Exported ${format.toUpperCase()} to ${outputPath}.`;
      pushToast(message, 'success');
      return exportSucceeded(format, message, outputPath);
    } catch (error) {
      const message = errorMessage(error);
      log.error('convert', message);
      log.flush();
      recordExportDiagnostic('pandoc-export-failed', message || `Pandoc ${format.toUpperCase()} export failed.`, format, filePath, outputMarkdown);
      pushToast(message || `Pandoc ${format.toUpperCase()} export failed.`, 'error');
      return exportFailed(format, message || `Pandoc ${format.toUpperCase()} export failed.`);
    }
  }, [captureVisualHtml, citationEntries, exportOptions, filePath, fontScale, onExportLog, platformHost, pushToast, renderVisualExportHtml, resolveOutputMarkdown, resolvedTheme, themeMode, variableDefinitions, visualStyle]);

  const printPreview = useCallback(async (options: ExportRequestOptions = exportOptions): Promise<void> => {
    const log = createExportLogger(onExportLog);
    const effectiveOptions = currentVisualExportOptions(options);
    const outputMarkdown = resolveOutputMarkdown();
    try {
      const preflight = runExportPreflight({ markdown: outputMarkdown, format: 'html', variableDefinitions, citationEntries, exportOptions: effectiveOptions });
      logExportPreflight(preflight, log);
      if (!preflight.ok) {
        log.flush();
        pushToast(preflightSummary(preflight), 'error');
        return;
      }
      log.info('prepare', 'Preparing print preview from the current visual document.');
      const html = await createStyledExportHtml({
        markdown: outputMarkdown,
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
      warnAboutExportArtifactIssues(html, pushToast, log);
      log.flush();
      pushToast('Print preview opened from the current visual document.', 'info');
    } catch (error) {
      const message = errorMessage(error);
      log.error('render', message);
      log.flush();
      recordExportDiagnostic('print-preview-failed', message || 'Print preview failed.', 'html', filePath, outputMarkdown);
      pushToast(message || 'Print preview failed.', 'error');
    }
  }, [captureVisualHtml, citationEntries, exportOptions, filePath, fontScale, onExportLog, pushToast, renderVisualExportHtml, resolveOutputMarkdown, resolvedTheme, themeMode, variableDefinitions, visualStyle]);

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

function recordExportDiagnostic(
  eventType: string,
  message: string,
  format: ExportFormat,
  documentPath: string | null,
  markdown: string,
): void {
  void appendDiagnosticsEvent({
    eventType,
    message: `${format.toUpperCase()}: ${message}`,
    documentPath,
    sourceTextBytes: byteLength(markdown),
  });
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  return unescape(encodeURIComponent(value)).length;
}

function warnAboutExportArtifactIssues(
  html: string,
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void,
  log: ExportLogger,
): void {
  for (const message of summarizeExportArtifactIssues(extractExportArtifactIssues(html))) {
    log.warn('write', message);
    pushToast(message, 'warning');
  }
}

function logExportPreflight(preflight: ExportPreflightResult, log: ExportLogger): void {
  log.info('validate', preflightSummary(preflight));
  for (const issue of preflight.blockers) {
    log.error('validate', formatPreflightIssue(issue));
  }
  for (const issue of preflight.warnings) {
    log.warn('validate', formatPreflightIssue(issue));
  }
}

function formatPreflightIssue(issue: ExportPreflightResult['issues'][number]): string {
  return issue.line ? `${issue.message} (line ${issue.line})` : issue.message;
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
    log.info(
      'render',
      liveCapture
        ? 'Export source: live visual HTML capture from the current editor frame.'
        : 'Export source: offscreen visual HTML capture rendered from the current Markdown.',
    );
    for (const warning of captured.warnings) {
      log.warn('render', warning);
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

async function replaceSvgFencesForPandoc(
  markdown: string,
  filePath: string | null,
  format: PandocExportFormat,
  platformHost: DesktopPlatformHost,
): Promise<{ markdown: string; skipped: number }> {
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
        const exported = await platformHost.inkscape.exportSvg(block.code, filePath, svgFormat);
        outputPath = exported.outputPath;
        exportedBySource.set(cacheKey, outputPath);
      }
      output = output.replace(block.raw, () => `![SVG figure](${relativeGeneratedAssetPath(filePath, outputPath)})`);
    } catch {
      skipped += 1;
      output = output.replace(block.raw, () => `<!-- SVG conversion skipped because Inkscape was unavailable or failed. -->\n${block.raw}`);
    }
  }
  return { markdown: output, skipped };
}

async function prepareHtmlForPandocExport(
  html: string,
  filePath: string | null,
  format: PandocExportFormat,
  platformHost: DesktopPlatformHost,
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
        const exported = await platformHost.inkscape.exportSvg(svgSource, filePath, svgFormat);
        outputPath = exported.outputPath;
        exportedBySource.set(cacheKey, outputPath);
      }
      const imagePath = relativeGeneratedAssetPath(filePath, outputPath);
      output = output.replace(
        figureHtml,
        () => `<figure class="exported-vector-figure"><img src="${escapeHtmlAttribute(imagePath)}" alt="Exported vector figure"></figure>`,
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
