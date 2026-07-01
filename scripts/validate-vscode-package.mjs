import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { releaseSizeBudgets, formatBytes } from './release-budgets.mjs';

const root = process.cwd();
const extensionRoot = resolve(root, 'scie-md-vscode-extension');
const extensionPackage = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'));
const expectedVsix = resolve(extensionRoot, `${extensionPackage.name}-${extensionPackage.version}.vsix`);
const vsixPath = resolve(process.argv[2] ?? expectedVsix);
const failures = [];
if (!existsSync(vsixPath)) {
  fail(`Missing VSIX package: ${vsixPath}`);
}

const entries = listVsixEntries(vsixPath);
const entrySet = new Set(entries);
expectEntry(entrySet, 'extension/package.json');
expectEntry(entrySet, 'extension/dist/extension/extension.js');
expectEntry(entrySet, 'extension/dist/webview/assets/main.js');
expectEntry(entrySet, 'extension/dist/webview/assets/main.css');

for (const entry of entries) {
  if (
    entry.startsWith('extension/src/')
    || entry.startsWith('extension/test/')
    || entry.startsWith('extension/scripts/')
    || entry.startsWith('extension/node_modules/')
    || entry.startsWith('extension/packages/')
    || entry === 'extension/tsconfig.json'
    || entry === 'extension/tsconfig.extension.json'
    || entry === 'extension/tsconfig.webview.json'
    || entry === 'extension/vite.config.ts'
    || entry === 'extension/vitest.config.ts'
    || entry.endsWith('.map')
  ) {
    failures.push(`Unexpected source/development file in VSIX: ${entry}`);
  }
}

const unpacked = unpackVsix(vsixPath);
try {
  const manifestPath = join(unpacked, 'extension', 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  expectManifestVersion(manifest);
  expectNoLocalDependencies(manifest, manifestPath);
  expectNoTauriDependencies(manifest, manifestPath);
  expectStructuredAssociationPolicy(manifest, manifestPath);
  expectStructuredPreviewBudgetPolicy(manifestPath);
  expectFileSizeAtMost(vsixPath, 'VSIX package', releaseSizeBudgets.vsixBytes);
  expectDirectoryJavaScriptBudget(join(unpacked, 'extension', 'dist', 'extension'), 'extension host JavaScript', releaseSizeBudgets.extensionHostJsBytes);
  expectDirectoryJavaScriptBudget(join(unpacked, 'extension', 'dist', 'webview'), 'webview JavaScript', releaseSizeBudgets.extensionWebviewJsBytes);
  for (const bundlePath of listPackagedJavaScriptBundles(join(unpacked, 'extension', 'dist'))) {
    expectBundleClean(bundlePath, bundlePath.replace(`${unpacked}\\`, '').replace(`${unpacked}/`, ''));
  }
  for (const bundlePath of listPackagedCssBundles(join(unpacked, 'extension', 'dist'))) {
    expectCssBundleClean(bundlePath, bundlePath.replace(`${unpacked}\\`, '').replace(`${unpacked}/`, ''));
  }
} finally {
  rmSync(unpacked, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error('[validate:vscode-package] VSIX package-content guard failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`[validate:vscode-package] ${basename(vsixPath)} is self-contained.`);

function listVsixEntries(filePath) {
  const result = spawnSync('tar', ['-tf', filePath], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(`Could not list VSIX entries with tar: ${result.stderr || result.error?.message || 'unknown error'}`);
  }
  return result.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
}

function unpackVsix(filePath) {
  const directory = mkdtempSync(join(tmpdir(), 'sciemd-vsix-'));
  const result = spawnSync('tar', ['-xf', filePath, '-C', directory], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0) {
    rmSync(directory, { recursive: true, force: true });
    fail(`Could not unpack VSIX with tar: ${result.stderr || result.error?.message || 'unknown error'}`);
  }
  return directory;
}

function expectEntry(entrySet, entry) {
  if (!entrySet.has(entry)) {
    failures.push(`VSIX is missing ${entry}.`);
  }
}

function expectManifestVersion(manifest) {
  if (manifest.name !== extensionPackage.name || manifest.version !== extensionPackage.version) {
    failures.push(
      `Packaged manifest identity is ${manifest.name}@${manifest.version}, expected ${extensionPackage.name}@${extensionPackage.version}.`,
    );
  }
}

function expectNoLocalDependencies(manifest, label) {
  for (const dependencyField of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const dependencies = manifest[dependencyField];
    if (!dependencies || typeof dependencies !== 'object') continue;
    for (const [name, range] of Object.entries(dependencies)) {
      if (typeof range === 'string' && /^(file:|link:|workspace:)/.test(range)) {
        failures.push(`${label} has local ${dependencyField} entry ${name}: ${range}.`);
      }
    }
  }
}

function expectNoTauriDependencies(manifest, label) {
  for (const dependencyField of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const dependencies = manifest[dependencyField];
    if (!dependencies || typeof dependencies !== 'object') continue;
    if (Object.hasOwn(dependencies, '@tauri-apps/api')) {
      failures.push(`${label} has desktop-only ${dependencyField} entry @tauri-apps/api.`);
    }
  }
}

function expectStructuredAssociationPolicy(manifest, label) {
  const genericStructuredPatterns = ['*.json', '*.jsonl', '*.ndjson', '*.yaml', '*.yml', '*.toml', '*.xml', '*.csv', '*.tsv'];
  const customEditorPatterns = (manifest.contributes?.customEditors ?? []).flatMap((editor) => (
    (editor.selector ?? []).map((selector) => selector.filenamePattern)
  ));
  const editorAssociations = manifest.contributes?.configurationDefaults?.['workbench.editorAssociations'] ?? {};
  for (const pattern of genericStructuredPatterns) {
    if (customEditorPatterns.includes(pattern)) {
      failures.push(`${label} claims ${pattern} as a custom editor association.`);
    }
    if (Object.hasOwn(editorAssociations, pattern)) {
      failures.push(`${label} sets a default editor association for ${pattern}.`);
    }
  }

  const settings = manifest.contributes?.configuration?.properties ?? {};
  if (settings['scieMd.structured.enableJsonActions']?.default !== false) {
    failures.push(`${label} must keep scieMd.structured.enableJsonActions defaulted to false.`);
  }
  if (settings['scieMd.structured.enablePreviewAssociations']?.default !== false) {
    failures.push(`${label} must keep scieMd.structured.enablePreviewAssociations defaulted to false.`);
  }

  const menus = manifest.contributes?.menus ?? {};
  const structuredEditMenus = [
    ...(menus.commandPalette ?? []),
    ...(menus['editor/title/context'] ?? []),
    ...(menus['editor/title'] ?? []),
    ...(menus['explorer/context'] ?? []),
  ].filter((item) => item.command === 'scieMd.applyStructuredClipboardToJson');
  for (const item of structuredEditMenus) {
    const when = String(item.when ?? '');
    if (!when.includes('config.scieMd.structured.enableJsonActions')) {
      failures.push(`${label} exposes scieMd.applyStructuredClipboardToJson without the enableJsonActions setting gate.`);
    }
    if (when.includes('resourceExtname == .yaml') || when.includes('resourceExtname == .yml') || when.includes('resourceExtname == .toml')) {
      failures.push(`${label} exposes scieMd.applyStructuredClipboardToJson for YAML/TOML, which must remain preview-only.`);
    }
  }
}

function expectStructuredPreviewBudgetPolicy(label) {
  const hostSource = readFileSync(join(extensionRoot, 'src', 'extension', 'StructuredPreviewPanel.ts'), 'utf8');
  const webviewSource = readFileSync(join(extensionRoot, 'src', 'webview', 'StructuredPreview.tsx'), 'utf8');
  if (!hostSource.includes('VSCODE_STRUCTURED_PREVIEW_SOURCE_EXCERPT_BYTES')) {
    failures.push(`${label} does not define an explicit VS Code structured preview source excerpt budget.`);
  }
  if (!hostSource.includes('formatParseBudgetBytes')) {
    failures.push(`${label} does not tie VS Code structured preview excerpts to shared parse budgets.`);
  }
  if (!hostSource.includes('sourceTextTruncated') || !hostSource.includes('sourceTotalBytes') || !hostSource.includes('sourceLimitBytes')) {
    failures.push(`${label} does not post structured preview source-excerpt metadata to the webview.`);
  }
  if (!webviewSource.includes('sourceTextTruncated') || !webviewSource.includes('source-excerpt')) {
    failures.push(`${label} webview does not handle structured preview source excerpts as source-only previews.`);
  }
}

function expectFileSizeAtMost(filePath, label, maxBytes) {
  const size = statSync(filePath).size;
  if (size > maxBytes) {
    failures.push(`${label} is ${formatBytes(size)}, above budget ${formatBytes(maxBytes)}.`);
  }
}

function expectDirectoryJavaScriptBudget(directory, label, maxBytes) {
  const totalBytes = listPackagedJavaScriptBundles(directory)
    .reduce((total, filePath) => total + statSync(filePath).size, 0);
  if (totalBytes > maxBytes) {
    failures.push(`${label} totals ${formatBytes(totalBytes)}, above budget ${formatBytes(maxBytes)}.`);
  }
}

function listPackagedJavaScriptBundles(directory) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...listPackagedJavaScriptBundles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      output.push(fullPath);
    }
  }
  return output.sort();
}

function listPackagedCssBundles(directory) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...listPackagedCssBundles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.css')) {
      output.push(fullPath);
    }
  }
  return output.sort();
}

