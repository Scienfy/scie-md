export interface LargeDocumentStressFixtureOptions {
  sectionCount?: number;
  includeMermaidEvery?: number;
  includeSvgEvery?: number;
  includeNoteEvery?: number;
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

function positiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  return Math.floor(value);
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  return unescape(encodeURIComponent(value)).length;
}

function lineCount(value: string): number {
  if (!value) return 0;
  return value.split(/\r\n|\r|\n/).length;
}
