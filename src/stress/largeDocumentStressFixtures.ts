export interface LargeDocumentStressFixtureOptions {
  sectionCount?: number;
  includeMermaidEvery?: number;
  includeSvgEvery?: number;
  includeNoteEvery?: number;
}

export interface StructuredStressFixtureOptions {
  recordCount?: number;
  invalidEvery?: number;
  longTextEvery?: number;
  columnCount?: number;
  embeddedNewlineEvery?: number;
}

export interface StructuredStressFixture {
  text: string;
  expected: {
    recordCount: number;
    byteLength: number;
    sourceLineCount?: number;
    invalidLineCount?: number;
    columnCount?: number;
    embeddedNewlineRowCount?: number;
  };
}

export interface LargeDocumentStressFixture {
  markdown: string;
  expected: LargeDocumentStressExpectations;
}

export interface LargeDocumentStressExpectations {
  sectionCount: number;
  markdownBytes: number;
  lineCount: number;
  imageCount: number;
  mathCount: number;
  citationUsageCount: number;
  variableUsageCount: number;
  figureDirectiveCount: number;
  noteDirectiveCount: number;
  mermaidFenceCount: number;
  svgFenceCount: number;
  visualAtomCount: number;
}

export const LARGE_DOCUMENT_STRESS_BIBTEX = [
  '@article{smith2026,',
  '  title={Reliable Scientific Markdown},',
  '  author={Smith, Jane and Doe, Alex},',
  '  journal={Journal of Research Tools},',
  '  year={2026}',
  '}',
].join('\n');

export const LARGE_DOCUMENT_STRESS_CITATION_ENTRY = {
  type: 'article',
  key: 'smith2026',
  fields: {
    title: 'Reliable Scientific Markdown',
    author: 'Jane Smith and Alex Doe',
    journal: 'Journal of Research Tools',
    year: '2026',
  },
};

const DEFAULT_SECTION_COUNT = 900;
const DEFAULT_MERMAID_INTERVAL = 17;
const DEFAULT_SVG_INTERVAL = 19;
const DEFAULT_NOTE_INTERVAL = 11;

export function createLargeDocumentStressFixture(
  options: LargeDocumentStressFixtureOptions = {},
): LargeDocumentStressFixture {
  const sectionCount = positiveInteger(options.sectionCount, DEFAULT_SECTION_COUNT);
  const includeMermaidEvery = positiveInteger(options.includeMermaidEvery, DEFAULT_MERMAID_INTERVAL);
  const includeSvgEvery = positiveInteger(options.includeSvgEvery, DEFAULT_SVG_INTERVAL);
  const includeNoteEvery = positiveInteger(options.includeNoteEvery, DEFAULT_NOTE_INTERVAL);
  const lines: string[] = [
    '---',
    'title: Large Document Stress Fixture',
    'bibliography:',
    '  - refs.bib',
    'variablesFile:',
    '  - variables.json',
    'scienfy:',
    '  documentType: research-note',
    '  visualStyle: scientific-draft',
    'cohort_n: 128',
    '---',
    '',
    '# Large Document Stress Fixture',
    '',
    'This deterministic fixture is generated for parser, diagnostics, export, and recovery stress validation.',
    '',
  ];

  let noteDirectiveCount = 0;
  let mermaidFenceCount = 0;
  let svgFenceCount = 0;

  for (let index = 0; index < sectionCount; index += 1) {
    const figureId = `fig-stress-${index}`;
    lines.push(
      `## Cohort Section ${index + 1}`,
      '',
      `Participants {{ cohort_n }} were analyzed in replicate ${index + 1} with citation [@smith2026] and cross reference @${figureId}.`,
      `Inline model quality is summarized as $x_{${index}}^2 + y_{${index}}^2 = z_{${index}}^2$ for stress accounting.`,
      '',
      `:::figure {#${figureId}}`,
      `![Cohort ${index + 1}](figures/cohort-${index + 1}.png)`,
      '',
      `Stress figure ${index + 1} keeps local image, directive, citation, and reference paths active.`,
      ':::',
      '',
      '| Measure | Value |',
      '| --- | ---: |',
      `| Section | ${index + 1} |`,
      `| Cohort | {{ cohort_n }} |`,
      '',
    );

    if (index % includeNoteEvery === 0) {
      noteDirectiveCount += 1;
      lines.push(
        ':::note',
        `Monitoring note for section ${index + 1} keeps note directives in the stress surface.`,
        ':::',
        '',
      );
    }

    if (index % includeMermaidEvery === 0) {
      mermaidFenceCount += 1;
      lines.push(
        '```mermaid',
        'flowchart LR',
        `  A${index}["Input ${index + 1}"] --> B${index}["Analysis"]`,
        `  B${index} --> C${index}["Output"]`,
        '```',
        '',
      );
    }

    if (index % includeSvgEvery === 0) {
      svgFenceCount += 1;
      lines.push(
        '```svg',
        '<svg viewBox="0 0 220 60" role="img" aria-label="Stress vector">',
        '<rect x="1" y="1" width="218" height="58" fill="#f8faf9" stroke="#4f7c68"/>',
        `<text x="12" y="36">Section ${index + 1} vector</text>`,
        '</svg>',
        '```',
        '',
      );
    }
  }

  lines.push(
    ':::references',
    ':::',
    '',
    '<!-- scie_md:variant:group id="abstract" active="short" -->',
    '<!-- scie_md:variant:item id="long" name="Long" -->',
    'This longer abstract variant should be ignored by export output.',
    '<!-- scie_md:variant:item id="short" name="Short" -->',
    'This short abstract variant should remain active for output.',
    '<!-- scie_md:variant:end -->',
    '',
    'Tail marker: large-document-stress-complete.',
    '',
  );

  const markdown = lines.join('\n');
  const markdownBytes = byteLength(markdown);
  const figureDirectiveCount = sectionCount;
  const expected: LargeDocumentStressExpectations = {
    sectionCount,
    markdownBytes,
    lineCount: lineCount(markdown),
    imageCount: sectionCount,
    mathCount: sectionCount * 2,
    citationUsageCount: sectionCount,
    variableUsageCount: sectionCount * 2,
    figureDirectiveCount,
    noteDirectiveCount,
    mermaidFenceCount,
    svgFenceCount,
    visualAtomCount: figureDirectiveCount + noteDirectiveCount + mermaidFenceCount + svgFenceCount + 1,
  };

  return { markdown, expected };
}

