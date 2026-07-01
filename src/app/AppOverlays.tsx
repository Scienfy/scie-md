import type { RefObject } from 'react';
import { AboutDialog } from '../components/AboutDialog';
import { AppTooltip } from '../components/AppTooltip';
import { BlockTypeDialog } from '../components/BlockTypeDialog';
import type { SelectionBlockType } from '../components/BlockTypeDialog';
import { CitationDialog } from '../components/CitationDialog';
import { CommandPalette } from '../components/CommandPalette';
import type { CommandItem } from '../components/CommandPalette';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DiffReviewDialog } from '../components/DiffReviewDialog';
import { DocumentTypeDialog } from '../components/DocumentTypeDialog';
import { DocumentOpenOverlay } from '../components/DocumentOpenOverlay';
import { ExternalConflictDialog } from '../components/ExternalConflictDialog';
import { ExportDialog } from '../components/ExportDialog';
import { ExportLogDialog } from '../components/ExportLogDialog';
import { ExportRenderHost } from '../components/ExportRenderHost';
import type { ExportRenderHostHandle } from '../components/ExportRenderHost';
import { ExportStatusBanner } from '../components/ExportStatusBanner';
import { JsonEditReviewDialog } from '../components/JsonEditReviewDialog';
import type { ExportStatusBannerState } from '../components/ExportStatusBanner';
import { LinkDialog } from '../components/LinkDialog';
import { PromptDialog } from '../components/PromptDialog';
import { SettingsDialog } from '../components/SettingsDialog';
import { ShortcutDialog } from '../components/ShortcutDialog';
import { SlashCommandMenu } from '../components/SlashCommandMenu';
import type { SlashCommandItem } from '../components/SlashCommandMenu';
import { StructuredConflictDialog } from '../components/StructuredConflictDialog';
import { TabularPasteDialog } from '../components/TabularPasteDialog';
import { TemplateDialog } from '../components/TemplateDialog';
import { ToastViewport } from '../components/ToastViewport';
import type { ToastMessage } from '../components/ToastViewport';
import { UnsavedDialog } from '../components/UnsavedDialog';
import { VariableDialog } from '../components/VariableDialog';
import type { VariableDialogState } from '../components/VariableDialog';
import type { BibtexEntry, BibtexEntryDraft, DelimitedTextConversionFormat, DelimitedTextConversionPreview, DiffHunk, JsonStructuralReviewPlan, ReviewPlan, StructuredEditSourcePreview, StructuredExternalConflictReviewPlan, StructuredReviewPlan } from '@sciemd/core';
import type { ScienfyTemplateId } from '../domain/document/templates';
import type { VariableDefinition } from '@sciemd/core';
import type { ExportFormat, ExportLogEntry, ExportRequestOptions } from '../export/exportTypes';
import type { ProtectedChange } from '@sciemd/core';
import type { PersistedSettings } from '../services/settingsService';
import type { ConfirmState, PromptState } from './hooks/useDialogs';
import type { EditorSelectionSnapshot } from '../components/editorSelection';
import type { DocumentOpenStatus } from './documentOpenStatus';
import type { StructuredConversionRequest } from './structuredConversionActions';

interface LinkDialogState {
  selectedText: string;
  text: string;
  url: string;
}

interface BlockDialogState {
  selection: EditorSelectionSnapshot | null;
}

interface TabularPasteDialogState {
  source: string;
  preview: DelimitedTextConversionPreview;
}

