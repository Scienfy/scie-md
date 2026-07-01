import { ChevronRight } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface ContextMenuSection<TMeta = unknown> {
  id?: string;
  label?: string;
  items: Array<ContextMenuItem<TMeta>>;
}

export interface ContextMenuItem<TMeta = unknown> {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  submenuHint?: string;
  disabled?: boolean;
  disabledReason?: string;
  danger?: boolean;
  checked?: boolean;
  role?: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio';
  submenu?: Array<ContextMenuSection<TMeta>>;
  meta?: TMeta;
  onSelect?: (item: ContextMenuItem<TMeta>) => void | Promise<void>;
}

export interface ContextMenuCardProps<TMeta = unknown> {
  sections: Array<ContextMenuSection<TMeta>>;
  position: ContextMenuPosition;
  ariaLabel?: string;
  className?: string;
  restoreFocusTo?: HTMLElement | null;
  onClose: () => void;
}

interface ViewportSize {
  width: number;
  height: number;
}

interface ElementSize {
  width: number;
  height: number;
}

interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface ResolvedPosition {
  left: number;
  top: number;
}

const VIEWPORT_GAP = 8;
const SUBMENU_OVERLAP = 2;
const FALLBACK_MENU_SIZE: ElementSize = { width: 236, height: 292 };
const FALLBACK_SUBMENU_SIZE: ElementSize = { width: 236, height: 210 };

export function getContextMenuPosition(
  position: ContextMenuPosition,
  menuSize: ElementSize = FALLBACK_MENU_SIZE,
  viewport: ViewportSize = getViewportSize(),
): ResolvedPosition {
  return {
    left: clamp(position.x, VIEWPORT_GAP, Math.max(VIEWPORT_GAP, viewport.width - menuSize.width - VIEWPORT_GAP)),
    top: clamp(position.y, VIEWPORT_GAP, Math.max(VIEWPORT_GAP, viewport.height - menuSize.height - VIEWPORT_GAP)),
  };
}

export function getContextSubmenuPosition(
  anchorRect: RectLike,
  submenuSize: ElementSize = FALLBACK_SUBMENU_SIZE,
  viewport: ViewportSize = getViewportSize(),
): ResolvedPosition {
  const rightLeft = anchorRect.right - SUBMENU_OVERLAP;
  const leftLeft = anchorRect.left - submenuSize.width + SUBMENU_OVERLAP;
  const hasRightRoom = rightLeft + submenuSize.width <= viewport.width - VIEWPORT_GAP;
  const hasLeftRoom = leftLeft >= VIEWPORT_GAP;
  const preferredLeft = hasRightRoom || !hasLeftRoom ? rightLeft : leftLeft;

  return {
    left: clamp(preferredLeft, VIEWPORT_GAP, Math.max(VIEWPORT_GAP, viewport.width - submenuSize.width - VIEWPORT_GAP)),
    top: clamp(anchorRect.top - 8, VIEWPORT_GAP, Math.max(VIEWPORT_GAP, viewport.height - submenuSize.height - VIEWPORT_GAP)),
  };
}

export function ContextMenuCard<TMeta = unknown>({
  sections,
  position,
  ariaLabel = 'Context menu',
  className,
  restoreFocusTo,
  onClose,
}: ContextMenuCardProps<TMeta>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fallbackFocusRef = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const closeOnEnvironmentChange = () => onClose();

    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    window.addEventListener('scroll', closeOnEnvironmentChange, true);
    window.addEventListener('resize', closeOnEnvironmentChange);
    window.addEventListener('blur', closeOnEnvironmentChange);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      window.removeEventListener('scroll', closeOnEnvironmentChange, true);
      window.removeEventListener('resize', closeOnEnvironmentChange);
      window.removeEventListener('blur', closeOnEnvironmentChange);
    };
  }, [onClose]);

  useEffect(() => () => {
    const target = restoreFocusTo ?? fallbackFocusRef.current;
    if (!target || !document.contains(target)) return;
    const activeElement = document.activeElement;
    const focusStayedInMenu = activeElement instanceof Node && Boolean(rootRef.current?.contains(activeElement));
    const focusIsUnset = !activeElement || activeElement === document.body;
    if (!focusStayedInMenu && !focusIsUnset) return;
    window.requestAnimationFrame(() => {
      if (document.contains(target)) target.focus({ preventScroll: true });
    });
  }, [restoreFocusTo]);

  return (
    <div ref={rootRef} className="context-menu-root">
      <ContextMenuSurface
        sections={sections}
        position={position}
        ariaLabel={ariaLabel}
        autoFocus
        className={className}
        onClose={onClose}
      />
    </div>
  );
}

