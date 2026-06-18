import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(extensionRoot, '..');

const mappings = [
  {
    sourceRoot: path.join(repoRoot, 'src', 'markdown'),
    copyRoot: path.join(extensionRoot, 'src', 'shared', 'markdown'),
  },
  {
    sourceRoot: path.join(repoRoot, 'src', 'domain'),
    copyRoot: path.join(extensionRoot, 'src', 'shared', 'domain'),
  },
];

const drift = [];

for (const mapping of mappings) {
  for (const file of await listTypescriptFiles(mapping.copyRoot)) {
    const relative = path.relative(mapping.copyRoot, file);
    const source = path.join(mapping.sourceRoot, relative);
    const [sourceText, copiedText] = await Promise.all([
      readFile(source, 'utf8').catch(() => null),
      readFile(file, 'utf8'),
    ]);

    if (sourceText === null) {
      drift.push(`${relative}: source file missing`);
    } else if (normalizeNewlines(sourceText) !== normalizeNewlines(copiedText)) {
      drift.push(`${relative}: copied core differs from desktop source`);
    }
  }
}

if (drift.length > 0) {
  console.error('ScieMD shared-core copy drift detected:');
  for (const item of drift) console.error(`- ${item}`);
  process.exit(1);
}

console.log('ScieMD shared-core copies match desktop source.');

async function listTypescriptFiles(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...await listTypescriptFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      output.push(fullPath);
    }
  }
  return output;
}

function normalizeNewlines(value) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
