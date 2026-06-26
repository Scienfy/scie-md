import { useEffect, useRef, useState } from 'react';

interface TooltipState {
  text: string;
  title?: string;
  detail?: string;
  meta?: string;
  kind?: string;
  left: number;
  top: number;
  width: number;
  placement: 'above' | 'below' | 'left';
}

interface TooltipContent {
  text: string;
  title?: string;
  detail?: string;
  meta?: string;
  kind?: string;
  placement?: 'above' | 'below' | 'left';
}

const tooltipTargetSelector = [
  '[data-tooltip]',
  '[title]',
  'button[aria-label]',
  '[role="button"][aria-label]',
  '[role="menuitem"][aria-label]',
  '[role="menuitemradio"][aria-label]',
  '[role="tab"][aria-label]',
  'input[aria-label]',
  'select[aria-label]',
  'textarea[aria-label]',
].join(',');

const nativeTitleAttribute = 'data-native-title';
const nativeAriaLabelAttribute = 'data-native-aria-label';
const nativeAriaLabelPresentAttribute = 'data-native-aria-label-present';
const tooltipDescribedByAttribute = 'data-tooltip-described-by';
const tooltipId = 'scie-app-tooltip';

export function AppTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const activeTargetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const hide = () => {
      restoreTooltipTarget(activeTargetRef.current);
      activeTargetRef.current = null;
      setTooltip(null);
    };

    const showForTarget = (target: HTMLElement) => {
      if (target.closest('[data-citation-tooltip], .source-citation-tooltip, .cm-tooltip')) {
        hide();
        return;
      }

      const content = tooltipContent(target);
      if (!content) {
        hide();
        return;
      }

      if (activeTargetRef.current && activeTargetRef.current !== target) {
        restoreTooltipTarget(activeTargetRef.current);
      }
      activeTargetRef.current = target;
      prepareTooltipTarget(target, tooltipId);
      setTooltip(positionTooltip(target, content));
    };

    const handlePointerOver = (event: PointerEvent) => {
      const target = closestTooltipTarget(event.target);
      if (!target) {
        hide();
        return;
      }
      showForTarget(target);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const target = closestTooltipTarget(event.target);
      if (!target || target !== activeTargetRef.current) return;
      setTooltip((current) => current ? positionTooltip(target, current) : current);
    };

    const handlePointerOut = (event: PointerEvent) => {
      const active = activeTargetRef.current;
      if (!active) return;
      const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (related && active.contains(related)) return;
      hide();
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = closestTooltipTarget(event.target);
      if (target) showForTarget(target);
    };

    const handleFocusOut = () => hide();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };

    document.addEventListener('pointerover', handlePointerOver, true);
    document.addEventListener('pointermove', handlePointerMove, true);
    document.addEventListener('pointerout', handlePointerOut, true);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);

    return () => {
      hide();
      document.removeEventListener('pointerover', handlePointerOver, true);
      document.removeEventListener('pointermove', handlePointerMove, true);
      document.removeEventListener('pointerout', handlePointerOut, true);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('focusout', handleFocusOut, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, []);

  if (!tooltip) return null;

  return (
    <div
      id={tooltipId}
      className={[
        'app-tooltip',
        `app-tooltip-${tooltip.placement}`,
        tooltip.title || tooltip.detail || tooltip.meta ? 'app-tooltip-structured' : '',
        tooltip.kind ? `app-tooltip-kind-${tooltip.kind}` : '',
      ].filter(Boolean).join(' ')}
      role="tooltip"
      style={{ left: tooltip.left, top: tooltip.top, width: tooltip.width }}
    >
      {tooltip.title || tooltip.detail || tooltip.meta ? (
        <>
          <div className="app-tooltip-title-row">
            {tooltip.title && <strong className="app-tooltip-title">{tooltip.title}</strong>}
            {tooltip.meta && <span className="app-tooltip-meta">{tooltip.meta}</span>}
          </div>
          {tooltip.detail && <span className="app-tooltip-detail">{tooltip.detail}</span>}
        </>
      ) : tooltip.text}
    </div>
  );
}

function closestTooltipTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(tooltipTargetSelector);
}

function tooltipContent(target: HTMLElement): TooltipContent | null {
  const title = target.getAttribute('data-tooltip-title')?.trim();
  const detail = target.getAttribute('data-tooltip-detail')?.trim();
  const meta = target.getAttribute('data-tooltip-meta')?.trim();
  const kind = normalizeTooltipKind(target.getAttribute('data-tooltip-kind'));
  const placement = normalizeTooltipPlacement(target.getAttribute('data-tooltip-placement'));
  const dataTooltip = target.getAttribute('data-tooltip')?.trim();
  if (title || detail || meta) {
    const text = dataTooltip || [title, detail, meta].filter(Boolean).join('\n');
    return { text, title, detail, meta, kind, placement };
  }
  if (dataTooltip) return { text: dataTooltip, kind, placement };
  const nativeTitle = (target.getAttribute('title') ?? target.getAttribute(nativeTitleAttribute) ?? '').trim();
  if (nativeTitle) return { text: nativeTitle, kind, placement };
  if (isInteractiveTooltipTarget(target)) {
    const label = target.getAttribute('aria-label')?.trim() ?? '';
    return label ? { text: label, kind, placement } : null;
  }
  return null;
}

