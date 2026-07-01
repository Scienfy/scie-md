import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const root = process.cwd();
const extensionRoot = resolve(root, 'scie-md-vscode-extension');
const extensionPackage = readJson(join(extensionRoot, 'package.json'));
const options = parseArgs(process.argv.slice(2));
const expectedExtensionId = `${extensionPackage.publisher}.${extensionPackage.name}`.toLowerCase();
const expectedListing = `${expectedExtensionId}@${extensionPackage.version}`;
const vsixPath = resolve(options.vsixPath ?? join(extensionRoot, `${extensionPackage.name}-${extensionPackage.version}.vsix`));
const codeCommand = options.codePath ?? process.env.SCIEMD_VSCODE_CLI ?? (process.platform === 'win32' ? 'code.cmd' : 'code');

if (options.help) {
  printHelp();
  process.exit(0);
}

if (!existsSync(vsixPath)) {
  skip(`Missing VSIX package: ${vsixPath}. Run "npm run package:vscode" first, or pass --vsix <path>.`);
}

const codeVersion = runCode(['--version'], { allowFailure: true });
if (codeVersion.status !== 0) {
  skip(`Could not run VS Code CLI "${codeCommand}": ${formatCommandFailure(codeVersion)}`);
}

const smokeRoot = mkdtempSync(join(tmpdir(), 'sciemd-vscode-installed-smoke-'));
const userDataDir = join(smokeRoot, 'user-data');
const extensionsDir = join(smokeRoot, 'extensions');

try {
  runCode([
    '--user-data-dir',
    userDataDir,
    '--extensions-dir',
    extensionsDir,
    '--install-extension',
    vsixPath,
    '--force',
  ]);

  const listedExtensions = runCode([
    '--user-data-dir',
    userDataDir,
    '--extensions-dir',
    extensionsDir,
    '--list-extensions',
    '--show-versions',
  ]).stdout.split(/\r?\n/).map((line) => line.trim().toLowerCase()).filter(Boolean);

  if (!listedExtensions.includes(expectedListing)) {
    throw new Error(`VS Code did not list ${expectedListing}. Listed extensions: ${listedExtensions.join(', ') || '(none)'}`);
  }

  const installedExtensionDir = findInstalledExtensionDir(extensionsDir, expectedExtensionId, extensionPackage.version);
  if (!installedExtensionDir) {
    throw new Error(`VS Code installed ${expectedListing}, but no installed extension directory was found under ${extensionsDir}.`);
  }

  assertInstalledExtension(installedExtensionDir);
  const structuredCommandSmoke = runStructuredCommandSmoke({
    userDataDir,
    extensionsDir,
  });

  console.log(JSON.stringify({
    ok: true,
    codeCommand,
    codeVersion: codeVersion.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    vsix: vsixPath,
    extensionId: expectedExtensionId,
    version: extensionPackage.version,
    installedExtensionDir,
    structuredCommandSmoke,
    smokeRoot: options.keep ? smokeRoot : undefined,
  }, null, 2));
} finally {
  if (!options.keep) rmSync(smokeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}

function assertInstalledExtension(installedExtensionDir) {
  const installedManifest = readJson(join(installedExtensionDir, 'package.json'));
  if (`${installedManifest.publisher}.${installedManifest.name}`.toLowerCase() !== expectedExtensionId) {
    throw new Error(`Installed manifest identity is ${installedManifest.publisher}.${installedManifest.name}, expected ${expectedExtensionId}.`);
  }
  if (installedManifest.version !== extensionPackage.version) {
    throw new Error(`Installed manifest version is ${installedManifest.version}, expected ${extensionPackage.version}.`);
  }
  if (installedManifest.main !== './dist/extension/extension.js') {
    throw new Error(`Installed manifest main is ${installedManifest.main}, expected ./dist/extension/extension.js.`);
  }

  const requiredFiles = [
    'dist/extension/extension.js',
    'dist/webview/assets/main.js',
    'dist/webview/assets/main.css',
  ];
  for (const relativePath of requiredFiles) {
    const filePath = join(installedExtensionDir, relativePath);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      throw new Error(`Installed extension is missing ${relativePath}.`);
    }
  }
}

function findInstalledExtensionDir(extensionsDir, extensionId, version) {
  if (!existsSync(extensionsDir)) return null;
  const expectedPrefix = `${extensionId}-${version}`.toLowerCase();
  for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.toLowerCase().startsWith(expectedPrefix)) {
      return join(extensionsDir, entry.name);
    }
  }
  const fallbackPrefix = `${extensionId}-`.toLowerCase();
  for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.toLowerCase().startsWith(fallbackPrefix)) {
      return join(extensionsDir, entry.name);
    }
  }
  return null;
}

