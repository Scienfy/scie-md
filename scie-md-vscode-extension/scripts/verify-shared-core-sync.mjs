import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(extensionRoot, '..');
const desktopMirrorRoot = path.join(repoRoot, 'src');
const extensionMirrorRoot = path.join(extensionRoot, 'src', 'scie-md');
const reportPath = path.join(repoRoot, 'docs', 'refactor', 'extension-mirror-classification.md');
const writeReport = process.argv.includes('--write-report');

const mirroredGroups = [
  {
    label: 'webview markdown copy',
    sourceRoot: path.join(repoRoot, 'src', 'markdown'),
    copyRoot: path.join(extensionRoot, 'src', 'scie-md', 'markdown'),
    files: [
      'authorship.test.ts',
      'authorship.ts',
      'documentHistory.test.ts',
      'documentHistory.ts',
      'documentIntelligence.test.ts',
      'documentIntelligence.ts',
      'findReplace.test.ts',
      'findReplace.ts',
      'headingToggle.test.ts',
      'headingToggle.ts',
      'htmlExportBlocks.test.ts',
      'htmlExportBlocks.ts',
      'htmlExport.test.ts',
      'htmlExport.ts',
      'imagePaths.test.ts',
      'imagePaths.ts',
      'manuscriptReadiness.test.ts',
      'manuscriptReadiness.ts',
      'markdownImages.test.ts',
      'markdownImages.ts',
      'markdownNormalize.ts',
      'markdownValidation.test.ts',
      'markdownValidation.ts',
      'mathPreview.test.ts',
      'mathPreview.ts',
      'mermaidBlocks.test.ts',
      'mermaidBlocks.ts',
      'outputPipeline.test.ts',
      'outputPipeline.ts',
      'roundTripGoldenCorpus.ts',
      'scientificTypography.test.ts',
      'scientificTypography.ts',
      'supportedMarkdown.ts',
      'svgBlocks.test.ts',
      'svgBlocks.ts',
      'svgSanitizer.test.ts',
      'svgSanitizer.ts',
      'visualMarkers.ts',
      'visualRoundTripSafety.ts',
    ],
  },
  {
    label: 'webview domain copy',
    sourceRoot: path.join(repoRoot, 'src', 'domain'),
    copyRoot: path.join(extensionRoot, 'src', 'scie-md', 'domain'),
    files: [
      'citations/crossref.test.ts',
      'citations/crossref.ts',
      'document/documentParser.worker.ts',
      'document/documentParserWorker.test.ts',
      'document/documentParserWorker.ts',
      'document/documentPerformance.test.ts',
      'document/templates.ts',
    ],
  },
  {
    label: 'webview Milkdown metadata copy',
    sourceRoot: path.join(repoRoot, 'src', 'components', 'milkdown'),
    copyRoot: path.join(extensionRoot, 'src', 'scie-md', 'components', 'milkdown'),
    files: [
      'nodes/pendingMetadataEdits.ts',
      'nodes/renderedVisualAtoms.test.ts',
      'nodes/renderedVisualAtoms.ts',
      'scieMetadataNodes.test.ts',
      'scieMetadataNodes.ts',
      'scieMetadataRoundtrip.test.ts',
      'scieMetadataRuntime.ts',
    ],
  },
];

