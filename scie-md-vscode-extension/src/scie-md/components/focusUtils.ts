export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'details summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisibleFocusable);
}

export function focusFirstElement(root: HTMLElement | null): void {
  const first = getFocusableElements(root)[0];
  (first ?? root)?.focus();
}

export function trapTabKey(root: HTMLElement | null, event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>): boolean {
  if (event.key !== 'Tab') return false;
  const focusable = getFocusableElements(root);
  if (focusable.length === 0) {
    event.preventDefault();
    root?.focus();
    return true;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  if (!active || !root?.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return true;
  }

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
    return true;
  }

  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }

  return false;
}

function isVisibleFocusable(element: HTMLElement): boolean {
  if (element.hasAttribute('disabled') || element.getAttribute('aria-hidden') === 'true') return false;
  if (element.hidden || element.closest('[hidden]')) return false;
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return true;
}
