import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToastMessage } from '../../components/ToastViewport';

interface ToastTimer {
  timeoutId: number | null;
  expiresAt: number;
  remainingMs: number;
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastIdRef = useRef(1);
  const timersRef = useRef(new Map<number, ToastTimer>());

  const clearToastTimer = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer?.timeoutId !== null && timer?.timeoutId !== undefined) window.clearTimeout(timer.timeoutId);
    timersRef.current.delete(id);
  }, []);

  const dismissToast = useCallback((id: number) => {
    clearToastTimer(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, [clearToastTimer]);

  const startToastTimer = useCallback((id: number, durationMs: number) => {
    clearToastTimer(id);
    const timeoutId = window.setTimeout(() => dismissToast(id), durationMs);
    timersRef.current.set(id, {
      timeoutId,
      expiresAt: Date.now() + durationMs,
      remainingMs: durationMs,
    });
  }, [clearToastTimer, dismissToast]);

  const pushToast = useCallback((text: string, tone: ToastMessage['tone'] = 'info') => {
    const id = toastIdRef.current;
    toastIdRef.current += 1;
    const durationMs = toastDurationForTone(tone);
    const nextToast: ToastMessage = { id, text, tone, durationMs };

    setToasts((current) => {
      const next = [...current, nextToast].slice(-4);
      const keptIds = new Set(next.map((toast) => toast.id));
      current.forEach((toast) => {
        if (!keptIds.has(toast.id)) clearToastTimer(toast.id);
      });
      return next;
    });

    if (durationMs !== null) startToastTimer(id, durationMs);
  }, [clearToastTimer, startToastTimer]);

  const pauseToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (!timer || timer.timeoutId === null) return;
    window.clearTimeout(timer.timeoutId);
    timer.timeoutId = null;
    timer.remainingMs = Math.max(0, timer.expiresAt - Date.now());
  }, []);

  const resumeToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (!timer || timer.timeoutId !== null) return;
    if (timer.remainingMs <= 0) {
      dismissToast(id);
      return;
    }
    const timeoutId = window.setTimeout(() => dismissToast(id), timer.remainingMs);
    timer.timeoutId = timeoutId;
    timer.expiresAt = Date.now() + timer.remainingMs;
  }, [dismissToast]);

  useEffect(() => () => {
    for (const timer of timersRef.current.values()) {
      if (timer.timeoutId !== null) window.clearTimeout(timer.timeoutId);
    }
    timersRef.current.clear();
  }, []);

  return { toasts, pushToast, dismissToast, pauseToast, resumeToast };
}

function toastDurationForTone(tone: ToastMessage['tone']): number | null {
  if (tone === 'error') return null;
  if (tone === 'warning') return 7000;
  return 4500;
}
