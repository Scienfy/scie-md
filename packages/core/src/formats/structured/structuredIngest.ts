import type { DocumentFormat, FormatDiagnostic } from '../documentFormat';
import {
  formatDefinitionFor,
  formatFromMediaType,
  formatFromPath,
} from '../formatDefinitions';
import {
  canonicalizeStructuredIngressText,
  formatRuntimePolicyFor,
} from '../formatPolicy';
import {
  createDelimitedTextConversionPreview,
  type DelimitedTextConversionPreview,
  type DelimitedTextConversionResult,
} from '../tabular/parseDelimitedText';

export type StructuredIngestOrigin = 'file' | 'clipboard' | 'drop' | 'url' | 'webClipper' | 'vscode' | 'unknown';
export type StructuredIngestTrust = 'trusted' | 'userConfirmed' | 'transient' | 'untrusted';
export type StructuredIngestConfidence = 'high' | 'medium' | 'low' | 'none';
export type StructuredIngestSignalSource = 'path' | 'url' | 'mime' | 'content' | 'fallback';

export interface StructuredIngestSource {
  text?: string | null;
  path?: string | null;
  url?: string | null;
  mimeType?: string | null;
  origin?: StructuredIngestOrigin;
  originLabel?: string | null;
  trust?: StructuredIngestTrust;
}

export interface StructuredIngestProvenance {
  origin: StructuredIngestOrigin;
  trust: StructuredIngestTrust;
  originLabel: string;
  path: string | null;
  url: string | null;
  mimeType: string | null;
}

export interface StructuredIngestSignal {
  source: StructuredIngestSignalSource;
  format: DocumentFormat;
  confidence: StructuredIngestConfidence;
  detail: string;
}

export interface StructuredIngestConversionOption {
  id: string;
  label: string;
  outputFormat: DocumentFormat;
  content: string;
  diagnostics: FormatDiagnostic[];
}

export interface StructuredIngestCapabilityPolicy {
  canOpenAsDocument: boolean;
  canPreview: boolean;
  canConvertFromDelimited: boolean;
  canUseVisualTree: boolean;
  canEditVisually: boolean;
  requiresUserConfirmation: boolean;
  safeForAutomaticFileCreation: boolean;
  sourceOnly: boolean;
}

export interface StructuredIngestResult {
  format: DocumentFormat;
  confidence: StructuredIngestConfidence;
  signals: StructuredIngestSignal[];
  diagnostics: FormatDiagnostic[];
  conversionOptions: StructuredIngestConversionOption[];
  tabularPreview: DelimitedTextConversionPreview | null;
  capabilityPolicy: StructuredIngestCapabilityPolicy;
  provenance: StructuredIngestProvenance;
}

interface Candidate {
  source: StructuredIngestSignalSource;
  format: DocumentFormat;
  confidence: StructuredIngestConfidence;
  detail: string;
  score: number;
}

export function inferStructuredDocument(source: StructuredIngestSource): StructuredIngestResult {
  const text = normalizeText(source.text);
  const provenance = normalizeProvenance(source);
  const tabularPreview = createDelimitedTextConversionPreview(text);
  const candidates = [
    candidateFromPath(provenance.path, 'path', 90),
    candidateFromMediaType(provenance.mimeType),
    candidateFromPath(provenance.url, 'url', 70),
    candidateFromContent(text, tabularPreview),
  ].filter((candidate): candidate is Candidate => Boolean(candidate));

  const selected = selectCandidate(candidates);
  const signals = candidates.map(candidateToSignal);
  const diagnostics = [
    ...createSignalDiagnostics(candidates, selected),
    ...createContentDiagnostics(selected.format, text),
    ...(tabularPreview?.parsed.diagnostics ?? []),
  ];
  const conversionOptions = tabularPreview ? tabularConversionOptions(tabularPreview) : [];

  return {
    format: selected.format,
    confidence: selected.confidence,
    signals: signals.length > 0 ? signals : [candidateToSignal(selected)],
    diagnostics,
    conversionOptions,
    tabularPreview,
    capabilityPolicy: capabilityPolicyFor(selected.format, selected.confidence, provenance, tabularPreview),
    provenance,
  };
}

function candidateFromPath(
  path: string | null,
  source: Extract<StructuredIngestSignalSource, 'path' | 'url'>,
  score: number,
): Candidate | null {
  const format = formatFromPath(path);
  if (!format) return null;
  return {
    source,
    format,
    confidence: format === 'plainText' ? 'medium' : 'high',
    detail: `${source === 'path' ? 'Path' : 'URL'} extension maps to ${labelForFormat(format)}.`,
    score: format === 'plainText' ? Math.min(score, 35) : score,
  };
}

function candidateFromMediaType(mediaType: string | null): Candidate | null {
  const format = formatFromMediaType(mediaType);
  if (!format) return null;
  return {
    source: 'mime',
    format,
    confidence: format === 'plainText' ? 'medium' : 'high',
    detail: `MIME type maps to ${labelForFormat(format)}.`,
    score: format === 'plainText' ? 32 : 85,
  };
}