function runStructuredCommandSmoke({ userDataDir, extensionsDir }) {
  const workspaceDir = join(smokeRoot, 'structured-command-workspace');
  const smokeExtensionDir = join(smokeRoot, 'structured-smoke-driver');
  const reportPath = join(smokeRoot, 'structured-command-report.json');
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(smokeExtensionDir, { recursive: true });
  const files = writeStructuredCommandFixtures(workspaceDir);
  writeStructuredSmokeDriver(smokeExtensionDir, {
    expectedExtensionId,
    reportPath,
    files,
  });

  runCode([
    '--user-data-dir',
    userDataDir,
    '--extensions-dir',
    extensionsDir,
    '--disable-workspace-trust',
    '--new-window',
    '--wait',
    '--extensionDevelopmentPath',
    smokeExtensionDir,
    workspaceDir,
  ]);

  if (!existsSync(reportPath)) {
    throw new Error('VS Code structured command smoke did not write a report.');
  }
  const report = readJson(reportPath);
  if (!report.ok) {
    throw new Error(`VS Code structured command smoke failed: ${report.error ?? 'unknown error'}`);
  }
  if (!Array.isArray(report.previewedFormats) || report.previewedFormats.length !== files.length) {
    throw new Error(`VS Code structured command smoke previewed ${report.previewedFormats?.length ?? 0} files, expected ${files.length}.`);
  }
  if (report.defaultJsonActionsEnabled !== false || report.defaultPreviewAssociationsEnabled !== false) {
    throw new Error('VS Code structured command smoke found default-off structured settings enabled.');
  }
  if (report.jsonEditChangedText !== false) {
    throw new Error('VS Code structured command smoke found JSON edit text changed while default-off.');
  }
  return report;
}

function writeStructuredCommandFixtures(workspaceDir) {
  const fixtures = [
    {
      format: 'json',
      fileName: 'structured-preview-smoke.json',
      content: `${JSON.stringify({
        smoke: 'vscode-structured-preview',
        samples: [{ id: 'S-001', value: 12.5 }, { id: 'S-002', value: 13.75 }],
      }, null, 2)}\n`,
    },
    {
      format: 'jsonl',
      fileName: 'structured-preview-smoke.jsonl',
      content: '{"smoke":"vscode-structured-preview","record":1,"value":12.5}\n{"smoke":"vscode-structured-preview","record":2,"value":13.75}\n',
    },
    {
      format: 'yaml',
      fileName: 'structured-preview-smoke.yaml',
      content: 'smoke: vscode-structured-preview\nsamples:\n  - id: S-001\n    value: 12.5\n  - id: S-002\n    value: 13.75\n',
    },
    {
      format: 'toml',
      fileName: 'structured-preview-smoke.toml',
      content: 'smoke = "vscode-structured-preview"\n\n[[samples]]\nid = "S-001"\nvalue = 12.5\n\n[[samples]]\nid = "S-002"\nvalue = 13.75\n',
    },
    {
      format: 'xml',
      fileName: 'structured-preview-smoke.xml',
      content: '<?xml version="1.0" encoding="UTF-8"?>\n<study smoke="vscode-structured-preview">\n  <sample id="S-001" value="12.5" />\n  <sample id="S-002" value="13.75" />\n</study>\n',
    },
  ];
  for (const fixture of fixtures) {
    const filePath = join(workspaceDir, fixture.fileName);
    writeFileSync(filePath, fixture.content, 'utf8');
    fixture.path = filePath;
  }
  return fixtures.map(({ format, fileName, path }) => ({ format, fileName, path }));
}

