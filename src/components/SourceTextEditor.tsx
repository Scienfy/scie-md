import { useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { json as jsonLanguage } from '@codemirror/lang-json';
import { markdown as markdownLanguage } from '@codemirror/lang-markdown';
import { xml as xmlLanguage } from '@codemirror/lang-xml';
import { yaml as yamlLanguage } from '@codemirror/lang-yaml';
import { lintGutter, linter } from '@codemirror/lint';
import type { Diagnostic as CodeMirrorDiagnostic } from '@codemirror/lint';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import type { Extension, TransactionSpec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { DocumentFormat, FormatDiagnostic, SourceEditorCapabilities } from '@sciemd/core';
import { formatByteLengthUtf8, formatBytes, formatDefinitionFor, quoteAnchorPrefix, quoteAnchorSuffix, sourceEditorCapabilitiesFor } from '@sciemd/core';
import type { EditorHistoryControls } from './editorControls';
import type { EditorSelectionGetter } from './editorSelection';
import type { EditorAdapter, EditorAdapterReady, EditorSelectionAnchor } from './editorAdapter';

export type SourceTextLanguage = DocumentFormat;
export type SourceTextInsert = (text: string) => void;
export type SourceTextJump = (line: number) => void;
export type SourceTextFind = (from: number, to: number) => void;
export type SourceTextSelection = EditorSelectionGetter;
export type SourceTextContextMenuRequestHandler = (request: SourceTextContextMenuRequest) => boolean | void;

export interface SourceTextMarker {
  id: string;
  line: number;
  kind: string;
  title: string;
}

export interface SourceTextContextMenuRequest {
  kind: 'selection' | 'line';
  position: { x: number; y: number };
  language: SourceTextLanguage;
  text: string;
  lineText: string;
  selectedLinesText: string;
  line: number;
  endLine: number;
  from: number;
  to: number;
  diagnostics: FormatDiagnostic[];
  sourceEditor: SourceEditorCapabilities;
  selectLine: () => void;
}

export type SourceTextInsertTransactionBuilder = (
  view: Pick<EditorView, 'state'>,
  text: string,
) => TransactionSpec;

export interface SourceTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: SourceTextLanguage;
  diagnostics?: FormatDiagnostic[];
  markers?: SourceTextMarker[];
  parsingPending?: boolean;
  autosavePausedReason?: string | null;
  extraExtensions?: Extension[];
  programmaticEditBypassRef?: MutableRefObject<boolean>;
  createInsertTransaction?: SourceTextInsertTransactionBuilder;
  onInsertReady?: (insert: SourceTextInsert | undefined) => void;
  onJumpReady?: (jump: SourceTextJump | undefined) => void;
  onFindReady?: (find: SourceTextFind | undefined) => void;
  onHistoryReady?: (history: EditorHistoryControls | undefined) => void;
  onSelectionTextReady?: (selection: SourceTextSelection | undefined) => void;
  onAdapterReady?: EditorAdapterReady;
  onContextMenuRequest?: SourceTextContextMenuRequestHandler;
  onCursorLineChange?: (line: number, column: number) => void;
  onViewportLineChange?: (line: number) => void;
}

export function SourceTextEditor({
  value,
  onChange,
  language,
  diagnostics = [],
  markers = [],
  parsingPending = false,
  autosavePausedReason = null,
  extraExtensions = [],
  programmaticEditBypassRef,
  createInsertTransaction = createPlainTextInsertTransaction,
  onInsertReady,
  onJumpReady,
  onFindReady,
  onHistoryReady,
  onSelectionTextReady,
  onAdapterReady,
  onContextMenuRequest,
  onCursorLineChange,
  onViewportLineChange,
}: SourceTextEditorProps) {
  const sourceEditorProfile = useMemo(() => sourceEditorCapabilitiesFor(language), [language]);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onInsertReadyRef = useRef(onInsertReady);
  const onJumpReadyRef = useRef(onJumpReady);
  const onFindReadyRef = useRef(onFindReady);
  const onHistoryReadyRef = useRef(onHistoryReady);
  const onSelectionTextReadyRef = useRef(onSelectionTextReady);
  const onAdapterReadyRef = useRef(onAdapterReady);
  const onContextMenuRequestRef = useRef(onContextMenuRequest);
  const onCursorLineChangeRef = useRef(onCursorLineChange);
  const onViewportLineChangeRef = useRef(onViewportLineChange);
  const createInsertTransactionRef = useRef(createInsertTransaction);
  const languageRef = useRef(language);
  const sourceEditorProfileRef = useRef(sourceEditorProfile);
  const diagnosticsRef = useRef(diagnostics);
  const lastCursorRef = useRef({ line: 1, column: 1 });
  const languageCompartmentRef = useRef(new Compartment());
  const diagnosticsCompartmentRef = useRef(new Compartment());
  const extraExtensionsCompartmentRef = useRef(new Compartment());

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    onInsertReadyRef.current = onInsertReady;
  }, [onInsertReady]);

  useEffect(() => {
    onJumpReadyRef.current = onJumpReady;
  }, [onJumpReady]);

  useEffect(() => {
    onFindReadyRef.current = onFindReady;
  }, [onFindReady]);

  useEffect(() => {
    onHistoryReadyRef.current = onHistoryReady;
  }, [onHistoryReady]);

  useEffect(() => {
    onSelectionTextReadyRef.current = onSelectionTextReady;
  }, [onSelectionTextReady]);

  useEffect(() => {
    onAdapterReadyRef.current = onAdapterReady;
  }, [onAdapterReady]);

  useEffect(() => {
    onContextMenuRequestRef.current = onContextMenuRequest;
  }, [onContextMenuRequest]);

  useEffect(() => {
    onCursorLineChangeRef.current = onCursorLineChange;
  }, [onCursorLineChange]);

  useEffect(() => {
    onViewportLineChangeRef.current = onViewportLineChange;
  }, [onViewportLineChange]);

  useEffect(() => {
    createInsertTransactionRef.current = createInsertTransaction;
  }, [createInsertTransaction]);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    sourceEditorProfileRef.current = sourceEditorProfile;
  }, [sourceEditorProfile]);

  useEffect(() => {
    diagnosticsRef.current = diagnostics;
  }, [diagnostics]);

  useEffect(() => {
    if (!hostRef.current) return undefined;

    const emitCursorLine = (view: EditorView) => {
      const docLine = view.state.doc.lineAt(view.state.selection.main.head);
      const line = docLine.number;
      const column = view.state.selection.main.head - docLine.from + 1;
      if (lastCursorRef.current.line === line && lastCursorRef.current.column === column) return;
      lastCursorRef.current = { line, column };
      onCursorLineChangeRef.current?.(line, column);
    };

    let viewportAnimationFrame: number | null = null;
    let lastViewportLine = 0;
    const emitViewportLine = () => {
      viewportAnimationFrame = null;
      const currentView = viewRef.current;
      if (!currentView) return;
      const line = viewportTopLine(currentView);
      if (line === lastViewportLine) return;
      lastViewportLine = line;
      onViewportLineChangeRef.current?.(line);
    };
    const scheduleViewportLine = () => {
      if (viewportAnimationFrame !== null) return;
      viewportAnimationFrame = window.requestAnimationFrame(emitViewportLine);
    };

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          languageCompartmentRef.current.of(createLanguageExtension(sourceEditorProfile)),
          diagnosticsCompartmentRef.current.of(createDiagnosticsExtension(diagnostics, sourceEditorProfile)),
          EditorState.tabSize.of(2),
          EditorState.allowMultipleSelections.of(true),
          EditorView.lineWrapping,
          keymap.of([indentWithTab, ...defaultKeymap]),
          EditorView.domEventHandlers({
            contextmenu: (event, view) => {
              const request = createSourceContextMenuRequest(
                view,
                event,
                languageRef.current,
                sourceEditorProfileRef.current,
                diagnosticsRef.current,
              );
              if (!request) return false;
              const handled = onContextMenuRequestRef.current?.(request);
              if (!handled) return false;
              event.preventDefault();
              event.stopPropagation();
              return true;
            },
          }),
          extraExtensionsCompartmentRef.current.of(extraExtensions),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
            if (update.docChanged || update.selectionSet) {
              emitCursorLine(update.view);
            }
            if (update.selectionSet) {
              maybeTypewriterScroll(update.view);
            }
            if (update.docChanged || update.viewportChanged) {
              scheduleViewportLine();
            }
          }),
        ],
      }),
    });

    viewRef.current = view;
    emitCursorLine(view);
    const scrollElement = view.scrollDOM;
    scrollElement.addEventListener('scroll', scheduleViewportLine, { passive: true });
    window.addEventListener('resize', scheduleViewportLine);
    scheduleViewportLine();
    onInsertReadyRef.current?.((text) => {
      const currentView = viewRef.current;
      if (!currentView) return;
      const transaction = createInsertTransactionRef.current(currentView, text);
      currentView.dispatch(transaction);
      currentView.focus();
    });
    onJumpReadyRef.current?.((line) => {
      const currentView = viewRef.current;
      if (!currentView) return;
      const targetLine = currentView.state.doc.line(Math.max(1, Math.min(line, currentView.state.doc.lines)));
      currentView.dispatch({
        selection: { anchor: targetLine.from },
        effects: EditorView.scrollIntoView(targetLine.from, { y: 'start', yMargin: 18 }),
      });
      currentView.focus();
    });
    onFindReadyRef.current?.((from, to) => {
      const currentView = viewRef.current;
      if (!currentView) return;
      const docLength = currentView.state.doc.length;
      const safeFrom = Math.max(0, Math.min(from, docLength));
      const safeTo = Math.max(safeFrom, Math.min(to, docLength));
      currentView.dispatch({
        selection: { anchor: safeFrom, head: safeTo },
        effects: EditorView.scrollIntoView(safeFrom, { y: 'center' }),
      });
      currentView.focus();
    });
    onHistoryReadyRef.current?.(undefined);
    onSelectionTextReadyRef.current?.(() => {
      const currentView = viewRef.current;
      if (!currentView) return { text: '' };
      const ranges = [...currentView.state.selection.ranges].sort((left, right) => left.from - right.from);
      const firstRange = ranges[0] ?? currentView.state.selection.main;
      const lastRange = ranges.at(-1) ?? firstRange;
      const docLine = currentView.state.doc.lineAt(firstRange.from);
      const docEndLine = currentView.state.doc.lineAt(Math.max(firstRange.from, lastRange.to - 1));
      const text = ranges
        .map((range) => currentView.state.sliceDoc(range.from, range.to))
        .filter(Boolean)
        .join('\n\n');
      return {
        text,
        line: docLine.number,
        endLine: docEndLine.number,
        from: firstRange.from,
        to: lastRange.to,
        prefix: quoteAnchorPrefix(currentView.state.sliceDoc(0, firstRange.from)),
        suffix: quoteAnchorSuffix(currentView.state.sliceDoc(lastRange.to, currentView.state.doc.length)),
        surface: 'source',
      };
    });
    const adapter: EditorAdapter = {
      surface: 'source',
      read: () => {
        const currentView = viewRef.current;
        if (!currentView) return null;
        const currentText = currentView.state.doc.toString();
        return {
          surface: 'source',
          markdown: currentText,
          changed: currentText !== valueRef.current,
          markCommitted: () => {
            valueRef.current = currentText;
          },
        };
      },
      replace: (nextText) => {
        const currentView = viewRef.current;
        if (!currentView) return false;
        currentView.dispatch({
          changes: { from: 0, to: currentView.state.doc.length, insert: nextText },
        });
        valueRef.current = nextText;
        return true;
      },
      focus: () => {
        viewRef.current?.focus();
      },
      getSelectionAnchor: () => {
        const currentView = viewRef.current;
        if (!currentView) return null;
        const selection = currentView.state.selection.main;
        return { from: selection.from, to: selection.to };
      },
      restoreSelectionAnchor: (anchor: EditorSelectionAnchor) => {
        const currentView = viewRef.current;
        if (!currentView) return false;
        const docLength = currentView.state.doc.length;
        const from = Math.max(0, Math.min(anchor.from, docLength));
        const to = Math.max(from, Math.min(anchor.to ?? anchor.from, docLength));
        currentView.dispatch({ selection: { anchor: from, head: to } });
        currentView.focus();
        return true;
      },
      flushPendingEdits: () => adapter.read(),
    };
    onAdapterReadyRef.current?.(adapter);

    return () => {
      onInsertReadyRef.current?.(undefined);
      onJumpReadyRef.current?.(undefined);
      onFindReadyRef.current?.(undefined);
      onHistoryReadyRef.current?.(undefined);
      onSelectionTextReadyRef.current?.(undefined);
      onAdapterReadyRef.current?.(undefined);
      scrollElement.removeEventListener('scroll', scheduleViewportLine);
      window.removeEventListener('resize', scheduleViewportLine);
      if (viewportAnimationFrame !== null) window.cancelAnimationFrame(viewportAnimationFrame);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageCompartmentRef.current.reconfigure(createLanguageExtension(sourceEditorProfile)),
    });
  }, [sourceEditorProfile]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: diagnosticsCompartmentRef.current.reconfigure(createDiagnosticsExtension(diagnostics, sourceEditorProfile)),
    });
  }, [diagnostics, sourceEditorProfile]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: extraExtensionsCompartmentRef.current.reconfigure(extraExtensions),
    });
  }, [extraExtensions]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    if (programmaticEditBypassRef) programmaticEditBypassRef.current = true;
    try {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        annotations: Transaction.addToHistory.of(false),
      });
    } finally {
      if (programmaticEditBypassRef) programmaticEditBypassRef.current = false;
    }
  }, [programmaticEditBypassRef, value]);

  return (
    <div
      className={`source-editor source-editor-shell source-editor-language-${language} source-editor-codemirror-${sourceEditorProfile.codeMirrorLanguage}`}
      data-source-editor-language={sourceEditorProfile.languageId}
      data-source-editor-codemirror={sourceEditorProfile.codeMirrorLanguage}
      data-source-editor-lint={sourceEditorProfile.lintProfile}
    >
      <SourceEditorStatusStrip
        value={value}
        language={language}
        profile={sourceEditorProfile}
        diagnostics={diagnostics}
        parsingPending={parsingPending}
        autosavePausedReason={autosavePausedReason}
      />
      <div className="source-editor-host" ref={hostRef} />
      <SourceValidationTicks
        value={value}
        diagnostics={diagnostics}
        markers={markers}
      />
    </div>
  );
}

