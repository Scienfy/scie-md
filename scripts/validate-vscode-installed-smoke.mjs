import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
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

  console.log(JSON.stringify({
    ok: true,
    codeCommand,
    codeVersion: codeVersion.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    vsix: vsixPath,
    extensionId: expectedExtensionId,
    version: extensionPackage.version,
    installedExtensionDir,
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
    timeoutMs: Number(process.env.SCIEMD_VSCODE_SMOKE_TIMEOUT_MS ?? 60_000),
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
    else if (arg === '--timeout-ms') parsed.timeoutMs = Number(args[++index] ?? 60_000);
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
