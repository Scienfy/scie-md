import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  adapterForFormat,
  applyStructuredExternalConflictReviewDecisions,
  canonicalizeStructuredIngressText,
  createJsonContent,
  createStructuredEditReviewPlan,
  createStructuredExternalConflictReview,
  formatFromPath,
  formatRuntimePolicyFor,
  jsonSourceHash,
  jsonlSourceHash,
  parseJsonDocument,
  planJsonVisualEdit,
  planJsonlVisualEdit,
  planTabularVisualEdit,
  resolveStructuredEditReviewApply,
  structuredEditTransactionFromJsonEdit,
  structuredEditTransactionFromJsonlEdit,
  structuredEditTransactionFromTabularEdit,
  tabularSourceHash,
  validateJsonValueAgainstSchema,
} from '@sciemd/core';
import type { DocumentFormat, FormatDiagnostic } from '@sciemd/core';
import { createStructuredSavePolicy } from './structuredSavePolicy';
import { parseSourceFormatDiagnostics } from './formatDiagnostics';
import { formatCapabilitiesFor } from './formatCapabilities';
import { createStructuredSurfaceNavigationModel } from './structuredSurfaceNavigation';

const exampleDir = resolve('docs/example-files');
const report: {
  ok: boolean;
  files: Array<{ name: string; format: DocumentFormat; status: string; metrics: Record<string, unknown> }>;
  workflows: string[];
} = {
  ok: true,
  files: [],
  workflows: [],
};

