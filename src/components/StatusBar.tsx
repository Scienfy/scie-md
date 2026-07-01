import { Copy, MapPin, RotateCcw } from 'lucide-react';
import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { AutosaveStatus } from '../app/documentState';
import type { MarkdownHeading } from '@sciemd/core';
import { MARKDOWN_UI_CAPABILITIES, type FormatUiCapabilities } from '../app/formatCapabilities';
import { ContextMenuCard, type ContextMenuSection } from './ContextMenuCard';
import {
  copyContextMenuItem,
  copyContextMenuSection,
  openContextMenuFromEvent,
  openContextMenuFromKeyboard,
  type ContextMenuCopyFeedback,
  type ContextMenuOpenState,
} from './contextMenuUtils';

interface StatusBarProps {
  formatCapabilities?: FormatUiCapabilities;
  autosaveStatus: AutosaveStatus;
  statusText: string;
  headingPath: MarkdownHeading[];
  wordCount: number;
  manuscriptScore: number;
  manuscriptStatus: 'ready' | 'needs-review' | 'blocked';
  errors: string[];
  warnings: string[];
  externalConflict: boolean;
  filePath: string | null;
  onReviewConflict: () => void;
  onSaveAnyway: () => void;
  onReveal: () => void;
  onReload: () => void;
  onJumpToHeading: (heading: MarkdownHeading) => void;
  onOpenReadiness: () => void;
  onOpenValidation: () => void;
  onSaveNow: () => void;
  onCopyFeedback?: ContextMenuCopyFeedback;
}

export function StatusBar({
  formatCapabilities = MARKDOWN_UI_CAPABILITIES,
  autosaveStatus,
  statusText,
  headingPath,
  wordCount,
  manuscriptScore,
  manuscriptStatus,
  errors,
  warnings,
  externalConflict,
  filePath,
  onReviewConflict,
  onSaveAnyway,
  onReveal,
  onReload,
  onJumpToHeading,
  onOpenReadiness,
  onOpenValidation,
  onSaveNow,
  onCopyFeedback,
}: StatusBarProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuOpenState | null>(null);
  const score = Math.max(0, Math.min(100, manuscriptScore));
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;
  const currentHeading = headingPath.at(-1);
  const currentHeadingPath = headingPath.map((heading) => heading.text).join(' / ');
  const showManuscriptStatus = formatCapabilities.canUseManuscriptReadiness;
  const currentHeadingMenuState = currentHeading
    ? statusHeadingMenuState(currentHeading, currentHeadingPath, onJumpToHeading, onCopyFeedback)
    : null;
  const openCurrentHeadingMenu = (event: MouseEvent<HTMLElement>) => {
    if (!currentHeadingMenuState) return;
    openContextMenuFromEvent(event, setContextMenu, currentHeadingMenuState);
  };
  const openCurrentHeadingKeyboardMenu = (event: KeyboardEvent<HTMLElement>) => {
    if (!currentHeadingMenuState) return;
    openContextMenuFromKeyboard(event, setContextMenu, currentHeadingMenuState);
  };

  return (
    <footer className="statusbar">
      <div className="status-left">
        <span className={`status-dot ${autosaveStatus}`} />
        <span className="status-save-text">{statusText}</span>
        {!filePath && (
          <button type="button" className="status-inline-action warning" onClick={onSaveNow}>
            Save now
          </button>
        )}
        {showManuscriptStatus && currentHeading && (
          <nav className="status-breadcrumb" aria-label="Current section">
            <span className="status-breadcrumb-segment">
              <button
                type="button"
                onClick={() => onJumpToHeading(currentHeading)}
                onKeyDown={openCurrentHeadingKeyboardMenu}
                onContextMenu={openCurrentHeadingMenu}
                title={`Current section: ${currentHeadingPath}`}
              >
                {currentHeading.text}
              </button>
            </span>
          </nav>
        )}
        {showManuscriptStatus && <span className="status-word-count">{wordCount.toLocaleString()} words</span>}
        {showManuscriptStatus && (
          <button
            type="button"
            className={`status-readiness ${manuscriptStatus}`}
            aria-label={`Submission readiness ${score} out of 100. Open review panel.`}
            title={`Submission readiness ${score}/100. Open review panel.`}
            onClick={onOpenReadiness}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="10" cy="10" r={radius} />
              <circle cx="10" cy="10" r={radius} style={{ strokeDasharray: circumference, strokeDashoffset }} />
            </svg>
            <span className="status-readiness-label">Readiness</span>
            <span>{score}</span>
          </button>
        )}
        {errors.length > 0 && (
          <button type="button" className="status-badge error" aria-label={`${errors.length} validation errors. Open validation panel.`} title={`${errors[0]} Open validation panel.`} onClick={onOpenValidation}>
            {errors.length}
          </button>
        )}
        {warnings.length > 0 && (
          <button type="button" className="status-badge warning" aria-label={`${warnings.length} validation warnings. Open validation panel.`} title={`${warnings[0]} Open validation panel.`} onClick={onOpenValidation}>
            {warnings.length}
          </button>
        )}
      </div>
      <div className="status-actions">
        {externalConflict && filePath && <button type="button" onClick={onReviewConflict}>Review Disk Changes</button>}
        {externalConflict && filePath && <button type="button" onClick={onSaveAnyway}>Save Anyway</button>}
        {filePath && <button type="button" onClick={onReveal}>Reveal in Explorer</button>}
        <button type="button" aria-label="Reload from disk" title="Reload from disk" disabled={!filePath} onClick={onReload}>
          <RotateCcw size={15} />Reload
        </button>
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
    </footer>
  );
}

function statusHeadingMenuState(
  heading: MarkdownHeading,
  headingPath: string,
  onJumpToHeading: (heading: MarkdownHeading) => void,
  onCopyFeedback?: ContextMenuCopyFeedback,
): Omit<ContextMenuOpenState, 'position'> {
  const sections: ContextMenuSection[] = [
    {
      items: [
        {
          id: 'jump-heading',
          label: 'Jump to heading',
          icon: <MapPin size={16} />,
          onSelect: () => onJumpToHeading(heading),
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
        id: 'copy-section-path',
        label: 'Copy section path',
        icon: <Copy size={16} />,
        text: headingPath || heading.text,
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
  return {
    ariaLabel: `Actions for current section ${heading.text}`,
    sections,
  };
}
