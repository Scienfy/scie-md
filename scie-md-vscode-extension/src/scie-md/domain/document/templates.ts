import type { DocumentFormat } from '@sciemd/core';
import type { EditorMode } from '../../app/documentState';

export type ScienfyTemplateId =
  | 'blank-markdown'
  | 'paper'
  | 'research-statement'
  | 'lab-note'
  | 'json'
  | 'jsonl'
  | 'yaml'
  | 'toml'
  | 'xml'
  | 'csv'
  | 'tsv'
  | 'plain-text';

export interface ScieMdTemplateDefinition {
  id: ScienfyTemplateId;
  label: string;
  detail: string;
  preview: string;
  format: DocumentFormat;
  group: 'writing' | 'structured' | 'plain';
}

export const SCIEMD_TEMPLATES: readonly ScieMdTemplateDefinition[] = [
  {
    id: 'blank-markdown',
    label: 'Markdown',
    detail: 'Small prose starter with visual editing enabled.',
    preview: 'Best for notes, drafts, and source-readable writing.',
    format: 'markdown',
    group: 'writing',
  },
  {
    id: 'json',
    label: 'JSON',
    detail: 'Valid object starter with a class-like item shape.',
    preview: 'Best for nested configuration, API payloads, and schema-backed data.',
    format: 'json',
    group: 'structured',
  },
  {
    id: 'jsonl',
    label: 'JSON Lines',
    detail: 'Two valid record lines with the same fields.',
    preview: 'Best for logs, exported samples, and line-oriented LLM/context packets.',
    format: 'jsonl',
    group: 'structured',
  },
  {
    id: 'yaml',
    label: 'YAML',
    detail: 'Readable nested starter with one list item.',
    preview: 'Best for human-maintained metadata that should stay source-first.',
    format: 'yaml',
    group: 'structured',
  },
  {
    id: 'toml',
    label: 'TOML',
    detail: 'Table-based starter with one array-of-tables item.',
    preview: 'Best for settings, reproducible runs, and typed configuration.',
    format: 'toml',
    group: 'structured',
  },
  {
    id: 'xml',
    label: 'XML',
    detail: 'Safe root element starter with no DTD.',
    preview: 'Best for metadata interchange and legacy scientific tool outputs.',
    format: 'xml',
    group: 'structured',
  },
  {
    id: 'csv',
    label: 'CSV',
    detail: 'Comma-delimited table with a header and one row.',
    preview: 'Best for spreadsheet-friendly tabular measurements.',
    format: 'csv',
    group: 'structured',
  },
  {
    id: 'tsv',
    label: 'TSV',
    detail: 'Tab-delimited table with a header and one row.',
    preview: 'Best for copy/paste from analysis tools where commas are common in values.',
    format: 'tsv',
    group: 'structured',
  },
  {
    id: 'plain-text',
    label: 'Plain text',
    detail: 'Small source-only plain-text starter.',
    preview: 'Best for scratch text, logs, and unsupported plain-text formats.',
    format: 'plainText',
    group: 'plain',
  },
];

export function createScienfyTemplate(id: ScienfyTemplateId): string {
  if (id === 'research-statement') return researchStatementTemplate();
  if (id === 'lab-note') return labNoteTemplate();
  if (id === 'blank-markdown') return markdownTemplate();
  if (id === 'json') return jsonTemplate();
  if (id === 'jsonl') return jsonlTemplate();
  if (id === 'yaml') return yamlTemplate();
  if (id === 'toml') return tomlTemplate();
  if (id === 'xml') return xmlTemplate();
  if (id === 'csv') return csvTemplate();
  if (id === 'tsv') return tsvTemplate();
  if (id === 'plain-text') return plainTextTemplate();
  return paperTemplate();
}

export function templateDefinitionFor(id: ScienfyTemplateId): ScieMdTemplateDefinition {
  return SCIEMD_TEMPLATES.find((template) => template.id === id) ?? SCIEMD_TEMPLATES[0];
}

export function templateFormat(id: ScienfyTemplateId): DocumentFormat {
  if (id === 'paper' || id === 'research-statement' || id === 'lab-note') return 'markdown';
  return templateDefinitionFor(id).format;
}

export function preferredTemplateMode(id: ScienfyTemplateId): EditorMode {
  return templateFormat(id) === 'plainText' ? 'source' : 'visual';
}

function markdownTemplate(): string {
  return [
    '# Header',
    '',
    'Main text',
    '',
  ].join('\n');
}

function plainTextTemplate(): string {
  return [
    'Header',
    '',
    'Main text',
    '',
  ].join('\n');
}

function jsonTemplate(): string {
  return [
    '{',
    '  "document": {',
    '    "title": "Header",',
    '    "text": "Main text"',
    '  },',
    '  "classes": [',
    '    {',
    '      "name": "ExampleItem",',
    '      "fields": [',
    '        { "name": "id", "type": "string" },',
    '        { "name": "value", "type": "number" }',
    '      ]',
    '    }',
    '  ],',
    '  "items": [',
    '    {',
    '      "id": "item-001",',
    '      "class": "ExampleItem",',
    '      "value": null',
    '    }',
    '  ]',
    '}',
    '',
  ].join('\n');
}

function jsonlTemplate(): string {
  return [
    '{"id":"item-001","name":"Main item","status":"draft"}',
    '{"id":"item-002","name":"Second item","status":"draft"}',
    '',
  ].join('\n');
}

function yamlTemplate(): string {
  return [
    'document:',
    '  title: Header',
    '  text: Main text',
    'items:',
    '  - id: item-001',
    '    name: Main item',
    '    value:',
    '',
  ].join('\n');
}

function tomlTemplate(): string {
  return [
    '[document]',
    'title = "Header"',
    'text = "Main text"',
    '',
    '[[items]]',
    'id = "item-001"',
    'name = "Main item"',
    '',
  ].join('\n');
}

function xmlTemplate(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<document>',
    '  <title>Header</title>',
    '  <text>Main text</text>',
    '  <items>',
    '    <item id="item-001" name="Main item" />',
    '  </items>',
    '</document>',
    '',
  ].join('\n');
}

function csvTemplate(): string {
  return [
    'id,name,value',
    'item-001,Main item,',
    '',
  ].join('\n');
}

function tsvTemplate(): string {
  return [
    'id\tname\tvalue',
    'item-001\tMain item\t',
    '',
  ].join('\n');
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
    '  visualStyle: science',
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
    '  visualStyle: science',
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
