import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const libPath = path.join(repoRoot, 'src-tauri', 'src', 'lib.rs');
const dialogsPath = path.join(repoRoot, 'src-tauri', 'src', 'commands', 'dialogs.rs');
const configPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json');
const cargoManifestPath = path.join(repoRoot, 'src-tauri', 'Cargo.toml');
const nsisHooksPath = path.join(repoRoot, 'src-tauri', 'windows', 'nsis-hooks.nsh');
const tomlSourceMapPath = path.join(repoRoot, 'src-tauri', 'src', 'commands', 'toml_source_map.rs');
const sourceRoot = path.join(repoRoot, 'src');
const failures = [];

const libSource = readFileSync(libPath, 'utf8');
const dialogsSource = readFileSync(dialogsPath, 'utf8');
const invokedCommands = scanInvokedCommands(sourceRoot);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const cargoManifest = readFileSync(cargoManifestPath, 'utf8');
const nsisHooksSource = readFileSync(nsisHooksPath, 'utf8');
const tomlSourceMapSource = readFileSync(tomlSourceMapPath, 'utf8');
const registeredCommands = parseRegisteredCommands(libSource);

const DOCUMENT_ASSOCIATION_PROGIDS = new Map([
  ['md', 'ScieMD.Markdown'],
  ['markdown', 'ScieMD.Markdown'],
  ['json', 'ScieMD.JSON'],
  ['jsonl', 'ScieMD.JSONLines'],
  ['ndjson', 'ScieMD.JSONLines'],
  ['yaml', 'ScieMD.YAML'],
  ['yml', 'ScieMD.YAML'],
  ['toml', 'ScieMD.TOML'],
  ['xml', 'ScieMD.XML'],
  ['tsv', 'ScieMD.TSV'],
  ['txt', 'ScieMD.PlainText'],
  ['text', 'ScieMD.PlainText'],
]);
const DOCUMENT_ASSOCIATION_EXTENSIONS = [...DOCUMENT_ASSOCIATION_PROGIDS.keys()];

