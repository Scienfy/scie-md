import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(extensionRoot, 'package.json');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const packageOnlyDependencies = new Set(['@tauri-apps/api']);
const originalManifestText = readFileSync(manifestPath, 'utf8');
const packagingManifest = sanitizeManifest(JSON.parse(originalManifestText));
const vsixPath = join(extensionRoot, `${packagingManifest.name}-${packagingManifest.version}.vsix`);

if (existsSync(vsixPath)) {
  rmSync(vsixPath);
}

try {
  writeFileSync(manifestPath, `${JSON.stringify(packagingManifest, null, 2)}\n`);
  const result = spawnSync(npmCommand, ['exec', '--', 'vsce', 'package', '--no-dependencies'], {
    cwd: extensionRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    console.error(`[package:vscode] ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
} finally {
  writeFileSync(manifestPath, originalManifestText);
}

function sanitizeManifest(manifest) {
  for (const dependencyField of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const dependencies = manifest[dependencyField];
    if (!dependencies || typeof dependencies !== 'object') continue;
    const sanitized = Object.fromEntries(
      Object.entries(dependencies).filter(([name, range]) => {
        if (packageOnlyDependencies.has(name)) return false;
        return typeof range !== 'string' || !/^(file:|link:|workspace:)/.test(range);
      }),
    );
    if (Object.keys(sanitized).length === 0) {
      delete manifest[dependencyField];
    } else {
      manifest[dependencyField] = sanitized;
    }
  }
  return manifest;
}