function isInteractiveTooltipTarget(target: HTMLElement): boolean {
  const tagName = target.tagName.toLowerCase();
  return tagName === 'button'
    || tagName === 'input'
    || tagName === 'select'
    || tagName === 'textarea'
    || target.getAttribute('role') === 'button'
    || target.getAttribute('role') === 'menuitem'
    || target.getAttribute('role') === 'menuitemradio'
    || target.getAttribute('role') === 'tab';
}

function prepareTooltipTarget(target: HTMLElement, describedById: string): void {
  suppressNativeTitle(target);
  describeTooltipTarget(target, describedById);
}

function restoreTooltipTarget(target: HTMLElement | null): void {
  restoreTooltipDescription(target);
  restoreNativeTitle(target);
}

function suppressNativeTitle(target: HTMLElement): void {
  const title = target.getAttribute('title');
  if (!title) return;
  if (!target.hasAttribute(nativeTitleAttribute)) target.setAttribute(nativeTitleAttribute, title);
  const ariaLabel = target.getAttribute('aria-label');
  if (isInteractiveTooltipTarget(target) && !ariaLabel?.trim() && !target.hasAttribute(nativeAriaLabelAttribute)) {
    target.setAttribute(nativeAriaLabelAttribute, ariaLabel ?? '');
    target.setAttribute(nativeAriaLabelPresentAttribute, target.hasAttribute('aria-label') ? 'true' : 'false');
    target.setAttribute('aria-label', title);
  }
  target.removeAttribute('title');
}

function restoreNativeTitle(target: HTMLElement | null): void {
  if (!target || !target.hasAttribute(nativeTitleAttribute)) return;
  if (!target.hasAttribute('title')) target.setAttribute('title', target.getAttribute(nativeTitleAttribute) ?? '');
  target.removeAttribute(nativeTitleAttribute);
  if (target.hasAttribute(nativeAriaLabelAttribute)) {
    if (target.getAttribute(nativeAriaLabelPresentAttribute) === 'true') {
      target.setAttribute('aria-label', target.getAttribute(nativeAriaLabelAttribute) ?? '');
    } else {
      target.removeAttribute('aria-label');
    }
    target.removeAttribute(nativeAriaLabelAttribute);
    target.removeAttribute(nativeAriaLabelPresentAttribute);
  }
}

function describeTooltipTarget(target: HTMLElement, describedById: string): void {
  if (target.hasAttribute(tooltipDescribedByAttribute)) return;
  const current = target.getAttribute('aria-describedby') ?? '';
  target.setAttribute(tooltipDescribedByAttribute, current);
  const ids = current.split(/\s+/).filter(Boolean);
  if (!ids.includes(describedById)) ids.push(describedById);
  target.setAttribute('aria-describedby', ids.join(' '));
}

function restoreTooltipDescription(target: HTMLElement | null): void {
  if (!target || !target.hasAttribute(tooltipDescribedByAttribute)) return;
  const original = target.getAttribute(tooltipDescribedByAttribute) ?? '';
  if (original.trim()) {
    target.setAttribute('aria-describedby', original);
  } else {
    target.removeAttribute('aria-describedby');
  }
  target.removeAttribute(tooltipDescribedByAttribute);
}

function normalizeTooltipKind(kind: string | null): string | undefined {
  const normalized = kind?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || undefined;
}

function normalizeTooltipPlacement(placement: string | null): 'left' | undefined {
  return placement?.trim().toLowerCase() === 'left' ? 'left' : undefined;
}

function positionTooltip(target: HTMLElement, content: TooltipContent): TooltipState {
  const rect = target.getBoundingClientRect();
  const viewportWidth = window.innerWidth || 0;
  const viewportHeight = window.innerHeight || 0;
  const estimatedWidth = estimateTooltipWidth(content, viewportWidth);
  if (content.placement === 'left') {
    return {
      ...content,
      left: Math.round(clamp(rect.left - 8, estimatedWidth + 8, viewportWidth - 8)),
      top: Math.round(clamp(rect.top + rect.height / 2, 12, viewportHeight - 12)),
      width: estimatedWidth,
      placement: 'left',
    };
  }
  const left = Math.round(clamp(rect.left + rect.width / 2, estimatedWidth / 2 + 8, viewportWidth - estimatedWidth / 2 - 8));
  const showBelow = rect.bottom + 42 <= viewportHeight || rect.top < 48;
  return {
    ...content,
    left,
    top: Math.round(showBelow ? rect.bottom + 8 : rect.top - 8),
    width: estimatedWidth,
    placement: showBelow ? 'below' : 'above',
  };
}

function estimateTooltipWidth(content: TooltipContent, viewportWidth: number): number {
  const longestLine = Math.max(...content.text.split('\n').map((line) => line.length), 0);
  const minimumWidth = content.title || content.detail ? 180 : 56;
  const desiredWidth = Math.min(320, Math.max(minimumWidth, longestLine * 6.6 + 30));
  return Math.ceil(Math.min(Math.max(48, viewportWidth - 16), desiredWidth));
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return value;
  return Math.min(max, Math.max(min, value));
}
