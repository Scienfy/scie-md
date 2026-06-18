import { useCallback, useRef, useState } from 'react';

export interface PromptState {
  title: string;
  label: string;
  defaultValue?: string;
}

export interface ConfirmState {
  title: string;
  message: string;
  okLabel?: string;
  cancelLabel?: string;
}

type DialogRequest =
  | { kind: 'prompt'; state: PromptState; resolve: (value: string | null) => void }
  | { kind: 'confirm'; state: ConfirmState; resolve: (value: boolean) => void };

export function useDialogs() {
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const activeRequestRef = useRef<DialogRequest | null>(null);
  const queueRef = useRef<DialogRequest[]>([]);

  const showRequest = useCallback((request: DialogRequest) => {
    activeRequestRef.current = request;
    if (request.kind === 'prompt') {
      setPromptState(request.state);
      setConfirmState(null);
    } else {
      setConfirmState(request.state);
      setPromptState(null);
    }
  }, []);

  const enqueueRequest = useCallback((request: DialogRequest) => {
    if (activeRequestRef.current) {
      queueRef.current.push(request);
      return;
    }
    showRequest(request);
  }, [showRequest]);

  const showNextRequest = useCallback(() => {
    const next = queueRef.current.shift() ?? null;
    if (next) {
      showRequest(next);
      return;
    }
    activeRequestRef.current = null;
    setPromptState(null);
    setConfirmState(null);
  }, [showRequest]);

  const promptText = useCallback((state: PromptState): Promise<string | null> => {
    return new Promise((resolve) => {
      enqueueRequest({ kind: 'prompt', state, resolve });
    });
  }, [enqueueRequest]);

  const completePrompt = useCallback((value: string | null) => {
    const active = activeRequestRef.current;
    if (active?.kind === 'prompt') {
      active.resolve(value);
      activeRequestRef.current = null;
    }
    showNextRequest();
  }, [showNextRequest]);

  const confirmText = useCallback((state: ConfirmState): Promise<boolean> => {
    return new Promise((resolve) => {
      enqueueRequest({ kind: 'confirm', state, resolve });
    });
  }, [enqueueRequest]);

  const completeConfirm = useCallback((value: boolean) => {
    const active = activeRequestRef.current;
    if (active?.kind === 'confirm') {
      active.resolve(value);
      activeRequestRef.current = null;
    }
    showNextRequest();
  }, [showNextRequest]);

  return { promptState, confirmState, promptText, confirmText, completePrompt, completeConfirm };
}
