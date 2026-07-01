import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { releaseSizeBudgets, formatBytes } from './release-budgets.mjs';

const root = process.cwd();
const options = parseArgs(process.argv.slice(2));
const failures = [];

validateDesktopDist();
validateExtensionDist();
if (options.requireVsix) validateVsixPackage();
if (options.requireDesktopBundles) validateDesktopBundles();

if (failures.length > 0) {
  console.error('[validate:package-budgets] Release/package budget guard failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('[validate:package-budgets] Release/package budgets passed.');

function validateDesktopDist() {
  const dist = resolve(root, 'dist');
  expectDirectory(dist, 'Desktop web build');
  if (!existsSync(dist)) return;

  const files = listFiles(dist);
  expectTotalAtMost(files, 'Desktop dist total', releaseSizeBudgets.desktopDistTotalBytes);
  expectTotalAtMost(files.filter((file) => file.endsWith('.js')), 'Desktop JavaScript total', releaseSizeBudgets.desktopDistJavaScriptBytes);
  expectLargestAtMost(files.filter((file) => file.endsWith('.js')), 'Desktop largest JavaScript bundle', releaseSizeBudgets.desktopDistLargestJavaScriptBytes);
  expectTotalAtMost(files.filter((file) => file.endsWith('.css')), 'Desktop CSS total', releaseSizeBudgets.desktopDistCssBytes);
  expectTotalAtMost(files.filter((file) => /\.worker-[^/\\]+\.js$/i.test(file)), 'Desktop worker JavaScript total', releaseSizeBudgets.desktopDistWorkerJavaScriptBytes);
}

function validateExtensionDist() {
  const dist = resolve(root, 'scie-md-vscode-extension', 'dist');
  const extensionDist = join(dist, 'extension');
  const webviewDist = join(dist, 'webview');
  expectDirectory(dist, 'VS Code extension build');
  if (!existsSync(dist)) return;
  expectDirectory(extensionDist, 'VS Code extension host build');
  expectDirectory(webviewDist, 'VS Code webview build');

  expectTotalAtMost(listFiles(dist), 'VS Code extension dist total', releaseSizeBudgets.extensionDistTotalBytes);
  expectTotalAtMost(listFiles(extensionDist).filter((file) => file.endsWith('.js')), 'VS Code extension host JavaScript', releaseSizeBudgets.extensionHostJsBytes);
  expectTotalAtMost(listFiles(webviewDist).filter((file) => file.endsWith('.js')), 'VS Code webview JavaScript', releaseSizeBudgets.extensionWebviewJsBytes);
}

function validateVsixPackage() {
  const extensionPackage = readJson(resolve(root, 'scie-md-vscode-extension', 'package.json'));
  const vsixPath = resolve(root, 'scie-md-vscode-extension', `${extensionPackage.name}-${extensionPackage.version}.vsix`);
  expectFile(vsixPath, 'VSIX package');
  if (existsSync(vsixPath)) {
    expectFileAtMost(vsixPath, 'VSIX package', releaseSizeBudgets.vsixBytes);
  }
}

function validateDesktopBundles() {
  const bundleRoot = resolve(root, 'src-tauri', 'target', 'release', 'bundle');
  expectDirectory(bundleRoot, 'Tauri desktop bundle output');
  if (!existsSync(bundleRoot)) return;

  const files = listFiles(bundleRoot);
  const installers = files.filter((file) => /\.(exe|msi)$/i.test(file));
  expectTotalAtMost(installers, 'Windows desktop bundle total', releaseSizeBudgets.desktopBundleTotalBytes);

  const nsisInstaller = installers.find((file) => /setup\.exe$/i.test(basename(file)));
  const msiInstaller = installers.find((file) => /\.msi$/i.test(file));
  if (!nsisInstaller) failures.push('Missing Windows NSIS setup installer in Tauri bundle output.');
  if (!msiInstaller) failures.push('Missing Windows MSI installer in Tauri bundle output.');
  if (nsisInstaller) expectFileAtMost(nsisInstaller, 'Windows NSIS setup installer', releaseSizeBudgets.windowsNsisInstallerBytes);
  if (msiInstaller) expectFileAtMost(msiInstaller, 'Windows MSI installer', releaseSizeBudgets.windowsMsiInstallerBytes);
}

function expectDirectory(directory, label) {
  if (!existsSync(directory)) {
    failures.push(`${label} is missing. Run the relevant build before validating budgets.`);
    return;
  }
  if (!statSync(directory).isDirectory()) {
    failures.push(`${label} is not a directory: ${directory}`);
  }
}

function expectFile(filePath, label) {
  if (!existsSync(filePath)) {
    failures.push(`${label} is missing: ${filePath}`);
    return;
  }
  if (!statSync(filePath).isFile()) {
    failures.push(`${label} is not a file: ${filePath}`);
  }
}

function expectFileAtMost(filePath, label, maxBytes) {
  const size = statSync(filePath).size;
  if (size > maxBytes) {
    failures.push(`${label} is ${formatBytes(size)}, above budget ${formatBytes(maxBytes)} (${filePath}).`);
  }
}

function expectTotalAtMost(files, label, maxBytes) {
  const total = files.reduce((sum, file) => sum + statSync(file).size, 0);
  if (total > maxBytes) {
    failures.push(`${label} totals ${formatBytes(total)}, above budget ${formatBytes(maxBytes)}.`);
  }
}

function expectLargestAtMost(files, label, maxBytes) {
  if (files.length === 0) return;
  const largest = files
    .map((file) => ({ file, size: statSync(file).size }))
    .sort((left, right) => right.size - left.size)[0];
  if (largest.size > maxBytes) {
    failures.push(`${label} is ${formatBytes(largest.size)}, above budget ${formatBytes(maxBytes)} (${largest.file}).`);
  }
}

function listFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function readJson(filePath) {
  if (!existsSync(filePath)) {
    failures.push(`Missing JSON file: ${filePath}`);
    return {};
  }
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function parseArgs(args) {
  return {
    requireVsix: args.includes('--vsix'),
    requireDesktopBundles: args.includes('--desktop-bundles'),
  };
}