function expectBundleClean(filePath, label) {
  const code = readFileSync(filePath, 'utf8');
  const forbiddenSnippets = [
    '@sciemd/core',
    'require("@sciemd/core")',
    "require('@sciemd/core')",
    'from "@sciemd/core"',
    "from '@sciemd/core'",
    '@tauri-apps/api',
  ];
  for (const snippet of forbiddenSnippets) {
    if (code.includes(snippet)) {
      failures.push(`${label} contains unresolved or Tauri-only import text: ${snippet}.`);
    }
  }
}

function expectCssBundleClean(filePath, label) {
  const code = readFileSync(filePath, 'utf8');
  const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  for (const match of code.matchAll(urlPattern)) {
    const assetUrl = match[2].trim();
    if (
      assetUrl.startsWith('/')
      || /^file:/i.test(assetUrl)
      || /^[A-Za-z]:[\\/]/.test(assetUrl)
    ) {
      failures.push(`${label} contains non-webview-safe CSS asset URL: ${assetUrl}.`);
      continue;
    }
    if (isExternalCssAssetUrl(assetUrl)) continue;

    const localAssetPath = assetUrl.split(/[?#]/, 1)[0];
    if (!localAssetPath) continue;
    if (!existsSync(resolve(dirname(filePath), localAssetPath))) {
      failures.push(`${label} references missing packaged CSS asset: ${assetUrl}.`);
    }
  }
}

function isExternalCssAssetUrl(assetUrl) {
  return assetUrl.startsWith('#')
    || assetUrl.startsWith('data:')
    || assetUrl.startsWith('blob:')
    || assetUrl.startsWith('http:')
    || assetUrl.startsWith('https:')
    || assetUrl.startsWith('vscode-resource:')
    || assetUrl.startsWith('vscode-webview-resource:');
}

function fail(message) {
  console.error(`[validate:vscode-package] ${message}`);
  process.exit(1);
}
