import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import assert from 'node:assert/strict';

const requiredIgnoredPaths = [
  'node_modules/',
  'dist/',
  'coverage/',
  '.vite/',
  'src-tauri/target/',
  'src-tauri/gen/',
  '.scienfy-backups/',
  'artifacts/',
  'output/',
  'tmp/',
  'nul',
  'desktop-build-smoke/',
  '.runtime-test/',
  '*.exe',
  '*.msi',
  '*.msix',
  '*.app',
  '*.dmg',
  '*.deb',
  '*.rpm',
  '*.vsix',
  '*.tgz',
  '*.log',
];

const requiredDocSnippets = [
  'Generated Outputs And Ignored Paths',
  'dist/',
  'src-tauri/target/',
  'artifacts/',
  'scie-md-vscode-extension/*.vsix',
  'GitHub Releases',
];

const generatedDirectoryNames = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.vite',
  'target',
  'gen',
  '.scienfy-backups',
  'artifacts',
  'output',
  'tmp',
  'desktop-build-smoke',
  '.runtime-test',
]);

const generatedDirectoryPaths = [
  /^src-tauri\/target(?:\/|$)/,
  /^src-tauri\/gen(?:\/|$)/,
  /^scie-md-vscode-extension\/dist(?:\/|$)/,
  /^artifacts(?:\/|$)/,
  /^output(?:\/|$)/,
  /^tmp(?:\/|$)/,
];

const generatedFileExtensions = new Set([
  '.exe',
  '.msi',
  '.msix',
  '.app',
  '.dmg',
  '.deb',
  '.rpm',
  '.vsix',
  '.tgz',
  '.log',
]);

const windowsReservedNames = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_value, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_value, index) => `lpt${index + 1}`),
]);

if (process.argv.includes('--self-test')) {
  runSelfTests();
  process.exit(0);
}

const failures = [];
validateIgnoredPaths(failures);
validateReleasePlanDocs(failures);
validateWorkingTree(failures);

if (failures.length > 0) {
  console.error('[validate:generated-outputs] Generated-output policy guard failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('[validate:generated-outputs] Generated-output policy, docs, and working tree are clean.');

function validateIgnoredPaths(outputFailures) {
  const gitignore = readText('.gitignore', outputFailures);
  const ignored = new Set(
    gitignore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')),
  );

  for (const pattern of requiredIgnoredPaths) {
    if (!ignored.has(pattern)) {
      outputFailures.push(`.gitignore is missing ${pattern}.`);
    }
  }
}

function validateReleasePlanDocs(outputFailures) {
  const releasePlan = readText('RELEASE_READINESS_PLAN.md', outputFailures);
  for (const snippet of requiredDocSnippets) {
    if (!releasePlan.includes(snippet)) {
      outputFailures.push(`RELEASE_READINESS_PLAN.md is missing ${snippet}.`);
    }
  }
}

function validateWorkingTree(outputFailures) {
  const status = readGitStatus(outputFailures);
  if (!status) return;
  const entries = parsePorcelainStatus(status.stdout);
  const violations = generatedOutputViolations(entries);
  for (const violation of violations) {
    outputFailures.push(`${violation.path} is ${violation.reason} (${violation.status.trim() || 'changed'}).`);
  }

  const ordinaryChanges = entries.length - violations.length;
  if (ordinaryChanges > 0) {
    console.log(`[validate:generated-outputs] ${ordinaryChanges} ordinary source/doc working-tree change${ordinaryChanges === 1 ? '' : 's'} ignored by this guard.`);
  }
}

function readGitStatus(outputFailures) {
  const gitCommand = process.platform === 'win32' ? 'git.exe' : 'git';
  const result = spawnSync(gitCommand, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.error) {
    outputFailures.push(`Could not run git status: ${result.error.message}`);
    return null;
  }
  if (result.status !== 0) {
    outputFailures.push(`git status failed: ${result.stderr || 'unknown error'}`);
    return null;
  }
  return result;
}

export function parsePorcelainStatus(output) {
  const tokens = output.split('\0').filter(Boolean);
  const entries = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.length < 4) continue;
    const status = token.slice(0, 2);
    const firstPath = token.slice(3);
    const paths = [firstPath];
    if (status.includes('R') || status.includes('C')) {
      index += 1;
      if (tokens[index]) paths.push(tokens[index]);
    }
    for (const path of paths) entries.push({ status, path: normalizePath(path) });
  }
  return entries;
}