function createSourceContextMenuRequest(
  view: EditorView,
  event: MouseEvent,
  language: SourceTextLanguage,
  sourceEditor: SourceEditorCapabilities,
  diagnostics: FormatDiagnostic[],
): SourceTextContextMenuRequest | null {
  const position = { x: event.clientX, y: event.clientY };
  const ranges = [...view.state.selection.ranges]
    .filter((range) => range.from !== range.to)
    .sort((left, right) => left.from - right.from);

  if (ranges.length === 0) {
    const line = lineForSourceContextPointer(view, event);
    return {
      kind: 'line',
      position,
      language,
      text: line.text,
      lineText: line.text,
      selectedLinesText: line.text,
      line: line.number,
      endLine: line.number,
      from: line.from,
      to: line.to,
      diagnostics: diagnostics.filter((diagnostic) => diagnosticBelongsToLine(diagnostic, line.number, view)),
      sourceEditor,
      selectLine: () => selectSourceLine(view, line.from, line.to),
    };
  }

  const text = ranges
    .map((range) => view.state.sliceDoc(range.from, range.to))
    .filter(Boolean)
    .join('\n\n');

  const firstRange = ranges[0] ?? view.state.selection.main;
  const lastRange = ranges.at(-1) ?? firstRange;
  const firstLine = view.state.doc.lineAt(firstRange.from);
  const lastLine = view.state.doc.lineAt(Math.max(firstRange.from, lastRange.to - 1));
  return {
    kind: 'selection',
    position,
    language,
    text,
    lineText: firstLine.text,
    selectedLinesText: view.state.sliceDoc(firstLine.from, lastLine.to),
    line: firstLine.number,
    endLine: lastLine.number,
    from: firstRange.from,
    to: lastRange.to,
    diagnostics: diagnostics.filter((diagnostic) => {
      const line = lineForSourceDiagnostic(diagnostic, view);
      return line !== null && firstLine.number <= line && line <= lastLine.number;
    }),
    sourceEditor,
    selectLine: () => selectSourceLine(view, firstLine.from, lastLine.to),
  };
}

