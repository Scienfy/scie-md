import { useCallback } from 'react';
import type { CommandItem } from '../../components/CommandPalette';
import { useAppCommandRegistry } from './useAppCommandRegistry';
import type { BibtexEntry } from '@sciemd/core';
import type { ScienfyTemplateId } from '../../domain/document/templates';
import type { MarkdownHeading } from '@sciemd/core';
import type { RecentFilePreview } from '../../markdown/documentIntelligence';
import type { PersistedSettings, SidebarView, ThemeMode } from '../../services/settingsService';
import type { VisualStyleId } from '../../services/visualStyleService';
import type { PandocExportFormat } from '../../export/exportTypes';

interface UseAppCommandsArgs {
  settings: Pick<PersistedSettings, 'outlineOpen' | 'focusMode' | 'themeMode' | 'exportOptions'>;
  currentVisualStyleLabel: string;
  pasteReviewHunks: number | null;
  recentPreviews: RecentFilePreview[];
  headings: MarkdownHeading[];
  citationCompletionKeys: string[];
  citationEntries: BibtexEntry[];
  missingCitationCount: number;
  missingVariableCount: number;
  onNew: () => void;
  onOpen: () => void;
  onOpenFolder: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onFind: () => void;
  onOpenSlashMenu: () => void;
  onOpenTemplates: () => void;
  onOpenSettings: () => void;
  onOpenTutorial: () => void;
  onOpenFullTutorial: () => void;
  onInsertImage: () => void;
  onInsertCitation: () => void;
  onInsertMarkdown: (markdown: string) => void;
  onInsertSvgFigure: () => void;
  onInsertVariable: () => void;
  onCheckExternalTools: () => void;
  onCheckInkscape: () => void;
  onSetInkscapePath: () => void;
  onInsertProtectedBlock: () => void;
  onInsertEditorComment: () => void;
  onInsertHumanEditorComment: () => void;
  onInsertTargetedInstruction: () => void;
  onInsertVariantGroup: () => void;
  onReloadBibliography: () => void;
  onSyncBibliography: () => void;
  onInsertReferencesDirective: () => void;
  onApplyScientificTypography: () => void;
  onGenerateSubmissionReadiness: () => void;
  onCopyScieMDLlmSkill: () => void;
  onGenerateScieMDLlmSkill: () => void;
  onCopyRichText: () => void;
  onRunConfiguredExport: (format: PandocExportFormat | 'html', options: PersistedSettings['exportOptions']) => void;
  onPrintPreview: () => void;
  onOpenPasteReview: () => void;
  onToggleOutline: () => void;
  onToggleFocusMode: () => void;
  onSidebarViewChange: (view: SidebarView) => void;
  onCycleTheme: () => void;
  onCycleVisualStyle: () => void;
  onSetVisualStyle: (style: VisualStyleId) => void;
  onIncreaseFont: () => void;
  onDecreaseFont: () => void;
  onShowShortcuts: () => void;
  onShowAbout: () => void;
  onOpenRecent: (path: string) => void;
  onJumpToHeading: (heading: MarkdownHeading) => void;
  onNewFromTemplate: (template: ScienfyTemplateId) => void;
}