function candidateFromContent(text: string, tabularPreview: DelimitedTextConversionPreview | null): Candidate | null {
  const trimmed = stripBom(text).trim();
  if (!trimmed) return null;

  if (isMarkdownLike(trimmed)) {
    return contentCandidate('markdown', 'medium', 'Content uses Markdown markers such as headings, fences, or front matter.', 58);
  }

  const nonEmptyLines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const jsonLikeLines = nonEmptyLines.filter(looksJsonLike);
  if (nonEmptyLines.length > 1 && jsonLikeLines.length === nonEmptyLines.length) {
    const everyLineParses = nonEmptyLines.every(isJsonParsable);
    return contentCandidate(
      'jsonl',
      everyLineParses ? 'high' : 'medium',
      everyLineParses
        ? 'Every non-empty line parses as an independent JSON value.'
        : 'Every non-empty line starts like an independent JSON value.',
      82,
    );
  }

  if (trimmed.startsWith('{') || (trimmed.startsWith('[') && isJsonParsable(trimmed))) {
    return contentCandidate('json', isJsonParsable(trimmed) ? 'high' : 'medium', 'Content starts like JSON.', 80);
  }

  if (looksXmlLike(trimmed)) {
    return contentCandidate(
      'xml',
      trimmed.startsWith('<?xml') ? 'high' : 'medium',
      'Content starts like an XML document or fragment.',
      62,
    );
  }

  if (looksTomlLike(trimmed)) {
    return contentCandidate('toml', 'medium', 'Content contains TOML-style sections or key/value assignments.', 55);
  }

  if (looksYamlLike(trimmed)) {
    return contentCandidate('yaml', 'medium', 'Content contains YAML-style mappings or document markers.', 54);
  }

  if (tabularPreview) {
    const format = tabularPreview.parsed.delimiter === '\t' ? 'tsv' : 'csv';
    return contentCandidate(format, 'medium', `Content looks like ${tabularPreview.parsed.delimiterLabel} delimited rows.`, 53);
  }

  return null;
}

function contentCandidate(
  format: DocumentFormat,
  confidence: StructuredIngestConfidence,
  detail: string,
  score: number,
): Candidate {
  return { source: 'content', format, confidence, detail, score };
}

function selectCandidate(candidates: Candidate[]): Candidate {
  const selected = candidates
    .slice()
    .sort((left, right) => right.score - left.score)[0];
  return selected ?? {
    source: 'fallback',
    format: 'plainText',
    confidence: 'none',
    detail: 'No path, MIME type, URL, or safe content signal identified a richer document format.',
    score: 0,
  };
}

function createSignalDiagnostics(candidates: Candidate[], selected: Candidate): FormatDiagnostic[] {
  const meaningful = candidates.filter((candidate) => candidate.format !== 'plainText');
  const conflicting = meaningful.filter((candidate) => candidate.format !== selected.format);
  if (conflicting.length === 0) return [];
  return [{
    severity: 'warning',
    code: 'ingest-conflicting-format-signals',
    category: 'conversion',
    source: selected.format,
    message: `Ingest selected ${labelForFormat(selected.format)} from ${selected.source}, but also saw ${formatSignalList(conflicting)}.`,
  }];
}

function createContentDiagnostics(format: DocumentFormat, text: string): FormatDiagnostic[] {
  if (!text.trim()) return [];
  if (format === 'json') return validateJsonText(text);
  if (format === 'jsonl') return validateJsonLines(text);
  if (format === 'xml') return validateXmlText(text);
  return [];
}

function validateJsonText(text: string): FormatDiagnostic[] {
  try {
    JSON.parse(stripBom(text));
    return [];
  } catch (error) {
    return [{
      severity: 'error',
      code: 'ingest-json-parse-error',
      category: 'parser',
      source: 'json',
      message: error instanceof Error ? error.message : 'JSON text could not be parsed.',
    }];
  }
}

function validateJsonLines(text: string): FormatDiagnostic[] {
  const diagnostics: FormatDiagnostic[] = [];
  stripBom(text).split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      JSON.parse(line);
    } catch (error) {
      diagnostics.push({
        severity: 'error',
        code: 'ingest-jsonl-parse-error',
        category: 'parser',
        source: 'jsonl',
        line: index + 1,
        message: error instanceof Error
          ? `Line ${index + 1}: ${error.message}`
          : `Line ${index + 1}: JSON Lines record could not be parsed.`,
      });
    }
  });
  return diagnostics;
}

function validateXmlText(text: string): FormatDiagnostic[] {
  const stripped = stripBom(text);
  const doctypeOffset = stripped.search(/<!DOCTYPE\b/i);
  if (doctypeOffset < 0) return [];
  return [{
    severity: 'error',
    code: 'ingest-xml-doctype-disabled',
    category: 'parser',
    source: 'xml',
    offset: doctypeOffset,
    message: 'XML DTD and DOCTYPE declarations are disabled for safety. ScieMD will keep this file in source-only review until the DTD is removed.',
    blocking: true,
  }];
}