function lineForSourceContextPointer(view: EditorView, event: MouseEvent) {
  let pointerPos: number | null = null;
  try {
    pointerPos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
  } catch {
    pointerPos = null;
  }
  const fallbackPos = view.state.selection.main.head;
  return view.state.doc.lineAt(clampOffset(pointerPos ?? fallbackPos, view.state.doc.length));
}

function diagnosticBelongsToLine(diagnostic: FormatDiagnostic, line: number, view: EditorView): boolean {
  return lineForSourceDiagnostic(diagnostic, view) === line;
}

function selectSourceLine(view: EditorView, from: number, to: number): void {
  view.dispatch({
    selection: { anchor: from, head: to },
    effects: EditorView.scrollIntoView(from, { y: 'nearest', yMargin: 18 }),
  });
  view.focus();
}

function lineForSourceDiagnostic(diagnostic: FormatDiagnostic, view: EditorView): number | null {
  if (diagnostic.line && diagnostic.line > 0) return diagnostic.line;
  const messageLine = lineFromDiagnostic(diagnostic);
  if (messageLine) return messageLine;
  if (diagnostic.offset !== undefined) {
    return view.state.doc.lineAt(clampOffset(diagnostic.offset, view.state.doc.length)).number;
  }
  return lineFromDiagnostic({ message: diagnostic.message });
}

