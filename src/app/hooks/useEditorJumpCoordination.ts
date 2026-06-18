import { useEffect } from 'react';
import type { EditorMode } from '../documentState';
import type { SourceMarkdownFind, SourceMarkdownJump } from '../../components/SourceMarkdownEditor';
import type { VisualMarkdownFind, VisualMarkdownJump, VisualMarkdownJumpTarget } from '../../components/VisualMarkdownEditor';

interface FindNavigationRequest {
  from: number;
  to: number;
  query: string;
  index: number;
  caseSensitive: boolean;
  line: number;
}

interface EditorJumpCoordinationParams {
  mode: EditorMode;
  pendingJumpLine: number | null;
  pendingVisualJump: VisualMarkdownJumpTarget | null;
  pendingFindMatch: FindNavigationRequest | null;
  sourceJumpHandler: SourceMarkdownJump | undefined;
  visualJumpHandler: VisualMarkdownJump | undefined;
  sourceFindHandler: SourceMarkdownFind | undefined;
  visualFindHandler: VisualMarkdownFind | undefined;
  setPendingJumpLine: (line: number | null) => void;
  setPendingVisualJump: (target: VisualMarkdownJumpTarget | null) => void;
  setPendingFindMatch: (match: FindNavigationRequest | null) => void;
}

export function useEditorJumpCoordination({
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
}: EditorJumpCoordinationParams): void {
  useEffect(() => {
    if (pendingJumpLine === null || mode !== 'source' || !sourceJumpHandler) return;
    sourceJumpHandler(pendingJumpLine);
    setPendingJumpLine(null);
  }, [mode, pendingJumpLine, setPendingJumpLine, sourceJumpHandler]);

  useEffect(() => {
    if (!pendingVisualJump || mode !== 'visual' || !visualJumpHandler) return;
    visualJumpHandler(pendingVisualJump);
    setPendingVisualJump(null);
  }, [mode, pendingVisualJump, setPendingVisualJump, visualJumpHandler]);

  useEffect(() => {
    if (!pendingFindMatch || mode !== 'source' || !sourceFindHandler) return;
    sourceFindHandler(pendingFindMatch.from, pendingFindMatch.to);
    setPendingFindMatch(null);
  }, [mode, pendingFindMatch, setPendingFindMatch, sourceFindHandler]);

  useEffect(() => {
    if (!pendingFindMatch || mode !== 'visual' || !visualFindHandler) return;
    visualFindHandler(pendingFindMatch.query, pendingFindMatch.index, pendingFindMatch.caseSensitive);
    setPendingFindMatch(null);
  }, [mode, pendingFindMatch, setPendingFindMatch, visualFindHandler]);
}