const divergentMirrorClassifications = new Map([
  [
    'components/AboutDialog.tsx',
    {
      category: 'hostAdapter',
      reason: 'desktop resolves the runtime Tauri app version; the extension exposes VS Code package metadata.',
    },
  ],
  [
    'components/AppTopbar.tsx',
    {
      category: 'hostAdapter',
      reason: 'desktop window/document actions and VS Code webview actions have different command surfaces.',
    },
  ],
  [
    'components/AppTopbar.test.tsx',
    {
      category: 'hostAdapter',
      reason: 'test fixtures track the desktop diagnostics command surface and the reduced VS Code webview command surface.',
    },
  ],
  [
    'components/ExportRenderHost.tsx',
    {
      category: 'hostAdapter',
      reason: 'desktop export capture and extension preview rendering use different host lifecycle assumptions.',
    },
  ],
  [
    'components/InspectorPane.tsx',
    {
      category: 'hostAdapter',
      reason: 'desktop inspector includes structured-format diagnostics and trees; the extension uses a separate read-only structured preview webview path.',
    },
  ],
  [
    'components/NavigationSidebar.tsx',
    {
      category: 'hostAdapter',
      reason: 'desktop file-explorer image previews use native resource conversion that is not part of the VSIX runtime surface.',
    },
  ],
  [
    'components/NavigationSidebar.test.tsx',
    {
      category: 'hostAdapter',
      reason: 'desktop navigation tests cover native file-explorer and structured-document routing that are not mirrored in the VS Code webview.',
    },
  ],
  [
    'components/QuickOutlineHover.tsx',
    {
      category: 'hostAdapter',
      reason: 'desktop quick outline owns context-menu affordances and copy feedback; the VS Code webview keeps a reduced outline without desktop context-menu plumbing.',
    },
  ],
  [
    'components/StatusBar.tsx',
    {
      category: 'hostAdapter',
      reason: 'desktop status chrome reports multi-format document state; the extension owns a reduced VS Code webview status surface.',
    },
  ],
  [
    'components/StatusBar.test.tsx',
    {
      category: 'hostAdapter',
      reason: 'desktop status tests cover multi-format document state that the extension does not mirror directly.',
    },
  ],
  [
    'components/TemplateDialog.tsx',
    {
      category: 'hostAdapter',
      reason: 'desktop exposes Markdown, structured, and plain-text new-document templates; the VS Code webview keeps a reduced Markdown template chooser.',
    },
  ],
  [
    'components/SlashCommandMenu.test.tsx',
    {
      category: 'intentionalFork',
      reason: 'test fixtures track the command set exposed by each host.',
    },
  ],
  [
    'components/SlashCommandMenu.tsx',
    {
      category: 'intentionalFork',
      reason: 'desktop and extension slash commands expose host-specific actions.',
    },
  ],
  [
    'components/SourceMarkdownEditor.test.ts',
    {
      category: 'hostAdapter',
      reason: 'tests cover host-specific source-editor insert and completion behavior.',
    },
  ],
  [
    'components/SourceMarkdownEditor.tsx',
    {
      category: 'hostAdapter',
      reason: 'source editor wiring differs between desktop document-session state and VS Code webview messages.',
    },
  ],
  [
    'components/VisualMarkdownEditor.test.ts',
    {
      category: 'hostAdapter',
      reason: 'tests cover host-specific visual-editor read/write hooks.',
    },
  ],
  [
    'components/VisualMarkdownEditor.tsx',
    {
      category: 'hostAdapter',
      reason: 'visual editor state readers and callbacks differ between desktop and the VS Code webview host.',
    },
  ],
  [
    'components/visualEditorStateSync.ts',
    {
      category: 'hostAdapter',
      reason: 'desktop uses editor-adapter state while the extension uses webview-safe string state readers.',
    },
  ],
  [
    'services/fileService.ts',
    {
      category: 'hostAdapter',
      reason: 'desktop file operations call Tauri commands; the extension bundles only webview-safe code and guards VSIX output.',
    },
  ],
  [
    'services/inkscapeService.ts',
    {
      category: 'hostAdapter',
      reason: 'desktop can invoke native Inkscape helpers; the extension cannot rely on those Tauri commands.',
    },
  ],
  [
    'styles/app.tokens.css',
    {
      category: 'hostAdapter',
      reason: 'desktop serves fonts from the app root; the extension must use webview-bundled relative font assets.',
    },
  ],
  [
    'styles/app.dialogs.css',
    {
      category: 'hostAdapter',
      reason: 'desktop dialog styles include native structured workflows; the extension keeps VS Code webview-specific dialogs in its own stylesheet.',
    },
  ],
  [
    'styles/app.editor.css',
    {
      category: 'hostAdapter',
      reason: 'desktop editor chrome includes startup-open fallback styling that is not part of the VS Code webview host.',
    },
  ],
  [
    'styles/app.navigation.css',
    {
      category: 'hostAdapter',
      reason: 'desktop navigation includes structured-data sidebar affordances; the extension uses separate structured preview webview navigation.',
    },
  ],
  [
    'styles/app.panels.css',
    {
      category: 'hostAdapter',
      reason: 'desktop panel styles include structured inspectors and conflict UI that are represented by separate extension webview styles.',
    },
  ],
  [
    'styles/app.shell.css',
    {
      category: 'hostAdapter',
      reason: 'desktop shell styles include structured surface toggles and context menus that are not mirrored in the reduced VS Code webview shell.',
    },
  ],
  [
    'styles/app.source-editor.css',
    {
      category: 'hostAdapter',
      reason: 'desktop source editor styles include structured parser status badges; the extension keeps structured preview status in its own VS Code webview styles.',
    },
  ],
  [
    'styles/app.css',
    {
      category: 'hostAdapter',
      reason: 'desktop shell chrome and VS Code webview layout styles intentionally differ.',
    },
  ],
]);

