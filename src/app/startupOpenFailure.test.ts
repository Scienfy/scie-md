import { describe, expect, it } from 'vitest';
import {
  createStartupOpenFailure,
  displayStartupOpenPath,
  startupOpenDiagnosticEvent,
} from './startupOpenFailure';

describe('startup open failure helpers', () => {
  it('creates a retryable open failure for a known startup document path', () => {
    const failure = createStartupOpenFailure({
      kind: 'open-failed',
      path: 'C:\\Users\\amin_\\paper.md',
      error: new Error('File access denied'),
      nowMs: 42,
    });

    expect(failure).toMatchObject({
      kind: 'open-failed',
      path: 'C:\\Users\\amin_\\paper.md',
      title: 'Startup document did not open',
      detail: 'File access denied',
      failedAtMs: 42,
      canRetry: true,
    });
    expect(failure.message).toContain('paper.md');
    expect(startupOpenDiagnosticEvent(failure.kind)).toBe('startup-open-failed');
  });

  it('creates a retryable path lookup failure when no document path is known', () => {
    const failure = createStartupOpenFailure({
      kind: 'path-lookup-failed',
      error: 'Startup document path lookup took too long.',
      nowMs: 12,
    });

    expect(failure).toMatchObject({
      kind: 'path-lookup-failed',
      path: null,
      title: 'Startup document check failed',
      detail: 'Startup document path lookup took too long.',
      failedAtMs: 12,
      canRetry: true,
    });
    expect(startupOpenDiagnosticEvent(failure.kind)).toBe('startup-path-lookup-failed');
  });

  it('extracts readable names from Windows and POSIX startup paths', () => {
    expect(displayStartupOpenPath('C:\\Users\\amin_\\paper.md')).toBe('paper.md');
    expect(displayStartupOpenPath('/home/amin/paper.markdown')).toBe('paper.markdown');
  });
});
