import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

if (process.argv.includes('--self-test')) {
  runSelfTest();
} else {
  const failures = collectReleaseIdentityFailures(process.cwd());
  if (failures.length > 0) {
    console.error('[validate:version-changelog] Release identity guard failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  const rootPackage = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
  console.log(`[validate:version-changelog] Release identity is aligned at ${rootPackage.version}.`);
}

function collectReleaseIdentityFailures(root) {
  const failures = [];
  const rootPackage = readJson(root, 'package.json', failures);
  const version = rootPackage.version;
  if (!version) {
    failures.push('package.json is missing a version.');
  }

  expectJsonVersion(root, failures, 'package-lock.json', version, [
    { label: 'version', read: (json) => json.version },
    { label: 'packages..version', read: (json) => json.packages?.['']?.version },
    { label: 'packages.packages/core.version', read: (json) => json.packages?.['packages/core']?.version },
  ]);
  expectJsonVersion(root, failures, 'packages/core/package.json', version, [
    { label: 'version', read: (json) => json.version },
  ]);
  expectJsonVersion(root, failures, 'src-tauri/tauri.conf.json', version, [
    { label: 'version', read: (json) => json.version },
  ]);
  expectCargoVersion(root, failures, 'src-tauri/Cargo.toml', version);
  expectJsonVersion(root, failures, 'scie-md-vscode-extension/package.json', version, [
    { label: 'version', read: (json) => json.version },
  ]);
  expectJsonVersion(root, failures, 'scie-md-vscode-extension/package-lock.json', version, [
    { label: 'version', read: (json) => json.version },
    { label: 'packages..version', read: (json) => json.packages?.['']?.version },
    { label: 'packages../packages/core.version', read: (json) => json.packages?.['../packages/core']?.version },
  ]);
  expectVersionHeading(root, failures, 'CHANGELOG.md', version);
  expectTextContains(root, failures, 'RELEASE_READINESS_PLAN.md', `ScieMD \`${version}\``);
  expectTextContains(root, failures, 'README.md', `sciemd-vscode-${version}.vsix`);
  return failures;
}

function readJson(root, relativePath, failures) {
  try {
    return JSON.parse(readFileSync(resolve(root, relativePath), 'utf8'));
  } catch (error) {
    failures.push(`${relativePath} could not be read as JSON: ${error.message}`);
    return {};
  }
}

function expectJsonVersion(root, failures, relativePath, expectedVersion, checks) {
  const json = readJson(root, relativePath, failures);
  for (const check of checks) {
    const actual = check.read(json);
    if (actual !== expectedVersion) {
      failures.push(`${relativePath} ${check.label} is ${String(actual)}, expected ${expectedVersion}.`);
    }
  }
}

function expectCargoVersion(root, failures, relativePath, expectedVersion) {
  const text = readText(root, failures, relativePath);
  const actual = readTomlPackageVersion(text);
  if (actual !== expectedVersion) {
    failures.push(`${relativePath} package.version is ${String(actual)}, expected ${expectedVersion}.`);
  }
}

function readTomlPackageVersion(text) {
  let inPackageSection = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) {
      inPackageSection = /^\s*\[package\]\s*$/.test(line);
      continue;
    }
    if (!inPackageSection) continue;
    const match = line.match(/^\s*version\s*=\s*"([^"]+)"/);
    if (match) return match[1];
  }
  return undefined;
}

function expectVersionHeading(root, failures, relativePath, expectedVersion) {
  const text = readText(root, failures, relativePath);
  const escaped = expectedVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`^##\\s+\\[?${escaped}\\]?\\b`, 'm').test(text)) {
    failures.push(`${relativePath} is missing a ${expectedVersion} heading.`);
  }
}

function expectTextContains(root, failures, relativePath, expectedText) {
  const text = readText(root, failures, relativePath);
  if (!text.includes(expectedText)) {
    failures.push(`${relativePath} does not mention ${expectedText}.`);
  }
}

function readText(root, failures, relativePath) {
  try {
    return readFileSync(join(root, relativePath), 'utf8');
  } catch (error) {
    failures.push(`${relativePath} could not be read: ${error.message}`);
    return '';
  }
}

