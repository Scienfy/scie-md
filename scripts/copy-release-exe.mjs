import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { writeReleaseChecksumManifest } from './release-checksums.mjs';

const root = process.cwd();
const source = resolve(root, 'src-tauri', 'target', 'release', 'sciemd.exe');
const bundleDir = resolve(root, 'src-tauri', 'target', 'release', 'bundle');
const artifactDir = resolve(root, 'artifacts');
const bundleArtifactDir = join(artifactDir, 'installers');
const bundleArtifactPrefix = 'ScieMD_';
const packageVersion = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const currentBundleArtifactPrefix = `${bundleArtifactPrefix}${packageVersion}_`;
const windowsBundleExtensions = new Set(['.msi', '.exe', '.msix']);
const copySmokeExecutables = readBooleanEnv('SCIEMD_COPY_SMOKE_EXES') || readBooleanEnv('SCIE_MD_COPY_SMOKE_EXES');

if (process.platform !== 'win32') {
  console.error('[copy:exe] This helper copies the Windows release executable and must run on Windows.');
  process.exit(1);
}

if (!existsSync(source)) {
  console.error(`[copy:exe] Missing release executable: ${source}`);
  console.error('[copy:exe] Run npm run build:desktop first.');
  process.exit(1);
}

mkdirSync(artifactDir, { recursive: true });
mkdirSync(bundleArtifactDir, { recursive: true });
for (const entry of readdirSync(artifactDir, { withFileTypes: true })) {
  if (
    entry.isFile() &&
    entry.name.startsWith(bundleArtifactPrefix) &&
    windowsBundleExtensions.has(extname(entry.name).toLowerCase())
  ) {
    rmSync(join(artifactDir, entry.name));
  }
}
for (const entry of readdirSync(bundleArtifactDir, { withFileTypes: true })) {
  if (
    entry.isFile() &&
    entry.name.startsWith(currentBundleArtifactPrefix) &&
    windowsBundleExtensions.has(extname(entry.name).toLowerCase())
  ) {
    rmSync(join(bundleArtifactDir, entry.name));
  }
}

const targets = [];
const copiedReleaseFiles = [];
let requiredCopyFailed = false;

removeStaleRootExecutable();
removeStaleArtifactExecutable();

// Optional smoke-test copies are intentionally gated so they are not mistaken
// for release/update artifacts when sharing builds with testers.
for (const smokeName of ['ScieMD.next.exe', 'ScieMD.updated.exe']) {
  const smokePath = resolve(root, smokeName);
  if (copySmokeExecutables) {
    targets.push({ path: smokePath, required: false });
  } else if (existsSync(smokePath)) {
    try {
      rmSync(smokePath);
      console.log(`[copy:exe] Removed stale smoke-test executable: ${smokePath}`);
    } catch (error) {
      if (isBusyError(error)) {
        console.warn(`[copy:exe] Could not remove locked smoke-test executable: ${smokePath}`);
      } else {
        throw error;
      }
    }
  }
}

for (const target of targets) {
  const copied = copyReleaseFile(source, target.path, target.required, 'copy:exe', target.lockedMessage);
  if (copied) {
    copiedReleaseFiles.push(target.path);
  } else if (target.required) {
    requiredCopyFailed = true;
  }
}

for (const bundlePath of findBundleArtifacts(bundleDir)) {
  const target = join(bundleArtifactDir, basename(bundlePath));
  const copied = copyReleaseFile(bundlePath, target, true, 'copy:bundle');
  if (copied) {
    copiedReleaseFiles.push(target);
  } else {
    requiredCopyFailed = true;
  }
}

if (requiredCopyFailed) {
  console.error('[copy:exe] Required release artifact copy failed. Close any running ScieMD installers/executables and rerun the command.');
  process.exit(1);
}

writeReleaseChecksumManifest(root, { releaseFiles: copiedReleaseFiles });

function copyReleaseFile(sourcePath, targetPath, required, label, lockedMessage) {
  try {
    copyFileSync(sourcePath, targetPath);
    const sizeMb = (statSync(targetPath).size / 1024 / 1024).toFixed(1);
    console.log(`[${label}] ${targetPath} (${sizeMb} MB)`);
    return true;
  } catch (error) {
    if (isBusyError(error)) {
      const severity = required ? 'warning' : 'optional';
      console.warn(`[${label}] Skipped locked ${severity} copy: ${targetPath}`);
      if (lockedMessage) console.warn(`[${label}] ${lockedMessage}`);
      return false;
    }
    throw error;
  }
}

function isBusyError(error) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EBUSY');
}

function removeStaleRootExecutable() {
  const rootExecutable = resolve(root, 'ScieMD.exe');
  if (!existsSync(rootExecutable)) return;
  try {
    rmSync(rootExecutable);
    console.log(`[copy:exe] Removed stale root executable: ${rootExecutable}`);
  } catch (error) {
    if (isBusyError(error)) {
      console.warn(`[copy:exe] Could not remove locked stale root executable: ${rootExecutable}`);
      console.warn('[copy:exe] Close ScieMD and rerun copy:exe, or remove the duplicate manually.');
      return;
    }
    throw error;
  }
}

function findBundleArtifacts(directory) {
  if (!existsSync(directory)) return [];
  const results = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (entry.isFile() && entry.name.startsWith(currentBundleArtifactPrefix) && windowsBundleExtensions.has(extname(entry.name).toLowerCase())) {
        results.push(path);
      }
    }
  }
  return results.sort((left, right) => left.localeCompare(right));
}

function removeStaleArtifactExecutable() {
  const portableExecutable = join(artifactDir, 'ScieMD.exe');
  if (!existsSync(portableExecutable)) return;
  try {
    rmSync(portableExecutable);
    console.log(`[copy:exe] Removed stale portable executable: ${portableExecutable}`);
  } catch (error) {
    if (isBusyError(error)) {
      console.warn(`[copy:exe] Could not remove locked stale portable executable: ${portableExecutable}`);
      console.warn('[copy:exe] Close ScieMD and rerun copy:exe, or remove the duplicate manually.');
      return;
    }
    throw error;
  }
}

function readBooleanEnv(name) {
  const value = process.env[name];
  return value === '1' || /^true$/i.test(value ?? '');
}
