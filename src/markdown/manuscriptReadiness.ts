import type { ParsedScienfyDocument } from '@sciemd/core';
import type { VariableDefinition } from '@sciemd/core';
import type { DocumentInsights } from './documentIntelligence';
import { extractHeadings } from '@sciemd/core';
import type { MarkdownHeading } from '@sciemd/core';
import { resolveInstructionTargets } from '@sciemd/core';

export type ReadinessSeverity = 'pass' | 'warning' | 'error';

export interface ReadinessItem {
  id: string;
  label: string;
  detail: string;
  severity: ReadinessSeverity;
}

export interface ManuscriptReadiness {
  score: number;
  status: 'ready' | 'needs-review' | 'blocked';
  summary: string;
  items: ReadinessItem[];
  counts: {
    headings: number;
    citations: number;
    labels: number;
    figures: number;
    tables: number;
    missingImages: number;
    unresolvedCitations: number;
    unresolvedReferences: number;
    missingVariables: number;
  };
}

interface ReadinessSectionRequirement {
  id: string;
  label: string;
  patterns: RegExp[];
  aliases?: string[];
}

const REQUIRED_MANUSCRIPT_SECTIONS: ReadinessSectionRequirement[] = [
  { id: 'abstract', label: 'Abstract', patterns: [/^abstract$/i, /^summary$/i] },
  { id: 'introduction', label: 'Introduction', patterns: [/^introduction$/i, /^background$/i] },
  { id: 'methods', label: 'Methods', patterns: [/methods?/i, /experimental/i] },
  { id: 'results', label: 'Results', patterns: [/results?/i, /findings?/i] },
  { id: 'discussion', label: 'Discussion or conclusion', patterns: [/discussion/i, /conclusions?/i] },
];

const SUBMISSION_STATEMENT_SECTIONS: ReadinessSectionRequirement[] = [
  { id: 'data-availability', label: 'Data availability', patterns: [/data availability/i, /availability of data/i] },
  { id: 'code-availability', label: 'Code availability', patterns: [/code availability/i, /software availability/i] },
  { id: 'competing-interests', label: 'Competing interests', patterns: [/competing interests?/i, /conflicts? of interest/i] },
  { id: 'author-contributions', label: 'Author contributions', patterns: [/author contributions?/i, /contributions/i] },
];

