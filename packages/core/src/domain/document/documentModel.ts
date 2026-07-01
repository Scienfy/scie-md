import { parseDirectiveBlocks } from '../blocks/directiveParser';
import type { DirectiveBlock } from '../blocks/directiveParser';
import { buildCitationIndex } from '../citations/citationIndex';
import type { CitationIndex } from '../citations/citationIndex';
import { buildCrossReferenceIndex } from '../references/crossReferenceIndex';
import type { CrossReferenceIndex } from '../references/crossReferenceIndex';
import { buildVariableIndex } from '../variables/variableIndex';
import type { VariableDefinition, VariableIndex } from '../variables/variableIndex';
import { duplicateVariantGroupIds, duplicateVariantItemIds, parseVariantGroups, validateVariantStructure } from '../../markdown/variants';
import type { VariantGroup } from '../../markdown/variants';
import { getScienfyMetadata, getStringArrayField, getStringField, parseFrontmatter } from './frontmatter';
import type { FrontmatterParseResult } from './frontmatter';

export type DocumentDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface DocumentDiagnostic {
  severity: DocumentDiagnosticSeverity;
  code: string;
  message: string;
  line?: number;
}

export interface ParsedScienfyDocument {
  frontmatter: FrontmatterParseResult;
  title: string | null;
  documentType: string | null;
  visualStyle: string | null;
  bibliographyFiles: string[];
  variableFiles: string[];
  directives: DirectiveBlock[];
  citations: CitationIndex;
  references: CrossReferenceIndex;
  variables: VariableIndex;
  variantGroups: VariantGroup[];
  diagnostics: DocumentDiagnostic[];
}

export interface ParseScienfyDocumentOptions {
  bibtex?: string;
  variableDefinitions?: VariableDefinition[];
  extraDiagnostics?: DocumentDiagnostic[];
}

export const DOCUMENT_PARSE_CRASH_CODE = 'document-parse-crash';

export function parseScienfyDocument(markdown: string, options: ParseScienfyDocumentOptions = {}): ParsedScienfyDocument {
  const frontmatter = parseFrontmatter(markdown);
  const scienfy = getScienfyMetadata(frontmatter.data);
  const body = frontmatter.hasFrontmatter ? frontmatter.body : markdown;
  const bibliographyFiles = getStringArrayField(frontmatter.data, 'bibliography');
  const variableFiles = Array.from(new Set([
    ...getStringArrayField(frontmatter.data, 'variablesFile'),
    ...getStringArrayField(scienfy, 'variablesFile'),
  ]));
  const directives = parseDirectiveBlocks(body);
  const citations = buildCitationIndex(body, bibliographyFiles, options.bibtex ?? '', frontmatter.hasFrontmatter ? frontmatter.endLine : 0);
  const references = buildCrossReferenceIndex(body, frontmatter.hasFrontmatter ? frontmatter.endLine : 0);
  const variables = buildVariableIndex(markdown, frontmatter, options.variableDefinitions ?? []);
  const variantGroups = parseVariantGroups(markdown);
  const variantStructureIssues = validateVariantStructure(markdown);
  const diagnostics = [
    ...buildDiagnostics(frontmatter, directives, citations, references, variables, variantGroups, variantStructureIssues),
    ...(options.extraDiagnostics ?? []),
  ];

  return {
    frontmatter,
    title: getStringField(frontmatter.data, 'title'),
    documentType: getStringField(scienfy, 'documentType'),
    visualStyle: getStringField(scienfy, 'visualStyle'),
    bibliographyFiles,
    variableFiles,
    directives,
    citations,
    references,
    variables,
    variantGroups,
    diagnostics,
  };
}

export function safeParseScienfyDocument(
  markdown: string,
  options: ParseScienfyDocumentOptions = {},
): ParsedScienfyDocument {
  try {
    return parseScienfyDocument(markdown, options);
  } catch (error) {
    console.error('ScieMD document parser failed; using raw Markdown fallback.', error);
    return createFallbackScienfyDocument(markdown, options, error);
  }
}

