import { useCallback, useRef, useState } from 'react';

export function useStableRegistration<T>() {
  const handlerRef = useRef<T | undefined>(undefined);
  const [handler, setHandler] = useState<T | undefined>();

  const register = useCallback((nextHandler: T | undefined) => {
    if (handlerRef.current === nextHandler) return;
    handlerRef.current = nextHandler;
    setHandler(() => nextHandler);
  }, []);

  return [handler, register] as const;
}