export function useAppCommands({
  settings,
  currentVisualStyleLabel,
  pasteReviewHunks,
  recentPreviews,
  headings,
  citationCompletionKeys,
  citationEntries,
  missingCitationCount,
  missingVariableCount,
  onNew,
  onOpen,
  onOpenFolder,
  onSave,
  onSaveAs,
  onFind,
  onOpenSlashMenu,
  onOpenTemplates,
  onOpenSettings,
  onOpenTutorial,
  onOpenFullTutorial,
  onInsertImage,
  onInsertCitation,
  onInsertMarkdown,
  onInsertSvgFigure,
  onInsertVariable,
  onCheckExternalTools,
  onCheckInkscape,
  onSetInkscapePath,
  onInsertProtectedBlock,
  onInsertEditorComment,
  onInsertHumanEditorComment,
  onInsertTargetedInstruction,
  onInsertVariantGroup,
  onReloadBibliography,
  onSyncBibliography,
  onInsertReferencesDirective,
  onApplyScientificTypography,
  onGenerateSubmissionReadiness,
  onCopyScieMDLlmSkill,
  onGenerateScieMDLlmSkill,
  onCopyRichText,
  onRunConfiguredExport,
  onPrintPreview,
  onOpenPasteReview,
  onToggleOutline,
  onToggleFocusMode,
  onSidebarViewChange,
  onCycleTheme,
  onCycleVisualStyle,
  onSetVisualStyle,
  onIncreaseFont,
  onDecreaseFont,
  onShowShortcuts,
  onShowAbout,
  onOpenRecent,
  onJumpToHeading,
  onNewFromTemplate,
}: UseAppCommandsArgs) {
  const commands = useAppCommandRegistry({
    outlineOpen: settings.outlineOpen,
    focusMode: settings.focusMode,
    themeMode: settings.themeMode as ThemeMode,
    currentVisualStyleLabel,
    pasteReviewHunks,
    recentPreviews,
    headings,
    onNew,
    onOpen,
    onOpenFolder,
    onSave,
    onSaveAs,
    onFind,
    onOpenSlashMenu,
    onOpenTemplates,
    onOpenSettings,
    onOpenTutorial,
    onOpenFullTutorial,
    onInsertImage,
    onInsertCitation,
    onInsertMermaid: () => onInsertMarkdown('```mermaid\nflowchart LR\n  A[Question] --> B[Experiment]\n  B --> C[Result]\n```\n\n'),
    onInsertSvgFigure,
    onInsertVariable,
    onCheckExternalTools,
    onCheckInkscape,
    onSetInkscapePath,
    onInsertProtectedBlock,
    onInsertEditorComment,
    onInsertHumanEditorComment,
    onInsertTargetedInstruction,
    onInsertVariantGroup,
    onReloadBibliography,
    onSyncBibliography,
    onInsertReferencesDirective,
    onApplyScientificTypography,
    onGenerateSubmissionReadiness,
    onCopyScieMDLlmSkill,
    onGenerateScieMDLlmSkill,
    onCopyRichText,
    onExportHtml: () => onRunConfiguredExport('html', settings.exportOptions),
    onExportPandoc: (format) => onRunConfiguredExport(format, settings.exportOptions),
    onPrintPreview,
    onOpenPasteReview,
    onToggleOutline,
    onToggleFocusMode,
    onSidebarOutline: () => onSidebarViewChange('outline'),
    onSidebarFiles: () => onSidebarViewChange('files'),
    onSidebarReferences: () => onSidebarViewChange('references'),
    onSidebarData: () => onSidebarViewChange('data'),
    onCycleTheme,
    onCycleVisualStyle,
    onSetVisualStyle,
    onIncreaseFont,
    onDecreaseFont,
    onShowShortcuts,
    onShowAbout,
    onOpenRecent,
    onJumpToHeading,
    onNewFromTemplate,
    missingCitationCount,
    missingVariableCount,
  });

  const dynamicCommands = useCallback((query: string): CommandItem[] => {
    const trimmed = query.trim();
    if (trimmed.startsWith('@')) {
      const needle = trimmed.slice(1).toLowerCase();
      const entryByKey = new Map(citationEntries.map((entry) => [entry.key, entry]));
      return citationCompletionKeys
        .filter((key) => key.toLowerCase().includes(needle))
        .slice(0, 12)
        .map((key) => ({
          id: `dynamic-citation-${key}`,
          label: `Insert citation @${key}`,
          detail: citationCommandDetail(entryByKey.get(key)),
          run: () => onInsertMarkdown(`[@${key}]`),
        }));
    }
    if (trimmed.startsWith('#')) {
      const needle = trimmed.slice(1).trim().toLowerCase();
      return headings
        .filter((heading) => !needle || heading.text.toLowerCase().includes(needle))
        .slice(0, 12)
        .map((heading) => ({
          id: `dynamic-heading-${heading.id}-${heading.line}`,
          label: `Go to ${'#'.repeat(Math.min(heading.level, 6))} ${heading.text}`,
          detail: `Line ${heading.line}`,
          run: () => onJumpToHeading(heading),
        }));
    }
    return [];
  }, [citationCompletionKeys, citationEntries, headings, onInsertMarkdown, onJumpToHeading]);

  return { commands, dynamicCommands };
}

function citationCommandDetail(entry: BibtexEntry | undefined): string {
  if (!entry) return 'Previously used citation key';
  const title = cleanBibtexCommandField(entry.fields.title) || entry.key;
  const authors = cleanBibtexCommandField(entry.fields.author || entry.fields.editor || '');
  const year = cleanBibtexCommandField(entry.fields.year || '');
  return [title, [authors, year].filter(Boolean).join(', ')].filter(Boolean).join(' - ');
}

function cleanBibtexCommandField(value: string): string {
  return value.replace(/[{}]/g, '').replace(/\\&/g, '&').replace(/\s+/g, ' ').trim();
}