describe('structured workflow validation', () => {
  it('parses every top-level example file with expected metrics and policies', () => {
    const fileNames = exampleFileNames();
    expect(fileNames).toEqual([
      'README.md',
      'materials-study-comprehensive.json',
      'materials-study-config.yaml',
      'materials-study-events.ndjson',
      'materials-study-matrix.tsv',
      'materials-study-records.jsonl',
      'materials-study-results.csv',
      'materials-study-settings.toml',
      'materials-study.schema.json',
    ]);

    for (const fileName of fileNames) {
      const path = examplePath(fileName);
      const format = formatFromPath(path);
      expect(format, fileName).not.toBeNull();
      const text = readFileSync(path, 'utf8');
      const diagnostics = parseSourceFormatDiagnostics(format!, text, path);
      const adapter = adapterForFormat(format!);
      expect(adapter, fileName).not.toBeNull();
      expect(diagnostics.diagnostics.filter(isError), fileName).toEqual([]);

      if (format === 'markdown') {
        expect(diagnostics.structuredModel).toBeNull();
        report.files.push({ name: fileName, format, status: 'markdown', metrics: { bytes: text.length } });
        continue;
      }

      if (format === 'json') {
        expect(diagnostics.jsonAnalysis?.status, fileName).toBe('valid');
        expect(diagnostics.jsonAnalysis?.parseResult.sourceOnly, fileName).toBe(false);
        expect(diagnostics.jsonAnalysis?.nodeCount ?? 0, fileName).toBeGreaterThan(20);
        report.files.push({
          name: fileName,
          format,
          status: diagnostics.jsonAnalysis?.status ?? 'missing',
          metrics: { nodeCount: diagnostics.jsonAnalysis?.nodeCount },
        });
      } else if (format === 'jsonl') {
        expect(diagnostics.jsonlAnalysis?.status, fileName).toBe('valid');
        expect(diagnostics.jsonlAnalysis?.invalidLineCount, fileName).toBe(0);
        expect(diagnostics.jsonlAnalysis?.recordCount, fileName).toBe(fileName.endsWith('.ndjson') ? 8 : 16);
        report.files.push({
          name: fileName,
          format,
          status: diagnostics.jsonlAnalysis?.status ?? 'missing',
          metrics: { recordCount: diagnostics.jsonlAnalysis?.recordCount },
        });
      } else if (format === 'csv' || format === 'tsv') {
        expect(diagnostics.tabularAnalysis?.status, fileName).toBe('valid');
        expect(diagnostics.tabularAnalysis?.dataRowCount, fileName).toBe(20);
        expect(diagnostics.tabularAnalysis?.columnCount, fileName).toBe(format === 'csv' ? 15 : 13);
        report.files.push({
          name: fileName,
          format,
          status: diagnostics.tabularAnalysis?.status ?? 'missing',
          metrics: {
            dataRowCount: diagnostics.tabularAnalysis?.dataRowCount,
            columnCount: diagnostics.tabularAnalysis?.columnCount,
          },
        });
      } else if (format === 'yaml' || format === 'toml' || format === 'xml') {
        expect(diagnostics.structuredAnalysis?.status, fileName).toBe('valid');
        expect(formatRuntimePolicyFor(format).canEditVisually, fileName).toBe(false);
        expect(adapter?.capabilities.formatPreservingEdits, fileName).toBe(false);
        report.files.push({
          name: fileName,
          format,
          status: diagnostics.structuredAnalysis?.status ?? 'missing',
          metrics: { nodeCount: diagnostics.structuredAnalysis?.nodeCount },
        });
      }
    }
  });

  it('validates the JSON study against the schema companion', () => {
    const jsonPath = examplePath('materials-study-comprehensive.json');
    const schemaPath = examplePath('materials-study.schema.json');
    const parsed = parseJsonDocument(createJsonContent(readFileSync(jsonPath, 'utf8'), jsonPath)).parsed;
    expect(parsed).not.toBeNull();

    const validation = validateJsonValueAgainstSchema(parsed!.value, {
      kind: 'sibling',
      text: readFileSync(schemaPath, 'utf8'),
      path: schemaPath,
      label: 'materials-study.schema.json',
    }, { sourceMap: parsed!.sourceMap });

    expect(validation.status).toBe('valid');
    expect(validation.summary?.requiredFields).toEqual(expect.arrayContaining(['study', 'samples', 'analysis']));
    expect(validation.summary?.knownFields.some((field) => field.path === '$.study.status')).toBe(true);
    report.workflows.push('schema-companion');
  });

  it('applies reviewed visual edits and reopens editable structured formats without losing meaning', () => {
    const jsonSource = readExample('materials-study-comprehensive.json');
    const jsonTitle = applyReviewedJsonEdit(jsonSource, {
      kind: 'replaceScalar',
      path: ['study', 'title'],
      nextValue: 'Round 12 validation title',
      expectedSourceHash: jsonSourceHash(jsonSource),
    });
    const jsonNumber = applyReviewedJsonEdit(jsonTitle, {
      kind: 'replaceScalar',
      path: ['samples', 0, 'measurements', 'thickness_nm'],
      nextValue: { kind: 'raw-json-number', raw: '119.4000' },
      expectedSourceHash: jsonSourceHash(jsonTitle),
    });
    const reopenedJson = parseJsonDocument(createJsonContent(jsonNumber)).parsed;
    expect(reopenedJson?.value).toMatchObject({
      study: { title: 'Round 12 validation title' },
    });
    expect(jsonNumber).toContain('"thickness_nm": 119.4000');

    const jsonlSource = readExample('materials-study-records.jsonl');
    const firstJsonlLine = jsonlSource.split(/\r?\n/)[0];
    const jsonlNext = applyReviewedJsonlEdit(jsonlSource, {
      kind: 'replaceRecord',
      lineNumber: 1,
      value: { ...JSON.parse(firstJsonlLine), review: { status: 'round12', reviewer: 'QA', flags: [] } },
      expectedOffset: 0,
      expectedLength: firstJsonlLine.length,
      expectedLineText: firstJsonlLine,
      expectedSourceHash: jsonlSourceHash(jsonlSource),
    });
    const jsonlAnalysis = parseSourceFormatDiagnostics('jsonl', jsonlNext, null).jsonlAnalysis;
    expect(jsonlAnalysis?.status).toBe('valid');
    expect(jsonlAnalysis?.recordCount).toBe(16);
    expect(JSON.parse(jsonlNext.split(/\r?\n/)[0]).review.status).toBe('round12');

    const csvSource = readExample('materials-study-results.csv');
    const csvNext = applyReviewedTabularEdit(csvSource, {
      kind: 'replaceCell',
      format: 'csv',
      dataRowIndex: 0,
      columnIndex: 14,
      nextValue: 'Validated, source-preserving "quoted" note',
      expectedSourceHash: tabularSourceHash(csvSource),
    });
    const csvAnalysis = parseSourceFormatDiagnostics('csv', csvNext, null).tabularAnalysis;
    expect(csvAnalysis?.status).toBe('valid');
    expect(csvAnalysis?.dataRowCount).toBe(20);
    expect(csvAnalysis?.parseResult.parsed?.dataRows[0]?.[14]).toBe('Validated, source-preserving "quoted" note');

    const tsvSource = readExample('materials-study-matrix.tsv');
    const tsvNext = applyReviewedTabularEdit(tsvSource, {
      kind: 'replaceCell',
      format: 'tsv',
      dataRowIndex: 0,
      columnIndex: 12,
      nextValue: 'round12_repeat',
      expectedSourceHash: tabularSourceHash(tsvSource),
    });
    const tsvAnalysis = parseSourceFormatDiagnostics('tsv', tsvNext, null).tabularAnalysis;
    expect(tsvAnalysis?.status).toBe('valid');
    expect(tsvAnalysis?.dataRowCount).toBe(20);
    expect(tsvAnalysis?.parseResult.parsed?.dataRows[0]?.[12]).toBe('round12_repeat');
    report.workflows.push('reviewed-visual-edit-save-reopen');
  });

  it('keeps stale reviewed edits and unsafe structured syntax from applying silently', () => {
    const jsonSource = '{"study":{"title":"old"}}\n';
    const jsonPlan = planJsonVisualEdit(jsonSource, {
      kind: 'replaceScalar',
      path: ['study', 'title'],
      nextValue: 'new',
      expectedSourceHash: jsonSourceHash(jsonSource),
    });
    const transaction = structuredEditTransactionFromJsonEdit(jsonSource, {
      kind: 'replaceScalar',
      path: ['study', 'title'],
      nextValue: 'new',
      expectedSourceHash: jsonSourceHash(jsonSource),
    }, jsonPlan);
    expect(transaction).not.toBeNull();
    const review = createStructuredEditReviewPlan({ source: jsonSource, transaction: transaction!, documentEpoch: 5 });
    expect(review).not.toBeNull();

    expect(resolveStructuredEditReviewApply('{"study":{"title":"changed"}}\n', 5, review!)).toMatchObject({ ok: false });
    expect(resolveStructuredEditReviewApply(jsonSource, 6, review!)).toMatchObject({ ok: false });

    const invalidJson = parseSourceFormatDiagnostics('json', '{"study":}\n', null);
    const invalidJsonPolicy = createStructuredSavePolicy({ format: 'json', diagnostics: invalidJson.diagnostics });
    expect(invalidJsonPolicy.autosaveBlocked).toBe(true);
    expect(invalidJsonPolicy.manualSaveRequiresConfirmation).toBe(true);

    const csvWarning = parseSourceFormatDiagnostics('csv', 'id,count\n001,002\n', null);
    expect(csvWarning.diagnostics).toContainEqual(expect.objectContaining({ code: 'tabular-number-risk' }));
    expect(createStructuredSavePolicy({ format: 'csv', diagnostics: csvWarning.diagnostics }).autosaveBlocked).toBe(false);
    report.workflows.push('stale-and-autosave-guards');
  });

  it('keeps source and visual surface switching deterministic across structured formats', () => {
    const jsonAnalysis = parseSourceFormatDiagnostics('json', '{"samples":[{"id":"S-001"}]}\n', null).jsonAnalysis;
    const jsonModel = createStructuredSurfaceNavigationModel({
      format: 'json',
      mode: 'visual',
      formatCapabilities: formatCapabilitiesFor('json'),
      jsonAnalysis,
      jsonArrayTableAvailable: true,
      preferredVisualSurface: 'table',
    });
    expect(jsonModel.activeSurface).toBe('table');
    expect(createStructuredSurfaceNavigationModel({
      format: 'json',
      mode: 'source',
      formatCapabilities: formatCapabilitiesFor('json'),
      jsonAnalysis,
      jsonArrayTableAvailable: true,
      preferredVisualSurface: jsonModel.preferredVisualSurface,
    }).activeSurface).toBe('source');

    const jsonlAnalysis = parseSourceFormatDiagnostics('jsonl', '{"id":1}\n', null).jsonlAnalysis;
    expect(createStructuredSurfaceNavigationModel({
      format: 'jsonl',
      mode: 'visual',
      formatCapabilities: formatCapabilitiesFor('jsonl'),
      jsonlAnalysis,
    }).activeSurface).toBe('records');

    const invalidJsonl = parseSourceFormatDiagnostics('jsonl', '{"id":}\n', null).jsonlAnalysis;
    expect(createStructuredSurfaceNavigationModel({
      format: 'jsonl',
      mode: 'visual',
      formatCapabilities: formatCapabilitiesFor('jsonl'),
      jsonlAnalysis: invalidJsonl,
    }).activeSurface).toBe('records');
    report.workflows.push('surface-switching');
  });

  it('locks parser and source-preservation regression fixtures', () => {
    const bom = canonicalizeStructuredIngressText('\uFEFF{"id":"bom"}\n');
    expect(bom.strippedBom).toBe(true);
    expect(parseSourceFormatDiagnostics('json', bom.text, null).jsonAnalysis?.status).toBe('valid');

    const duplicateJson = parseSourceFormatDiagnostics('json', '{"id":1,"id":2}\n', null);
    expect(duplicateJson.diagnostics).toContainEqual(expect.objectContaining({ code: 'json-duplicate-key' }));

    const crlfJsonl = parseSourceFormatDiagnostics('jsonl', '{"id":1}\r\n{"id":2}\r\n', null);
    expect(crlfJsonl.jsonlAnalysis?.recordCount).toBe(2);
    const malformedJsonl = parseSourceFormatDiagnostics('jsonl', '{"id":1}\n{"id":}\n', null);
    expect(malformedJsonl.jsonlAnalysis?.status).toBe('invalid');
    expect(malformedJsonl.diagnostics).toContainEqual(expect.objectContaining({ code: expect.stringContaining('jsonl-syntax') }));

    const quotedCsv = parseSourceFormatDiagnostics('csv', 'id,note\n001,"thin, film ""quoted"""\n', null);
    expect(quotedCsv.tabularAnalysis?.parseResult.parsed?.dataRows[0]?.[1]).toBe('thin, film "quoted"');

    const yaml = parseSourceFormatDiagnostics('yaml', readExample('materials-study-config.yaml'), null);
    expect(yaml.structuredAnalysis?.status).toBe('valid');
    expect(yaml.diagnostics.some((diagnostic) => diagnostic.category === 'preservation')).toBe(true);

    const toml = parseSourceFormatDiagnostics('toml', readExample('materials-study-settings.toml'), null);
    expect(toml.structuredAnalysis?.status).toBe('valid');

    const xmlNamespace = parseSourceFormatDiagnostics('xml', '<root xmlns="urn:default" xmlns:x="urn:x"><child x:id="a">value</child></root>', null);
    expect(xmlNamespace.structuredAnalysis?.status).toBe('valid');
    const xmlDoctype = parseSourceFormatDiagnostics('xml', '<!DOCTYPE root><root />', null);
    expect(xmlDoctype.diagnostics).toContainEqual(expect.objectContaining({ code: 'xml-doctype-disabled' }));
    report.workflows.push('regression-fixtures');
  });

  it('reviews external JSONL and table conflicts without line-level conflict markers', () => {
    const jsonlReview = createStructuredExternalConflictReview(
      'jsonl',
      '{"id":1,"status":"base"}\n',
      '{"id":1,"status":"local"}\n',
      '{"id":1,"status":"disk"}\n',
    );
    expect(jsonlReview.status).toBe('ready');
    const jsonlMerge = applyStructuredExternalConflictReviewDecisions(jsonlReview, new Set());
    expect(jsonlMerge.ok).toBe(true);
    expect(jsonlMerge.nextSource).toBe('{"id":1,"status":"disk"}\n');
    expect(jsonlMerge.nextSource).not.toContain('<<<<<<<');

    const tableReview = createStructuredExternalConflictReview(
      'csv',
      'id,note\n001,base\n',
      'id,note\n001,local\n',
      'id,note\n001,"disk, quoted"\n',
    );
    expect(tableReview.status).toBe('ready');
    const rejected = new Set([tableReview.entries[0]?.id ?? 'missing']);
    const tableMerge = applyStructuredExternalConflictReviewDecisions(tableReview, rejected);
    expect(tableMerge.ok).toBe(true);
    expect(tableMerge.nextSource).toBe('id,note\n001,local\n');
    report.workflows.push('external-conflict-review');
  });
});

