import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseScienfyDocumentAsync } from '../domain/document/documentParserWorker';
import { renderMarkdownHtmlFragment, createHtmlDocument } from '../markdown/htmlExport';
import { captureEditorHtmlForExport } from '../export/renderCapture';
import { readBinaryFileBase64 } from '../services/fileService';
import { writeNativeRecoverySnapshot } from '../services/nativeRecoveryService';
import {
  RAW_RESCUE_SESSION_STORAGE_MAX_BYTES,
  flushRawDocumentRescueSnapshotForTests,
  nativeRescueMarkdown,
  rawDocumentRescuePolicy,
  updateRawDocumentRescue,
} from '../services/rawDocumentRescue';
import { createBackgroundJobSnapshot, summarizeBackgroundJobs } from '../app/backgroundJobs';
import { summarizeMarkdownForDiagnostics } from '../app/hooks/useRendererDiagnostics';
import {
  LARGE_DOCUMENT_STRESS_BIBTEX,
  LARGE_DOCUMENT_STRESS_CITATION_ENTRY,
  createLargeDocumentStressFixture,
  createRecoveryStressMarkdown,
  createVisualExportStressRoot,
} from './largeDocumentStressFixtures';

vi.mock('../services/fileService', () => ({
  readBinaryFileBase64: vi.fn(async () => 'ZmFrZS1zdHJlc3MtaW1hZ2U='),
}));

vi.mock('../services/nativeRecoveryService', () => ({
  readNativeRecoverySnapshot: vi.fn(async () => null),
  writeNativeRecoverySnapshot: vi.fn(async () => true),
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockImplementation(async (id: string) => ({
      svg: `<svg id="${id}" viewBox="0 0 120 40"><text x="4" y="24">stress-flow</text></svg>`,
    })),
  },
}));

const RESCUE_SNAPSHOT_KEY = 'scie-md:raw-document-rescue';
const STRESS_TIMEOUT_MS = numberFromEnv('SCIEMD_LARGE_DOCUMENT_STRESS_TIMEOUT_MS', 60_000);
const PARSER_SECTION_COUNT = numberFromEnv('SCIEMD_LARGE_DOCUMENT_STRESS_SECTIONS', 900);
const EXPORT_SECTION_COUNT = numberFromEnv('SCIEMD_LARGE_DOCUMENT_STRESS_EXPORT_SECTIONS', 180);
const VISUAL_IMAGE_COUNT = numberFromEnv('SCIEMD_LARGE_DOCUMENT_STRESS_VISUAL_IMAGES', 48);

interface StressReport {
  ok: boolean;
  sectionCount: number;
  exportSectionCount: number;
  visualImageCount: number;
  fixtureBytes: number;
  steps: StressReportStep[];
}

interface StressReportStep {
  name: string;
  durationMs: number;
  heapUsedBytes: number | null;
  details: Record<string, number | string | boolean | null>;
}

const stressReport: StressReport = {
  ok: false,
  sectionCount: PARSER_SECTION_COUNT,
  exportSectionCount: EXPORT_SECTION_COUNT,
  visualImageCount: VISUAL_IMAGE_COUNT,
  fixtureBytes: 0,
  steps: [],
};

