import { spawnSync } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const gitCommand = process.platform === 'win32' ? 'git.exe' : 'git';

const steps = [
  { label: 'Release validator with identity and generated-output guards', command: npmCommand, args: ['run', 'validate:release'] },
  { label: 'VS Code host and webview smoke', command: npmCommand, args: ['run', 'validate:vscode-visual-smoke'] },
  { label: 'Large-document/OOM stress gate', command: npmCommand, args: ['run', 'validate:large-document-stress'] },
  { label: 'Packaged desktop build', command: npmCommand, args: ['run', 'build:desktop'] },
  { label: 'Required packaged desktop smoke', command: npmCommand, args: ['run', 'validate:desktop-smoke', '--', '--required'] },
  { label: 'Desktop artifact staging', command: npmCommand, args: ['run', 'copy:exe'] },
  { label: 'VS Code extension package', command: npmCommand, args: ['run', 'package:vscode'] },
  { label: 'VSIX package-content guard', command: npmCommand, args: ['run', 'validate:vscode-package'] },
  { label: 'Required installed VSIX smoke', command: npmCommand, args: ['run', 'validate:vscode-installed-smoke', '--', '--required'] },
  { label: 'VS Code extension staging', command: npmCommand, args: ['run', 'stage:vscode'] },
  { label: 'Generated-output leak recheck after staging', command: npmCommand, args: ['run', 'validate:generated-outputs'] },
  { label: 'Whitespace guard', command: gitCommand, args: ['diff', '--check'] },
];

for (const step of steps) {
  console.log(`\n[merge validation] ${step.label}`);
  const result = spawnSync(step.command, step.args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    console.error(`[merge validation] ${result.error.message}`);
  }
  if (result.status !== 0) {
    console.error(`[merge validation] Failed: ${step.label}`);
    process.exit(result.status ?? 1);
  }
}

console.log('\n[merge validation] All checks passed.');