afterAll(() => {
  const reportPath = process.env.SCIEMD_STRUCTURED_WORKFLOW_REPORT;
  if (!reportPath) return;
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
});

function exampleFileNames(): string[] {
  expect(existsSync(exampleDir)).toBe(true);
  return readdirSync(exampleDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

function readExample(name: string): string {
  return readFileSync(examplePath(name), 'utf8');
}

function examplePath(name: string): string {
  return join(exampleDir, name);
}

function isError(diagnostic: FormatDiagnostic): boolean {
  return diagnostic.severity === 'error';
}

function applyReviewedJsonEdit(
  source: string,
  intent: Parameters<typeof planJsonVisualEdit>[1],
): string {
  const plan = planJsonVisualEdit(source, intent);
  expect(plan.ok, plan.unsupportedReason).toBe(true);
  const transaction = structuredEditTransactionFromJsonEdit(source, intent, plan);
  expect(transaction).not.toBeNull();
  const review = createStructuredEditReviewPlan({ source, transaction: transaction!, documentEpoch: 1 });
  expect(review).not.toBeNull();
  const apply = resolveStructuredEditReviewApply(source, 1, review!);
  expect(apply.ok).toBe(true);
  return apply.ok ? apply.nextSource : source;
}

function applyReviewedJsonlEdit(
  source: string,
  intent: Parameters<typeof planJsonlVisualEdit>[1],
): string {
  const plan = planJsonlVisualEdit(source, intent);
  expect(plan.ok, plan.unsupportedReason).toBe(true);
  const transaction = structuredEditTransactionFromJsonlEdit(source, intent, plan);
  expect(transaction).not.toBeNull();
  const review = createStructuredEditReviewPlan({ source, transaction: transaction!, documentEpoch: 1 });
  expect(review).not.toBeNull();
  const apply = resolveStructuredEditReviewApply(source, 1, review!);
  expect(apply.ok).toBe(true);
  return apply.ok ? apply.nextSource : source;
}

function applyReviewedTabularEdit(
  source: string,
  intent: Parameters<typeof planTabularVisualEdit>[1],
): string {
  const plan = planTabularVisualEdit(source, intent);
  expect(plan.ok, plan.unsupportedReason).toBe(true);
  const transaction = structuredEditTransactionFromTabularEdit(source, intent, plan);
  expect(transaction).not.toBeNull();
  const review = createStructuredEditReviewPlan({ source, transaction: transaction!, documentEpoch: 1 });
  expect(review).not.toBeNull();
  const apply = resolveStructuredEditReviewApply(source, 1, review!);
  expect(apply.ok).toBe(true);
  return apply.ok ? apply.nextSource : source;
}
