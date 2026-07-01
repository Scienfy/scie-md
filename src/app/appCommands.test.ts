import { describe, expect, it } from 'vitest';
import type { AppCommandContext } from './appCommands';
import { createAppCommands } from './appCommands';
import { formatCapabilitiesFor } from './formatCapabilities';

const noop = () => undefined;

function createContext(overrides: Partial<AppCommandContext> = {}): AppCommandContext {
  return {
    outlineOpen: true,
    formatCapabilities: formatCapabilitiesFor('markdown'),
    focusMode: false,
    themeMode: 'dark',
    currentVisualStyleLabel: 'Scienfy',
    pasteReviewHunks: null,
    missingCitationCount: 0,
    missingVariableCount: 0,
    structuredContextAvailable: false,
    structuredTableSampleAvailable: false,
    structuredPasteBackValidationAvailable: false,
    recentPreviews: [],
    headings: [],
    onNew: noop,
    onOpen: noop,
    onOpenFolder: noop,
    onSave: noop,
    onSaveAs: noop,
    onFind: noop,
    onOpenSlashMenu: noop,
    onOpenTemplates: noop,
    onOpenSettings: noop,
    onOpenTutorial: noop,
    onOpenFullTutorial: noop,
    onInsertImage: noop,
    onInsertCitation: noop,
    onInsertMermaid: noop,
    onInsertSvgFigure: noop,
    onInsertVariable: noop,
    onCheckExternalTools: noop,
    onCheckInkscape: noop,
    onSetInkscapePath: noop,
    onInsertProtectedBlock: noop,
    onInsertEditorComment: noop,
    onInsertHumanEditorComment: noop,
    onInsertTargetedInstruction: noop,
    onInsertVariantGroup: noop,
    onReloadBibliography: noop,
    onSyncBibliography: noop,
    onInsertReferencesDirective: noop,
    onApplyScientificTypography: noop,
    onGenerateSubmissionReadiness: noop,
    onCopyScieMDLlmSkill: noop,
    onGenerateScieMDLlmSkill: noop,
    onCopyStructuredContext: noop,
    onCopySelectedStructureContext: noop,
    onCopyParserDiagnostics: noop,
    onCopyStructuredSchemaSummary: noop,
    onCopyStructuredTableSample: noop,
    onCopyStructuredHealthReport: noop,
    onCopyRedactedStructuredPreview: noop,
    onValidateStructuredClipboard: noop,
    onCopyRichText: noop,
    onExportHtml: noop,
    onExportPandoc: noop,
    onPrintPreview: noop,
    onOpenPasteReview: noop,
    onToggleOutline: noop,
    onToggleFocusMode: noop,
    onSidebarOutline: noop,
    onSidebarFiles: noop,
    onSidebarReferences: noop,
    onSidebarData: noop,
    onCycleTheme: noop,
    onCycleVisualStyle: noop,
    onSetVisualStyle: noop,
    onIncreaseFont: noop,
    onDecreaseFont: noop,
    onShowShortcuts: noop,
    onShowAbout: noop,
    onOpenRecent: noop,
    onJumpToHeading: noop,
    onNewFromTemplate: noop,
    ...overrides,
  };
}