function ContextMenuSurface<TMeta>({
  sections,
  position,
  anchorRect,
  ariaLabel,
  labelledBy,
  autoFocus,
  className,
  submenu,
  onClose,
  onReturnToParent,
}: {
  sections: Array<ContextMenuSection<TMeta>>;
  position?: ContextMenuPosition;
  anchorRect?: RectLike;
  ariaLabel?: string;
  labelledBy?: string;
  autoFocus?: boolean;
  className?: string;
  submenu?: boolean;
  onClose: () => void;
  onReturnToParent?: () => void;
}) {
  const surfaceId = useId();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const skipSubmenuFocusOpenRef = useRef<string | null>(null);
  const [resolvedPosition, setResolvedPosition] = useState<ResolvedPosition>(() => (
    anchorRect ? getContextSubmenuPosition(anchorRect) : getContextMenuPosition(position ?? { x: 0, y: 0 })
  ));
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  const [focusSubmenuOnOpen, setFocusSubmenuOnOpen] = useState(false);

  const renderableSections = useMemo(
    () => sections.map((section) => ({
      ...section,
      items: section.items.filter(Boolean),
    })).filter((section) => section.items.length > 0),
    [sections],
  );

  const menuItems = useMemo(
    () => renderableSections.flatMap((section) => section.items),
    [renderableSections],
  );

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    const measuredSize = surface ? measureElement(surface, submenu ? FALLBACK_SUBMENU_SIZE : FALLBACK_MENU_SIZE) : undefined;
    setResolvedPosition(
      anchorRect
        ? getContextSubmenuPosition(anchorRect, measuredSize)
        : getContextMenuPosition(position ?? { x: 0, y: 0 }, measuredSize),
    );
  }, [anchorRect, position, renderableSections, submenu]);

  useLayoutEffect(() => {
    const firstItem = menuItems[0];
    if (!firstItem) return;
    if (!activeItemId || !menuItems.some((item) => item.id === activeItemId)) {
      setActiveItemId(firstItem.id);
    }
  }, [activeItemId, menuItems]);

  useLayoutEffect(() => {
    if (!autoFocus) return;
    const firstItem = menuItems[0];
    if (!firstItem) return;
    setActiveItemId(firstItem.id);
  }, [autoFocus, menuItems]);

  useLayoutEffect(() => {
    if (!autoFocus || !activeItemId) return;
    itemRefs.current.get(activeItemId)?.focus();
  }, [activeItemId, autoFocus]);

  const activeItem = activeItemId ? menuItems.find((item) => item.id === activeItemId) ?? null : null;
  const openSubmenuItem = openSubmenuId ? menuItems.find((item) => item.id === openSubmenuId) ?? null : null;
  const openSubmenuButton = openSubmenuId ? itemRefs.current.get(openSubmenuId) : undefined;
  const openSubmenuAnchor = openSubmenuButton?.getBoundingClientRect();

  function focusItem(itemId: string) {
    setActiveItemId(itemId);
    itemRefs.current.get(itemId)?.focus();
  }

  function focusRelativeItem(direction: 1 | -1) {
    if (menuItems.length === 0) return;
    const currentIndex = activeItemId ? menuItems.findIndex((item) => item.id === activeItemId) : -1;
    const nextIndex = currentIndex === -1
      ? 0
      : (currentIndex + direction + menuItems.length) % menuItems.length;
    const nextItem = menuItems[nextIndex];
    if (nextItem) {
      setOpenSubmenuId(null);
      setFocusSubmenuOnOpen(false);
      focusItem(nextItem.id);
    }
  }

  function openItemSubmenu(item: ContextMenuItem<TMeta>, focusSubmenu: boolean) {
    if (item.disabled || !item.submenu?.length) return;
    setActiveItemId(item.id);
    setOpenSubmenuId(item.id);
    setFocusSubmenuOnOpen(focusSubmenu);
  }

  function closeSubmenuAndReturnFocus(parentItemId: string) {
    setOpenSubmenuId(null);
    setFocusSubmenuOnOpen(false);
    skipSubmenuFocusOpenRef.current = parentItemId;
    focusItem(parentItemId);
  }

  function activateItem(item: ContextMenuItem<TMeta>) {
    if (item.disabled) return;
    if (item.submenu?.length) {
      openItemSubmenu(item, true);
      return;
    }
    if (!item.onSelect) return;
    Promise.resolve(item.onSelect(item))
      .then(() => onClose())
      .catch((error: unknown) => {
        console.error('Context menu action failed', error);
      });
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const consume = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    const targetItemId = (event.target as HTMLElement | null)
      ?.closest<HTMLButtonElement>('[data-context-menu-item-id]')
      ?.dataset.contextMenuItemId;
    const currentItem = targetItemId
      ? menuItems.find((item) => item.id === targetItemId) ?? activeItem
      : activeItem;

    switch (event.key) {
      case 'ArrowDown':
        consume();
        focusRelativeItem(1);
        break;
      case 'ArrowUp':
        consume();
        focusRelativeItem(-1);
        break;
      case 'Home':
        consume();
        if (menuItems[0]) focusItem(menuItems[0].id);
        break;
      case 'End':
        consume();
        if (menuItems.at(-1)) focusItem(menuItems.at(-1)!.id);
        break;
      case 'ArrowRight':
        if (currentItem?.submenu?.length) {
          consume();
          openItemSubmenu(currentItem, true);
        }
        break;
      case 'ArrowLeft':
        if (submenu && onReturnToParent) {
          consume();
          onReturnToParent();
        }
        break;
      case 'Enter':
      case ' ':
        if (currentItem) {
          consume();
          activateItem(currentItem);
        }
        break;
      case 'Escape':
      case 'Tab':
        consume();
        onClose();
        break;
      default:
        break;
    }
  }

  return (
    <>
      <div
        ref={surfaceRef}
        role="menu"
        aria-label={labelledBy ? undefined : ariaLabel}
        aria-labelledby={labelledBy}
        className={[
          'context-menu-card',
          submenu ? 'context-menu-submenu' : '',
          className ?? '',
        ].filter(Boolean).join(' ')}
        style={{ left: resolvedPosition.left, top: resolvedPosition.top }}
        onKeyDown={onMenuKeyDown}
      >
        {renderableSections.map((section, sectionIndex) => (
          <MenuSection
            key={section.id ?? `${surfaceId}-section-${sectionIndex}`}
            section={section}
            sectionIndex={sectionIndex}
            surfaceId={surfaceId}
            itemRefs={itemRefs.current}
            activeItemId={activeItemId}
            openSubmenuId={openSubmenuId}
            showSeparator={sectionIndex > 0}
            onFocusItem={(item) => {
              setActiveItemId(item.id);
              if (skipSubmenuFocusOpenRef.current === item.id) {
                skipSubmenuFocusOpenRef.current = null;
                return;
              }
              if (item.submenu?.length) {
                openItemSubmenu(item, false);
              } else {
                setOpenSubmenuId(null);
                setFocusSubmenuOnOpen(false);
              }
            }}
            onHoverItem={(item) => {
              setActiveItemId(item.id);
              if (item.submenu?.length) {
                openItemSubmenu(item, false);
              } else {
                setOpenSubmenuId(null);
                setFocusSubmenuOnOpen(false);
              }
            }}
            onSelectItem={activateItem}
          />
        ))}
      </div>
      {openSubmenuItem?.submenu?.length && openSubmenuAnchor && (
        <ContextMenuSurface
          sections={openSubmenuItem.submenu}
          anchorRect={openSubmenuAnchor}
          labelledBy={`${surfaceId}-item-${openSubmenuItem.id}`}
          autoFocus={focusSubmenuOnOpen}
          submenu
          onClose={onClose}
          onReturnToParent={() => closeSubmenuAndReturnFocus(openSubmenuItem.id)}
        />
      )}
    </>
  );
}

