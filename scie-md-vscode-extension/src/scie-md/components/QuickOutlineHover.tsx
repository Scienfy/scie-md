import type { MarkdownHeading } from '../markdown/outline';

interface QuickOutlineHoverProps {
  headings: MarkdownHeading[];
  activeHeadingId?: string | null;
  onJump: (heading: MarkdownHeading) => void;
}

export function QuickOutlineHover({ headings, activeHeadingId, onJump }: QuickOutlineHoverProps) {
  const markerHeadings = primarySectionHeadings(headings);
  const activeMarkerId = activePrimaryHeadingId(headings, markerHeadings, activeHeadingId);

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
        {headings.length === 0 ? (
          <p className="quick-outline-empty">No headings</p>
        ) : (
          <>
            {headings.map((heading) => (
              <button
                key={`${heading.id}:${heading.line}`}
                type="button"
                className={`quick-outline-item level-${heading.level} ${heading.id === activeHeadingId ? 'active' : ''}`}
                onClick={() => onJump(heading)}
                title={heading.text}
              >
                <span className="quick-outline-item-dash" aria-hidden="true" />
                <span className="quick-outline-item-text">{heading.text}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </nav>
  );
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
