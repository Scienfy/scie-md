import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const DEFAULT_PORT = 9231;
const APP_CANDIDATES = [
  'src-tauri/target/release/sciemd.exe',
  'src-tauri/target/release/ScieMD.exe',
  'src-tauri/target/debug/sciemd.exe',
  'src-tauri/target/debug/ScieMD.exe',
];

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

if (process.platform !== 'win32') {
  skip('Packaged desktop smoke currently targets the Windows WebView2 runtime.');
}
const appPath = resolveAppPath(options.appPath);
if (!appPath) {
  skip(`No packaged ScieMD executable found. Run "npm run build:desktop" first, or pass --app <path>.`);
}

const smokeRoot = await mkdtemp(join(tmpdir(), 'sciemd-desktop-smoke-'));
const appDataRoot = join(smokeRoot, 'app-data');
const workspace = join(smokeRoot, 'workspace');
const startupPath = join(workspace, 'startup-paper.md');
const exportPath = join(workspace, 'export-target.md');
const structuredManifestPath = join(workspace, 'structured-smoke-manifest.json');
const startupMarkdown = [
  '# ScieMD Desktop Smoke',
  '',
  'This Markdown file was opened by the packaged desktop smoke harness.',
  '',
].join('\n');

let summary;
try {
  await mkdir(workspace, { recursive: true });
  await writeFile(startupPath, startupMarkdown, 'utf8');
  await writeFile(exportPath, '# Export target\n', 'utf8');
  const structuredCases = await writeStructuredSmokeFixtures(workspace);
  await writeFile(structuredManifestPath, JSON.stringify(structuredCases.map((fixture) => ({
    format: fixture.format,
    path: fixture.path,
    expectedContains: fixture.expectedContains,
    updatedContent: fixture.updatedContent,
    updatedContains: fixture.updatedContains,
  })), null, 2), 'utf8');

  const noFile = await runPackagedSelfTest({
    appPath,
    args: [],
    appDataRoot,
    reportPath: join(smokeRoot, 'no-file-report.json'),
    scenario: 'no-file',
    timeoutMs: options.timeoutMs,
  });
  if (noFile.initialPath !== null && noFile.initialPath !== undefined) {
    throw new Error(`Expected no-file startup to have no initial Markdown path, got ${noFile.initialPath}`);
  }

  const fileLaunch = await runPackagedSelfTest({
    appPath,
    args: [startupPath],
    appDataRoot,
    reportPath: join(smokeRoot, 'file-launch-report.json'),
    scenario: 'file-launch',
    startupPath,
    exportPath,
    timeoutMs: options.timeoutMs,
  });
  if (!fileLaunch.savedSizeBytes || !fileLaunch.recoveryBytes || !fileLaunch.docxBytes) {
    throw new Error('File-launch smoke report is missing save, recovery, or export evidence.');
  }

  const structuredFileLaunch = await runPackagedSelfTest({
    appPath,
    args: [structuredCases.find((fixture) => fixture.format === 'json')?.path ?? structuredCases[0].path],
    appDataRoot,
    reportPath: join(smokeRoot, 'structured-file-launch-report.json'),
    scenario: 'structured-file-launch',
    timeoutMs: options.timeoutMs,
  });
  if (!structuredFileLaunch.initialPath || basename(structuredFileLaunch.initialPath) !== 'desktop-structured-smoke.json') {
    throw new Error(`Expected structured CLI launch to open the JSON fixture, got ${structuredFileLaunch.initialPath}`);
  }

  const structuredManualOpen = await runPackagedSelfTest({
    appPath,
    args: [],
    appDataRoot,
    reportPath: join(smokeRoot, 'structured-manual-open-report.json'),
    scenario: 'structured-manual-open',
    structuredManifestPath,
    timeoutMs: options.timeoutMs,
  });
  if (!Array.isArray(structuredManualOpen.structuredFiles) || structuredManualOpen.structuredFiles.length !== structuredCases.length) {
    throw new Error(`Structured desktop smoke expected ${structuredCases.length} file reports, got ${structuredManualOpen.structuredFiles?.length ?? 0}.`);
  }
  const unchanged = structuredManualOpen.structuredFiles.filter((file) => !file.contentHashChanged || !file.afterSizeBytes);
  if (unchanged.length > 0) {
    throw new Error(`Structured desktop smoke did not persist edits for: ${unchanged.map((file) => file.format).join(', ')}`);
  }

  summary = {
    ok: true,
    appPath,
    smokeRoot,
    noFile,
    fileLaunch,
    structuredFileLaunch,
    structuredManualOpen,
  };
  console.log(JSON.stringify(summary, null, 2));
} finally {
  if (!readBooleanEnv('SCIEMD_DESKTOP_SMOKE_KEEP_TEMP', 'SCIE_MD_DESKTOP_SMOKE_KEEP_TEMP')) {
    await cleanupSmokeRoot(smokeRoot);
  }
}

