import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const target = resolve(process.cwd(), 'dist');
const maxAttempts = 8;
const retryDelayMs = 350;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  try {
    await rm(target, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: retryDelayMs,
    });
    process.exit(0);
  } catch (error) {
    if (!isTransientWindowsDeleteError(error) || attempt === maxAttempts) {
      console.error(`[clean] Could not remove ${target}: ${errorMessage(error)}`);
      process.exit(1);
    }
    await delay(retryDelayMs * attempt);
  }
}

function isTransientWindowsDeleteError(error) {
  return Boolean(error && typeof error === 'object' && 'code' in error && [
    'EBUSY',
    'EMFILE',
    'ENFILE',
    'ENOTEMPTY',
    'EPERM',
  ].includes(String(error.code)));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}