const drift = [];
const packageOwnedMarkdownCoreRelativeFiles = [
  'diffReview.test.ts',
  'diffReview.ts',
  'editorComments.test.ts',
  'editorComments.ts',
  'lockRanges.test.ts',
  'lockRanges.ts',
  'llm.test.ts',
  'llm.ts',
  'markdownRanges.test.ts',
  'markdownRanges.ts',
  'outline.test.ts',
  'outline.ts',
  'protectedBlocks.test.ts',
  'protectedBlocks.ts',
  'quoteAnchors.test.ts',
  'quoteAnchors.ts',
  'reviewPlan.test.ts',
  'reviewPlan.ts',
  'selectionWrapping.test.ts',
  'selectionWrapping.ts',
  'semanticBlocks.test.ts',
  'semanticBlocks.ts',
  'targetedInstructions.test.ts',
  'targetedInstructions.ts',
  'textOffsets.test.ts',
  'textOffsets.ts',
  'variants.test.ts',
  'variants.ts',
];
const requiredPackageCoreFiles = [
  path.join(repoRoot, 'packages', 'core', 'src', 'domain', 'blocks', 'directiveParser.ts'),
  path.join(repoRoot, 'packages', 'core', 'src', 'domain', 'document', 'documentModel.ts'),
  path.join(repoRoot, 'packages', 'core', 'src', 'domain', 'document', 'frontmatter.ts'),
  path.join(repoRoot, 'packages', 'core', 'src', 'domain', 'references', 'crossReferenceIndex.ts'),
  path.join(repoRoot, 'packages', 'core', 'src', 'domain', 'variables', 'variableEditing.ts'),
  path.join(repoRoot, 'packages', 'core', 'src', 'domain', 'variables', 'variableIndex.ts'),
  ...packageOwnedMarkdownCoreRelativeFiles.map((relative) => path.join(repoRoot, 'packages', 'core', 'src', 'markdown', relative)),
];
const packageOwnedLegacyCopies = [
  path.join(repoRoot, 'src', 'domain', 'citations', 'bibtex.ts'),
  path.join(repoRoot, 'src', 'domain', 'citations', 'citationIndex.ts'),
  path.join(extensionRoot, 'src', 'scie-md', 'domain', 'citations', 'bibtex.ts'),
  path.join(extensionRoot, 'src', 'scie-md', 'domain', 'citations', 'citationIndex.ts'),
  path.join(extensionRoot, 'src', 'shared', 'domain', 'citations', 'bibtex.ts'),
  path.join(extensionRoot, 'src', 'shared', 'domain', 'citations', 'citationIndex.ts'),
];
const packageOwnedDomainCopies = [
  path.join(repoRoot, 'src', 'domain', 'blocks', 'directiveParser.ts'),
  path.join(repoRoot, 'src', 'domain', 'document', 'documentModel.ts'),
  path.join(repoRoot, 'src', 'domain', 'document', 'frontmatter.ts'),
  path.join(repoRoot, 'src', 'domain', 'references', 'crossReferenceIndex.ts'),
  path.join(repoRoot, 'src', 'domain', 'variables', 'variableEditing.ts'),
  path.join(repoRoot, 'src', 'domain', 'variables', 'variableIndex.ts'),
  path.join(extensionRoot, 'src', 'scie-md', 'domain', 'blocks', 'directiveParser.ts'),
  path.join(extensionRoot, 'src', 'scie-md', 'domain', 'document', 'documentModel.ts'),
  path.join(extensionRoot, 'src', 'scie-md', 'domain', 'document', 'frontmatter.ts'),
  path.join(extensionRoot, 'src', 'scie-md', 'domain', 'references', 'crossReferenceIndex.ts'),
  path.join(extensionRoot, 'src', 'scie-md', 'domain', 'variables', 'variableEditing.ts'),
  path.join(extensionRoot, 'src', 'scie-md', 'domain', 'variables', 'variableIndex.ts'),
  path.join(extensionRoot, 'src', 'shared', 'domain', 'blocks', 'directiveParser.ts'),
  path.join(extensionRoot, 'src', 'shared', 'domain', 'document', 'documentModel.ts'),
  path.join(extensionRoot, 'src', 'shared', 'domain', 'document', 'frontmatter.ts'),
  path.join(extensionRoot, 'src', 'shared', 'domain', 'references', 'crossReferenceIndex.ts'),
  path.join(extensionRoot, 'src', 'shared', 'domain', 'variables', 'variableEditing.ts'),
  path.join(extensionRoot, 'src', 'shared', 'domain', 'variables', 'variableIndex.ts'),
];
const packageOwnedSharedMarkdownCopies = [
  'diffReview.ts',
  'editorComments.ts',
  'lockRanges.ts',
  'llm.ts',
  'markdownRanges.ts',
  'outline.ts',
  'protectedBlocks.ts',
  'quoteAnchors.ts',
  'reviewPlan.ts',
  'selectionWrapping.ts',
  'semanticBlocks.ts',
  'targetedInstructions.ts',
  'textOffsets.ts',
  'variants.ts',
].map((relative) => path.join(extensionRoot, 'src', 'shared', 'markdown', relative));
const packageOwnedMarkdownCopies = [
  ...packageOwnedMarkdownCoreRelativeFiles,
].flatMap((relative) => [
  path.join(repoRoot, 'src', 'markdown', relative),
  path.join(extensionRoot, 'src', 'scie-md', 'markdown', relative),
]);
const unusedDeletedCopies = [
  {
    relative: 'components/AppErrorBoundary.tsx',
    file: path.join(extensionRoot, 'src', 'scie-md', 'components', 'AppErrorBoundary.tsx'),
    reason: 'unused extension copy diverged from desktop diagnostics and raw-Markdown recovery; the extension webview does not import it.',
  },
  {
    relative: 'webview/markdownRender.ts',
    file: path.join(extensionRoot, 'src', 'webview', 'markdownRender.ts'),
    reason: 'unused wrapper around markdownRenderCore; the current VS Code webview bundle does not import it.',
  },
  {
    relative: 'webview/markdownRenderCore.ts',
    file: path.join(extensionRoot, 'src', 'webview', 'markdownRenderCore.ts'),
    reason: 'unused legacy Markdown renderer; the current VS Code webview renders Markdown through the ScieMD app copy.',
  },
];

