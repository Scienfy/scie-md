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
const vitestPath = resolve(repoRoot, 'node_modules/vitest/vitest.mjs');
const reportPath = resolve(options.reportPath ?? `tmp/structured-workflows/report-${Date.now()}.json`);

if (!existsSync(vitestPath)) {
  console.error('[structured-workflows] Missing Vitest runtime. Run "npm install" before this validation.');
  process.exit(1);
}

await mkdir(dirname(reportPath), { recursive: true });

console.log('[structured-workflows] Running structured corpus and workflow validation');
console.log(JSON.stringify({
  reportPath,
  timeoutMs: options.timeoutMs,
}, null, 2));

const result = spawnSync(process.execPath, [
  vitestPath,
  'run',
  'src/app/structuredWorkflowValidation.test.ts',
  '--testTimeout',
  String(options.timeoutMs),
  '--hookTimeout',
  String(options.timeoutMs),
], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    SCIEMD_STRUCTURED_WORKFLOW_REPORT: reportPath,
  },
  shell: false,
  timeout: options.timeoutMs + 15_000,
});

if (result.error) {
  console.error(`[structured-workflows] ${result.error.message}`);
}
if (result.status !== 0) {
  console.error('[structured-workflows] Validation failed.');
  process.exit(result.status ?? 1);
}

if (!existsSync(reportPath)) {
  console.error(`[structured-workflows] Validation passed but did not write a report: ${reportPath}`);
  process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
if (!report.ok) {
  console.error('[structured-workflows] Report did not mark the run as ok.');
  process.exit(1);
}

console.log('[structured-workflows] Validation passed.');
console.log(formatReportSummary(report));

function parseArgs(args) {
  const parsed = {
    timeoutMs: readPositiveIntegerEnv('SCIEMD_STRUCTURED_WORKFLOW_TIMEOUT_MS', 45_000),
    reportPath: process.env.SCIEMD_STRUCTURED_WORKFLOW_REPORT ?? null,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--timeout-ms') parsed.timeoutMs = parsePositiveInteger(args[++index], 'timeout-ms');
    else if (arg === '--report') parsed.reportPath = args[++index] ?? '';
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/validate-structured-workflows.mjs [options]

Runs the focused ScieMD structured-data workflow gate. The gate parses the
docs/example-files corpus, validates schema companionship, applies reviewed
visual edits for editable structured formats, checks stale-source guards, and
locks parser/regression fixtures for source-preserving behavior.

Options:
  --timeout-ms <ms>  Vitest test/hook timeout. Default: 45000.
  --report <path>   JSON report path. Default: tmp/structured-workflows/report-<time>.json.
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
  return [
    `files=${report.files?.length ?? 0}`,
    `workflows=${report.workflows?.join(',') ?? ''}`,
  ].join('\n');
}