async function cleanupSmokeRoot(path) {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        console.warn(`[desktop-smoke] Could not remove temporary smoke directory ${path}: ${error.message}`);
        return;
      }
      await delay(250 * attempt);
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseArgs(args) {
  const parsed = {
    appPath: readEnv('SCIEMD_DESKTOP_SMOKE_APP', 'SCIE_MD_DESKTOP_SMOKE_APP') ?? null,
    timeoutMs: Number(readEnv('SCIEMD_DESKTOP_SMOKE_TIMEOUT_MS', 'SCIE_MD_DESKTOP_SMOKE_TIMEOUT_MS') ?? 30_000),
    required: readBooleanEnv('SCIEMD_DESKTOP_SMOKE_REQUIRED', 'SCIE_MD_DESKTOP_SMOKE_REQUIRED'),
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--required') parsed.required = true;
    else if (arg === '--app') parsed.appPath = args[++index] ?? '';
    else if (arg === '--timeout-ms') parsed.timeoutMs = Number(args[++index] ?? 30_000);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/validate-desktop-smoke.mjs [--app <path>] [--timeout-ms <ms>] [--required]

Launches a packaged Windows ScieMD executable in smoke self-test mode and validates:
- no-file startup native app-data availability
- startup Markdown open/read through native grants
- atomic save
- native recovery snapshot write/read/clear
- native DOCX export fallback
- PDF export when the packaged runtime can reach a supported browser
- structured JSON, JSONL, YAML, TOML, XML, CSV, TSV, and plain-text manual open/read/save plumbing
- structured file launch paths open through the same supported-document startup/open-with path

If no packaged executable is found, the script skips by default. Use --required to make missing prerequisites fail.`);
}

function resolveAppPath(explicitPath) {
  if (explicitPath?.trim()) {
    const candidate = resolve(explicitPath);
    return existsSync(candidate) ? candidate : null;
  }
  for (const candidate of APP_CANDIDATES) {
    const absolute = resolve(candidate);
    if (existsSync(absolute)) return absolute;
  }
  return null;
}

async function runPackagedSelfTest({ appPath, args, appDataRoot, reportPath, scenario, startupPath, exportPath, structuredManifestPath, timeoutMs }) {
  const child = launchApp(appPath, args, appDataRoot, {
    SCIEMD_DESKTOP_SMOKE_SELF_TEST: '1',
    SCIEMD_DESKTOP_SMOKE_REPORT: reportPath,
    SCIEMD_DESKTOP_SMOKE_SCENARIO: scenario,
    ...(startupPath ? { SCIEMD_DESKTOP_SMOKE_STARTUP_PATH: startupPath } : {}),
    ...(exportPath ? { SCIEMD_DESKTOP_SMOKE_EXPORT_PATH: exportPath } : {}),
    ...(structuredManifestPath ? { SCIEMD_DESKTOP_SMOKE_STRUCTURED_MANIFEST: structuredManifestPath } : {}),
  });
  let stderr = '';
  let stdout = '';
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  const exitCode = await waitForExit(child, timeoutMs);
  let report = null;
  if (existsSync(reportPath)) {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
  }
  if (exitCode !== 0 || !report?.ok) {
    const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
    const suffix = output ? `\n\nProcess output:\n${output}` : '';
    throw new Error(`Packaged desktop smoke failed for ${scenario}: ${report?.error ?? `exit code ${exitCode}`}${suffix}`);
  }
  return report;
}

async function writeStructuredSmokeFixtures(workspacePath) {
  const fixtures = createStructuredSmokeFixtures(workspacePath);
  for (const fixture of fixtures) {
    await writeFile(fixture.path, fixture.initialContent, 'utf8');
  }
  return fixtures;
}

function createStructuredSmokeFixtures(workspacePath) {
  const jsonBefore = {
    smoke: 'desktop-structured-before',
    title: 'Packaged desktop structured JSON smoke',
    samples: [
      { id: 'S-001', value: 12.5, valid: true },
      { id: 'S-002', value: 13.75, valid: false },
    ],
  };
  const jsonAfter = {
    smoke: 'desktop-structured-after',
    title: 'Packaged desktop structured JSON smoke',
    saved: true,
    samples: jsonBefore.samples,
  };

  return [
    fixture({
      workspacePath,
      format: 'json',
      fileName: 'desktop-structured-smoke.json',
      initialContent: `${JSON.stringify(jsonBefore, null, 2)}\n`,
      updatedContent: `${JSON.stringify(jsonAfter, null, 2)}\n`,
    }),
    fixture({
      workspacePath,
      format: 'jsonl',
      fileName: 'desktop-structured-smoke.jsonl',
      initialContent: [
        '{"smoke":"desktop-structured-before","record":1,"value":12.5}',
        '{"smoke":"desktop-structured-before","record":2,"value":13.75}',
        '',
      ].join('\n'),
      updatedContent: [
        '{"smoke":"desktop-structured-after","record":1,"value":12.5}',
        '{"smoke":"desktop-structured-after","record":2,"value":13.75}',
        '',
      ].join('\n'),
    }),
    fixture({
      workspacePath,
      format: 'yaml',
      fileName: 'desktop-structured-smoke.yaml',
      initialContent: [
        'smoke: desktop-structured-before',
        'title: Packaged desktop structured YAML smoke',
        'samples:',
        '  - id: S-001',
        '    value: 12.5',
        '  - id: S-002',
        '    value: 13.75',
        '',
      ].join('\n'),
      updatedContent: [
        'smoke: desktop-structured-after',
        'title: Packaged desktop structured YAML smoke',
        'saved: true',
        'samples:',
        '  - id: S-001',
        '    value: 12.5',
        '  - id: S-002',
        '    value: 13.75',
        '',
      ].join('\n'),
    }),
    fixture({
      workspacePath,
      format: 'toml',
      fileName: 'desktop-structured-smoke.toml',
      initialContent: [
        'smoke = "desktop-structured-before"',
        'title = "Packaged desktop structured TOML smoke"',
        '',
        '[[samples]]',
        'id = "S-001"',
        'value = 12.5',
        '',
        '[[samples]]',
        'id = "S-002"',
        'value = 13.75',
        '',
      ].join('\n'),
      updatedContent: [
        'smoke = "desktop-structured-after"',
        'title = "Packaged desktop structured TOML smoke"',
        'saved = true',
        '',
        '[[samples]]',
        'id = "S-001"',
        'value = 12.5',
        '',
        '[[samples]]',
        'id = "S-002"',
        'value = 13.75',
        '',
      ].join('\n'),
    }),
    fixture({
      workspacePath,
      format: 'xml',
      fileName: 'desktop-structured-smoke.xml',
      initialContent: [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<study smoke="desktop-structured-before">',
        '  <title>Packaged desktop structured XML smoke</title>',
        '  <sample id="S-001" value="12.5" />',
        '  <sample id="S-002" value="13.75" />',
        '</study>',
        '',
      ].join('\n'),
      updatedContent: [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<study smoke="desktop-structured-after" saved="true">',
        '  <title>Packaged desktop structured XML smoke</title>',
        '  <sample id="S-001" value="12.5" />',
        '  <sample id="S-002" value="13.75" />',
        '</study>',
        '',
      ].join('\n'),
    }),
    fixture({
      workspacePath,
      format: 'csv',
      fileName: 'desktop-structured-smoke.csv',
      initialContent: [
        'smoke,id,value',
        'desktop-structured-before,S-001,12.5',
        'desktop-structured-before,S-002,13.75',
        '',
      ].join('\n'),
      updatedContent: [
        'smoke,id,value,saved',
        'desktop-structured-after,S-001,12.5,true',
        'desktop-structured-after,S-002,13.75,true',
        '',
      ].join('\n'),
    }),
    fixture({
      workspacePath,
      format: 'tsv',
      fileName: 'desktop-structured-smoke.tsv',
      initialContent: [
        'smoke\tid\tvalue',
        'desktop-structured-before\tS-001\t12.5',
        'desktop-structured-before\tS-002\t13.75',
        '',
      ].join('\n'),
      updatedContent: [
        'smoke\tid\tvalue\tsaved',
        'desktop-structured-after\tS-001\t12.5\ttrue',
        'desktop-structured-after\tS-002\t13.75\ttrue',
        '',
      ].join('\n'),
    }),
    fixture({
      workspacePath,
      format: 'plainText',
      fileName: 'desktop-structured-smoke.txt',
      initialContent: [
        'desktop-structured-before',
        'Packaged desktop plain text smoke file.',
        'Line two confirms non-Markdown text still uses safe manual read/write plumbing.',
        '',
      ].join('\n'),
      updatedContent: [
        'desktop-structured-after',
        'Packaged desktop plain text smoke file.',
        'Line two confirms non-Markdown text still uses safe manual read/write plumbing.',
        '',
      ].join('\n'),
    }),
  ];
}

function fixture({ workspacePath, format, fileName, initialContent, updatedContent }) {
  return {
    format,
    path: join(workspacePath, fileName),
    initialContent,
    updatedContent,
    expectedContains: 'desktop-structured-before',
    updatedContains: 'desktop-structured-after',
  };
}

function launchApp(appPath, args, appDataRoot, smokeEnv) {
  const env = {
    ...process.env,
    SCIEMD_DESKTOP_SMOKE_DISABLE_SINGLE_INSTANCE: '1',
    SCIEMD_APP_DATA_DIR_OVERRIDE: join(appDataRoot, 'ScieMD'),
    ...smokeEnv,
    APPDATA: join(appDataRoot, 'Roaming'),
    LOCALAPPDATA: join(appDataRoot, 'Local'),
    XDG_DATA_HOME: join(appDataRoot, 'xdg-data'),
  };
  return spawn(appPath, args, {
    cwd: resolve('.'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      stopProcessTree(child);
      rejectExit(new Error(`${basename(child.spawnfile)} did not finish desktop smoke self-test within ${timeoutMs}ms.`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      rejectExit(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolveExit(code ?? 1);
    });
  });
}

function stopProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
}

function skip(message) {
  const payload = { ok: true, skipped: true, reason: message };
  console.log(JSON.stringify(payload, null, 2));
  process.exit(options.required ? 1 : 0);
}

function readEnv(name, legacyName) {
  return process.env[name] ?? (legacyName ? process.env[legacyName] : undefined);
}

function readBooleanEnv(name, legacyName) {
  const value = readEnv(name, legacyName);
  return value === '1' || value?.toLowerCase() === 'true';
}
