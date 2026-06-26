import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { writeReleaseChecksumManifest } from './release-checksums.mjs';

const root = process.cwd();
const artifactInstallerDir = resolve(root, 'artifacts', 'installers');
const extensionDir = resolve(root, 'scie-md-vscode-extension');
const extensionPackage = JSON.parse(readFileSync(join(extensionDir, 'package.json'), 'utf8'));
const packageVersion = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const vsixName = `${extensionPackage.name}-${extensionPackage.version}.vsix`;
const source = join(extensionDir, vsixName);
const target = join(artifactInstallerDir, vsixName);

if (!existsSync(source)) {
  console.error(`[stage:vscode] Missing VS Code extension package: ${source}`);
  console.error('[stage:vscode] Run npm run package:vscode first.');
  process.exit(1);
}

mkdirSync(artifactInstallerDir, { recursive: true });
copyFileSync(source, target);

const sizeMb = (statSync(target).size / 1024 / 1024).toFixed(1);
console.log(`[stage:vscode] ${target} (${sizeMb} MB)`);

writeReleaseChecksumManifest(root, { releaseFiles: currentReleaseFiles() });

function currentReleaseFiles() {
  const files = [target];
  if (!existsSync(artifactInstallerDir)) return files;
  const windowsBundleExtensions = new Set(['.msi', '.exe', '.msix']);
  const bundlePrefix = `ScieMD_${packageVersion}_`;
  for (const entry of readdirSync(artifactInstallerDir, { withFileTypes: true })) {
    const filePath = join(artifactInstallerDir, entry.name);
    if (
      entry.isFile()
      && entry.name.startsWith(bundlePrefix)
      && windowsBundleExtensions.has(extname(entry.name).toLowerCase())
    ) {
      files.push(filePath);
    }
  }
  return files;
}