const exactMirrorSet = new Set();
for (const mapping of mirroredGroups) {
  for (const relative of mapping.files) {
    exactMirrorSet.add(toPosix(path.relative(desktopMirrorRoot, path.join(mapping.sourceRoot, relative))));
  }
}

for (const file of requiredPackageCoreFiles) {
  const raw = await readOptionalUtf8(file);
  if (raw === null) {
    drift.push(`package-owned domain core is missing ${path.relative(repoRoot, file)}`);
  }
}

for (const file of packageOwnedLegacyCopies) {
  const raw = await readOptionalUtf8(file);
  if (raw !== null) {
    drift.push(`package-owned citation core should import @sciemd/core instead of restoring ${path.relative(repoRoot, file)}`);
  }
}

for (const file of packageOwnedDomainCopies) {
  const raw = await readOptionalUtf8(file);
  if (raw !== null) {
    drift.push(`package-owned domain core should import @sciemd/core instead of restoring ${path.relative(repoRoot, file)}`);
  }
}

for (const file of packageOwnedSharedMarkdownCopies) {
  const raw = await readOptionalUtf8(file);
  if (raw !== null) {
    drift.push(`package-owned shared markdown should import @sciemd/core instead of restoring ${path.relative(repoRoot, file)}`);
  }
}

for (const file of packageOwnedMarkdownCopies) {
  const raw = await readOptionalUtf8(file);
  if (raw !== null) {
    drift.push(`package-owned markdown core should import @sciemd/core instead of restoring ${path.relative(repoRoot, file)}`);
  }
}

for (const item of unusedDeletedCopies) {
  const raw = await readOptionalUtf8(item.file);
  if (raw !== null) {
    drift.push(`unused/deleted extension mirror should not be restored: ${path.relative(repoRoot, item.file)} (${item.reason})`);
  }
}

