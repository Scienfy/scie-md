import { useEffect, useState } from 'react';
import type { ReviewUnit } from '../markdown/reviewPlan';

interface ReviewUnitBodyProps {
  unit: ReviewUnit;
  beforeLabel?: string;
  afterLabel?: string;
  selectedPane?: 'before' | 'after' | null;
}

interface MarkdownPreviewPaneProps {
  label: string;
  markdown: string;
  tone: 'before' | 'after';
  selected: boolean;
}

export function ReviewUnitBody({
  unit,
  beforeLabel = 'Original',
  afterLabel = 'Edited',
  selectedPane = null,
}: ReviewUnitBodyProps) {
  return (
    <div className="review-unit-body">
      <div className="review-unit-location">
        <span>Document lines {unit.beforeStart + 1}-{Math.max(unit.beforeStart + 1, unit.beforeEnd)}</span>
      </div>
      <div className="review-visual-grid">
        <MarkdownPreviewPane
          label={beforeLabel}
          markdown={unit.beforeMarkdown}
          tone="before"
          selected={selectedPane === 'before'}
        />
        <MarkdownPreviewPane
          label={afterLabel}
          markdown={unit.afterMarkdown}
          tone="after"
          selected={selectedPane === 'after'}
        />
      </div>
    </div>
  );
}

function MarkdownPreviewPane({ label, markdown, tone, selected }: MarkdownPreviewPaneProps) {
  const [html, setHtml] = useState(() => fallbackMarkdownHtml(markdown));
  const hasMarkdown = markdown.trim().length > 0;

  useEffect(() => {
    let cancelled = false;
    if (!hasMarkdown) {
      setHtml('');
      return () => {
        cancelled = true;
      };
    }
    setHtml(fallbackMarkdownHtml(markdown));
    void import('../markdown/htmlExport').then((module) => module.renderMarkdownHtmlFragment(markdown, null, {
      prepareOutput: false,
      embedImages: false,
      renderMermaid: false,
      renderSvg: false,
    })).then((rendered) => {
      if (!cancelled) setHtml(rendered);
    }).catch(() => {
      if (!cancelled) setHtml(`<p>${escapeHtml(markdown)}</p>`);
    });
    return () => {
      cancelled = true;
    };
  }, [hasMarkdown, markdown]);

  return (
    <section className={`review-preview-pane ${tone} ${selected ? 'selected' : ''}`}>
      <header>
        <span>{label}</span>
        {selected && <strong>Selected</strong>}
      </header>
      {hasMarkdown ? (
        <div className="review-preview-prose" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="review-preview-empty">No visible text.</div>
      )}
    </section>
  );
}

function fallbackMarkdownHtml(markdown: string): string {
  return markdown
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeBasicInlineMarkdown(paragraph)}</p>`)
    .join('');
}

function escapeBasicInlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
