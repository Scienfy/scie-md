import { useCallback, useEffect, useRef } from 'react';
import type { AutosaveStatus } from '../documentState';
import { AUTOSAVE_DELAY_MS, AUTOSAVE_MAX_WAIT_MS, shouldScheduleAutosave } from '../../services/autosaveService';

interface UseAutosaveTimerOptions {
  filePath: string | null;
  sourceText: string;
  dirty: boolean;
  externalConflict: boolean;
  autosaveBlocked?: boolean;
  saveCurrent: (options?: { autosave?: boolean; forceSaveAs?: boolean }) => Promise<string | false>;
  setAutosaveStatus: (status: AutosaveStatus) => void;
}

export function useAutosaveTimer({
  filePath,
  sourceText,
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
  const firstPendingAtRef = useRef<number | null>(null);

  latestStateRef.current = { filePath, dirty, externalConflict, autosaveBlocked };

  const cancelAutosave = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetPendingWindow = useCallback(() => {
    firstPendingAtRef.current = null;
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
        resetPendingWindow();
      }
    }
  }, [resetPendingWindow, saveCurrent]);

  const flushAutosave = useCallback(async () => {
    cancelAutosave();
    if (filePath && dirty && !autosaveBlocked) {
      return runAutosave();
    }
    if (filePath && dirty && autosaveBlocked) return false;
    resetPendingWindow();
    return true;
  }, [autosaveBlocked, cancelAutosave, dirty, filePath, resetPendingWindow, runAutosave]);

  const scheduleAutosave = useCallback(() => {
    cancelAutosave();

    if (!filePath) {
      resetPendingWindow();
      setAutosaveStatus('idle');
      return;
    }

    if (!shouldScheduleAutosave({ filePath, dirty, conflictDetected: externalConflict })) {
      resetPendingWindow();
      return;
    }

    setAutosaveStatus('pending');
    if (autosaveBlocked) {
      setAutosaveStatus('paused');
      return;
    }

    const now = Date.now();
    firstPendingAtRef.current ??= now;
    const elapsed = now - firstPendingAtRef.current;
    const maxWaitRemaining = Math.max(0, AUTOSAVE_MAX_WAIT_MS - elapsed);
    const delay = Math.min(AUTOSAVE_DELAY_MS, maxWaitRemaining);

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void runAutosave().catch((error) => {
        console.warn('Autosave task failed before it could report status.', error);
        resetPendingWindow();
        setAutosaveStatus('error');
      });
    }, delay);
  }, [
    autosaveBlocked,
    cancelAutosave,
    dirty,
    externalConflict,
    filePath,
    resetPendingWindow,
    runAutosave,
    setAutosaveStatus,
  ]);

  const resumeAutosave = useCallback(() => {
    scheduleAutosave();
  }, [scheduleAutosave]);

  useEffect(() => {
    scheduleAutosave();

    return cancelAutosave;
  }, [cancelAutosave, scheduleAutosave, sourceText]);

  return { cancelAutosave, flushAutosave, resumeAutosave };
}