export function createFallbackScienfyDocument(
  markdown: string,
  options: ParseScienfyDocumentOptions = {},
  error?: unknown,
): ParsedScienfyDocument {
  const frontmatter = safeParseFrontmatter(markdown);
  const scienfy = getScienfyMetadata(frontmatter.data);
  const bibliographyFiles = getStringArrayField(frontmatter.data, 'bibliography');
  const variableFiles = Array.from(new Set([
    ...getStringArrayField(frontmatter.data, 'variablesFile'),
    ...getStringArrayField(scienfy, 'variablesFile'),
  ]));
  const parseMessage = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'Unknown parser error.';

  return {
    frontmatter,
    title: getStringField(frontmatter.data, 'title'),
    documentType: getStringField(scienfy, 'documentType'),
    visualStyle: getStringField(scienfy, 'visualStyle'),
    bibliographyFiles,
    variableFiles,
    directives: [],
    citations: {
      usages: [],
      bibliographyFiles,
      bibtexKeys: [],
      bibtexEntries: [],
      missingKeys: [],
    },
    references: {
      labels: [],
      usages: [],
      duplicateLabels: [],
      missingLabels: [],
    },
    variables: {
      definitions: options.variableDefinitions ?? [],
      usages: [],
      missingVariables: [],
    },
    variantGroups: [],
    diagnostics: [
      ...(frontmatter.error
        ? [{
          severity: 'error' as const,
          code: 'frontmatter-yaml',
          message: frontmatter.error,
          line: frontmatter.startLine || 1,
        }]
        : []),
      {
        severity: 'error',
        code: DOCUMENT_PARSE_CRASH_CODE,
        message: `ScieMD could not parse this document safely. Raw Markdown remains editable in visual mode. Parser error: ${parseMessage}`,
        line: 1,
      },
      ...(options.extraDiagnostics ?? []),
    ],
  };
}

function safeParseFrontmatter(markdown: string): FrontmatterParseResult {
  try {
    return parseFrontmatter(markdown);
  } catch (error) {
    return {
      hasFrontmatter: false,
      raw: '',
      body: markdown,
      data: {},
      error: error instanceof Error ? error.message : 'Front matter could not be parsed.',
      startLine: 1,
      endLine: 1,
      openingFence: '',
      closingFence: '',
      lineEnding: '\n',
      sourcePrefix: '',
      bodyStartOffset: 0,
    };
  }
}

function buildDiagnostics(
  frontmatter: FrontmatterParseResult,
  directives: DirectiveBlock[],
  citations: CitationIndex,
  references: CrossReferenceIndex,
  variables: VariableIndex,
  variantGroups: VariantGroup[],
  variantStructureIssues: DocumentDiagnostic[],
): DocumentDiagnostic[] {
  const diagnostics: DocumentDiagnostic[] = [];

  if (frontmatter.error) {
    diagnostics.push({
      severity: 'error',
      code: 'frontmatter-yaml',
      message: frontmatter.error,
      line: frontmatter.startLine || 1,
    });
  }

  diagnostics.push(...buildFrontmatterSchemaDiagnostics(frontmatter));

  for (const directive of directives) {
    if (directive.endLine === null) {
      diagnostics.push({
        severity: 'error',
        code: 'directive-unclosed',
        message: `${directive.name} block is missing a closing ::: fence.`,
        line: directive.line,
      });
    } else if (!directive.known) {
      diagnostics.push({
        severity: 'warning',
        code: 'directive-unknown',
        message: `${directive.name} block is preserved as source because Scienfy does not know this directive yet.`,
        line: directive.line,
      });
    }
  }

  if (citations.usages.length > 0 && citations.bibliographyFiles.length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'citation-no-bibliography',
      message: 'Citations were found, but front matter does not specify a bibliography file.',
      line: citations.usages[0]?.line,
    });
  }

  for (const key of citations.missingKeys) {
    diagnostics.push({
      severity: 'warning',
      code: 'citation-missing',
      message: `Citation @${key} is not present in the loaded bibliography index.`,
      line: citations.usages.find((usage) => usage.key === key)?.line,
    });
  }

  for (const id of references.duplicateLabels) {
    diagnostics.push({
      severity: 'error',
      code: 'reference-duplicate-label',
      message: `Reference label ${id} is defined more than once.`,
    });
  }

  for (const id of references.missingLabels) {
    diagnostics.push({
      severity: 'warning',
      code: 'reference-missing-label',
      message: `Reference @${id} has no matching label.`,
    });
  }

  for (const name of variables.missingVariables) {
    diagnostics.push({
      severity: 'warning',
      code: 'variable-missing',
      message: `Variable {{ ${name} }} is used but not defined in front matter variables or linked variable files.`,
      line: variables.usages.find((usage) => usage.name === name)?.line,
    });
  }

  for (const id of duplicateVariantGroupIds(variantGroups)) {
    diagnostics.push({
      severity: 'error',
      code: 'variant-duplicate-group',
      message: `Variant group id "${id}" is used more than once. Use unique ids so export and LLM output are unambiguous.`,
      line: variantGroups.find((group) => group.id === id)?.line,
    });
  }

  for (const group of variantGroups) {
    const activeExists = group.items.some((item) => item.id === group.active);
    if (!activeExists) {
      diagnostics.push({
        severity: 'warning',
        code: 'variant-active-missing',
        message: `Variant group "${group.id}" points to active item "${group.active}", but that item does not exist. The first variant will be used for output.`,
        line: group.line,
      });
    }
    for (const id of duplicateVariantItemIds(group)) {
      diagnostics.push({
        severity: 'error',
        code: 'variant-duplicate-item',
        message: `Variant group "${group.id}" contains duplicate item id "${id}".`,
        line: group.items.find((item) => item.id === id)?.line ?? group.line,
      });
    }
  }

  diagnostics.push(...variantStructureIssues);

  return diagnostics;
}

