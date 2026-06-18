import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const desktopCapability = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8'));
const tauriMain = readFileSync('src-tauri/src/main.rs', 'utf8');
const requireSignedDistribution = readEnv('SCIEMD_REQUIRE_SIGNED_DISTRIBUTION', 'SCIE_MD_REQUIRE_SIGNED_DISTRIBUTION') === '1';

if (!config.bundle?.publisher || !config.bundle?.homepage) {
  fail('Bundle publisher and homepage must be configured before release.');
}

if (!config.bundle?.windows?.digestAlgorithm || !config.bundle?.windows?.timestampUrl) {
  fail('Windows signing digest and timestamp settings must be configured before release.');
}

if (config.bundle?.macOS?.hardenedRuntime !== true) {
  fail('macOS hardened runtime must stay enabled for release builds.');
}

if (!tauriMain.includes('#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]')) {
  fail('Windows release builds must use the GUI subsystem so ScieMD does not launch a console window.');
}

const requiredWindowPermissions = [
  'core:window:allow-close',
  'core:window:allow-destroy',
  'core:window:allow-minimize',
  'core:window:allow-start-dragging',
  'core:window:allow-toggle-maximize',
];

for (const permission of requiredWindowPermissions) {
  if (!desktopCapability.permissions?.includes(permission)) {
    fail(`Default desktop capability is missing required window permission: ${permission}`);
  }
}

if (!requireSignedDistribution) {
  console.log('[distribution] Release signing gate is available. Set SCIEMD_REQUIRE_SIGNED_DISTRIBUTION=1 in CI to require signing and updater credentials.');
  process.exit(0);
}

const requiredEnv = [
  ['SCIEMD_WINDOWS_CERTIFICATE_THUMBPRINT', 'SCIE_MD_WINDOWS_CERTIFICATE_THUMBPRINT'],
  ['SCIEMD_MACOS_SIGNING_IDENTITY', 'SCIE_MD_MACOS_SIGNING_IDENTITY'],
  ['SCIEMD_UPDATE_ENDPOINT', 'SCIE_MD_UPDATE_ENDPOINT'],
  ['TAURI_SIGNING_PRIVATE_KEY'],
];

for (const [name, legacyName] of requiredEnv) {
  if (!readEnv(name, legacyName)?.trim()) fail(`Missing required signed-release environment variable: ${name}`);
}

console.log('[distribution] Signed distribution credentials are present.');

function readEnv(name, legacyName) {
  return process.env[name] ?? (legacyName ? process.env[legacyName] : undefined);
}

function fail(message) {
  console.error(`[distribution] ${message}`);
  process.exit(1);
}
