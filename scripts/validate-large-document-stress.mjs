import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const repoRoot = resolve('.');
const reportPath = resolve(options.reportPath ?? `tmp/large-document-stress/report-${Date.now()}.json`);
const vitestPath = resolve(repoRoot, 'node_modules/vitest/vitest.mjs');

if (!existsSync(vitestPath)) {
  console.error('[large-document-stress] Missing Vitest runtime. Run "npm install" before this validation.');
  process.exit(1);
}

await mkdir(dirname(reportPath), { recursive: true });

console.log('[large-document-stress] Running optional large-document/OOM stress gate');
console.log(JSON.stringify({
  sections: options.sections,
  exportSections: options.exportSections,
  visualImages: options.visualImages,
  timeoutMs: options.timeoutMs,
  reportPath,
}, null, 2));

const result = spawnSync(process.execPath, [
  vitestPath,
  'run',
  'src/stress/largeDocumentStress.test.ts',
  '--testTimeout',
  String(options.timeoutMs),
  '--hookTimeout',
  String(options.timeoutMs),
], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    SCIEMD_LARGE_DOCUMENT_STRESS_SECTIONS: String(options.sections),
    SCIEMD_LARGE_DOCUMENT_STRESS_EXPORT_SECTIONS: String(options.exportSections),
    SCIEMD_LARGE_DOCUMENT_STRESS_VISUAL_IMAGES: String(options.visualImages),
    SCIEMD_LARGE_DOCUMENT_STRESS_TIMEOUT_MS: String(options.timeoutMs),
    SCIEMD_LARGE_DOCUMENT_STRESS_REPORT: reportPath,
  },
  shell: false,
  timeout: options.timeoutMs + 15_000,
});

if (result.error) {
  console.error(`[large-document-stress] ${result.error.message}`);
}
if (result.status !== 0) {
  console.error('[large-document-stress] Stress gate failed.');
  process.exit(result.status ?? 1);
}

if (!existsSync(reportPath)) {
  console.error(`[large-document-stress] Stress test passed but did not write a report: ${reportPath}`);
  process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
if (!report.ok) {
  console.error('[large-document-stress] Stress report did not mark the run as ok.');
  process.exit(1);
}

console.log('[large-document-stress] Stress gate passed.');
console.log(formatReportSummary(report));

function parseArgs(args) {
  const parsed = {
    sections: readPositiveIntegerEnv('SCIEMD_LARGE_DOCUMENT_STRESS_SECTIONS', 900),
    exportSections: readPositiveIntegerEnv('SCIEMD_LARGE_DOCUMENT_STRESS_EXPORT_SECTIONS', 180),
    visualImages: readPositiveIntegerEnv('SCIEMD_LARGE_DOCUMENT_STRESS_VISUAL_IMAGES', 48),
    timeoutMs: readPositiveIntegerEnv('SCIEMD_LARGE_DOCUMENT_STRESS_TIMEOUT_MS', 60_000),
    reportPath: process.env.SCIEMD_LARGE_DOCUMENT_STRESS_REPORT ?? null,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--sections') parsed.sections = parsePositiveInteger(args[++index], 'sections');
    else if (arg === '--export-sections') parsed.exportSections = parsePositiveInteger(args[++index], 'export-sections');
    else if (arg === '--visual-images') parsed.visualImages = parsePositiveInteger(args[++index], 'visual-images');
    else if (arg === '--timeout-ms') parsed.timeoutMs = parsePositiveInteger(args[++index], 'timeout-ms');
    else if (arg === '--report') parsed.reportPath = args[++index] ?? '';
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/validate-large-document-stress.mjs [options]

Runs the optional ScieMD large-document/OOM stress gate through Vitest. The gate
processes deterministic fixtures through the parser async API, diagnostics
metrics, background job accounting, HTML export, visual export capture, and raw
document recovery policy.

Options:
  --sections <count>         Parser/diagnostics fixture size. Default: 900.
  --export-sections <count>  HTML export fixture size. Default: 180.
  --visual-images <count>    Visual export capture image count. Default: 48.
  --timeout-ms <ms>          Vitest test/hook timeout. Default: 60000.
  --report <path>           JSON report path. Default: tmp/large-document-stress/report-<time>.json.
`);
}

function readPositiveIntegerEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return parsePositiveInteger(raw, name);
}

function parsePositiveInteger(raw, label) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Expected ${label} to be a positive integer, got ${raw}`);
  }
  return Math.floor(value);
}

function formatReportSummary(report) {
  const lines = [
    `fixtureBytes=${report.fixtureBytes}`,
    `sections=${report.sectionCount}`,
    `exportSections=${report.exportSectionCount}`,
    `visualImages=${report.visualImageCount}`,
  ];
  for (const step of report.steps ?? []) {
    const heap = typeof step.heapUsedBytes === 'number'
      ? `${Math.round(step.heapUsedBytes / 1024 / 1024)}MiB`
      : 'n/a';
    lines.push(`step=${step.name} durationMs=${step.durationMs} heap=${heap}`);
  }
  return lines.join('\n');
}