interface AppOverlaysProps {
  closeDialogOpen: boolean;
  onCloseSave: () => void;
  onCloseDiscard: () => void;
  onCloseCancel: () => void;
  promptState: PromptState | null;
  onPromptComplete: (value: string | null) => void;
  confirmState: ConfirmState | null;
  onConfirmComplete: (value: boolean) => void;
  linkDialog: LinkDialogState | null;
  onLinkSubmit: (link: { text: string; url: string }) => void;
  onLinkCancel: () => void;
  variableDialog: VariableDialogState | null;
  variableDefinitions: VariableDefinition[];
  suggestedVariableName: string;
  onUseExistingVariable: (name: string) => void;
  onCreateVariable: (name: string, value: string) => void;
  onSaveVariable: (originalName: string, nextName: string, value: string) => void;
  onCancelVariable: () => void;
  citationDialogOpen: boolean;
  citationDocumentPath: string | null;
  citationEntries: BibtexEntry[];
  citationBibliographyFiles: string[];
  citationLoading: boolean;
  citationDialogInitialKey: string | null;
  onCloseCitationDialog: () => void;
  onInsertCitation: (key: string) => void;
  onSaveCitationEntry: (draft: BibtexEntryDraft, originalKey: string | null) => Promise<void>;
  onDeleteCitationEntry: (key: string) => Promise<void>;
  onReloadBibliography: () => void;
  blockDialogState: BlockDialogState | null;
  onSelectBlockType: (type: SelectionBlockType) => void;
  onCancelBlockType: () => void;
  exportDialogFormat: ExportFormat | null;
  exportOptions: ExportRequestOptions;
  onCancelExportDialog: () => void;
  onRunExport: (format: ExportFormat, options: ExportRequestOptions) => void;
  exportLogOpen: boolean;
  exportLogEntries: ExportLogEntry[];
  onCloseExportLog: () => void;
  pasteReviewOpen: boolean;
  pasteReviewHunks: DiffHunk[];
  pasteReviewPlan?: ReviewPlan;
  pasteReviewLargeChangeSummary?: string;
  pasteProtectedChanges: ProtectedChange[];
  onApplyPasteReview: (rejectedUnitIds: Set<string>, rejectedRawHunkIds?: Set<string>) => void;
  onAcceptPasteReview: () => void;
  onRejectPasteReview: () => void;
  onClosePasteReview: () => void;
  onFocusReviewLine: (line: number) => void;
  tabularPaste: TabularPasteDialogState | null;
  tabularPasteDefaultFormat: DelimitedTextConversionFormat;
  onInsertTabularPaste: (content: string, format: DelimitedTextConversionFormat) => void;
  onCopyTabularPaste: (content: string, format: DelimitedTextConversionFormat) => void;
  onStructuredConversionAction?: (request: StructuredConversionRequest) => void;
  onCancelTabularPaste: () => void;
  jsonEditReviewPreview: StructuredEditSourcePreview | null;
  jsonEditReviewPlan?: StructuredReviewPlan | null;
  jsonEditReviewSchemaExplanation?: string;
  onApplyJsonEditReview: () => void;
  onCancelJsonEditReview: () => void;
  externalConflictOpen: boolean;
  externalConflictHunks: DiffHunk[];
  externalProtectedChanges: ProtectedChange[];
  onApplyExternalConflictReview: (rejectedDiskHunkIds: Set<string>) => void;
  onCloseExternalConflictReview: () => void;
  structuredConflictOpen: boolean;
  structuredConflictFormatLabel: string;
  structuredConflictFilePath: string | null;
  structuredConflictCurrentSource: string;
  structuredConflictDiskSource: string;
  structuredConflictJsonReview?: JsonStructuralReviewPlan | null;
  structuredConflictExternalReview?: StructuredExternalConflictReviewPlan | null;
  structuredConflictReviewPlan?: StructuredReviewPlan | null;
  onKeepStructuredConflict: () => void;
  onReloadStructuredConflict: () => void;
  onSaveStructuredConflictAs: () => void;
  onSaveStructuredConflictAnyway: () => void;
  onApplyStructuredJsonConflictReview?: (rejectedDiskChangeIds: Set<string>) => void;
  onApplyStructuredConflictReview?: (rejectedDiskChangeIds: Set<string>) => void;
  shortcutDialogOpen: boolean;
  onCloseShortcutDialog: () => void;
  aboutOpen: boolean;
  onCloseAbout: () => void;
  settingsOpen: boolean;
  settings: PersistedSettings;
  onUpdateSettings: (patch: Partial<PersistedSettings>) => void;
  onCheckInkscape: () => void;
  onSetInkscapePath: () => void;
  onOpenWritingDefaults: () => void;
  onCloseSettings: () => void;
  templateDialogOpen: boolean;
  onCreateFromTemplate: (template: ScienfyTemplateId) => void;
  onCancelTemplateDialog: () => void;
  automaticDocumentTypeDialogOpen: boolean;
  documentTypeDialogOpen: boolean;
  onSelectDocumentType: (documentType: PersistedSettings['documentType']) => void;
  onSkipDocumentType: () => void;
  commandPaletteOpen: boolean;
  commands: CommandItem[];
  dynamicCommands: (query: string) => CommandItem[];
  onCloseCommandPalette: () => void;
  slashMenu: { top: number; left: number; initialCommandId?: string } | null;
  slashCommands: SlashCommandItem[];
  onSelectSlashCommand: (command: SlashCommandItem) => void;
  onCloseSlashMenu: () => void;
  exportStatus: ExportStatusBannerState | null;
  exportBusy: boolean;
  documentOpenStatus: DocumentOpenStatus | null;
  onOpenExportLog: () => void;
  onDismissExportStatus?: () => void;
  toasts: ToastMessage[];
  onDismissToast: (id: number) => void;
  onPauseToast: (id: number) => void;
  onResumeToast: (id: number) => void;
  exportRenderHostMounted: boolean;
  exportRenderHostRef: RefObject<ExportRenderHostHandle | null>;
}

