import { useCallback, useEffect, useRef } from 'react';
import type { AutosaveStatus } from '../documentState';
import { AUTOSAVE_DELAY_MS, shouldScheduleAutosave } from '../../services/autosaveService';

interface UseAutosaveTimerOptions {
  filePath: string | null;
  markdown: string;
  dirty: boolean;
  externalConflict: boolean;
  autosaveBlocked?: boolean;
  saveCurrent: (options?: { autosave?: boolean; forceSaveAs?: boolean }) => Promise<string | false>;
  setAutosaveStatus: (status: AutosaveStatus) => void;
}

export function useAutosaveTimer({
  filePath,
  markdown,
  dirty,
  externalConflict,
  autosaveBlocked = false,
  saveCurrent,
  setAutosaveStatus,
}: UseAutosaveTimerOptions) {
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef<Promise<string | false> | null>(null);
  const rerunAfterSaveRef = useRef(false);
  const latestStateRef = useRef({ filePath, dirty, externalConflict, autosaveBlocked });

  latestStateRef.current = { filePath, dirty, externalConflict, autosaveBlocked };

  const cancelAutosave = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const runAutosave = useCallback(async () => {
    if (savingRef.current) {
      rerunAfterSaveRef.current = true;
      return savingRef.current;
    }

    const saveTask = (async () => {
      let result: string | false = false;
      do {
        rerunAfterSaveRef.current = false;
        result = await saveCurrent({ autosave: true });
      } while (
        rerunAfterSaveRef.current
        && !latestStateRef.current.autosaveBlocked
        && shouldScheduleAutosave({
          filePath: latestStateRef.current.filePath,
          dirty: latestStateRef.current.dirty,
          conflictDetected: latestStateRef.current.externalConflict,
        })
      );
      return result;
    })();

    savingRef.current = saveTask;
    try {
      return await saveTask;
    } finally {
      if (savingRef.current === saveTask) {
        savingRef.current = null;
      }
    }
  }, [saveCurrent]);

  const flushAutosave = useCallback(async () => {
    cancelAutosave();
    if (filePath && dirty && !autosaveBlocked) {
      return runAutosave();
    }
    if (filePath && dirty && autosaveBlocked) return false;
    return true;
  }, [autosaveBlocked, cancelAutosave, dirty, filePath, runAutosave]);

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
      void runAutosave().catch((error) => {
        console.warn('Autosave task failed before it could report status.', error);
        setAutosaveStatus('error');
      });
    }, AUTOSAVE_DELAY_MS);

    return cancelAutosave;
  }, [autosaveBlocked, cancelAutosave, dirty, externalConflict, filePath, markdown, runAutosave, setAutosaveStatus]);

  return { cancelAutosave, flushAutosave };
}