export function createPlainTextInsertTransaction(view: Pick<EditorView, 'state'>, text: string): TransactionSpec {
  const selection = view.state.selection.main;
  return {
    changes: { from: selection.from, to: selection.to, insert: text },
    selection: { anchor: selection.from + text.length },
  };
}

function SourceEditorStatusStrip({
  value,
  language,
  profile,
  diagnostics,
  parsingPending,
  autosavePausedReason,
}: {
  value: string;
  language: SourceTextLanguage;
  profile: SourceEditorCapabilities;
  diagnostics: FormatDiagnostic[];
  parsingPending: boolean;
  autosavePausedReason: string | null;
}) {
  const badges = sourceEditorStatusBadges({
    value,
    language,
    profile,
    diagnostics,
    parsingPending,
    autosavePausedReason,
  });
  if (badges.length === 0) return null;
  return (
    <div className="source-editor-status-strip" aria-label="Source editor status">
      {badges.map((badge) => (
        <span key={badge.id} className={`source-editor-status-badge ${badge.tone}`} title={badge.title}>
          {badge.label}
        </span>
      ))}
    </div>
  );
}

interface SourceEditorStatusBadge {
  id: string;
  label: string;
  title: string;
  tone: 'neutral' | 'success' | 'warning' | 'error';
}

