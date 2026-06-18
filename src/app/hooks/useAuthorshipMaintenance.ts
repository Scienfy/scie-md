import { useEffect } from 'react';
import { keepRecentAuthorshipMarks } from '../../markdown/authorship';
import type { AuthorshipMark } from '../../markdown/authorship';

export function useAuthorshipMaintenance(setAuthorshipMarks: (updater: (current: AuthorshipMark[]) => AuthorshipMark[]) => void): void {
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      setAuthorshipMarks((current) => keepRecentAuthorshipMarks(current, Date.now()));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [setAuthorshipMarks]);
}