export function AppOverlays({
  closeDialogOpen,
  onCloseSave,
  onCloseDiscard,
  onCloseCancel,
  promptState,
  onPromptComplete,
  confirmState,
  onConfirmComplete,
  linkDialog,
  onLinkSubmit,
  onLinkCancel,
  variableDialog,
  variableDefinitions,
  suggestedVariableName,
  onUseExistingVariable,
  onCreateVariable,
  onSaveVariable,
  onCancelVariable,
  citationDialogOpen,
  citationDocumentPath,
  citationEntries,
  citationBibliographyFiles,
  citationLoading,
  citationDialogInitialKey,
  onCloseCitationDialog,
  onInsertCitation,
  onSaveCitationEntry,
  onDeleteCitationEntry,
  onReloadBibliography,
  blockDialogState,
  onSelectBlockType,
  onCancelBlockType,
  exportDialogFormat,
  exportOptions,
  onCancelExportDialog,
  onRunExport,
  exportLogOpen,
  exportLogEntries,
  onCloseExportLog,
  pasteReviewOpen,
  pasteReviewHunks,
  pasteReviewPlan,
  pasteReviewLargeChangeSummary,
  pasteProtectedChanges,
  onApplyPasteReview,
  onAcceptPasteReview,
  onRejectPasteReview,
  onClosePasteReview,
  onFocusReviewLine,
  tabularPaste,
  tabularPasteDefaultFormat,
  onInsertTabularPaste,
  onCopyTabularPaste,
  onStructuredConversionAction,
  onCancelTabularPaste,
  jsonEditReviewPreview,
  jsonEditReviewPlan,
  jsonEditReviewSchemaExplanation,
  onApplyJsonEditReview,
  onCancelJsonEditReview,
  externalConflictOpen,
  externalConflictHunks,
  externalProtectedChanges,
  onApplyExternalConflictReview,
  onCloseExternalConflictReview,
  structuredConflictOpen,
  structuredConflictFormatLabel,
  structuredConflictFilePath,
  structuredConflictCurrentSource,
  structuredConflictDiskSource,
  structuredConflictJsonReview,
  structuredConflictExternalReview,
  structuredConflictReviewPlan,
  onKeepStructuredConflict,
  onReloadStructuredConflict,
  onSaveStructuredConflictAs,
  onSaveStructuredConflictAnyway,
  onApplyStructuredJsonConflictReview,
  onApplyStructuredConflictReview,
  shortcutDialogOpen,
  onCloseShortcutDialog,
  aboutOpen,
  onCloseAbout,
  settingsOpen,
  settings,
  onUpdateSettings,
  onCheckInkscape,
  onSetInkscapePath,
  onOpenWritingDefaults,
  onCloseSettings,
  templateDialogOpen,
  onCreateFromTemplate,
  onCancelTemplateDialog,
  automaticDocumentTypeDialogOpen,
  documentTypeDialogOpen,
  onSelectDocumentType,
  onSkipDocumentType,
  commandPaletteOpen,
  commands,
  dynamicCommands,
  onCloseCommandPalette,
  slashMenu,
  slashCommands,
  onSelectSlashCommand,
  onCloseSlashMenu,
  exportStatus,
  exportBusy,
  documentOpenStatus,
  onOpenExportLog,
  onDismissExportStatus,
  toasts,
  onDismissToast,
  onPauseToast,
  onResumeToast,
  exportRenderHostMounted,
  exportRenderHostRef,
}: AppOverlaysProps) {
  return (
    <>
      <DocumentOpenOverlay status={documentOpenStatus} />
      <UnsavedDialog
        open={closeDialogOpen}
        onSave={onCloseSave}
        onDiscard={onCloseDiscard}
        onCancel={onCloseCancel}
      />
      <PromptDialog
        open={Boolean(promptState)}
        title={promptState?.title ?? ''}
        label={promptState?.label ?? ''}
        defaultValue={promptState?.defaultValue ?? ''}
        onSubmit={(value) => onPromptComplete(value)}
        onCancel={() => onPromptComplete(null)}
      />
      <LinkDialog
        open={Boolean(linkDialog)}
        initialText={linkDialog?.text ?? ''}
        initialUrl={linkDialog?.url ?? ''}
        onSubmit={onLinkSubmit}
        onCancel={onLinkCancel}
      />
      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        okLabel={confirmState?.okLabel}
        cancelLabel={confirmState?.cancelLabel}
        onConfirm={() => onConfirmComplete(true)}
        onCancel={() => onConfirmComplete(false)}
      />
      <VariableDialog
        state={variableDialog}
        definitions={variableDefinitions}
        suggestedName={suggestedVariableName}
        onUseExisting={onUseExistingVariable}
        onCreate={onCreateVariable}
        onSave={onSaveVariable}
        onCancel={onCancelVariable}
      />
      <CitationDialog
        open={citationDialogOpen}
        documentPath={citationDocumentPath}
        entries={citationEntries}
        bibliographyFiles={citationBibliographyFiles}
        loading={citationLoading}
        initialEditKey={citationDialogInitialKey}
        onClose={onCloseCitationDialog}
        onInsert={onInsertCitation}
        onSaveEntry={onSaveCitationEntry}
        onDeleteEntry={onDeleteCitationEntry}
        onReloadBibliography={onReloadBibliography}
      />
      <BlockTypeDialog
        open={Boolean(blockDialogState)}
        mode={blockDialogState?.selection ? 'wrap' : 'insert'}
        onSelect={onSelectBlockType}
        onCancel={onCancelBlockType}
      />
      <ExportDialog
        open={Boolean(exportDialogFormat)}
        format={exportDialogFormat}
        initialOptions={exportOptions}
        onCancel={onCancelExportDialog}
        onExport={onRunExport}
      />
      <ExportLogDialog
        open={exportLogOpen}
        entries={exportLogEntries}
        onClose={onCloseExportLog}
      />
      <DiffReviewDialog
        open={pasteReviewOpen}
        hunks={pasteReviewHunks}
        reviewPlan={pasteReviewPlan}
        largeChangeSummary={pasteReviewLargeChangeSummary}
        protectedChanges={pasteProtectedChanges}
        onApply={onApplyPasteReview}
        onAcceptAll={onAcceptPasteReview}
        onRejectAll={onRejectPasteReview}
        onClose={onClosePasteReview}
        onFocusLine={onFocusReviewLine}
      />
      <TabularPasteDialog
        open={Boolean(tabularPaste)}
        preview={tabularPaste?.preview ?? null}
        sourceText={tabularPaste?.source}
        defaultFormat={tabularPasteDefaultFormat}
        onInsert={onInsertTabularPaste}
        onCopy={onCopyTabularPaste}
        onConversionAction={onStructuredConversionAction}
        onCancel={onCancelTabularPaste}
      />
      <JsonEditReviewDialog
        open={Boolean(jsonEditReviewPreview)}
        preview={jsonEditReviewPreview}
        reviewPlan={jsonEditReviewPlan}
        schemaGeneratedValueExplanation={jsonEditReviewSchemaExplanation}
        onApply={onApplyJsonEditReview}
        onCancel={onCancelJsonEditReview}
      />
      <ExternalConflictDialog
        open={externalConflictOpen}
        hunks={externalConflictHunks}
        protectedChanges={externalProtectedChanges}
        onApplyReview={onApplyExternalConflictReview}
        onClose={onCloseExternalConflictReview}
        onFocusLine={onFocusReviewLine}
      />
      <StructuredConflictDialog
        open={structuredConflictOpen}
        formatLabel={structuredConflictFormatLabel}
        filePath={structuredConflictFilePath}
        currentSource={structuredConflictCurrentSource}
        diskSource={structuredConflictDiskSource}
        jsonReview={structuredConflictJsonReview}
        externalReview={structuredConflictExternalReview}
        reviewPlan={structuredConflictReviewPlan}
        onKeepCurrent={onKeepStructuredConflict}
        onReloadDisk={onReloadStructuredConflict}
        onSaveAs={onSaveStructuredConflictAs}
        onSaveAnyway={onSaveStructuredConflictAnyway}
        onApplyJsonReview={onApplyStructuredJsonConflictReview}
        onApplyStructuredReview={onApplyStructuredConflictReview}
        onClose={onCloseExternalConflictReview}
      />
      <ShortcutDialog open={shortcutDialogOpen} onClose={onCloseShortcutDialog} />
      <AboutDialog open={aboutOpen} onClose={onCloseAbout} />
      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onUpdate={onUpdateSettings}
        onCheckInkscape={onCheckInkscape}
        onSetInkscapePath={onSetInkscapePath}
        onOpenWritingDefaults={onOpenWritingDefaults}
        onClose={onCloseSettings}
      />
      <TemplateDialog
        open={templateDialogOpen}
        onCreate={onCreateFromTemplate}
        onCancel={onCancelTemplateDialog}
      />
      <DocumentTypeDialog
        open={automaticDocumentTypeDialogOpen || documentTypeDialogOpen}
        onSelect={onSelectDocumentType}
        onSkip={onSkipDocumentType}
      />
      <CommandPalette
        open={commandPaletteOpen}
        commands={commands}
        dynamicCommands={dynamicCommands}
        onClose={onCloseCommandPalette}
      />
      <SlashCommandMenu
        open={Boolean(slashMenu)}
        top={slashMenu?.top ?? 0}
        left={slashMenu?.left ?? 0}
        initialCommandId={slashMenu?.initialCommandId}
        commands={slashCommands}
        onSelect={onSelectSlashCommand}
        onClose={onCloseSlashMenu}
      />
      {exportStatus && (
        <ExportStatusBanner
          status={exportStatus}
          busy={exportBusy}
          onOpenLog={onOpenExportLog}
          onDismiss={onDismissExportStatus}
        />
      )}
      <ToastViewport toasts={toasts} onDismiss={onDismissToast} onPause={onPauseToast} onResume={onResumeToast} />
      <AppTooltip />
      {exportRenderHostMounted && <ExportRenderHost ref={exportRenderHostRef} />}
    </>
  );
}