function sourceEditorStatusBadges({
  value,
  language,
  profile,
  diagnostics,
  parsingPending,
  autosavePausedReason,
}: {
  value: string;
  language: SourceTextLanguage;
  profile: SourceEditorCapabilities;
  diagnostics: FormatDiagnostic[];
  parsingPending: boolean;
  autosavePausedReason: string | null;
}): SourceEditorStatusBadge[] {
  const label = formatDefinitionFor(language)?.label ?? language;
  const badges: SourceEditorStatusBadge[] = [];
  const parserDiagnostics = diagnostics.filter((diagnostic) => diagnostic.category === 'parser' || /\bsyntax\b/i.test(diagnostic.code));
  const parserErrors = parserDiagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  const parserWarnings = parserDiagnostics.filter((diagnostic) => diagnostic.severity !== 'error').length;
  const schemaDiagnostics = diagnostics.filter((diagnostic) => diagnostic.category === 'schema');
  const preservationDiagnostics = diagnostics.filter((diagnostic) => diagnostic.category === 'preservation');
  const sourceOnlyDiagnostic = diagnostics.find((diagnostic) => diagnostic.code.includes('source-only'));
  const lineEndings = detectLineEndingState(value);
  const byteLength = formatByteLengthUtf8(value);

  if (
    language === 'markdown'
    && diagnostics.length === 0
    && !parsingPending
    && !autosavePausedReason
    && !lineEndings.mixed
  ) {
    return [];
  }

  badges.push({
    id: 'format',
    label,
    title: `${label} source mode`,
    tone: 'neutral',
  });

  if (parsingPending) {
    badges.push({
      id: 'parser',
      label: 'Checking',
      title: 'Background parser diagnostics are still running.',
      tone: 'neutral',
    });
  } else if (parserErrors > 0) {
    badges.push({
      id: 'parser',
      label: `${parserErrors} syntax ${parserErrors === 1 ? 'error' : 'errors'}`,
      title: 'Parser errors block safe visual projection until the source is fixed.',
      tone: 'error',
    });
  } else if (parserWarnings > 0) {
    badges.push({
      id: 'parser',
      label: `${parserWarnings} parser ${parserWarnings === 1 ? 'warning' : 'warnings'}`,
      title: 'Parser diagnostics are available for this source.',
      tone: 'warning',
    });
  } else if (profile.lintProfile !== 'none') {
    badges.push({
      id: 'parser',
      label: 'Parser OK',
      title: 'No parser errors were reported for this source.',
      tone: 'success',
    });
  }

  if (schemaDiagnostics.length > 0) {
    badges.push({
      id: 'schema',
      label: `${schemaDiagnostics.length} schema ${schemaDiagnostics.length === 1 ? 'issue' : 'issues'}`,
      title: 'Schema diagnostics are present for this document.',
      tone: schemaDiagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 'error' : 'warning',
    });
  }

  if (preservationDiagnostics.length > 0) {
    badges.push({
      id: 'preservation',
      label: `${preservationDiagnostics.length} preservation ${preservationDiagnostics.length === 1 ? 'warning' : 'warnings'}`,
      title: 'Some source syntax may not round-trip through visual projections.',
      tone: 'warning',
    });
  }

  if (sourceOnlyDiagnostic) {
    badges.push({
      id: 'source-only',
      label: 'Source-only',
      title: sourceOnlyDiagnostic.message,
      tone: 'warning',
    });
  } else if (profile.sourceOnlyThresholdBytes !== undefined) {
    badges.push({
      id: 'budget',
      label: `${formatBytes(byteLength)} / ${formatBytes(profile.sourceOnlyThresholdBytes)}`,
      title: 'Current source size compared with this format parser budget.',
      tone: byteLength > profile.sourceOnlyThresholdBytes ? 'warning' : 'neutral',
    });
  }

  if (language !== 'plainText' && !profile.codeMirrorLanguageAvailable && profile.plainTextReason) {
    badges.push({
      id: 'language',
      label: 'Plain text',
      title: profile.plainTextReason,
      tone: 'neutral',
    });
  }

  if (lineEndings.mixed) {
    badges.push({
      id: 'line-endings',
      label: 'Mixed line endings',
      title: `Detected ${lineEndings.labels.join(', ')} line endings in this source.`,
      tone: 'warning',
    });
  }

  if (autosavePausedReason) {
    badges.push({
      id: 'autosave',
      label: 'Autosave paused',
      title: autosavePausedReason,
      tone: 'warning',
    });
  }

  return badges;
}