export function createVisualExportStressRoot(imageCount: number): HTMLElement {
  const normalizedImageCount = positiveInteger(imageCount, 32);
  const root = document.createElement('div');
  const body: string[] = [];

  for (let index = 0; index < normalizedImageCount; index += 1) {
    body.push(
      '<section class="directive-card directive-figure">',
      '<div class="scie-md-visual-atom-controls"><button>Edit</button></div>',
      `<p>Visual stress block ${index + 1}</p>`,
      `<p><img src="file:///C:/Lab/stress/figures/visual-${index + 1}.png" alt="Visual ${index + 1}"></p>`,
      '</section>',
    );
  }

  root.innerHTML = [
    '<main class="editor-stage">',
    '<div class="save-pill">Autosave</div>',
    '<section class="visual-editor">',
    '<div class="milkdown">',
    '<article class="ProseMirror ProseMirror-focused" contenteditable="true">',
    '<h1>Visual Export Stress</h1>',
    ...body,
    '</article>',
    '</div>',
    '</section>',
    '</main>',
  ].join('\n');

  return root;
}

export function createRecoveryStressMarkdown(minBytes: number): string {
  const chunks = [
    '# Recovery Stress',
    '',
    'Head marker: large-document-recovery-start.',
    '',
  ];
  let index = 0;
  while (byteLength(chunks.join('\n')) < minBytes) {
    chunks.push(
      `## Recovery section ${index + 1}`,
      `The recovery snapshot keeps bounded durable text for section ${index + 1}.`,
      `Payload ${index + 1}: ${'R'.repeat(512)}`,
      '',
    );
    index += 1;
  }
  chunks.push('Tail marker: large-document-recovery-complete.', '');
  return chunks.join('\n');
}

export function createLargeJsonStressFixture(options: StructuredStressFixtureOptions = {}): StructuredStressFixture {
  const recordCount = positiveInteger(options.recordCount, 3200);
  const records = Array.from({ length: recordCount }, (_value, index) => ({
    id: `sample-${index + 1}`,
    group: index % 2 === 0 ? 'control' : 'treatment',
    measurements: [
      { name: 'baseline', value: index },
      { name: 'week4', value: index + 4 },
      { name: 'week8', value: index + 8 },
    ],
    flags: {
      qc: index % 7 !== 0,
      replicate: index % 3,
    },
  }));
  const text = `${JSON.stringify({
    schemaVersion: 1,
    generatedFor: 'large-document-stress',
    records,
  }, null, 2)}\n`;
  return {
    text,
    expected: {
      recordCount,
      byteLength: byteLength(text),
    },
  };
}