for (const mapping of mirroredGroups) {
  for (const relative of mapping.files) {
    const source = path.join(mapping.sourceRoot, relative);
    const file = path.join(mapping.copyRoot, relative);
    const [sourceText, copiedText] = await Promise.all([
      readOptionalUtf8(source),
      readOptionalUtf8(file),
    ]);

    if (sourceText === null) {
      drift.push(`${mapping.label}/${relative}: source file missing`);
    } else if (copiedText === null) {
      drift.push(`${mapping.label}/${relative}: copied file missing`);
    } else if (!sameText(sourceText, copiedText)) {
      drift.push(`${mapping.label}/${relative}: copied core differs from desktop source`);
    }
  }
}

const classification = await classifyMirrorOverlap();

if (writeReport) {
  await writeFile(reportPath, renderClassificationReport(classification), 'utf8');
}

if (drift.length > 0) {
  console.error('ScieMD shared-core copy drift detected:');
  for (const item of drift) console.error(`- ${item}`);
  process.exit(1);
}

console.log(
  [
    'ScieMD shared-core copies match desktop source.',
    `Mirror classification: ${classification.overlapCount} same-path files,`,
    `${classification.exactMirror.length} exact mirrors,`,
    `${classification.hostAdapter.length} host adapters,`,
    `${classification.intentionalFork.length} intentional forks,`,
    `${classification.unusedDeleted.length} unused/deleted guards.`,
  ].join(' '),
);
if (writeReport) {
  console.log(`Wrote ${path.relative(repoRoot, reportPath)}.`);
}

async function classifyMirrorOverlap() {
  const [desktopFiles, extensionFiles] = await Promise.all([
    listFiles(desktopMirrorRoot),
    listFiles(extensionMirrorRoot),
  ]);
  const extensionFileSet = new Set(extensionFiles);
  const overlap = desktopFiles.filter((relative) => extensionFileSet.has(relative)).sort();
  const result = {
    overlapCount: overlap.length,
    exactMirror: [],
    hostAdapter: [],
    intentionalFork: [],
    unusedDeleted: unusedDeletedCopies.map((item) => ({
      relative: item.relative,
      reason: item.reason,
    })),
  };

  for (const relative of overlap) {
    const [sourceText, copiedText] = await Promise.all([
      readFile(path.join(desktopMirrorRoot, relative), 'utf8'),
      readFile(path.join(extensionMirrorRoot, relative), 'utf8'),
    ]);
    if (sameText(sourceText, copiedText)) {
      result.exactMirror.push({
        relative,
        source: exactMirrorSet.has(relative) ? 'manifest' : 'auto-identical',
      });
      continue;
    }

    if (exactMirrorSet.has(relative)) {
      continue;
    }

    const item = divergentMirrorClassifications.get(relative);
    if (!item) {
      drift.push(`unclassified extension mirror divergence: ${relative}`);
      continue;
    }
    result[item.category].push({
      relative,
      reason: item.reason,
    });
  }

  return result;
}

async function listFiles(root, base = root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath, base));
    } else if (entry.isFile()) {
      files.push(toPosix(path.relative(base, fullPath)));
    }
  }
  return files.sort();
}

function renderClassificationReport(classification) {
  const lines = [
    '# ScieMD Extension Mirror Classification',
    '',
    'Generated by `node scie-md-vscode-extension/scripts/verify-shared-core-sync.mjs --write-report`.',
    '',
    '## Summary',
    '',
    `- Same-relative desktop/extension files: ${classification.overlapCount}`,
    `- Exact mirrors: ${classification.exactMirror.length}`,
    `- Host adapters: ${classification.hostAdapter.length}`,
    `- Intentional forks: ${classification.intentionalFork.length}`,
    `- Unused/deleted guards: ${classification.unusedDeleted.length}`,
    '',
    '## Exact Mirrors',
    '',
    ...classification.exactMirror.map((item) => `- \`${item.relative}\` (${item.source})`),
    '',
    '## Host Adapters',
    '',
    ...classification.hostAdapter.map((item) => `- \`${item.relative}\`: ${item.reason}`),
    '',
    '## Intentional Forks',
    '',
    ...classification.intentionalFork.map((item) => `- \`${item.relative}\`: ${item.reason}`),
    '',
    '## Unused Or Deleted',
    '',
    ...classification.unusedDeleted.map((item) => `- \`${item.relative}\`: ${item.reason}`),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

async function readOptionalUtf8(file) {
  return readFile(file, 'utf8').catch(() => null);
}

function sameText(left, right) {
  return normalizeNewlines(left) === normalizeNewlines(right);
}

function normalizeNewlines(value) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function toPosix(value) {
  return value.replace(/\\/g, '/');
}
