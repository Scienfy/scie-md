import { useCallback, useState } from 'react';
import type { ExportFormat, ExportLogEntry, ExportRequestOptions, ExportRunResult, PandocExportFormat } from '../../export/exportTypes';

interface UseExportWorkflowParams {
  exportHtml: (options?: ExportRequestOptions) => Promise<ExportRunResult>;
  exportPandoc: (format: PandocExportFormat, options?: ExportRequestOptions) => Promise<ExportRunResult>;
}

interface ExportWorkflowStatus {
  tone: 'info' | 'success' | 'error';
  format: ExportFormat;
  message: string;
  outputPath?: string;
}

export function useExportWorkflow({
  exportHtml,
  exportPandoc,
}: UseExportWorkflowParams) {
  const [dialogFormat, setDialogFormat] = useState<ExportFormat | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [logEntries, setLogEntries] = useState<ExportLogEntry[]>([]);
  const [activeExport, setActiveExport] = useState<ExportWorkflowStatus | null>(null);
  const [lastExportStatus, setLastExportStatus] = useState<ExportWorkflowStatus | null>(null);

  const handleLog = useCallback((entries: ExportLogEntry[]) => {
    setLogEntries(entries);
    const latest = entries.at(-1);
    if (latest) {
      setActiveExport((current) => current ? { ...current, message: latest.message } : current);
    }
    if (entries.some((entry) => entry.level === 'error')) setLogOpen(true);
  }, []);

  const openDialog = useCallback((format: ExportFormat) => {
    setDialogFormat(format);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogFormat(null);
  }, []);

  const runConfiguredExport = useCallback(async (format: ExportFormat, options: ExportRequestOptions) => {
    setDialogFormat(null);
    setLogEntries([]);
    setLastExportStatus(null);
    setActiveExport({
      tone: 'info',
      format,
      message: `Exporting ${formatLabel(format)}. Choose a destination and keep ScieMD open until it finishes.`,
    });
    try {
      const result = format === 'html'
        ? await exportHtml(options)
        : await exportPandoc(format as PandocExportFormat, options);
      setActiveExport(null);
      if (result.cancelled) return;
      if (result.ok) {
        setLastExportStatus({
          tone: 'success',
          format,
          message: result.message,
          outputPath: result.outputPath,
        });
        return;
      }
      setLastExportStatus({
        tone: 'error',
        format,
        message: result.message,
        outputPath: result.outputPath,
      });
      setLogOpen(true);
    } catch (error) {
      const message = errorMessage(error);
      const entry: ExportLogEntry = {
        timestamp: Date.now(),
        phase: 'convert',
        level: 'error',
        message,
      };
      setActiveExport(null);
      setLastExportStatus({ tone: 'error', format, message });
      setLogEntries((current) => current.length > 0 ? current : [entry]);
      setLogOpen(true);
    }
  }, [exportHtml, exportPandoc]);

  return {
    dialogFormat,
    logOpen,
    logEntries,
    activeExport,
    lastExportStatus,
    handleLog,
    openDialog,
    closeDialog,
    runConfiguredExport,
    openLog: () => setLogOpen(true),
    closeLog: () => setLogOpen(false),
    clearLastStatus: () => setLastExportStatus(null),
  };
}

function formatLabel(format: ExportFormat): string {
  return format === 'html' ? 'HTML' : format.toUpperCase();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown export error.';
}
