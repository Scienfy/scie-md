import { useCallback, useEffect, useRef } from 'react';
import type { AutosaveStatus } from '../documentState';
import { AUTOSAVE_DELAY_MS, shouldScheduleAutosave } from '../../services/autosaveService';

interface UseAutosaveTimerOptions {
  filePath: string | null;
  dirty: boolean;
  externalConflict: boolean;
  autosaveBlocked?: boolean;
  saveCurrent: (options?: { autosave?: boolean; forceSaveAs?: boolean }) => Promise<string | false>;
  setAutosaveStatus: (status: AutosaveStatus) => void;
}

export function useAutosaveTimer({
  filePath,
  dirty,
  externalConflict,
  autosaveBlocked = false,
  saveCurrent,
  setAutosaveStatus,
}: UseAutosaveTimerOptions) {
  const timerRef = useRef<number | null>(null);

  const cancelAutosave = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flushAutosave = useCallback(async () => {
    cancelAutosave();
    if (filePath && dirty && !autosaveBlocked) {
      return saveCurrent({ autosave: true });
    }
    if (filePath && dirty && autosaveBlocked) return false;
    return true;
  }, [autosaveBlocked, cancelAutosave, dirty, filePath, saveCurrent]);

  useEffect(() => {
    cancelAutosave();

    if (!filePath) {
      setAutosaveStatus('idle');
      return undefined;
    }

    if (!shouldScheduleAutosave({ filePath, dirty, conflictDetected: externalConflict })) return undefined;

    setAutosaveStatus('pending');
    if (autosaveBlocked) return undefined;

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void saveCurrent({ autosave: true });
    }, AUTOSAVE_DELAY_MS);

    return cancelAutosave;
  }, [autosaveBlocked, cancelAutosave, dirty, externalConflict, filePath, saveCurrent, setAutosaveStatus]);

  return { cancelAutosave, flushAutosave };
}