const requiredCommandGroups = {
  startup: [
    'initial_document_path',
    'initial_markdown_path',
    'peek_pending_document_open',
    'peek_pending_markdown_open',
    'take_pending_document_open',
    'take_pending_markdown_open',
    'clear_pending_document_open',
    'clear_pending_markdown_open',
  ],
  dialogs: [
    'pick_markdown_file',
    'pick_document_file',
    'pick_json_schema_file',
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

validateDocumentAssociationPolicy(config);
validateDocumentLaunchPolicy(libSource);
validateWindowsInstallerDocumentPolicy(nsisHooksSource);
validateManualStructuredOpenPolicy(dialogsSource);
validateExperimentalTomlSourceMapPolicy(tomlSourceMapSource, registeredCommands, invokedCommands);

if (failures.length > 0) {
  console.error('[tauri-contract] Native command contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `[tauri-contract] ${registeredCommands.size} registered commands cover ${invokedCommands.size} TypeScript invoke calls; local-image and supported-document association policies are locked.`,
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

function validateDocumentAssociationPolicy(tauriConfig) {
  const associations = Array.isArray(tauriConfig.bundle?.fileAssociations)
    ? tauriConfig.bundle.fileAssociations
    : [];
  const associatedExtensions = new Map();

  for (const association of associations) {
    for (const extension of normalizeExtensions(association.ext ?? association.extensions)) {
      associatedExtensions.set(extension, association.name);
    }
  }

  for (const [extension, expectedProgId] of DOCUMENT_ASSOCIATION_PROGIDS) {
    const actualProgId = associatedExtensions.get(extension);
    if (!actualProgId) {
      failures.push(`Tauri fileAssociations must register .${extension} for document open-with support.`);
    } else if (actualProgId !== expectedProgId) {
      failures.push(`Tauri fileAssociations must map .${extension} to ${expectedProgId}, got ${actualProgId}.`);
    }
  }

  for (const extension of associatedExtensions.keys()) {
    if (!DOCUMENT_ASSOCIATION_PROGIDS.has(extension)) {
      failures.push(`Tauri fileAssociations registers unsupported document extension .${extension}.`);
    }
  }
}

function validateDocumentLaunchPolicy(source) {
  const match = source.match(/const\s+LAUNCH_DOCUMENT_EXTENSIONS:\s*&\[[^\]]+\]\s*=\s*&\[(.*?)\];/s);
  if (!match) {
    failures.push('src-tauri/src/lib.rs must define LAUNCH_DOCUMENT_EXTENSIONS for startup/open-with gating.');
    return;
  }
  const launchExtensions = parseQuotedStrings(match[1]);
  for (const extension of DOCUMENT_ASSOCIATION_EXTENSIONS) {
    if (!launchExtensions.includes(extension)) {
      failures.push(`Document launch gate must accept .${extension}.`);
    }
  }
  for (const extension of launchExtensions) {
    if (!DOCUMENT_ASSOCIATION_PROGIDS.has(extension)) {
      failures.push(`Document launch gate accepts unsupported extension .${extension}.`);
    }
  }
  if (!source.includes('resolve_supported_document_launch_path')) {
    failures.push('src-tauri/src/lib.rs must keep startup and single-instance launch paths behind supported-document filtering.');
  }
}

function validateWindowsInstallerDocumentPolicy(source) {
  if (/!insertmacro\s+RegisterScieMdDocumentExtension\s+"csv"/i.test(source)) {
    failures.push('Windows installer hooks must not actively register .csv; CSV stays available only through in-app open/save.');
  }
  if (/!insertmacro\s+RegisterScieMdDocumentProgId\s+"ScieMD\.CSV"/i.test(source)) {
    failures.push('Windows installer hooks must not actively register ScieMD.CSV as a document ProgID.');
  }
  if (!source.includes('ClearLegacyScieMdCsvAssociation')) {
    failures.push('Windows installer hooks must clean stale ScieMD CSV associations from older installers.');
  }
  if (!source.includes('PromptForScieMdDefaultAppsSelection')) {
    failures.push('Windows installer hooks must offer to open Windows Default Apps after registering document associations.');
  }
  if (!source.includes('ms-settings:defaultapps?registeredAppUser=${PRODUCTNAME}')) {
    failures.push('Windows installer hooks must use the official Default Apps settings URI for user-approved default selection.');
  }
  if (!source.includes('WriteRegStr HKCU "Software\\Classes\\.${EXT}" "" "${PROGID}"')) {
    failures.push('Windows installer hooks must set the per-user extension ProgID value for each supported extension.');
  }
  if (!source.includes('ReadRegStr $0 HKCU "Software\\Classes\\.${EXT}" ""')) {
    failures.push('Windows uninstaller must inspect each extension default before removing ScieMD ProgID ownership.');
  }
  if (!source.includes('DeleteRegValue HKCU "Software\\Classes\\.${EXT}" ""')) {
    failures.push('Windows uninstaller must remove extension defaults only when they still point to ScieMD.');
  }
  for (const [extension, progId] of DOCUMENT_ASSOCIATION_PROGIDS) {
    const registerPattern = new RegExp(String.raw`!insertmacro\s+RegisterScieMdDocumentExtension\s+"${escapeRegExp(extension)}"\s+"${escapeRegExp(progId)}"`);
    const unregisterPattern = new RegExp(String.raw`!insertmacro\s+UnregisterScieMdDocumentExtension\s+"${escapeRegExp(extension)}"\s+"${escapeRegExp(progId)}"`);
    if (!registerPattern.test(source)) {
      failures.push(`Windows installer hooks must register .${extension} through RegisterScieMdDocumentExtension.`);
    }
    if (!unregisterPattern.test(source)) {
      failures.push(`Windows installer hooks must unregister .${extension} through UnregisterScieMdDocumentExtension.`);
    }
  }
  for (const registryKey of ['OpenWithProgids', 'SupportedTypes', 'Capabilities\\FileAssociations', 'RegisteredApplications']) {
    if (!source.includes(registryKey)) {
      failures.push(`Windows installer hooks must keep ${registryKey} registration for document open-with support.`);
    }
  }
}

function validateManualStructuredOpenPolicy(source) {
  const expectedFilters = [
    'add_filter("JSON", JSON_EXTENSIONS)',
    'add_filter("JSON Lines", JSONL_EXTENSIONS)',
    'add_filter("YAML", YAML_EXTENSIONS)',
    'add_filter("TOML", TOML_EXTENSIONS)',
    'add_filter("XML", XML_EXTENSIONS)',
    'add_filter("CSV", CSV_EXTENSIONS)',
    'add_filter("TSV", TSV_EXTENSIONS)',
    'add_filter("Plain Text", PLAIN_TEXT_EXTENSIONS)',
  ];
  for (const filter of expectedFilters) {
    if (!source.includes(filter)) {
      failures.push(`Manual document picker must keep structured open support: missing ${filter}.`);
    }
  }
}

function validateExperimentalTomlSourceMapPolicy(source, registeredCommands, invokedCommands) {
  if (!registeredCommands.has('inspect_toml_source_map')) {
    failures.push('Experimental TOML source-map evidence command must stay registered while the preservation spike is active.');
  }
  if (invokedCommands.has('inspect_toml_source_map')) {
    failures.push('TypeScript must not invoke inspect_toml_source_map until a typed host bridge and edit planner are implemented.');
  }
  if (!source.includes('experimental-readonly-evidence') || !source.includes('inspect-source-map-only')) {
    failures.push('TOML source-map command must advertise itself as experimental read-only evidence.');
  }
  if (!source.includes('visual_writes_enabled: false')) {
    failures.push('TOML source-map command must keep visual_writes_enabled false.');
  }
}

function normalizeExtensions(value) {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim().replace(/^\./, '').toLowerCase())
    .filter(Boolean);
}

function parseQuotedStrings(value) {
  return [...value.matchAll(/"([^"]+)"/g)].map((match) => match[1].trim().replace(/^\./, '').toLowerCase());
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
