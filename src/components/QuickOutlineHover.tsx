import type { MarkdownHeading } from '@sciemd/core';
import { Copy, MapPin } from 'lucide-react';
import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ContextMenuCard, type ContextMenuSection } from './ContextMenuCard';
import {
  copyContextMenuItem,
  copyContextMenuSection,
  openContextMenuFromEvent,
  openContextMenuFromKeyboard,
  type ContextMenuCopyFeedback,
  type ContextMenuOpenState,
} from './contextMenuUtils';

interface QuickOutlineHoverProps {
  headings: MarkdownHeading[];
  activeHeadingId?: string | null;
  onJump: (heading: MarkdownHeading) => void;
  onCopyFeedback?: ContextMenuCopyFeedback;
}

export function QuickOutlineHover({ headings, activeHeadingId, onJump, onCopyFeedback }: QuickOutlineHoverProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuOpenState | null>(null);
  if (headings.length === 0) return null;

  const markerHeadings = primarySectionHeadings(headings);
  const activeMarkerId = activePrimaryHeadingId(headings, markerHeadings, activeHeadingId);
  const headingMenuState = (heading: MarkdownHeading): Omit<ContextMenuOpenState, 'position'> => ({
    ariaLabel: `Actions for heading ${heading.text}`,
    sections: quickOutlineHeadingMenuSections(heading, onJump, onCopyFeedback),
  });
  const openHeadingMenu = (event: MouseEvent<HTMLElement>, heading: MarkdownHeading) => {
    openContextMenuFromEvent(event, setContextMenu, headingMenuState(heading));
  };
  const openHeadingKeyboardMenu = (event: KeyboardEvent<HTMLElement>, heading: MarkdownHeading) => {
    openContextMenuFromKeyboard(event, setContextMenu, headingMenuState(heading));
  };

  return (
    <nav className="quick-outline" aria-label="Quick outline">
      <button
        type="button"
        className="quick-outline-trigger"
        aria-label="Show document outline"
        aria-haspopup="true"
      >
        {markerHeadings.length > 0 ? (
          markerHeadings.map((heading) => (
            <span
              key={`${heading.id}:${heading.line}`}
              className={`quick-outline-dash level-${Math.min(6, Math.max(1, heading.level))} ${heading.id === activeMarkerId ? 'active' : ''}`}
              aria-hidden="true"
            />
          ))
        ) : (
          <span className="quick-outline-dash level-1" aria-hidden="true" />
        )}
      </button>

      <div className="quick-outline-card">
        {headings.map((heading) => (
          <button
            key={`${heading.id}:${heading.line}`}
            type="button"
            className={`quick-outline-item level-${heading.level} ${heading.id === activeHeadingId ? 'active' : ''}`}
            onClick={() => onJump(heading)}
            onKeyDown={(event) => openHeadingKeyboardMenu(event, heading)}
            onContextMenu={(event) => openHeadingMenu(event, heading)}
            title={heading.text}
          >
            <span className="quick-outline-item-dash" aria-hidden="true" />
            <span className="quick-outline-item-text">{heading.text}</span>
          </button>
        ))}
      </div>
      {contextMenu && (
        <ContextMenuCard
          ariaLabel={contextMenu.ariaLabel}
          sections={contextMenu.sections}
          position={contextMenu.position}
          restoreFocusTo={contextMenu.restoreFocusTo}
          onClose={() => setContextMenu(null)}
        />
      )}
    </nav>
  );
}

function quickOutlineHeadingMenuSections(
  heading: MarkdownHeading,
  onJump: (heading: MarkdownHeading) => void,
  onCopyFeedback?: ContextMenuCopyFeedback,
): ContextMenuSection[] {
  return [
    {
      items: [
        {
          id: 'jump-heading',
          label: 'Jump to heading',
          icon: <MapPin size={16} />,
          onSelect: () => onJump(heading),
        },
      ],
    },
    copyContextMenuSection('copy-heading', 'Copy', <Copy size={16} />, [
      copyContextMenuItem({
        id: 'copy-heading-text',
        label: 'Copy heading text',
        icon: <Copy size={16} />,
        text: heading.text,
        onCopyFeedback,
      }),
      copyContextMenuItem({
        id: 'copy-heading-line',
        label: 'Copy line number',
        icon: <Copy size={16} />,
        text: String(heading.line),
        onCopyFeedback,
      }),
    ]),
  ];
}

function primarySectionHeadings(headings: MarkdownHeading[]): MarkdownHeading[] {
  if (headings.length === 0) return [];

  const levelOne = headings.filter((heading) => heading.level === 1);
  if (levelOne.length > 1) return levelOne;

  const levelTwo = headings.filter((heading) => heading.level === 2);
  if (levelTwo.length > 0) return levelTwo;

  if (levelOne.length === 1) return levelOne;

  const shallowest = Math.min(...headings.map((heading) => heading.level));
  return headings.filter((heading) => heading.level === shallowest);
}

function activePrimaryHeadingId(
  headings: MarkdownHeading[],
  primaryHeadings: MarkdownHeading[],
  activeHeadingId?: string | null,
): string | null {
  if (primaryHeadings.length === 0) return null;
  const activeHeading = headings.find((heading) => heading.id === activeHeadingId);
  if (!activeHeading) return primaryHeadings[0]?.id ?? null;

  let activePrimary = primaryHeadings[0];
  for (const heading of primaryHeadings) {
    if (heading.line > activeHeading.line) break;
    activePrimary = heading;
  }
  return activePrimary?.id ?? null;
}
