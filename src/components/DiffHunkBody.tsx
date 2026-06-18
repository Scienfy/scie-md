import type { DiffHunk, DiffLine } from '../markdown/diffReview';

export type DiffViewMode = 'inline' | 'side-by-side';

interface DiffHunkBodyProps {
  hunk: DiffHunk;
  mode: DiffViewMode;
  removedPrefix: string;
  addedPrefix: string;
  beforeLabel: string;
  afterLabel: string;
}

export function DiffHunkBody({
  hunk,
  mode,
  removedPrefix,
  addedPrefix,
  beforeLabel,
  afterLabel,
}: DiffHunkBodyProps) {
  if (mode === 'side-by-side') {
    return (
      <div className="diff-side-by-side">
        <DiffPane
          label={beforeLabel}
          lines={hunk.diffLines.filter((line) => line.kind === 'removed')}
          prefix={removedPrefix}
        />
        <DiffPane
          label={afterLabel}
          lines={hunk.diffLines.filter((line) => line.kind === 'added')}
          prefix={addedPrefix}
        />
      </div>
    );
  }

  return (
    <pre>
      {hunk.diffLines.map((line, index) => (
        <DiffCodeLine key={`${hunk.id}-${index}`} line={line} prefix={line.kind === 'added' ? addedPrefix : removedPrefix} />
      ))}
    </pre>
  );
}

function DiffPane({ label, lines, prefix }: { label: string; lines: DiffLine[]; prefix: string }) {
  return (
    <section className="diff-pane">
      <header>{label}</header>
      <pre>
        {lines.length === 0 ? (
          <code className="empty">No changes in this side.</code>
        ) : (
          lines.map((line, index) => (
            <DiffCodeLine key={`${label}-${index}`} line={line} prefix={prefix} />
          ))
        )}
      </pre>
    </section>
  );
}

function DiffCodeLine({ line, prefix }: { line: DiffLine; prefix: string }) {
  return (
    <code className={line.kind}>
      {prefix}
      {line.segments
        ? line.segments.map((segment, segmentIndex) => (
          <span key={segmentIndex} className={`diff-segment ${segment.kind}`}>{segment.text || ' '}</span>
        ))
        : line.text || ' '}
    </code>
  );
}
