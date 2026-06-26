import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import type { Editor as MilkdownEditor } from '@milkdown/kit/core';
import type { BibtexEntry } from '../domain/citations/bibtex';
import type { VariableDefinition } from '../domain/variables/variableIndex';
import { captureEditorHtmlForExport } from '../export/renderCapture';
import type { CapturedEditorHtml } from '../export/renderCapture';
import { VisualMarkdownEditor } from './VisualMarkdownEditor';

export interface ExportRenderHostHandle {
  render: (request: ExportRenderRequest) => Promise<CapturedEditorHtml | null>;
}

export interface ExportRenderRequest {
  markdown: string;
  filePath: string | null;
  variableDefinitions: VariableDefinition[];
  citationEntries: BibtexEntry[];
}

interface PendingJob extends ExportRenderRequest {
  id: number;
}

interface PendingPromise {
  resolve: (value: CapturedEditorHtml | null) => void;
  timeout: number;
}

export const ExportRenderHost = forwardRef<ExportRenderHostHandle>(function ExportRenderHost(_, ref) {
  const [job, setJob] = useState<PendingJob | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pendingRef = useRef<PendingPromise | null>(null);
  const jobCounterRef = useRef(0);

  const finish = useCallback((value: CapturedEditorHtml | null) => {
    const pending = pendingRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    pendingRef.current = null;
    pending.resolve(value);
    setJob(null);
  }, []);

  const scheduleCapture = useCallback(() => {
    window.setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          void captureEditorHtmlForExport(rootRef.current).then(finish).catch(() => finish(null));
        });
      });
    }, 220);
  }, [finish]);

  useImperativeHandle(ref, () => ({
    render(request) {
      pendingRef.current?.resolve(null);
      if (pendingRef.current) window.clearTimeout(pendingRef.current.timeout);
      const id = jobCounterRef.current + 1;
      jobCounterRef.current = id;
      setJob({ ...request, id });
      return new Promise<CapturedEditorHtml | null>((resolve) => {
        pendingRef.current = {
          resolve,
          timeout: window.setTimeout(() => finish(null), 5000),
        };
      });
    },
  }), [finish]);

  return (
    <div className="export-render-host" aria-hidden="true" ref={rootRef}>
      {job && (
        <main className="editor-stage export-render-stage">
          <VisualMarkdownEditor
            key={job.id}
            markdown={job.markdown}
            filePath={job.filePath}
            onChange={() => undefined}
            onEditorReady={(editor: MilkdownEditor | undefined) => {
              if (editor) scheduleCapture();
            }}
            registerStateReader={false}
            citationKeys={job.citationEntries.map((entry) => entry.key)}
            citationEntries={job.citationEntries}
            variableDefinitions={job.variableDefinitions}
          />
        </main>
      )}
    </div>
  );
});
