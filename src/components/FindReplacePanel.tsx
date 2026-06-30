import { ChevronDown, ChevronUp, Replace, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { findTextMatches, replaceTextMatch, replaceTextMatches } from '../markdown/findReplace';
import type { TextMatch } from '../markdown/findReplace';
import { parseProtectedBlocks } from '@sciemd/core';
import type { OffsetRange } from '@sciemd/core';

interface FindReplacePanelProps {
  markdown: string;
  onChange: (markdown: string) => void;
  onClose: () => void;
  onNavigate?: (match: TextMatch, context: { index: number; query: string; caseSensitive: boolean; line: number }) => void;
}

export function FindReplacePanel({ markdown, onChange, onClose, onNavigate }: FindReplacePanelProps) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const lastNavigatedSearchRef = useRef('');
  const protectedRanges = useMemo<OffsetRange[]>(
    () => parseProtectedBlocks(markdown).map((block) => ({ start: block.start, end: block.end })),
    [markdown],
  );
  const allMatches = useMemo(() => findTextMatches(markdown, query, caseSensitive), [caseSensitive, markdown, query]);
  const matches = useMemo(
    () => allMatches.filter((match) => !protectedRanges.some((range) => rangesOverlap(match, range))),
    [allMatches, protectedRanges],
  );
  const skippedProtectedMatches = allMatches.length - matches.length;
  const currentMatchIndex = matches.length > 0 ? Math.min(currentIndex, matches.length - 1) : -1;
  const currentMatch = currentMatchIndex >= 0 ? matches[currentMatchIndex] : undefined;

  useEffect(() => {
    if (matches.length === 0) {
      if (currentIndex !== 0) setCurrentIndex(0);
      return;
    }
    if (currentIndex >= matches.length) setCurrentIndex(matches.length - 1);
  }, [currentIndex, matches.length]);

  const navigateToIndex = (index: number) => {
    const match = matches[index];
    if (!match || !query) return;
    lastNavigatedSearchRef.current = searchSignature(query, caseSensitive);
    setCurrentIndex(index);
    onNavigate?.(match, { index, query, caseSensitive, line: lineForOffset(markdown, match.from) });
  };

  const step = (direction: 1 | -1) => {
    if (matches.length === 0) return;
    const nextIndex = (currentMatchIndex >= 0 ? currentMatchIndex + direction + matches.length : 0) % matches.length;
    navigateToIndex(nextIndex);
  };

  const replaceCurrent = () => {
    if (!currentMatch) return;
    onChange(replaceTextMatch(markdown, currentMatch, replacement));
    setCurrentIndex((current) => Math.max(0, current - 1));
  };

  const replaceAll = () => {
    if (!query) return;
    onChange(replaceTextMatches(markdown, matches, replacement));
    setCurrentIndex(0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      if (lastNavigatedSearchRef.current !== searchSignature(query, caseSensitive)) navigateToIndex(0);
      else step(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (lastNavigatedSearchRef.current !== searchSignature(query, caseSensitive)) navigateToIndex(0);
      else step(1);
    }
  };

  return (
    <section className="find-panel" aria-label="Find and replace" onKeyDown={handleKeyDown}>
      <label>
        <Search size={16} />
        <input
          autoFocus
          aria-label="Find text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCurrentIndex(0);
            lastNavigatedSearchRef.current = '';
          }}
          placeholder="Find"
        />
      </label>
      <label>
        <Replace size={16} />
        <input aria-label="Replacement text" value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder="Replace" />
      </label>
      <button aria-label="Previous match" title="Previous match" disabled={matches.length === 0} onClick={() => step(-1)}><ChevronUp size={16} /></button>
      <button aria-label="Next match" title="Next match" disabled={matches.length === 0} onClick={() => step(1)}><ChevronDown size={16} /></button>
      <button disabled={!currentMatch} onClick={replaceCurrent}>Replace</button>
      <button disabled={matches.length === 0} onClick={replaceAll}>All</button>
      <label className="compact-check">
        <input
          type="checkbox"
          checked={caseSensitive}
          onChange={(event) => {
            setCaseSensitive(event.target.checked);
            setCurrentIndex(0);
            lastNavigatedSearchRef.current = '';
          }}
        />
        Aa
      </label>
      <span className="find-count" title={skippedProtectedMatches > 0 ? `${skippedProtectedMatches} match${skippedProtectedMatches === 1 ? '' : 'es'} skipped inside locked sections` : undefined}>
        {matches.length === 0 ? '0 matches' : `${currentMatchIndex + 1} / ${matches.length}`}
        {skippedProtectedMatches > 0 ? ` (${skippedProtectedMatches} locked)` : ''}
      </span>
      <button aria-label="Close find" title="Close find" onClick={onClose}><X size={16} /></button>
    </section>
  );
}

function rangesOverlap(match: TextMatch, range: OffsetRange): boolean {
  return match.from < range.end && range.start < match.to;
}

function lineForOffset(markdown: string, offset: number): number {
  const safeOffset = Math.max(0, Math.min(offset, markdown.length));
  let line = 1;
  for (let index = 0; index < safeOffset; index += 1) {
    if (markdown[index] === '\n') line += 1;
  }
  return line;
}

function searchSignature(query: string, caseSensitive: boolean): string {
  return `${caseSensitive ? 'case' : 'fold'}:${query}`;
}