export function assessManuscriptReadiness(
  markdown: string,
  parsed: ParsedScienfyDocument,
  insights: DocumentInsights,
  missingImageCount: number,
  providedHeadings?: MarkdownHeading[],
): ManuscriptReadiness {
  const headings = providedHeadings ?? extractHeadings(markdown);
  const headingText = headings.map((heading) => heading.text);
  const sectionConfig = readinessSectionConfig(parsed);
  const figureCount = countFigures(parsed, insights);
  const tableCount = insights.tableCount;
  const missingRequiredSections = sectionConfig.required.filter((section) => !hasSectionHeading(headingText, section));
  const missingStatements = sectionConfig.statements.filter((section) => !hasSectionHeading(headingText, section));
  const unresolvedCitations = parsed.citations.missingKeys.length;
  const unresolvedReferences = parsed.references.missingLabels.length;
  const missingVariables = parsed.variables.missingVariables.length;
  const duplicateLabels = parsed.references.duplicateLabels.length;
  const unlabeledFigures = parsed.directives.filter((directive) => directive.name === 'figure' && !directive.label).length;
  const unreferencedFigureLabels = parsed.references.labels
    .filter((label) => label.id.startsWith('fig-'))
    .filter((label) => !parsed.references.usages.some((usage) => usage.id === label.id))
    .length;

  const items: ReadinessItem[] = [
    {
      id: 'title',
      label: 'Title',
      detail: parsed.title || insights.firstHeading ? 'Title detected.' : 'Add a title in front matter or as the first heading.',
      severity: parsed.title || insights.firstHeading ? 'pass' : 'error',
    },
    {
      id: 'required-sections',
      label: 'Core manuscript sections',
      detail: missingRequiredSections.length === 0
        ? `${sectionConfig.required.map((section) => section.label).join(', ')} are present.`
        : `Missing or not clearly titled: ${missingRequiredSections.map((section) => section.label).join(', ')}.`,
      severity: missingRequiredSections.length === 0 ? 'pass' : missingRequiredSections.length > 2 ? 'error' : 'warning',
    },
    {
      id: 'submission-statements',
      label: 'Submission statements',
      detail: missingStatements.length === 0
        ? `${sectionConfig.statements.map((section) => section.label).join(', ')} sections are present.`
        : `Consider adding: ${missingStatements.map((section) => section.label).join(', ')}.`,
      severity: missingStatements.length === 0 ? 'pass' : 'warning',
    },
    {
      id: 'bibliography',
      label: 'Bibliography and citations',
      detail: parsed.citations.usages.length === 0
        ? 'No citations detected.'
        : parsed.bibliographyFiles.length === 0
          ? 'Citations exist, but no bibliography file is declared in front matter.'
          : unresolvedCitations > 0
            ? `${unresolvedCitations} citation key(s) are missing from the loaded bibliography.`
            : `${parsed.citations.usages.length} citation use(s) checked against bibliography metadata.`,
      severity: parsed.citations.usages.length > 0 && (parsed.bibliographyFiles.length === 0 || unresolvedCitations > 0) ? 'warning' : 'pass',
    },
    {
      id: 'references',
      label: 'Cross-references',
      detail: duplicateLabels > 0
        ? `${duplicateLabels} duplicate label(s) found.`
        : unresolvedReferences > 0
          ? `${unresolvedReferences} cross-reference(s) point to missing labels.`
          : `${parsed.references.labels.length} label(s), ${parsed.references.usages.length} reference use(s).`,
      severity: duplicateLabels > 0 ? 'error' : unresolvedReferences > 0 ? 'warning' : 'pass',
    },
    {
      id: 'variables',
      label: 'Dynamic variables',
      detail: missingVariables > 0
        ? `${missingVariables} variable placeholder(s) are unresolved and would export literally, such as {{ ${parsed.variables.missingVariables[0]} }}.`
        : parsed.variables.usages.length > 0
          ? `${parsed.variables.usages.length} variable placeholder(s) resolve from front matter or linked data files.`
          : 'No dynamic variables detected.',
      severity: missingVariables > 0 ? 'error' : 'pass',
    },
    {
      id: 'figures',
      label: 'Figures and images',
      detail: missingImageCount > 0
        ? `${missingImageCount} image file(s) are missing.`
        : unlabeledFigures > 0
          ? `${unlabeledFigures} figure block(s) should get a label such as {#fig-1}.`
          : unreferencedFigureLabels > 0
            ? `${unreferencedFigureLabels} figure label(s) are never referenced in text.`
            : `${figureCount} figure/image item(s) are ready for review.`,
      severity: missingImageCount > 0 ? 'error' : unlabeledFigures > 0 || unreferencedFigureLabels > 0 ? 'warning' : 'pass',
    },
  ];

  const errorCount = items.filter((item) => item.severity === 'error').length;
  const warningCount = items.filter((item) => item.severity === 'warning').length;
  const score = Math.max(0, Math.round(100 - errorCount * 18 - warningCount * 7));
  const status = errorCount > 0 ? 'blocked' : warningCount > 0 ? 'needs-review' : 'ready';

  return {
    score,
    status,
    summary: status === 'ready'
      ? 'Submission structure looks ready for final human review.'
      : status === 'blocked'
        ? 'Resolve blocking structure or integrity issues before submission.'
        : 'Close the warnings before journal submission.',
    items,
    counts: {
      headings: headings.length,
      citations: parsed.citations.usages.length,
      labels: parsed.references.labels.length,
      figures: figureCount,
      tables: tableCount,
      missingImages: missingImageCount,
      unresolvedCitations,
      unresolvedReferences,
      missingVariables,
    },
  };
}