function writeStructuredSmokeDriver(directory, { expectedExtensionId, reportPath, files }) {
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    name: 'sciemd-installed-smoke-driver',
    displayName: 'ScieMD Installed Smoke Driver',
    version: '0.0.0',
    publisher: 'scienfy-smoke',
    engines: { vscode: '^1.90.0' },
    activationEvents: ['*'],
    main: './extension.js',
  }, null, 2), 'utf8');

  writeFileSync(join(directory, 'extension.js'), `
const fs = require('fs');
const vscode = require('vscode');

const expectedExtensionId = ${JSON.stringify(expectedExtensionId)};
const reportPath = ${JSON.stringify(reportPath)};
const files = ${JSON.stringify(files)};

async function activate() {
  const report = {
    ok: false,
    previewedFormats: [],
    defaultJsonActionsEnabled: null,
    defaultPreviewAssociationsEnabled: null,
    jsonEditChangedText: null,
    error: null,
  };

  try {
    const extension = vscode.extensions.getExtension(expectedExtensionId);
    if (!extension) throw new Error('Installed ScieMD extension was not found: ' + expectedExtensionId);
    await extension.activate();

    const config = vscode.workspace.getConfiguration('scieMd.structured');
    report.defaultJsonActionsEnabled = config.get('enableJsonActions');
    report.defaultPreviewAssociationsEnabled = config.get('enablePreviewAssociations');
    if (report.defaultJsonActionsEnabled !== false) {
      throw new Error('scieMd.structured.enableJsonActions default is not false.');
    }
    if (report.defaultPreviewAssociationsEnabled !== false) {
      throw new Error('scieMd.structured.enablePreviewAssociations default is not false.');
    }

    for (const file of files) {
      const uri = vscode.Uri.file(file.path);
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, { preview: false });
      await vscode.commands.executeCommand('scieMd.openStructuredPreview', uri);
      report.previewedFormats.push(file.format);
    }

    const jsonFile = files.find((file) => file.format === 'json');
    if (!jsonFile) throw new Error('JSON smoke fixture is missing.');
    const jsonUri = vscode.Uri.file(jsonFile.path);
    const jsonDocument = await vscode.workspace.openTextDocument(jsonUri);
    const before = jsonDocument.getText();
    await vscode.env.clipboard.writeText('{"smoke":"default-off-should-not-apply"}\\n');
    await vscode.commands.executeCommand('scieMd.applyStructuredClipboardToJson', jsonUri);
    report.jsonEditChangedText = jsonDocument.getText() !== before;
    if (report.jsonEditChangedText) {
      throw new Error('JSON edit command changed document text while default-off.');
    }

    report.ok = true;
  } catch (error) {
    report.error = error && (error.stack || error.message) ? String(error.stack || error.message) : String(error);
  } finally {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    setTimeout(() => {
      void vscode.commands.executeCommand('workbench.action.closeWindow');
    }, 250);
  }
}

exports.activate = activate;
`, 'utf8');
}

function runCode(args, optionsForRun = {}) {
  const result = spawnSync(codeCommand, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    shell: process.platform === 'win32',
    timeout: options.timeoutMs,
    windowsHide: true,
  });
  if (optionsForRun.allowFailure) return result;
  if (result.error || result.status !== 0) {
    throw new Error(`VS Code CLI command failed: ${codeCommand} ${args.join(' ')}\n${formatCommandFailure(result)}`);
  }
  return result;
}

function parseArgs(args) {
  const parsed = {
    codePath: process.env.SCIEMD_VSCODE_CLI ?? null,
    vsixPath: process.env.SCIEMD_VSCODE_SMOKE_VSIX ?? null,
    timeoutMs: Number(process.env.SCIEMD_VSCODE_SMOKE_TIMEOUT_MS ?? 120_000),
    keep: readBooleanEnv('SCIEMD_VSCODE_SMOKE_KEEP_TEMP'),
    required: readBooleanEnv('SCIEMD_VSCODE_SMOKE_REQUIRED'),
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--required') parsed.required = true;
    else if (arg === '--keep') parsed.keep = true;
    else if (arg === '--code') parsed.codePath = args[++index] ?? '';
    else if (arg === '--vsix') parsed.vsixPath = args[++index] ?? '';
    else if (arg === '--timeout-ms') parsed.timeoutMs = Number(args[++index] ?? 120_000);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
    throw new Error(`Expected --timeout-ms to be a positive number, got ${parsed.timeoutMs}.`);
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/validate-vscode-installed-smoke.mjs [--vsix <path>] [--code <path>] [--timeout-ms <ms>] [--required] [--keep]

Installs the built ScieMD VSIX into an isolated VS Code profile and validates:
- VS Code CLI is available
- VSIX installs successfully into a temporary extensions directory
- VS Code lists ${expectedListing}
- installed manifest identity, entrypoint, and bundled extension/webview files exist
- installed ScieMD executes scieMd.openStructuredPreview for JSON, JSONL, YAML, TOML, and XML fixtures
- structured JSON/JSONL edit commands and preview associations remain default-off after installation

If VS Code CLI or the VSIX is missing, the script skips by default. Use --required to make missing prerequisites fail.`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function skip(message) {
  const payload = { ok: true, skipped: true, reason: message };
  console.log(JSON.stringify(payload, null, 2));
  process.exit(options.required ? 1 : 0);
}

function formatCommandFailure(result) {
  return [
    result.error?.message,
    result.stdout?.trim(),
    result.stderr?.trim(),
    result.status !== null && result.status !== undefined ? `exit=${result.status}` : null,
    result.signal ? `signal=${result.signal}` : null,
  ].filter(Boolean).join('\n');
}

function readBooleanEnv(name) {
  const value = process.env[name];
  return value === '1' || value?.toLowerCase() === 'true';
}
