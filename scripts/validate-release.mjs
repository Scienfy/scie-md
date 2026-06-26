import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const cargoCommand = process.platform === 'win32' ? 'cargo.exe' : 'cargo';

const steps = [
  { label: 'Scie Sans font build', command: npmCommand, args: ['run', 'fonts:scie-sans'] },
  { label: 'Scie Sans font verification', command: npmCommand, args: ['run', 'fonts:verify'] },
  { label: 'Distribution configuration guard', command: npmCommand, args: ['run', 'validate:distribution'] },
  { label: 'Frontend build', command: npmCommand, args: ['run', 'build'] },
  { label: 'Visual export smoke validation', command: npmCommand, args: ['run', 'validate:export'] },
  { label: 'Visual style smoke validation', command: npmCommand, args: ['run', 'validate:styles'] },
  { label: 'UX workflow smoke validation', command: npmCommand, args: ['run', 'validate:ux'] },
  { label: 'Vitest + strict round-trip validation', command: npmCommand, args: ['run', 'test:all'] },
  { label: 'VS Code extension tests', command: npmCommand, args: ['--prefix', 'scie-md-vscode-extension', 'test'] },
  { label: 'VS Code extension build', command: npmCommand, args: ['--prefix', 'scie-md-vscode-extension', 'run', 'build'] },
  { label: 'Rust tests', command: cargoCommand, args: ['test'], cwd: 'src-tauri' },
  { label: 'Rust clippy', command: cargoCommand, args: ['clippy', '--all-targets', '--', '-D', 'warnings'], cwd: 'src-tauri' },
];

for (const step of steps) {
  if (step.cwd && !existsSync(step.cwd)) {
    console.error(`[release validation] Missing working directory: ${step.cwd}`);
    process.exit(1);
  }
  console.log(`\n[release validation] ${step.label}`);
  const result = spawnSync(step.command, step.args, {
    cwd: step.cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    console.error(`[release validation] ${result.error.message}`);
  }
  if (result.status !== 0) {
    console.error(`[release validation] Failed: ${step.label}`);
    process.exit(result.status ?? 1);
  }
}

console.log('\n[release validation] All checks passed.');
