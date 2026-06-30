import type {
  ClipboardEventHandler,
  ComponentProps,
  DragEventHandler,
  KeyboardEventHandler,
  RefObject,
} from 'react';
import type { Editor } from '@milkdown/kit/core';
import { EditorErrorBoundary } from '../components/EditorErrorBoundary';
import { FloatingFormatToolbar } from '../components/FloatingFormatToolbar';
import { MetadataRail } from '../components/MetadataRail';
import { QuickOutlineHover } from '../components/QuickOutlineHover';
import { SavePill } from '../components/SavePill';
import { SourceMarkdownEditor } from '../components/SourceMarkdownEditor';
import { VisualMarkdownEditor } from '../components/VisualMarkdownEditor';
import type { EditorMode } from './documentState';
import { StartupOpenFailureBanner } from './StartupOpenFailureBanner';
import type { StartupOpenFailureState } from './startupOpenFailure';

interface AppEditorStageProps {
  editorStageRef: RefObject<HTMLElement | null>;
  mode: EditorMode;
  filePath: string | null;
  markdown: string;
  editorResetToken: number;
  dropOverlayVisible: boolean;
  autosaveStatus: ComponentProps<typeof SavePill>['status'];
  statusText: string;
  saveQueueDepth: number;
  startupOpenFailure: StartupOpenFailureState | null;
  headings: ComponentProps<typeof QuickOutlineHover>['headings'];
  activeHeadingId: string | null;
  activeNavigationLine: ComponentProps<typeof MetadataRail>['currentLine'];
  navigationHeadings: ComponentProps<typeof VisualMarkdownEditor>['outlineHeadings'];
  visualEditor: Editor | undefined;
  layerTwoDocument: ComponentProps<typeof MetadataRail>['document'];
  protectedBlocks: ComponentProps<typeof MetadataRail>['protectedBlocks'];
  editorComments: ComponentProps<typeof MetadataRail>['editorComments'];
  targetedInstructions: ComponentProps<typeof MetadataRail>['targetedInstructions'];
  variantGroups: ComponentProps<typeof MetadataRail>['variantGroups'];
  citationCompletionKeys: string[];
  selectedVariableName: string | null;
  authorshipMarks: ComponentProps<typeof SourceMarkdownEditor>['authorshipMarks'];
  validationIssues: ComponentProps<typeof SourceMarkdownEditor>['validationIssues'];
  onKeyDownCapture: KeyboardEventHandler<HTMLElement>;
  onPasteCapture: ClipboardEventHandler<HTMLElement>;
  onDragEnterCapture: DragEventHandler<HTMLElement>;
  onDragLeaveCapture: DragEventHandler<HTMLElement>;
  onDropCapture: DragEventHandler<HTMLElement>;
  onDragOver: DragEventHandler<HTMLElement>;
  onJumpToHeading: ComponentProps<typeof QuickOutlineHover>['onJump'];
  onMarkdownChange: (markdown: string) => void;
  onEditorReset: () => void;
  onVisualEditorReady: ComponentProps<typeof VisualMarkdownEditor>['onEditorReady'];
  onVisualInsertReady: ComponentProps<typeof VisualMarkdownEditor>['onInsertReady'];
  onVisualJumpReady: ComponentProps<typeof VisualMarkdownEditor>['onJumpReady'];
  onVisualFindReady: ComponentProps<typeof VisualMarkdownEditor>['onFindReady'];
  onVisualHistoryReady: ComponentProps<typeof VisualMarkdownEditor>['onHistoryReady'];
  onSourceInsertReady: ComponentProps<typeof SourceMarkdownEditor>['onInsertReady'];
  onSourceJumpReady: ComponentProps<typeof SourceMarkdownEditor>['onJumpReady'];
  onSourceFindReady: ComponentProps<typeof SourceMarkdownEditor>['onFindReady'];
  onSourceHistoryReady: ComponentProps<typeof SourceMarkdownEditor>['onHistoryReady'];
  onSelectionTextReady: ComponentProps<typeof VisualMarkdownEditor>['onSelectionTextReady'];
  onCursorLineChange: ComponentProps<typeof VisualMarkdownEditor>['onCursorLineChange'];
  onViewportLineChange: ComponentProps<typeof VisualMarkdownEditor>['onViewportLineChange'];
  onLockViolation: (message: string) => void;
  onToast: ComponentProps<typeof VisualMarkdownEditor>['onToast'];
  confirmText: ComponentProps<typeof VisualMarkdownEditor>['confirmText'];
  onEditCitation: ComponentProps<typeof VisualMarkdownEditor>['onEditCitation'];
  onEditVariable: ComponentProps<typeof VisualMarkdownEditor>['onEditVariable'];
  getSelectionSnapshot: ComponentProps<typeof FloatingFormatToolbar>['getSelectionSnapshot'];
  onLockSelection: ComponentProps<typeof FloatingFormatToolbar>['onLockSelection'];
  onCommentSelection: ComponentProps<typeof FloatingFormatToolbar>['onCommentSelection'];
  onHumanCommentSelection: ComponentProps<typeof FloatingFormatToolbar>['onHumanCommentSelection'];
  onVariantSelection: ComponentProps<typeof FloatingFormatToolbar>['onVariantSelection'];
  onCopySelection: ComponentProps<typeof FloatingFormatToolbar>['onCopySelection'];
  onHeadingSelection: ComponentProps<typeof FloatingFormatToolbar>['onHeadingSelection'];
  onBlockSelection: ComponentProps<typeof FloatingFormatToolbar>['onBlockSelection'];
  onJumpToLine: ComponentProps<typeof MetadataRail>['onJumpToLine'];
  onOpenReferences: ComponentProps<typeof MetadataRail>['onOpenReferences'];
  onOpenData: ComponentProps<typeof MetadataRail>['onOpenData'];
  onRetryStartupOpen: () => void;
  onOpenStartupFallbackDocument: () => void;
  onDismissStartupOpenFailure: () => void;
}

