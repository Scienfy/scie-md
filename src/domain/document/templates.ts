export type ScienfyTemplateId = 'paper' | 'research-statement' | 'lab-note';

export function createScienfyTemplate(id: ScienfyTemplateId): string {
  if (id === 'research-statement') return researchStatementTemplate();
  if (id === 'lab-note') return labNoteTemplate();
  return paperTemplate();
}

function paperTemplate(): string {
  const today = localDateString();
  return [
    '---',
    'title: "Scientific Paper Draft"',
    'authors:',
    '  - name: "Author Name"',
    `date: ${today}`,
    'bibliography: references.bib',
    'keywords:',
    '  - keyword',
    'scienfy:',
    '  schema: 2',
    '  documentType: paper',
    '  visualStyle: scientific-draft',
    '  llm:',
    '    preserveCitations: true',
    '    preserveCrossReferences: true',
    '---',
    '',
    '# Scientific Paper Draft',
    '',
    '## Abstract {#sec-abstract}',
    '',
    'Write a concise summary of the scientific question, method, result, and implication.',
    '',
    '## Introduction {#sec-introduction}',
    '',
    'Frame the scientific problem and cite relevant work [@example2026].',
    '',
    '## Methods {#sec-methods}',
    '',
    ':::note',
    'Describe the experimental or computational method.',
    ':::',
    '',
    '## Results {#sec-results}',
    '',
    ':::figure {#fig-main}',
    '![Main result](assets/main-result.png)',
    '',
    'Caption explaining the main result.',
    ':::',
    '',
    'Refer to @fig-main when interpreting the result.',
    '',
    '## Discussion {#sec-discussion}',
    '',
    'Explain the meaning, limitations, and next experiments.',
    '',
    '## References {#sec-references}',
    '',
    ':::references',
    ':::',
    '',
  ].join('\n');
}

function researchStatementTemplate(): string {
  return [
    '---',
    'title: "Research Statement"',
    'scienfy:',
    '  schema: 2',
    '  documentType: paper',
    '  visualStyle: scienfy',
    '---',
    '',
    '# Research Statement',
    '',
    '## Research Vision {#sec-vision}',
    '',
    'State the long-term scientific vision.',
    '',
    '## Research Program 1 {#sec-program-1}',
    '',
    'Describe the first research direction, its novelty, and expected impact.',
    '',
    '## Research Program 2 {#sec-program-2}',
    '',
    'Describe the second research direction.',
    '',
    '## Broader Impact {#sec-impact}',
    '',
    'Explain why the program matters scientifically and practically.',
    '',
  ].join('\n');
}

function labNoteTemplate(): string {
  const today = localDateString();
  return [
    '---',
    'title: "Lab Note"',
    `date: ${today}`,
    'scienfy:',
    '  schema: 2',
    '  documentType: lab-note',
    '  visualStyle: lab-notebook',
    '---',
    '',
    '# Lab Note',
    '',
    '## Objective',
    '',
    'What is the goal of this session?',
    '',
    '## Setup',
    '',
    '* Sample:',
    '',
    '* Instrument:',
    '',
    '* Conditions:',
    '',
    '## Observations',
    '',
    'Record observations and attach images as needed.',
    '',
    '## Next Steps',
    '',
    '* [ ] Follow-up task',
    '',
  ].join('\n');
}

function localDateString(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}