export function createSubmissionReadinessReport(
  documentName: string,
  readiness: ManuscriptReadiness,
): string {
  return [
    '# Scienfy Submission Readiness Report',
    '',
    `Document: ${documentName}`,
    `Readiness score: ${readiness.score}/100`,
    `Status: ${readiness.status}`,
    '',
    '## Summary',
    '',
    readiness.summary,
    '',
    '## Checklist',
    '',
    ...readiness.items.map((item) => `- [${item.severity === 'pass' ? 'x' : ' '}] **${item.label}** (${item.severity}) - ${item.detail}`),
    '',
    '## Counts',
    '',
    `- Headings: ${readiness.counts.headings}`,
    `- Citations: ${readiness.counts.citations}`,
    `- Labels: ${readiness.counts.labels}`,
    `- Figures/images: ${readiness.counts.figures}`,
    `- Tables: ${readiness.counts.tables}`,
    `- Missing images: ${readiness.counts.missingImages}`,
    `- Unresolved citations: ${readiness.counts.unresolvedCitations}`,
    `- Unresolved cross-references: ${readiness.counts.unresolvedReferences}`,
    `- Unresolved variables: ${readiness.counts.missingVariables}`,
    '',
    '## Submission Notes',
    '',
    '- Confirm the target journal author instructions before upload.',
    '- Confirm that data availability, code availability, competing interests, author contributions, acknowledgements, and funding statements match your coauthor and journal requirements.',
    '- Confirm that figures are legible, permission-cleared, and exported at the journal-required resolution and format.',
    '- Confirm that every LLM-assisted edit has been reviewed by a human author.',
    '',
  ].join('\n');
}

export function createSectionRevisionPacket(
  markdown: string,
  documentName: string,
  currentLine: number,
  readiness: ManuscriptReadiness,
  variableDefinitions: VariableDefinition[] = [],
): string {
  const headings = extractHeadings(markdown);
  const lines = markdown.split(/\r?\n/);
  const instructionTarget = resolveInstructionTargets(markdown).find((target) => (
    currentLine >= target.instruction.line && currentLine <= Math.max(target.endLine, target.instruction.line + 2)
  ));
  const activeIndex = headings.findIndex((heading, index) => {
    const next = headings[index + 1];
    return heading.line <= currentLine && (!next || next.line > currentLine);
  });
  const activeHeading = activeIndex >= 0 ? headings[activeIndex] : null;
  const startLine = activeHeading?.line ?? 1;
  const endLine = activeHeading && headings[activeIndex + 1] ? headings[activeIndex + 1].line - 1 : lines.length;
  const sectionMarkdown = instructionTarget?.markdown || lines.slice(startLine - 1, endLine).join('\n').trim() || markdown.trim();
  const variableSummary = uniqueVariableDefinitions(variableDefinitions).map((definition) => (
    `${definition.name} = ${definition.value}${definition.file ? ` (${definition.file})` : ` (${definition.source})`}`
  ));

  return [
    instructionTarget ? '# Scienfy Targeted Revision Packet' : '# Scienfy Section Revision Packet',
    '',
    instructionTarget
      ? 'You are revising one targeted block of a scientific manuscript. Work like a careful scientific editor, not a ghostwriter.'
      : 'You are revising one section of a scientific manuscript. Work like a careful scientific editor, not a ghostwriter.',
    '',
    '## Non-negotiable Rules',
    '- Preserve Markdown syntax, citations, labels, cross-references, math, image paths, and directive blocks.',
    '- Preserve dynamic variables such as `{{reactor_temp}}` exactly. Do not replace them with evaluated values.',
    '- Do not invent results, citations, measurements, claims, or mechanisms.',
    '- If a claim needs evidence, mark it with `[needs citation]` rather than fabricating a citation.',
    '- Improve clarity, logical flow, scientific precision, and submission readiness.',
    instructionTarget
      ? '- Return revised Markdown for the targeted block only.'
      : '- Return revised Markdown for this section only.',
    '',
    '## Document Context',
    `Document: ${documentName}`,
    `Active section: ${activeHeading ? activeHeading.text : 'Untitled opening section'}`,
    instructionTarget ? `Targeted instruction: ${instructionTarget.instruction.prompt}` : '',
    instructionTarget ? `Target lines: ${instructionTarget.startLine}-${instructionTarget.endLine}` : '',
    `Dynamic variables: ${variableSummary.length === 0 ? 'none' : variableSummary.join(' | ')}`,
    `Readiness score: ${readiness.score}/100 (${readiness.status})`,
    `Current blockers/warnings: ${readiness.items.filter((item) => item.severity !== 'pass').map((item) => item.label).join(', ') || 'none'}`,
    '',
    '## Revision Focus',
    instructionTarget ? `- Follow this targeted instruction: ${instructionTarget.instruction.prompt}` : '',
    '- Tighten the scientific claim chain: observation -> interpretation -> implication.',
    '- Improve transitions between paragraphs.',
    '- Keep terminology consistent.',
    '- Preserve figure/table/citation references exactly.',
    '',
    instructionTarget ? '## Target Markdown' : '## Section Markdown',
    '---',
    sectionMarkdown,
  ].join('\n');
}