function MenuSection<TMeta>({
  section,
  sectionIndex,
  surfaceId,
  itemRefs,
  activeItemId,
  openSubmenuId,
  showSeparator,
  onFocusItem,
  onHoverItem,
  onSelectItem,
}: {
  section: ContextMenuSection<TMeta>;
  sectionIndex: number;
  surfaceId: string;
  itemRefs: Map<string, HTMLButtonElement>;
  activeItemId: string | null;
  openSubmenuId: string | null;
  showSeparator: boolean;
  onFocusItem: (item: ContextMenuItem<TMeta>) => void;
  onHoverItem: (item: ContextMenuItem<TMeta>) => void;
  onSelectItem: (item: ContextMenuItem<TMeta>) => void;
}) {
  return (
    <div className="context-menu-section" role="presentation">
      {showSeparator && <div className="context-menu-separator" role="separator" aria-orientation="horizontal" />}
      {section.label && <div className="context-menu-section-label" role="presentation">{section.label}</div>}
      {section.items.map((item) => {
        const hasSubmenu = Boolean(item.submenu?.length);
        const isActive = item.id === activeItemId || item.id === openSubmenuId;
        const itemElementId = `${surfaceId}-item-${item.id}`;
        const shortcutText = item.shortcut ?? item.submenuHint ?? '';
        return (
          <button
            key={`${section.id ?? sectionIndex}-${item.id}`}
            id={itemElementId}
            data-context-menu-item-id={item.id}
            ref={(node) => {
              if (node) itemRefs.set(item.id, node);
              else itemRefs.delete(item.id);
            }}
            type="button"
            role={item.role ?? 'menuitem'}
            tabIndex={isActive ? 0 : -1}
            aria-disabled={item.disabled ? 'true' : undefined}
            aria-haspopup={hasSubmenu ? 'menu' : undefined}
            aria-expanded={hasSubmenu ? item.id === openSubmenuId : undefined}
            aria-checked={item.role === 'menuitemcheckbox' || item.role === 'menuitemradio' ? Boolean(item.checked) : undefined}
            title={item.disabledReason}
            className={[
              'context-menu-item',
              isActive ? 'is-active' : '',
              item.disabled ? 'is-disabled' : '',
              item.danger ? 'danger' : '',
              hasSubmenu ? 'has-submenu' : '',
              shortcutText ? 'has-shortcut' : '',
            ].filter(Boolean).join(' ')}
            onFocus={() => onFocusItem(item)}
            onMouseEnter={() => onHoverItem(item)}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelectItem(item);
            }}
          >
            <span className="context-menu-icon" aria-hidden="true">{item.icon}</span>
            <span className="context-menu-label">{item.label}</span>
            <span className="context-menu-shortcut">{shortcutText}</span>
            <span className="context-menu-chevron" aria-hidden="true">{hasSubmenu && <ChevronRight size={14} />}</span>
          </button>
        );
      })}
    </div>
  );
}

function getViewportSize(): ViewportSize {
  return {
    width: typeof window === 'undefined' ? 1024 : window.innerWidth,
    height: typeof window === 'undefined' ? 768 : window.innerHeight,
  };
}

function measureElement(element: HTMLElement, fallback: ElementSize): ElementSize {
  const rect = element.getBoundingClientRect();
  return {
    width: rect.width || element.offsetWidth || fallback.width,
    height: rect.height || element.offsetHeight || fallback.height,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
