import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const releaseFileExtensions = new Set(['.msi', '.exe', '.msix', '.dmg', '.app', '.deb', '.rpm', '.vsix']);

export function writeReleaseChecksumManifest(root = process.cwd(), options = {}) {
  const artifactDir = resolve(root, 'artifacts');
  const installerDir = join(artifactDir, 'installers');
  const checksumManifestPath = join(artifactDir, 'SHA256SUMS.txt');
  const releaseFiles = [];

  if (Array.isArray(options.releaseFiles)) {
    for (const filePath of options.releaseFiles) {
      releaseFiles.push(resolve(root, filePath));
    }
  } else {
    if (existsSync(installerDir)) {
      for (const entry of readdirSync(installerDir, { withFileTypes: true })) {
        const filePath = join(installerDir, entry.name);
        if (entry.isFile() && releaseFileExtensions.has(extname(entry.name).toLowerCase())) {
          releaseFiles.push(filePath);
        }
      }
    }
  }

  const lines = [...new Set(releaseFiles)]
    .filter((filePath) => existsSync(filePath) && statSync(filePath).isFile())
    .sort((left, right) => left.localeCompare(right))
    .map((filePath) => {
      const digest = createHash('sha256').update(readFileSync(filePath)).digest('hex');
      const portablePath = relative(artifactDir, filePath).replace(/\\/g, '/');
      return `${digest}  ${portablePath}`;
    });

  writeFileSync(checksumManifestPath, `${lines.join('\n')}\n`);
  console.log(`[release:checksum] ${checksumManifestPath} (${lines.length} file${lines.length === 1 ? '' : 's'})`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeReleaseChecksumManifest();
}