function runSelfTest() {
  const tempRoot = mkdtempSync(join(tmpdir(), 'sciemd-version-guard-'));
  try {
    writeFixture(tempRoot);
    const alignedFailures = collectReleaseIdentityFailures(tempRoot);
    if (alignedFailures.length > 0) {
      throw new Error(`aligned fixture failed:\n${alignedFailures.join('\n')}`);
    }

    assertFixtureFailure(tempRoot, 'root release drift', () => {
      writeJson(tempRoot, 'package.json', { name: 'sciemd', version: '1.0.13' });
    }, 'CHANGELOG.md is missing a 1.0.13 heading.');
    assertFixtureFailure(tempRoot, 'Tauri drift', () => {
      writeJson(tempRoot, 'src-tauri/tauri.conf.json', { version: '1.0.13' });
    }, 'src-tauri/tauri.conf.json version is 1.0.13, expected 1.0.12.');
    assertFixtureFailure(tempRoot, 'Cargo drift', () => {
      writeText(tempRoot, 'src-tauri/Cargo.toml', '[package]\nname = "sciemd"\nversion = "1.0.13"\n');
    }, 'src-tauri/Cargo.toml package.version is 1.0.13, expected 1.0.12.');
    assertFixtureFailure(tempRoot, 'extension package drift', () => {
      writeJson(tempRoot, 'scie-md-vscode-extension/package.json', { name: 'sciemd-vscode', version: '1.0.13' });
    }, 'scie-md-vscode-extension/package.json version is 1.0.13, expected 1.0.12.');
    assertFixtureFailure(tempRoot, 'core package drift', () => {
      writeJson(tempRoot, 'packages/core/package.json', { name: '@sciemd/core', version: '1.0.13' });
    }, 'packages/core/package.json version is 1.0.13, expected 1.0.12.');
    assertFixtureFailure(tempRoot, 'root lock core drift', () => {
      const lock = fixturePackageLock('1.0.12');
      lock.packages['packages/core'].version = '1.0.13';
      writeJson(tempRoot, 'package-lock.json', lock);
    }, 'package-lock.json packages.packages/core.version is 1.0.13, expected 1.0.12.');
    assertFixtureFailure(tempRoot, 'extension lock core drift', () => {
      const lock = fixtureExtensionPackageLock('1.0.12');
      lock.packages['../packages/core'].version = '1.0.13';
      writeJson(tempRoot, 'scie-md-vscode-extension/package-lock.json', lock);
    }, 'scie-md-vscode-extension/package-lock.json packages../packages/core.version is 1.0.13, expected 1.0.12.');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log('[validate:version-changelog:self-test] Fixture checks passed.');
}

function assertFixtureFailure(root, label, mutate, expectedFailure) {
  writeFixture(root);
  mutate();
  const failures = collectReleaseIdentityFailures(root);
  if (!failures.some((failure) => failure.includes(expectedFailure))) {
    throw new Error(`${label} was not caught. Expected "${expectedFailure}", got:\n${failures.join('\n')}`);
  }
}

function writeFixture(root, version = '1.0.12') {
  writeJson(root, 'package.json', { name: 'sciemd', version });
  writeJson(root, 'package-lock.json', fixturePackageLock(version));
  writeJson(root, 'packages/core/package.json', { name: '@sciemd/core', version });
  writeJson(root, 'src-tauri/tauri.conf.json', { version });
  writeText(root, 'src-tauri/Cargo.toml', `[package]\nname = "sciemd"\nversion = "${version}"\n`);
  writeJson(root, 'scie-md-vscode-extension/package.json', { name: 'sciemd-vscode', version });
  writeJson(root, 'scie-md-vscode-extension/package-lock.json', fixtureExtensionPackageLock(version));
  writeText(root, 'CHANGELOG.md', `# Changelog\n\n## ${version}\n`);
  writeText(root, 'RELEASE_READINESS_PLAN.md', `Release candidate: ScieMD \`${version}\`\n`);
  writeText(root, 'README.md', `Install sciemd-vscode-${version}.vsix\n`);
}

function fixturePackageLock(version) {
  return {
    name: 'sciemd',
    version,
    packages: {
      '': { name: 'sciemd', version },
      'packages/core': { name: '@sciemd/core', version },
    },
  };
}

function fixtureExtensionPackageLock(version) {
  return {
    name: 'sciemd-vscode',
    version,
    packages: {
      '': { name: 'sciemd-vscode', version },
      '../packages/core': { name: '@sciemd/core', version },
    },
  };
}

function writeJson(root, relativePath, value) {
  writeText(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(root, relativePath, value) {
  const file = resolve(root, relativePath);
  mkdirSync(resolve(file, '..'), { recursive: true });
  writeFileSync(file, value, 'utf8');
}