function buildFrontmatterSchemaDiagnostics(frontmatter: FrontmatterParseResult): DocumentDiagnostic[] {
  if (!frontmatter.hasFrontmatter || frontmatter.error) return [];

  const diagnostics: DocumentDiagnostic[] = [];
  const data = frontmatter.data;
  const scienfy = getScienfyMetadata(data);

  if ('title' in data && typeof data.title !== 'string') {
    diagnostics.push({
      severity: 'warning',
      code: 'frontmatter-title-type',
      message: 'Front matter title should be a string.',
      line: frontmatter.startLine,
    });
  }

  if ('bibliography' in data && !isStringOrStringArray(data.bibliography)) {
    diagnostics.push({
      severity: 'warning',
      code: 'frontmatter-bibliography-type',
      message: 'Front matter bibliography should be a string or a list of strings.',
      line: frontmatter.startLine,
    });
  }

  if ('variablesFile' in data && !isStringOrStringArray(data.variablesFile)) {
    diagnostics.push({
      severity: 'warning',
      code: 'frontmatter-variables-file-type',
      message: 'Front matter variablesFile should be a string or a list of strings.',
      line: frontmatter.startLine,
    });
  }

  if ('scienfy' in data && !isScienfyMetadataObject(data.scienfy)) {
    diagnostics.push({
      severity: 'error',
      code: 'frontmatter-scienfy-invalid',
      message: 'Front matter scienfy block must be a YAML object.',
      line: frontmatter.startLine,
    });
  }

  if ('documentType' in scienfy && typeof scienfy.documentType !== 'string') {
    diagnostics.push({
      severity: 'warning',
      code: 'scienfy-document-type',
      message: 'scienfy.documentType should be a string.',
      line: frontmatter.startLine,
    });
  }

  if ('visualStyle' in scienfy && typeof scienfy.visualStyle !== 'string') {
    diagnostics.push({
      severity: 'warning',
      code: 'scienfy-visual-style',
      message: 'scienfy.visualStyle should be a string.',
      line: frontmatter.startLine,
    });
  }

  if ('variablesFile' in scienfy && !isStringOrStringArray(scienfy.variablesFile)) {
    diagnostics.push({
      severity: 'warning',
      code: 'scienfy-variables-file-type',
      message: 'scienfy.variablesFile should be a string or a list of strings.',
      line: frontmatter.startLine,
    });
  }

  return diagnostics;
}

function isStringOrStringArray(value: unknown): boolean {
  if (typeof value === 'string') return true;
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isScienfyMetadataObject(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