function detectLineEndingState(value: string): { mixed: boolean; labels: string[] } {
  const labels: string[] = [];
  if (/\r\n/.test(value)) labels.push('CRLF');
  if (/(^|[^\r])\n/.test(value)) labels.push('LF');
  if (/\r(?!\n)/.test(value)) labels.push('CR');
  return {
    mixed: labels.length > 1,
    labels,
  };
}

function SourceValidationTicks({
  value,
  diagnostics,
  markers,
}: {
  value: string;
  diagnostics: FormatDiagnostic[];
  markers: SourceTextMarker[];
}) {
  let totalLines = 1;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\n') totalLines++;
  }
  const diagnosticTicks: SourceTextMarker[] = diagnostics
    .map((diagnostic): SourceTextMarker | null => {
      const line = diagnostic.line ?? lineFromDiagnostic(diagnostic);
      return line
        ? {
            id: `diagnostic-${diagnostic.code}-${line}-${diagnostic.message}`,
            line,
            kind: diagnostic.severity,
            title: diagnostic.message,
          }
        : null;
    })
    .filter((tick): tick is SourceTextMarker => Boolean(tick));
  const ticks: SourceTextMarker[] = [
    ...diagnosticTicks,
    ...markers,
  ];

  if (ticks.length === 0) return null;

  return (
    <div className="source-validation-ticks" aria-hidden="true">
      {ticks.map((tick) => {
        const top = totalLines <= 1 ? 0 : ((Math.max(1, Math.min(tick.line, totalLines)) - 1) / (totalLines - 1)) * 100;
        return (
          <span
            key={tick.id}
            className={`source-validation-tick ${tick.kind}`}
            title={tick.title}
            style={{ top: `${top}%` }}
          />
        );
      })}
    </div>
  );
}

