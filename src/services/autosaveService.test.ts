import { describe, expect, it } from 'vitest';
import { BACKUP_INTERVAL_MS, markAutosaveBackupCreated, shouldCreateAutosaveBackup, shouldScheduleAutosave } from './autosaveService';

describe('autosaveService', () => {
  it('suppresses autosave when no file, clean, or in conflict', () => {
    expect(shouldScheduleAutosave({ filePath: null, dirty: true, conflictDetected: false })).toBe(false);
    expect(shouldScheduleAutosave({ filePath: '/tmp/a.md', dirty: false, conflictDetected: false })).toBe(false);
    expect(shouldScheduleAutosave({ filePath: '/tmp/a.md', dirty: true, conflictDetected: true })).toBe(false);
    expect(shouldScheduleAutosave({ filePath: '/tmp/a.md', dirty: true, conflictDetected: false })).toBe(true);
  });

  it('creates first autosave backup and then time-spaces later backups', () => {
    const initial = { sessionBackupDone: false, lastBackupAtMs: 0 };
    expect(shouldCreateAutosaveBackup(initial, 100)).toBe(true);

    const afterFirst = markAutosaveBackupCreated(initial, 100);
    expect(shouldCreateAutosaveBackup(afterFirst, 100 + BACKUP_INTERVAL_MS - 1)).toBe(false);
    expect(shouldCreateAutosaveBackup(afterFirst, 100 + BACKUP_INTERVAL_MS)).toBe(true);
  });
});