function uniqueVariableDefinitions(definitions: VariableDefinition[]): VariableDefinition[] {
  const byName = new Map<string, VariableDefinition>();
  for (const definition of definitions) byName.set(definition.name, definition);
  return Array.from(byName.values());
}

function hasSectionHeading(headings: string[], section: ReadinessSectionRequirement): boolean {
  return headings.some((heading) => {
    const trimmed = heading.trim();
    if (section.patterns.some((pattern) => pattern.test(trimmed))) return true;
    const normalized = normalizeHeadingForMatch(trimmed);
    return (section.aliases ?? []).some((alias) => normalizeHeadingForMatch(alias) === normalized);
  });
}

function countFigures(parsed: ParsedScienfyDocument, insights: DocumentInsights): number {
  const figureBlocks = parsed.directives.filter((directive) => directive.name === 'figure').length;
  return Math.max(figureBlocks, insights.imageReferences.length);
}

function readinessSectionConfig(parsed: ParsedScienfyDocument): {
  required: ReadinessSectionRequirement[];
  statements: ReadinessSectionRequirement[];
} {
  const readiness = objectField(objectField(parsed.frontmatter.data, 'scienfy'), 'readiness')
    ?? objectField(parsed.frontmatter.data, 'readiness');
  if (!readiness) {
    return { required: REQUIRED_MANUSCRIPT_SECTIONS, statements: SUBMISSION_STATEMENT_SECTIONS };
  }
  return {
    required: configuredSections(
      readiness.requiredSections ?? readiness.coreSections,
      readiness.requiredSectionAliases,
      REQUIRED_MANUSCRIPT_SECTIONS,
    ),
    statements: configuredSections(
      readiness.submissionStatements ?? readiness.statementSections,
      readiness.submissionStatementAliases ?? readiness.statementSectionAliases,
      SUBMISSION_STATEMENT_SECTIONS,
    ),
  };
}

function configuredSections(
  sectionsValue: unknown,
  aliasValue: unknown,
  defaults: ReadinessSectionRequirement[],
): ReadinessSectionRequirement[] {
  const explicit = parseExplicitSections(sectionsValue);
  const base = explicit.length > 0 ? explicit : defaults.map((section) => ({ ...section }));
  return applySectionAliases(base, aliasValue);
}

function parseExplicitSections(value: unknown): ReadinessSectionRequirement[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index): ReadinessSectionRequirement | null => {
      if (typeof item === 'string' && item.trim()) {
        const label = item.trim();
        return { id: slugify(label) || `section-${index + 1}`, label, patterns: [], aliases: [label] };
      }
      if (!isRecord(item)) return null;
      const label = stringField(item, 'label') ?? stringField(item, 'title') ?? stringField(item, 'id');
      if (!label) return null;
      const id = stringField(item, 'id') ?? (slugify(label) || `section-${index + 1}`);
      const aliases = [
        label,
        ...stringArrayField(item, 'aliases'),
        ...stringArrayField(item, 'headings'),
      ];
      return { id, label, patterns: [], aliases };
    })
    .filter((section): section is ReadinessSectionRequirement => Boolean(section));
}

function applySectionAliases(
  sections: ReadinessSectionRequirement[],
  aliasValue: unknown,
): ReadinessSectionRequirement[] {
  if (!isRecord(aliasValue)) return sections;
  return sections.map((section) => {
    const aliases = stringArrayField(aliasValue, section.id);
    return aliases.length > 0
      ? { ...section, aliases: [...(section.aliases ?? []), ...aliases] }
      : section;
  });
}

function objectField(source: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(source)) return null;
  const value = source[key];
  return isRecord(value) ? value : null;
}

function stringField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringArrayField(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeHeadingForMatch(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function slugify(value: string): string {
  return normalizeHeadingForMatch(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
