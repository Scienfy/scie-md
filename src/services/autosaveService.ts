export const AUTOSAVE_DELAY_MS = 5000;
export const BACKUP_INTERVAL_MS = 10 * 60 * 1000;

export interface BackupScheduleState {
  sessionBackupDone: boolean;
  lastBackupAtMs: number;
}

export interface AutosaveScheduleInput {
  filePath: string | null;
  dirty: boolean;
  conflictDetected: boolean;
}

export function shouldScheduleAutosave({ filePath, dirty, conflictDetected }: AutosaveScheduleInput): boolean {
  return Boolean(filePath && dirty && !conflictDetected);
}

export function shouldCreateAutosaveBackup(state: BackupScheduleState, nowMs: number, intervalMs = BACKUP_INTERVAL_MS): boolean {
  return !state.sessionBackupDone || nowMs - state.lastBackupAtMs >= intervalMs;
}

export function markAutosaveBackupCreated(state: BackupScheduleState, nowMs: number): BackupScheduleState {
  return {
    ...state,
    sessionBackupDone: true,
    lastBackupAtMs: nowMs,
  };
}
