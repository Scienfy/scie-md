import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const script = process.argv[2];
const scriptArgs = process.argv.slice(3);

if (!script) {
  console.error('[python] Missing script path.');
  process.exit(1);
}

const root = process.cwd();
const scriptPath = resolve(root, script);
if (!existsSync(scriptPath)) {
  console.error(`[python] Script does not exist: ${scriptPath}`);
  process.exit(1);
}

const candidates = process.platform === 'win32'
  ? [
      { command: 'py', args: ['-3'] },
      { command: 'python', args: [] },
      { command: 'python3', args: [] },
    ]
  : [
      { command: 'python3', args: [] },
      { command: 'python', args: [] },
    ];

for (const candidate of candidates) {
  const version = spawnSync(candidate.command, [...candidate.args, '--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (version.status !== 0) continue;

  const result = spawnSync(candidate.command, [...candidate.args, scriptPath, ...scriptArgs], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    console.error(`[python] ${result.error.message}`);
  }
  process.exit(result.status ?? 1);
}

console.error('[python] Could not find Python 3. Install Python 3 or add it to PATH.');
process.exit(1);
