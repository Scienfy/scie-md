import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const libPath = path.join(repoRoot, 'src-tauri', 'src', 'lib.rs');
const configPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json');
const cargoManifestPath = path.join(repoRoot, 'src-tauri', 'Cargo.toml');
const sourceRoot = path.join(repoRoot, 'src');
const failures = [];

const registeredCommands = parseRegisteredCommands(readFileSync(libPath, 'utf8'));
const invokedCommands = scanInvokedCommands(sourceRoot);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const cargoManifest = readFileSync(cargoManifestPath, 'utf8');

const requiredCommandGroups = {
  startup: [
    'initial_markdown_path',
    'peek_pending_markdown_open',
    'take_pending_markdown_open',
    'clear_pending_markdown_open',
  ],
  dialogs: [
    'pick_markdown_file',
    'pick_image_file',
    'pick_citation_style_file',
    'pick_folder',
    'pick_save_path',
    'pick_html_save_path',
    'pick_pandoc_export_save_path',
  ],
  diagnostics: [
    'append_diagnostics_event',
    'clear_recovery_snapshot',
    'mark_renderer_clean_shutdown',
    'read_recovery_snapshot',
    'record_renderer_heartbeat',
    'write_recovery_snapshot',
  ],
  pathGrants: ['grant_external_path', 'sync_document_image_grants'],
  fileIo: [
    'read_text_file',
    'read_text_file_for_edit',
    'read_text_file_preview',
    'read_binary_file_base64',
    'list_readable_files',
    'stat_file',
    'write_text_file_atomic',
    'write_text_file_create_new',
    'create_generated_sibling_artifact',
    'cleanup_stale_temp_files_for_paths',
  ],
  watcher: ['watch_files_for_changes', 'unwatch_files_for_changes'],
  assets: ['copy_image_to_assets', 'save_image_bytes_to_assets'],
  backups: ['create_backup_snapshot', 'list_backups'],
  export: [
    'check_pandoc_available',
    'export_with_pandoc',
    'export_html_with_pandoc',
    'export_html_to_docx_native',
    'export_styled_html_to_pdf',
  ],
  inkscape: [
    'check_inkscape_available',
    'open_svg_in_inkscape',
    'stat_inkscape_svg_session',
    'read_inkscape_svg_session',
    'cleanup_inkscape_svg_session',
    'export_svg_with_inkscape',
  ],
  reveal: ['reveal_in_file_manager'],
};

for (const [group, commands] of Object.entries(requiredCommandGroups)) {
  for (const command of commands) {
    if (!registeredCommands.has(command)) {
      failures.push(`Required ${group} command is not registered in src-tauri/src/lib.rs: ${command}`);
    }
  }
}

for (const command of invokedCommands) {
  if (!registeredCommands.has(command)) {
    failures.push(`TypeScript invokes an unregistered Tauri command: ${command}`);
  }
}

const libSource = readFileSync(libPath, 'utf8');
if (!libSource.includes('.register_uri_scheme_protocol("scie-md-local-image"')) {
  failures.push('Rust app does not register the grant-checked scie-md-local-image protocol.');
}

const csp = config.app?.security?.csp ?? '';
if (!csp.includes('scie-md-local-image:') || !csp.includes('http://scie-md-local-image.localhost')) {
  failures.push('Tauri CSP must allow the grant-checked scie-md-local-image protocol.');
}
if (/\basset:|asset\.localhost/i.test(csp)) {
  failures.push('Tauri CSP must not re-enable the legacy asset protocol.');
}
if (config.app?.security?.assetProtocol?.enable !== false) {
  failures.push('Tauri assetProtocol must stay disabled; local images use scie-md-local-image.');
}
if (cargoManifest.includes('protocol-asset')) {
  failures.push('Cargo.toml must not enable Tauri protocol-asset; local images use scie-md-local-image.');
}

if (failures.length > 0) {
  console.error('[tauri-contract] Native command contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `[tauri-contract] ${registeredCommands.size} registered commands cover ${invokedCommands.size} TypeScript invoke calls; local-image protocol policy is locked.`,
);

function parseRegisteredCommands(source) {
  const match = source.match(/generate_handler!\s*\[([\s\S]*?)\]\s*\)/);
  if (!match) {
    failures.push('Could not find tauri::generate_handler![...] in src-tauri/src/lib.rs.');
    return new Set();
  }
  const commands = match[1]
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split('::').at(-1)?.trim())
    .filter(Boolean);
  const seen = new Set();
  for (const command of commands) {
    if (seen.has(command)) failures.push(`Duplicate registered Tauri command: ${command}`);
    seen.add(command);
  }
  return seen;
}

function scanInvokedCommands(root) {
  const commands = new Set();
  for (const file of listSourceFiles(root)) {
    const source = readFileSync(file, 'utf8');
    const invokePattern = /\binvoke(?:<[^>]+>)?\(\s*(['"`])([^'"`]+)\1/g;
    for (const match of source.matchAll(invokePattern)) {
      commands.add(match[2]);
    }
  }
  return commands;
}

function listSourceFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (['dist', 'node_modules'].includes(entry.name)) continue;
      files.push(...listSourceFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) continue;
    files.push(fullPath);
  }
  return files.sort();
}