function tabularConversionOptions(preview: DelimitedTextConversionPreview): StructuredIngestConversionOption[] {
  return [
    conversionOption('markdown-table', preview.markdown),
    conversionOption('json-array', preview.json),
    conversionOption('json-lines', preview.jsonl),
    conversionOption('yaml-list', preview.yaml),
    conversionOption('toml-array-of-tables', preview.toml),
  ];
}

function conversionOption(id: string, result: DelimitedTextConversionResult): StructuredIngestConversionOption {
  return {
    id,
    label: result.label,
    outputFormat: result.format,
    content: result.content,
    diagnostics: result.diagnostics,
  };
}

function capabilityPolicyFor(
  format: DocumentFormat,
  confidence: StructuredIngestConfidence,
  provenance: StructuredIngestProvenance,
  tabularPreview: DelimitedTextConversionPreview | null,
): StructuredIngestCapabilityPolicy {
  const policy = formatRuntimePolicyFor(format);
  const requiresUserConfirmation = provenance.origin === 'clipboard'
    || provenance.origin === 'drop'
    || provenance.origin === 'webClipper'
    || provenance.trust !== 'trusted';

  return {
    canOpenAsDocument: policy.canOpenAsDocument && confidence !== 'none',
    canPreview: policy.canPreview,
    canConvertFromDelimited: Boolean(tabularPreview),
    canUseVisualTree: policy.canUseVisualTree,
    canEditVisually: policy.canEditVisually,
    requiresUserConfirmation,
    safeForAutomaticFileCreation: false,
    sourceOnly: policy.sourceOnlyByDefault,
  };
}

function normalizeProvenance(source: StructuredIngestSource): StructuredIngestProvenance {
  const path = cleanOptionalString(source.path);
  const url = cleanOptionalString(source.url);
  const mimeType = cleanOptionalString(source.mimeType);
  const origin = source.origin ?? (path ? 'file' : url ? 'url' : 'unknown');
  return {
    origin,
    trust: source.trust ?? defaultTrustForOrigin(origin),
    originLabel: cleanOptionalString(source.originLabel) ?? defaultOriginLabel(origin),
    path,
    url,
    mimeType,
  };
}

function defaultTrustForOrigin(origin: StructuredIngestOrigin): StructuredIngestTrust {
  if (origin === 'file' || origin === 'vscode') return 'trusted';
  if (origin === 'drop') return 'userConfirmed';
  if (origin === 'clipboard') return 'transient';
  return 'untrusted';
}

function defaultOriginLabel(origin: StructuredIngestOrigin): string {
  if (origin === 'file') return 'Local file';
  if (origin === 'clipboard') return 'Clipboard';
  if (origin === 'drop') return 'Dropped file';
  if (origin === 'url') return 'URL';
  if (origin === 'webClipper') return 'Browser capture';
  if (origin === 'vscode') return 'VS Code document';
  return 'Unknown source';
}

function candidateToSignal(candidate: Candidate): StructuredIngestSignal {
  return {
    source: candidate.source,
    format: candidate.format,
    confidence: candidate.confidence,
    detail: candidate.detail,
  };
}

function formatSignalList(candidates: Candidate[]): string {
  return candidates
    .map((candidate) => `${labelForFormat(candidate.format)} from ${candidate.source}`)
    .join(', ');
}

function labelForFormat(format: DocumentFormat): string {
  return formatDefinitionFor(format)?.label ?? format;
}

function normalizeText(text: string | null | undefined): string {
  return canonicalizeStructuredIngressText(text ?? '').text;
}

function cleanOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isJsonParsable(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function looksJsonLike(text: string): boolean {
  return text.startsWith('{') || text.startsWith('[');
}

function isMarkdownLike(text: string): boolean {
  return /^#\s+/m.test(text)
    || /^```/m.test(text)
    || /^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n[#\w]/.test(text);
}

function looksYamlLike(text: string): boolean {
  if (/^---\s*$/m.test(text) && /:\s*(?:$|[\w"'[{])/m.test(text)) return true;
  const mappingLines = text.split(/\r?\n/).filter((line) => /^\s*[\w.-][\w .-]*:\s*(?:$|[\w"'[{>-])/.test(line));
  return mappingLines.length >= 2 || (mappingLines.length === 1 && /\n\s+[\w.-][\w .-]*:\s*/.test(text));
}

function looksTomlLike(text: string): boolean {
  if (/^\s*\[[\w.-]+]\s*$/m.test(text)) return true;
  const assignmentLines = text.split(/\r?\n/).filter((line) => /^\s*[\w.-]+\s*=\s*(?:"[^"]*"|'[^']*'|\d|true\b|false\b|\[)/.test(line));
  return assignmentLines.length >= 2;
}

function looksXmlLike(text: string): boolean {
  if (/^<\?xml(?:\s|\?>)/i.test(text)) return true;
  if (/^<!DOCTYPE\b/i.test(text)) return true;
  const rootMatch = text.match(/^<([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)(?:\s[^>]*)?>/);
  if (!rootMatch) return false;
  const rootName = rootMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`</${rootName}>\\s*$`).test(text) || /\/>\s*$/.test(text);
}
