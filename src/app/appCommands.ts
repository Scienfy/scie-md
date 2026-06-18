import type { CommandItem } from '../components/CommandPalette';
import type { RecentFilePreview } from '../markdown/documentIntelligence';
import type { MarkdownHeading } from '../markdown/outline';
import type { ThemeMode } from '../services/settingsService';
import type { VisualStyleId } from '../services/visualStyleService';
import { VISUAL_STYLE_OPTIONS } from '../services/visualStyleService';
import type { ScienfyTemplateId } from '../domain/document/templates';
import type { PandocExportFormat } from '../export/exportTypes';
import { getKeyboardShortcutDisplay } from './keyboardShortcuts';

export interface AppCommandContext {
  outlineOpen: boolean;
  focusMode: boolean;
  themeMode: ThemeMode;
  currentVisualStyleLabel: string;
  pasteReviewHunks: number | null;
  missingCitationCount: number;
  missingVariableCount: number;
  recentPreviews: RecentFilePreview[];
  headings: MarkdownHeading[];
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
  onInsertMermaid: () => void;
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
  onExportHtml: () => void;
  onExportPandoc: (format: PandocExportFormat) => void;
  onPrintPreview: () => void;
  onOpenPasteReview: () => void;
  onToggleOutline: () => void;
  onToggleFocusMode: () => void;
  onSidebarOutline: () => void;
  onSidebarFiles: () => void;
  onSidebarReferences: () => void;
  onSidebarData: () => void;
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

export function createAppCommands(context: AppCommandContext): CommandItem[] {
  const issueCommands: CommandItem[] = [];
  if (context.missingCitationCount > 0) {
    issueCommands.push({
      id: 'issues-citations',
      label: `Find ${context.missingCitationCount} missing citation${context.missingCitationCount === 1 ? '' : 's'}`,
      detail: 'Open references panel',
      run: context.onSidebarReferences,
    });
  }
  if (context.missingVariableCount > 0) {
    issueCommands.push({
      id: 'issues-variables',
      label: `Find ${context.missingVariableCount} missing variable${context.missingVariableCount === 1 ? '' : 's'}`,
      detail: 'Open data sources panel',
      run: context.onSidebarData,
    });
  }
  return [
    ...issueCommands,
    { id: 'new', label: 'New document', detail: getKeyboardShortcutDisplay('new'), run: context.onNew },
    { id: 'new-paper', label: 'New scientific paper', detail: 'Layer II paper template', run: () => context.onNewFromTemplate('paper') },
    { id: 'new-research-statement', label: 'New research statement', detail: 'Paragraph-focused research template', run: () => context.onNewFromTemplate('research-statement') },
    { id: 'new-lab-note', label: 'New lab note', detail: 'Structured daily scientific record', run: () => context.onNewFromTemplate('lab-note') },
    { id: 'open', label: 'Open Markdown file', detail: getKeyboardShortcutDisplay('open'), run: context.onOpen },
    { id: 'open-folder', label: 'Open folder in file explorer', detail: 'Browse Markdown, text, and images', run: context.onOpenFolder },
    { id: 'save', label: 'Save', detail: getKeyboardShortcutDisplay('save'), run: context.onSave },
    { id: 'save-as', label: 'Save As', detail: getKeyboardShortcutDisplay('saveAs'), run: context.onSaveAs },
    { id: 'find', label: 'Find and replace', detail: getKeyboardShortcutDisplay('find'), run: context.onFind },
    { id: 'insert-menu', label: 'Open insert menu', detail: 'Use / for blocks, tables, citations, variables, LLM notes, and versions', run: context.onOpenSlashMenu },
    { id: 'templates', label: 'Open templates', detail: 'Paper, research statement, and lab note starters', run: context.onOpenTemplates },
    { id: 'settings', label: 'Open settings', detail: 'Theme, visual style, font, writing defaults, local tools', run: context.onOpenSettings },
    { id: 'quick-tour', label: 'Open quick tour', detail: 'Reopen the short onboarding document', run: context.onOpenTutorial },
    { id: 'full-tutorial', label: 'Open full tutorial', detail: 'Complete reference for ScieMD workflows', run: context.onOpenFullTutorial },
    { id: 'check-tools', label: 'Check external tools', detail: 'Verify Pandoc and Inkscape availability', run: context.onCheckExternalTools },
    { id: 'check-inkscape', label: 'Check Inkscape integration', detail: 'Validate SVG external editor/export support', run: context.onCheckInkscape },
    { id: 'set-inkscape-path', label: 'Set Inkscape path', detail: 'Optional custom path to inkscape executable', run: context.onSetInkscapePath },
    { id: 'reload-bibliography', label: 'Reload bibliography from disk', detail: 'Refresh loaded .bib files without reopening the document', run: context.onReloadBibliography },
    { id: 'sync-bibliography', label: 'Sync generated bibliography', detail: 'Append or refresh managed References section', run: context.onSyncBibliography },
    { id: 'insert-references-directive', label: 'Insert auto References section', detail: '`:::references` renders the cited keys from loaded .bib files', run: context.onInsertReferencesDirective },
    { id: 'insert-note-to-llm', label: 'Insert Note to LLM', detail: 'Anchored author guidance for external LLM revision', run: context.onInsertEditorComment },
    { id: 'insert-note-to-human', label: 'Insert Note to Human', detail: 'Anchored review note for the author', run: context.onInsertHumanEditorComment },
    { id: 'apply-scientific-typography', label: 'Apply scientific typography', detail: 'Normalize minus signs, micro units, and value-unit spacing', run: context.onApplyScientificTypography },
    { id: 'copy-sciemd-llm-skill', label: 'LLM skill: copy ScieMD LLM Skill', detail: 'Teach another LLM to resolve Note to LLM markers safely', run: context.onCopyScieMDLlmSkill },
    { id: 'generate-sciemd-llm-skill', label: 'LLM skill: generate ScieMD_LLM_skill.md', detail: 'Create ScieMD_LLM_skill.md beside the current document', run: context.onGenerateScieMDLlmSkill },
    { id: 'generate-submission-readiness', label: 'Generate submission readiness report', detail: 'Create SCIENFY_SUBMISSION_READINESS.md', run: context.onGenerateSubmissionReadiness },
    { id: 'copy-rich', label: 'Copy as rich text', detail: 'HTML clipboard', run: context.onCopyRichText },
    { id: 'export-html', label: 'Export styled HTML', detail: 'Current style/theme with embedded fonts and images', run: context.onExportHtml },
    { id: 'export-docx', label: 'Export styled DOCX', detail: 'Uses current style/theme source; requires Pandoc', run: () => context.onExportPandoc('docx') },
    { id: 'export-pdf', label: 'Export styled PDF', detail: 'Uses current style/theme and bundled fonts', run: () => context.onExportPandoc('pdf') },
    { id: 'print-preview', label: 'Print preview', detail: getKeyboardShortcutDisplay('print'), run: context.onPrintPreview },
    ...(context.pasteReviewHunks ? [{
      id: 'review-paste',
      label: 'Review pasted changes',
      detail: `${context.pasteReviewHunks} changed blocks`,
      run: context.onOpenPasteReview,
    }] : []),
    { id: 'toggle-outline', label: context.outlineOpen ? 'Hide navigation sidebar' : 'Show navigation sidebar', detail: getKeyboardShortcutDisplay('toggleOutline'), run: context.onToggleOutline },
    { id: 'toggle-focus-mode', label: context.focusMode ? 'Leave focus mode' : 'Enter focus mode', detail: 'Quiet writing surface', run: context.onToggleFocusMode },
    { id: 'sidebar-files', label: 'Sidebar: files', detail: 'Show folder explorer', run: context.onSidebarFiles },
    { id: 'sidebar-outline', label: 'Sidebar: outline', detail: 'Show document headings', run: context.onSidebarOutline },
    { id: 'sidebar-references', label: 'Sidebar: references', detail: 'Show citations and labels', run: context.onSidebarReferences },
    { id: 'sidebar-data', label: 'Sidebar: data sources', detail: 'Show linked JSON/CSV variables', run: context.onSidebarData },
    { id: 'theme', label: `Theme: ${context.themeMode}`, detail: 'Cycle system/dark/sepia/light', run: context.onCycleTheme },
    { id: 'visual-style-cycle', label: `Visual style: ${context.currentVisualStyleLabel}`, detail: 'Cycle predefined document styles', run: context.onCycleVisualStyle },
    ...VISUAL_STYLE_OPTIONS.map((style) => ({
      id: `visual-style-${style.id}`,
      label: `Use visual style: ${style.label}`,
      detail: 'Visual style preset',
      run: () => context.onSetVisualStyle(style.id),
    })),
    { id: 'font-up', label: 'Increase font size', detail: getKeyboardShortcutDisplay('increaseFont'), run: context.onIncreaseFont },
    { id: 'font-down', label: 'Decrease font size', detail: getKeyboardShortcutDisplay('decreaseFont'), run: context.onDecreaseFont },
    { id: 'shortcuts', label: 'Show keyboard shortcuts', detail: getKeyboardShortcutDisplay('shortcutSheet'), run: context.onShowShortcuts },
    { id: 'about', label: 'About local-first privacy', detail: 'File transparency', run: context.onShowAbout },
    ...context.recentPreviews.map((preview) => ({
      id: `recent-${preview.path}`,
      label: `Open ${preview.heading}`,
      detail: `${preview.excerpt || preview.name} - ${preview.path}`,
      run: () => context.onOpenRecent(preview.path),
    })),
    ...context.headings.map((heading) => ({
      id: `heading-${heading.id}-${heading.line}`,
      label: `Go to ${heading.text}`,
      detail: `Line ${heading.line}`,
      run: () => context.onJumpToHeading(heading),
    })),
  ];
}
