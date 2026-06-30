import { describe, expect, it } from 'vitest';
import type { AppCommandContext } from './appCommands';
import { createAppCommands } from './appCommands';

const noop = () => undefined;

function createContext(overrides: Partial<AppCommandContext> = {}): AppCommandContext {
  return {
    outlineOpen: true,
    focusMode: false,
    themeMode: 'dark',
    currentVisualStyleLabel: 'Scienfy',
    pasteReviewHunks: null,
    missingCitationCount: 0,
    missingVariableCount: 0,
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
    expect(labels).toContain('Open templates');
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
  });
});
