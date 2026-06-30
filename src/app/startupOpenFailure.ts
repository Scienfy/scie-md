export type StartupOpenFailureKind = 'path-lookup-failed' | 'open-failed';

export interface StartupOpenFailureState {
  kind: StartupOpenFailureKind;
  path: string | null;
  title: string;
  message: string;
  detail: string | null;
  failedAtMs: number;
  canRetry: boolean;
}

interface StartupOpenFailureParams {
  kind: StartupOpenFailureKind;
  path?: string | null;
  error?: unknown;
  nowMs?: number;
}

export function createStartupOpenFailure({
  kind,
  path = null,
  error,
  nowMs = Date.now(),
}: StartupOpenFailureParams): StartupOpenFailureState {
  const detail = summarizeStartupOpenError(error);
  if (kind === 'open-failed') {
    const target = path ? displayStartupOpenPath(path) : 'the startup document';
    return {
      kind,
      path,
      title: 'Startup document did not open',
      message: `ScieMD opened a fallback workspace because ${target} could not be opened.`,
      detail,
      failedAtMs: nowMs,
      canRetry: Boolean(path?.trim()),
    };
  }
  return {
    kind,
    path: null,
    title: 'Startup document check failed',
    message: 'ScieMD opened a fallback workspace because the startup document path could not be resolved.',
    detail,
    failedAtMs: nowMs,
    canRetry: true,
  };
}

export function startupOpenDiagnosticEvent(kind: StartupOpenFailureKind): string {
  return kind === 'open-failed'
    ? 'startup-open-failed'
    : 'startup-path-lookup-failed';
}

export function displayStartupOpenPath(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? path;
}

function summarizeStartupOpenError(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  return String(error);
}