describe('large document OOM stress gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  afterAll(() => {
    const reportPath = process.env.SCIEMD_LARGE_DOCUMENT_STRESS_REPORT;
    if (!reportPath) return;
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(stressReport, null, 2)}\n`, 'utf8');
  });

  it('processes parser, diagnostics, export, capture, and recovery stress surfaces', async () => {
    const parserFixture = createLargeDocumentStressFixture({ sectionCount: PARSER_SECTION_COUNT });
    stressReport.fixtureBytes = parserFixture.expected.markdownBytes;

    const parsed = await recordStep('parser', async () => (
      parseScienfyDocumentAsync(parserFixture.markdown, {
        bibtex: LARGE_DOCUMENT_STRESS_BIBTEX,
        variableDefinitions: [{ name: 'cohort_n', value: '128', source: 'external', file: 'variables.json' }],
      })
    ), {
      markdownBytes: parserFixture.expected.markdownBytes,
      sectionCount: parserFixture.expected.sectionCount,
    });

    expect(parsed.title).toBe('Large Document Stress Fixture');
    expect(parsed.directives.length).toBeGreaterThanOrEqual(
      parserFixture.expected.figureDirectiveCount + parserFixture.expected.noteDirectiveCount,
    );
    expect(parsed.citations.usages.length).toBe(parserFixture.expected.citationUsageCount);
    expect(parsed.citations.missingKeys).toEqual([]);
    expect(parsed.variables.usages.length).toBeGreaterThanOrEqual(parserFixture.expected.variableUsageCount);
    expect(parsed.variables.missingVariables).toEqual([]);
    expect(parsed.references.missingLabels).toEqual([]);
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);

    const metrics = await recordStep('diagnostics-heartbeat-input', async () => (
      summarizeMarkdownForDiagnostics(parserFixture.markdown)
    ), {
      markdownBytes: parserFixture.expected.markdownBytes,
    });
    expect(metrics.markdownBytes).toBe(parserFixture.expected.markdownBytes);
    expect(metrics.lineCount).toBe(parserFixture.expected.lineCount);
    expect(metrics.imageCount).toBe(parserFixture.expected.imageCount);
    expect(metrics.mathCount).toBe(parserFixture.expected.mathCount);

    const jobSummary = await recordStep('background-jobs', async () => {
      const startedAtById = new Map<string, number>();
      const snapshot = createBackgroundJobSnapshot([
        { id: 'parser', label: 'Document parser stress fixture', active: true, stuckAfterMs: 500 },
        { id: 'diagnostics', label: 'Renderer diagnostics heartbeat', active: true, stuckAfterMs: 1_000 },
        { id: 'export', label: 'HTML export stress fixture', active: true, stuckAfterMs: 2_500 },
        { id: 'recovery', label: 'Native recovery snapshot stress fixture', active: false },
      ], startedAtById, 1_000);
      return summarizeBackgroundJobs(snapshot, 2_200);
    }, {});
    expect(jobSummary).toMatchObject({
      activeCount: 3,
      stuckCount: 2,
      oldestBackgroundJobMs: 1_200,
      activeJobLabels: [
        'Renderer diagnostics heartbeat',
        'HTML export stress fixture',
        'Document parser stress fixture',
      ],
      stuckJobLabels: [
        'Renderer diagnostics heartbeat',
        'Document parser stress fixture',
      ],
    });

    const exportFixture = createLargeDocumentStressFixture({ sectionCount: EXPORT_SECTION_COUNT });
    const fragment = await recordStep('html-export-fragment', async () => (
      renderMarkdownHtmlFragment(exportFixture.markdown, null, {
        embedImages: false,
        citationEntries: [LARGE_DOCUMENT_STRESS_CITATION_ENTRY],
      })
    ), {
      markdownBytes: exportFixture.expected.markdownBytes,
      exportSectionCount: EXPORT_SECTION_COUNT,
    });
    expect(fragment).toContain('directive-card directive-figure');
    expect(fragment).toContain('Figure 1:');
    expect(fragment).toContain('directive-card directive-references');
    expect(fragment).toContain('Reliable Scientific Markdown.');
    expect(fragment).toContain('stress-flow');
    expect(fragment).toContain('class="svg-figure"');
    expect(fragment).toContain('<math');
    expect(fragment).toContain('This short abstract variant should remain active for output.');
    expect(fragment).not.toContain('This longer abstract variant should be ignored by export output.');
    expect(fragment).not.toContain('```mermaid');
    expect(fragment).not.toContain(':::figure');

    const fullHtml = await recordStep('html-export-document', async () => (
      createHtmlDocument(fragment, 'Large Document Stress Fixture', {
        embedFonts: false,
        bodyIsFullVisualFrame: false,
      })
    ), {
      fragmentBytes: new TextEncoder().encode(fragment).byteLength,
    });
    expect(fullHtml).toContain('<!doctype html>');
    expect(fullHtml).toContain("script-src 'none'");
    expect(fullHtml).toContain('Large Document Stress Fixture');

    const captured = await recordStep('visual-export-capture', async () => (
      captureEditorHtmlForExport(createVisualExportStressRoot(VISUAL_IMAGE_COUNT))
    ), {
      visualImageCount: VISUAL_IMAGE_COUNT,
    });
    expect(captured?.isFullVisualFrame).toBe(true);
    expect(captured?.bodyHtml).toContain('export-captured-stage');
    expect(captured?.bodyHtml).toContain('data:image/png;base64,ZmFrZS1zdHJlc3MtaW1hZ2U=');
    expect(captured?.bodyHtml).not.toContain('scie-md-visual-atom-controls');
    expect(readBinaryFileBase64).toHaveBeenCalledTimes(VISUAL_IMAGE_COUNT);

    const recoveryMarkdown = createRecoveryStressMarkdown(RAW_RESCUE_SESSION_STORAGE_MAX_BYTES + 32 * 1024);
    const rescuePolicy = rawDocumentRescuePolicy(recoveryMarkdown, RAW_RESCUE_SESSION_STORAGE_MAX_BYTES);
    const rescue = await recordStep('recovery-policy', async () => (
      nativeRescueMarkdown(recoveryMarkdown, RAW_RESCUE_SESSION_STORAGE_MAX_BYTES)
    ), {
      recoveryBytes: rescuePolicy.markdownBytes,
    });
    expect(rescuePolicy).toMatchObject({
      sessionStorage: 'skipped',
      nativeStorage: 'truncated',
    });
    expect(rescue).toContain('ScieMD rescue snapshot truncated');
    expect(rescue).toContain('Head marker: large-document-recovery-start.');
    expect(rescue).toContain('Tail marker: large-document-recovery-complete.');

    await recordStep('recovery-write', async () => {
      updateRawDocumentRescue(recoveryMarkdown, 'C:\\Lab\\stress\\large.md');
      await flushRawDocumentRescueSnapshotForTests();
      return true;
    }, {
      recoveryBytes: rescuePolicy.markdownBytes,
    });
    const sessionPayload = JSON.parse(window.sessionStorage.getItem(RESCUE_SNAPSHOT_KEY) ?? '{}') as {
      markdown?: string;
      nativeFallbackOnly?: boolean;
      filePath?: string;
    };
    expect(sessionPayload).toMatchObject({
      markdown: '',
      nativeFallbackOnly: true,
      filePath: 'C:\\Lab\\stress\\large.md',
    });
    expect(writeNativeRecoverySnapshot).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'C:\\Lab\\stress\\large.md',
    }));

    stressReport.ok = true;
  }, STRESS_TIMEOUT_MS);
});

async function recordStep<T>(
  name: string,
  work: () => T | Promise<T>,
  details: Record<string, number | string | boolean | null>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await work();
  } finally {
    stressReport.steps.push({
      name,
      durationMs: Math.round(performance.now() - startedAt),
      heapUsedBytes: heapUsedBytes(),
      details,
    });
  }
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function heapUsedBytes(): number | null {
  if (typeof process === 'undefined' || typeof process.memoryUsage !== 'function') return null;
  return process.memoryUsage().heapUsed;
}