export function AppEditorStage({
  editorStageRef,
  mode,
  filePath,
  markdown,
  editorResetToken,
  dropOverlayVisible,
  autosaveStatus,
  statusText,
  saveQueueDepth,
  startupOpenFailure,
  headings,
  activeHeadingId,
  activeNavigationLine,
  navigationHeadings,
  visualEditor,
  layerTwoDocument,
  protectedBlocks,
  editorComments,
  targetedInstructions,
  variantGroups,
  citationCompletionKeys,
  selectedVariableName,
  authorshipMarks,
  validationIssues,
  onKeyDownCapture,
  onPasteCapture,
  onDragEnterCapture,
  onDragLeaveCapture,
  onDropCapture,
  onDragOver,
  onJumpToHeading,
  onMarkdownChange,
  onEditorReset,
  onVisualEditorReady,
  onVisualInsertReady,
  onVisualJumpReady,
  onVisualFindReady,
  onVisualHistoryReady,
  onSourceInsertReady,
  onSourceJumpReady,
  onSourceFindReady,
  onSourceHistoryReady,
  onSelectionTextReady,
  onCursorLineChange,
  onViewportLineChange,
  onLockViolation,
  onToast,
  confirmText,
  onEditCitation,
  onEditVariable,
  getSelectionSnapshot,
  onLockSelection,
  onCommentSelection,
  onHumanCommentSelection,
  onVariantSelection,
  onCopySelection,
  onHeadingSelection,
  onBlockSelection,
  onJumpToLine,
  onOpenReferences,
  onOpenData,
  onRetryStartupOpen,
  onOpenStartupFallbackDocument,
  onDismissStartupOpenFailure,
}: AppEditorStageProps) {
  return (
    <main
      id="editor-stage"
      ref={editorStageRef}
      className="editor-stage"
      tabIndex={-1}
      onKeyDownCapture={onKeyDownCapture}
      onPasteCapture={onPasteCapture}
      onDragEnterCapture={onDragEnterCapture}
      onDragLeaveCapture={onDragLeaveCapture}
      onDropCapture={onDropCapture}
      onDragOver={onDragOver}
    >
      {dropOverlayVisible && (
        <div className="editor-drop-overlay" aria-hidden="true">
          <div>
            <strong>Drop into ScieMD</strong>
            <span>Images are copied into assets. Markdown files open as documents.</span>
          </div>
        </div>
      )}
      <SavePill status={autosaveStatus} text={statusText} queueDepth={saveQueueDepth} />
      {startupOpenFailure && (
        <StartupOpenFailureBanner
          failure={startupOpenFailure}
          onRetry={onRetryStartupOpen}
          onOpenDocument={onOpenStartupFallbackDocument}
          onDismiss={onDismissStartupOpenFailure}
        />
      )}
      <QuickOutlineHover headings={headings} activeHeadingId={activeHeadingId} onJump={onJumpToHeading} />
      <EditorErrorBoundary
        resetKey={`${filePath ?? 'untitled'}:${mode}:${editorResetToken}`}
        fallback={(error, reset) => (
          <div className="editor-fallback">
            <div className="editor-fallback-banner">
              <strong>Visual editor could not render this view.</strong>
              <span>{error.message || 'The visual editor failed to render this document.'}</span>
              <button
                onClick={() => {
                  onEditorReset();
                  reset();
                }}
              >
                Retry visual editor
              </button>
            </div>
            <textarea
              className="editor-fallback-raw"
              aria-label="Raw Markdown fallback"
              value={markdown}
              onChange={(event) => onMarkdownChange(event.target.value)}
            />
          </div>
        )}
      >
        {mode === 'visual' ? (
          <VisualMarkdownEditor
            markdown={markdown}
            filePath={filePath}
            onChange={onMarkdownChange}
            onEditorReady={onVisualEditorReady}
            onInsertReady={onVisualInsertReady}
            onJumpReady={onVisualJumpReady}
            onFindReady={onVisualFindReady}
            onHistoryReady={onVisualHistoryReady}
            onSelectionTextReady={onSelectionTextReady}
            onCursorLineChange={onCursorLineChange}
            onViewportLineChange={onViewportLineChange}
            outlineHeadings={navigationHeadings}
            onLockViolation={onLockViolation}
            onToast={onToast}
            confirmText={confirmText}
            referenceLabels={layerTwoDocument.references.labels.map((label) => label.id)}
            citationKeys={citationCompletionKeys}
            citationEntries={layerTwoDocument.citations.bibtexEntries}
            variableDefinitions={layerTwoDocument.variables.definitions}
            highlightedVariableName={selectedVariableName}
            onEditCitation={onEditCitation}
            onEditVariable={onEditVariable}
          />
        ) : (
          <SourceMarkdownEditor
            markdown={markdown}
            onChange={onMarkdownChange}
            onInsertReady={onSourceInsertReady}
            onJumpReady={onSourceJumpReady}
            onFindReady={onSourceFindReady}
            onHistoryReady={onSourceHistoryReady}
            onSelectionTextReady={onSelectionTextReady}
            onCursorLineChange={onCursorLineChange}
            onViewportLineChange={onViewportLineChange}
            authorshipMarks={authorshipMarks}
            citationKeys={citationCompletionKeys}
            citationEntries={layerTwoDocument.citations.bibtexEntries}
            crossReferenceLabels={layerTwoDocument.references.labels}
            variableDefinitions={layerTwoDocument.variables.definitions}
            highlightedVariableName={selectedVariableName}
            validationIssues={validationIssues}
            protectedBlocks={protectedBlocks}
            onLockViolation={onLockViolation}
          />
        )}
      </EditorErrorBoundary>
      <FloatingFormatToolbar
        enabled={mode === 'visual'}
        visualEditor={visualEditor}
        selectionRoot={editorStageRef.current?.querySelector<HTMLElement>('.visual-editor') ?? null}
        getSelectionSnapshot={getSelectionSnapshot}
        onLockSelection={onLockSelection}
        onCommentSelection={onCommentSelection}
        onHumanCommentSelection={onHumanCommentSelection}
        onVariantSelection={onVariantSelection}
        onCopySelection={onCopySelection}
        onHeadingSelection={onHeadingSelection}
        onBlockSelection={onBlockSelection}
      />
      <MetadataRail
        mode={mode}
        document={layerTwoDocument}
        protectedBlocks={protectedBlocks}
        editorComments={editorComments}
        targetedInstructions={targetedInstructions}
        variantGroups={variantGroups}
        currentLine={activeNavigationLine}
        onJumpToLine={onJumpToLine}
        onOpenReferences={onOpenReferences}
        onOpenData={onOpenData}
      />
    </main>
  );
}
