import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const sourceRoot = join(root, 'src');
const keyPattern = /\bt\(\s*['"`]([^'"`]+)['"`]/g;
const sourceExtensions = new Set(['.ts', '.tsx']);
const keys = [];

for (const file of walk(sourceRoot)) {
  if (!sourceExtensions.has(extensionOf(file))) continue;
  if (file.includes('.test.')) continue;
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(keyPattern)) {
    keys.push({
      key: match[1],
      file: relative(root, file).replaceAll('\\', '/'),
    });
  }
}

keys.sort((a, b) => a.key.localeCompare(b.key) || a.file.localeCompare(b.file));
console.log(JSON.stringify({ keys }, null, 2));

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

function extensionOf(file) {
  const dot = file.lastIndexOf('.');
  return dot >= 0 ? file.slice(dot) : '';
}