describe('createAppCommands', () => {
  it('exposes app actions and keeps insert commands out of the static palette', () => {
    const commands = createAppCommands(createContext());
    const labels = commands.map((command) => command.label);
    const ids = commands.map((command) => command.id);

    expect(labels).toContain('Print preview');
    expect(commands.find((command) => command.id === 'print-preview')?.detail).toBe('Ctrl/Cmd+P');
    expect(labels).toContain('Check Inkscape integration');
    expect(labels).toContain('Check external tools');
    expect(labels).toContain('Apply scientific typography');
    expect(labels).toContain('Open insert menu');
    expect(labels).not.toContain('Open new document chooser');
    expect(labels).toContain('New JSON');
    expect(labels).toContain('New CSV');
    expect(labels).not.toContain('New Scientific paper');
    expect(labels).not.toContain('New Lab note');
    expect(labels).toContain('Open settings');
    expect(labels).toContain('Open quick tour');
    expect(labels).toContain('Open full tutorial');
    expect(labels).toContain('Insert auto References section');
    expect(labels).toContain('Insert note');
    expect(labels).toContain('Insert review note');
    expect(labels).toContain('LLM skill: copy ScieMD LLM Skill');
    expect(labels).toContain('LLM skill: generate ScieMD_LLM_skill.md');
    expect(labels).not.toContain('Copy for LLM: style guide');
    expect(labels).not.toContain('Copy current section for LLM revision');
    expect(ids).not.toContain('insert-image');
    expect(ids).not.toContain('insert-citation');
    expect(ids).not.toContain('insert-variable');
    expect(ids).not.toContain('insert-protected-block');
    expect(ids).not.toContain('insert-targeted-instruction');
    expect(labels).not.toContain('Selection: create text variants');
    expect(labels).not.toContain('Insert legacy targeted LLM note');
    expect(labels).not.toContain('Copy selected path context');
  });

  it('filters Markdown-only commands for source-only formats', () => {
    const commands = createAppCommands(createContext({
      formatCapabilities: formatCapabilitiesFor('json'),
      missingCitationCount: 2,
      missingVariableCount: 3,
      headings: [{ id: 'intro', level: 1, text: 'Intro', line: 1 }],
    }));
    const labels = commands.map((command) => command.label);
    const ids = commands.map((command) => command.id);

    expect(labels).toContain('New document');
    expect(labels).not.toContain('Open new document chooser');
    expect(labels).toContain('New JSON');
    expect(labels).toContain('Open file');
    expect(labels).toContain('Save');
    expect(labels).toContain('Find and replace');
    expect(labels).toContain('Open settings');
    expect(ids).toContain('sidebar-files');
    expect(labels).not.toContain('Open insert menu');
    expect(labels).not.toContain('Apply scientific typography');
    expect(labels).not.toContain('Insert auto References section');
    expect(labels).not.toContain('Insert note');
    expect(labels).not.toContain('Generate submission readiness report');
    expect(labels).not.toContain('Export styled HTML');
    expect(labels).not.toContain('Find 2 missing citations');
    expect(labels).not.toContain('Find 3 missing variables');
    expect(labels).not.toContain('Go to Intro');
    expect(ids).not.toContain('sidebar-outline');
    expect(ids).not.toContain('sidebar-references');
    expect(ids).not.toContain('sidebar-data');
  });

  it('exposes structured context commands without re-enabling Markdown LLM marker commands', () => {
    const commands = createAppCommands(createContext({
      formatCapabilities: formatCapabilitiesFor('json'),
      structuredContextAvailable: true,
      structuredTableSampleAvailable: false,
      structuredPasteBackValidationAvailable: true,
    }));
    const labels = commands.map((command) => command.label);

    expect(labels).toContain('Copy structured context');
    expect(labels).toContain('Copy selected path context');
    expect(labels).toContain('Copy schema-aware JSON context');
    expect(labels).toContain('Copy parser diagnostics');
    expect(labels).toContain('Structured context: copy health report');
    expect(labels).toContain('Structured context: copy redacted preview');
    expect(labels).toContain('Structured context: validate clipboard text');
    expect(labels).not.toContain('Copy table sample');
    expect(labels).not.toContain('Insert note');
    expect(labels).not.toContain('LLM skill: copy ScieMD LLM Skill');
  });

  it('exposes table samples for parsed tabular context without schema-aware JSON commands', () => {
    const commands = createAppCommands(createContext({
      formatCapabilities: formatCapabilitiesFor('csv'),
      structuredContextAvailable: true,
      structuredTableSampleAvailable: true,
      structuredPasteBackValidationAvailable: true,
    }));
    const labels = commands.map((command) => command.label);

    expect(labels).toContain('Copy structured context');
    expect(labels).toContain('Copy table sample');
    expect(labels).toContain('Copy parser diagnostics');
    expect(labels).not.toContain('Copy schema-aware JSON context');
  });
});