export function generatedOutputViolations(entries) {
  const violations = [];
  for (const entry of entries) {
    const reason = generatedOutputReason(entry.path);
    if (reason) violations.push({ ...entry, reason });
  }
  return violations;
}

export function generatedOutputReason(path) {
  const normalized = normalizePath(path);
  if (!normalized) return null;
  const reserved = reservedWindowsName(normalized);
  if (reserved) return `Windows reserved path name "${reserved}"`;

  for (const pattern of generatedDirectoryPaths) {
    if (pattern.test(normalized)) return 'generated output directory';
  }

  const segments = normalized.split('/');
  for (const segment of segments.slice(0, -1)) {
    if (generatedDirectoryNames.has(segment)) return `generated directory "${segment}"`;
  }

  const fileName = basename(normalized);
  const lowerFileName = fileName.toLowerCase();
  const extension = lowerFileName.includes('.') ? lowerFileName.slice(lowerFileName.lastIndexOf('.')) : '';
  if (generatedFileExtensions.has(extension)) return `generated package/artifact extension "${extension}"`;
  if (/^sha256sums(?:[-_.].*)?\.txt$/i.test(fileName)) return 'release checksum manifest';
  return null;
}

function reservedWindowsName(path) {
  const fileName = basename(path).toLowerCase();
  const stem = fileName.split('.')[0];
  return windowsReservedNames.has(stem) ? stem : null;
}

function normalizePath(path) {
  return path.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+/g, '/').trim();
}

function readText(relativePath, outputFailures) {
  try {
    return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
  } catch (error) {
    outputFailures.push(`${relativePath} could not be read: ${error.message}`);
    return '';
  }
}

function runSelfTests() {
  assert.deepEqual(generatedOutputViolations([
    { status: ' M', path: 'src/app/App.tsx' },
    { status: '??', path: 'docs/refactor/plan.md' },
  ]), []);

  assert.deepEqual(
    generatedOutputViolations([
      { status: '??', path: 'dist/assets/app.js' },
      { status: 'A ', path: 'artifacts/installers/ScieMD_1.0.12_x64-setup.exe' },
      { status: '??', path: 'scie-md-vscode-extension/sciemd-vscode-1.0.12.vsix' },
      { status: '??', path: 'src-tauri/target/release/sciemd.exe' },
      { status: '??', path: 'SHA256SUMS.txt' },
    ]).map((violation) => violation.path),
    [
      'dist/assets/app.js',
      'artifacts/installers/ScieMD_1.0.12_x64-setup.exe',
      'scie-md-vscode-extension/sciemd-vscode-1.0.12.vsix',
      'src-tauri/target/release/sciemd.exe',
      'SHA256SUMS.txt',
    ],
  );

  assert.deepEqual(
    generatedOutputViolations([
      { status: '??', path: 'nul' },
      { status: '??', path: 'docs/con.txt' },
      { status: '??', path: 'tmp/report.md' },
    ]).map((violation) => violation.reason),
    [
      'Windows reserved path name "nul"',
      'Windows reserved path name "con"',
      'generated output directory',
    ],
  );

  const parsed = parsePorcelainStatus(` M src/app/App.tsx\0R  docs/new.md\0docs/old.md\0?? dist/app.js\0`);
  assert.deepEqual(parsed, [
    { status: ' M', path: 'src/app/App.tsx' },
    { status: 'R ', path: 'docs/new.md' },
    { status: 'R ', path: 'docs/old.md' },
    { status: '??', path: 'dist/app.js' },
  ]);

  console.log('[validate:generated-outputs] Self-tests passed.');
}