function lineFromDiagnostic(diagnostic: Pick<FormatDiagnostic, 'message'>): number | null {
  const match = diagnostic.message.match(/\bline\s+(\d+)\b/i);
  if (!match) return null;
  const line = Number(match[1]);
  return Number.isFinite(line) && line > 0 ? line : null;
}

function maybeTypewriterScroll(view: EditorView): void {
  if (!document.querySelector('.app-shell.focus-mode')) return;
  const head = view.state.selection.main.head;
  window.requestAnimationFrame(() => {
    const coords = view.coordsAtPos(head);
    if (!coords) return;
    const scroller = view.scrollDOM;
    const scrollerRect = scroller.getBoundingClientRect();
    const target = scroller.scrollTop + coords.top - scrollerRect.top - scroller.clientHeight * 0.42;
    scroller.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  });
}

function viewportTopLine(view: EditorView): number {
  const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop + 24);
  return view.state.doc.lineAt(block.from).number;
}

function createLanguageExtension(profile: SourceEditorCapabilities): Extension {
  if (profile.codeMirrorLanguage === 'markdown') return markdownLanguage();
  if (profile.codeMirrorLanguage === 'json') return jsonLanguage();
  if (profile.codeMirrorLanguage === 'yaml') return yamlLanguage();
  if (profile.codeMirrorLanguage === 'xml') return xmlLanguage();
  return [];
}

function createDiagnosticsExtension(diagnostics: FormatDiagnostic[], profile: SourceEditorCapabilities): Extension {
  if (diagnostics.length === 0) return [];
  if (profile.lintProfile === 'none' || profile.diagnosticsRangeSupport === 'none') return [];
  return [
    lintGutter(),
    linter((view) => formatDiagnosticsForCodeMirror(diagnostics, view.state.doc.toString()), { delay: 100 }),
  ];
}

export function formatDiagnosticsForCodeMirror(
  diagnostics: readonly FormatDiagnostic[],
  text: string,
): CodeMirrorDiagnostic[] {
  return diagnostics.map((diagnostic) => {
    const from = clampOffset(diagnostic.offset ?? offsetFromLineColumn(text, diagnostic.line, diagnostic.column), text.length);
    const to = clampOffset(from + Math.max(1, diagnostic.length ?? 1), text.length);
    return {
      from,
      to: Math.max(from, to),
      severity: diagnostic.severity,
      source: diagnostic.source ?? 'source',
      message: diagnostic.message,
    };
  });
}

function offsetFromLineColumn(text: string, line?: number, column?: number): number {
  if (!line || line < 1) return 0;
  let currentLine = 1;
  let lineStart = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (currentLine === line) break;
    if (text.charCodeAt(index) === 10) {
      currentLine += 1;
      lineStart = index + 1;
    }
  }
  if (currentLine !== line) return text.length;
  return lineStart + Math.max(0, (column ?? 1) - 1);
}

function clampOffset(offset: number, documentLength: number): number {
  return Math.max(0, Math.min(offset, documentLength));
}
