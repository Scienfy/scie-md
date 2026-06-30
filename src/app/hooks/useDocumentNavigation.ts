import { useCallback, useState } from 'react';
import type { EditorMode } from '../documentState';
import type { SourceMarkdownFind, SourceMarkdownJump } from '../../components/SourceMarkdownEditor';
import type { VisualMarkdownFind, VisualMarkdownJump, VisualMarkdownJumpTarget } from '../../components/VisualMarkdownEditor';
import type { MarkdownHeading } from '@sciemd/core';
import { useEditorJumpCoordination } from './useEditorJumpCoordination';

interface DocumentNavigationParams {
  mode: EditorMode;
  setMode: (mode: EditorMode) => void;
  headings: MarkdownHeading[];
  sourceJumpHandler: SourceMarkdownJump | undefined;
  sourceFindHandler: SourceMarkdownFind | undefined;
  visualJumpHandler: VisualMarkdownJump | undefined;
  visualFindHandler: VisualMarkdownFind | undefined;
}

interface FindNavigationRequest {
  from: number;
  to: number;
  query: string;
  index: number;
  caseSensitive: boolean;
  line: number;
}

export function useDocumentNavigation({
  mode,
  setMode,
  headings,
  sourceJumpHandler,
  sourceFindHandler,
  visualJumpHandler,
  visualFindHandler,
}: DocumentNavigationParams) {
  const [currentLine, setCurrentLine] = useState(1);
  const [currentColumn, setCurrentColumn] = useState(1);
  const [activeNavigationLine, setActiveNavigationLine] = useState(1);
  const [pendingJumpLine, setPendingJumpLine] = useState<number | null>(null);
  const [pendingVisualJump, setPendingVisualJump] = useState<VisualMarkdownJumpTarget | null>(null);
  const [pendingFindMatch, setPendingFindMatch] = useState<FindNavigationRequest | null>(null);

  useEditorJumpCoordination({
    mode,
    pendingJumpLine,
    pendingVisualJump,
    pendingFindMatch,
    sourceJumpHandler,
    visualJumpHandler,
    sourceFindHandler,
    visualFindHandler,
    setPendingJumpLine,
    setPendingVisualJump,
    setPendingFindMatch,
  });

  const handleCursorPositionChange = useCallback((line: number, column: number) => {
    setCurrentLine(line);
    setCurrentColumn(column);
    if (mode === 'source') setActiveNavigationLine(line);
  }, [mode]);

  const handleViewportLineChange = useCallback((line: number) => {
    setActiveNavigationLine(Math.max(1, Math.floor(line)));
  }, []);

  const visualJumpTargetForHeading = useCallback((heading: MarkdownHeading): VisualMarkdownJumpTarget => {
    const occurrence = headings
      .filter((candidate) => candidate.line <= heading.line && candidate.level === heading.level && candidate.text === heading.text)
      .length - 1;
    return { id: heading.id, level: heading.level, text: heading.text, line: heading.line, occurrence: Math.max(0, occurrence) };
  }, [headings]);

  const jumpToHeading = useCallback((heading: MarkdownHeading) => {
    setCurrentLine(heading.line);
    setCurrentColumn(1);
    setActiveNavigationLine(heading.line);
    if (mode === 'visual') {
      const target = visualJumpTargetForHeading(heading);
      if (visualJumpHandler) {
        visualJumpHandler(target);
      } else {
        setPendingVisualJump(target);
      }
      return;
    }
    setMode('source');
    setPendingJumpLine(heading.line);
  }, [mode, setMode, visualJumpHandler, visualJumpTargetForHeading]);

  const jumpToLineInCurrentMode = useCallback((line: number) => {
    setCurrentLine(line);
    setCurrentColumn(1);
    setActiveNavigationLine(line);
    if (mode === 'visual') {
      const targetHeading = nearestHeadingForLine(headings, line);
      if (targetHeading) {
        const target = visualJumpTargetForHeading(targetHeading);
        if (visualJumpHandler) {
          visualJumpHandler(target);
        } else {
          setPendingVisualJump(target);
        }
        return;
      }
    }
    if (mode === 'source') {
      setPendingJumpLine(line);
      return;
    }
    setMode('source');
    setPendingJumpLine(line);
  }, [headings, mode, setMode, visualJumpHandler, visualJumpTargetForHeading]);

  const jumpToLineInSource = useCallback((line: number) => {
    setCurrentLine(line);
    setCurrentColumn(1);
    setActiveNavigationLine(line);
    setMode('source');
    setPendingJumpLine(line);
  }, [setMode]);

  const preserveLineForModeChange = useCallback((line: number, nextMode: EditorMode) => {
    const safeLine = Math.max(1, Math.floor(line));
    setCurrentLine(safeLine);
    setCurrentColumn(1);
    setActiveNavigationLine(safeLine);
    if (nextMode === 'source') {
      setPendingJumpLine(safeLine);
      return;
    }
    const targetHeading = nearestHeadingForLine(headings, safeLine);
    if (targetHeading) {
      setPendingVisualJump(visualJumpTargetForHeading(targetHeading));
    }
  }, [headings, visualJumpTargetForHeading]);

  const navigateToFindMatch = useCallback((match: { from: number; to: number }, context: { index: number; query: string; caseSensitive: boolean; line: number }) => {
    const request = { from: match.from, to: match.to, query: context.query, index: context.index, caseSensitive: context.caseSensitive, line: context.line };
    setCurrentLine(context.line);
    setCurrentColumn(1);
    setActiveNavigationLine(context.line);
    if (mode === 'visual') {
      if (visualFindHandler) {
        visualFindHandler(request.query, request.index, request.caseSensitive);
      } else {
        setPendingFindMatch(request);
      }
      return;
    }
    if (mode === 'source') {
      if (sourceFindHandler) {
        sourceFindHandler(request.from, request.to);
      } else {
        setPendingFindMatch(request);
      }
      return;
    }
    setMode('source');
    setPendingFindMatch(request);
  }, [mode, setMode, sourceFindHandler, visualFindHandler]);

  return {
    currentLine,
    currentColumn,
    activeNavigationLine,
    handleCursorPositionChange,
    handleViewportLineChange,
    jumpToHeading,
    jumpToLineInCurrentMode,
    jumpToLineInSource,
    preserveLineForModeChange,
    navigateToFindMatch,
  };
}

function nearestHeadingForLine(headings: MarkdownHeading[], line: number): MarkdownHeading | null {
  let nearest: MarkdownHeading | null = null;
  for (const heading of headings) {
    if (heading.line > line) break;
    nearest = heading;
  }
  return nearest ?? headings[0] ?? null;
}