export function createLargeJsonlStressFixture(options: StructuredStressFixtureOptions = {}): StructuredStressFixture {
  const recordCount = positiveInteger(options.recordCount, 900);
  const invalidEvery = positiveIntegerOrZero(options.invalidEvery);
  const longTextEvery = positiveIntegerOrZero(options.longTextEvery);
  let invalidLineCount = 0;
  const lines = Array.from({ length: recordCount }, (_value, index) => {
    const ordinal = index + 1;
    if (invalidEvery > 0 && ordinal % invalidEvery === 0) {
      invalidLineCount += 1;
      return `{"id":"row-${ordinal}","score":}`;
    }
    return JSON.stringify({
      id: `row-${ordinal}`,
      cohort: index % 5,
      score: Number((index / 10).toFixed(2)),
      status: index % 11 === 0 ? 'review' : 'ok',
      note: longTextEvery > 0 && ordinal % longTextEvery === 0
        ? `Long JSONL stress note ${ordinal}: ${'abcdefghijklmnopqrstuvwxyz '.repeat(24)}`
        : `note-${ordinal}`,
    });
  });
  const text = `${lines.join('\n')}\n`;
  return {
    text,
    expected: {
      recordCount: recordCount - invalidLineCount,
      byteLength: byteLength(text),
      sourceLineCount: recordCount,
      invalidLineCount,
    },
  };
}

export function createLargeCsvStressFixture(options: StructuredStressFixtureOptions = {}): StructuredStressFixture {
  const recordCount = positiveInteger(options.recordCount, 700);
  const columnCount = Math.max(4, positiveInteger(options.columnCount, 4));
  const embeddedNewlineEvery = positiveIntegerOrZero(options.embeddedNewlineEvery);
  const longTextEvery = positiveIntegerOrZero(options.longTextEvery);
  const headers = ['sample', 'cohort', 'score', 'status'];
  const baseHeaderCount = headers.length;
  for (let index = baseHeaderCount; index < columnCount; index += 1) {
    headers.push(`measurement_${index - baseHeaderCount + 1}`);
  }
  const lines = [headers.map(csvCell).join(',')];
  let embeddedNewlineRowCount = 0;
  for (let index = 0; index < recordCount; index += 1) {
    const ordinal = index + 1;
    const row = [
      `sample-${ordinal}`,
      String(index % 5),
      (index / 10).toFixed(2),
      index % 11 === 0 ? 'review' : 'ok',
    ];
    for (let columnIndex = row.length; columnIndex < columnCount; columnIndex += 1) {
      if (embeddedNewlineEvery > 0 && ordinal % embeddedNewlineEvery === 0 && columnIndex === 4) {
        embeddedNewlineRowCount += 1;
        row.push(`embedded line ${ordinal}\ncontinued measurement ${columnIndex}`);
      } else if (longTextEvery > 0 && ordinal % longTextEvery === 0 && columnIndex === 5) {
        row.push(`Long CSV stress cell ${ordinal}: ${'ABCDEFGHIJKLMNOPQRSTUVWXYZ '.repeat(18)}`);
      } else {
        row.push(`m${columnIndex - 3}-${ordinal}`);
      }
    }
    lines.push(row.map(csvCell).join(','));
  }
  const text = `${lines.join('\n')}\n`;
  return {
    text,
    expected: {
      recordCount,
      byteLength: byteLength(text),
      sourceLineCount: recordCount + 1 + embeddedNewlineRowCount,
      columnCount,
      embeddedNewlineRowCount,
    },
  };
}

export function createYamlTomlLossyStressFixtures(options: StructuredStressFixtureOptions = {}): {
  yaml: StructuredStressFixture;
  toml: StructuredStressFixture;
} {
  const recordCount = positiveInteger(options.recordCount, 90);
  const yamlLines = [
    '# Comments must remain source-only',
    'defaults: &defaults',
    '  status: ok',
    '  note: |',
    '    Block scalar style should not become editable.',
    'records:',
  ];
  const tomlLines = [
    '# Comments must remain source-only',
    'schema.version = 1',
  ];

  for (let index = 0; index < recordCount; index += 1) {
    yamlLines.push(
      `  - <<: *defaults`,
      `    id: sample-${index + 1}`,
      `    cohort: ${index % 5}`,
    );
    tomlLines.push(
      '',
      '[[records]]',
      `id = "sample-${index + 1}"`,
      `cohort = ${index % 5}`,
      'status = "ok"',
    );
  }

  const yamlText = `${yamlLines.join('\n')}\n`;
  const tomlText = `${tomlLines.join('\n')}\n`;
  return {
    yaml: {
      text: yamlText,
      expected: {
        recordCount,
        byteLength: byteLength(yamlText),
      },
    },
    toml: {
      text: tomlText,
      expected: {
        recordCount,
        byteLength: byteLength(tomlText),
      },
    },
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  return Math.floor(value);
}

function positiveIntegerOrZero(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value < 1) return 0;
  return Math.floor(value);
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) || /^\s|\s$/.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  return unescape(encodeURIComponent(value)).length;
}

function lineCount(value: string): number {
  if (!value) return 0;
  return value.split(/\r\n|\r|\n/).length;
}
