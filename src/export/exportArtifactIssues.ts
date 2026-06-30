export type ExportArtifactIssueCode = 'missing-image' | 'remote-image-kept';
export type ExportArtifactIssueSeverity = 'warning';

export interface ExportArtifactIssue {
  severity: ExportArtifactIssueSeverity;
  code: ExportArtifactIssueCode;
  message: string;
  source?: string;
}

export const EXPORT_ISSUE_ATTRIBUTE = 'data-scie-md-export-issue';
export const EXPORT_ISSUE_SOURCE_ATTRIBUTE = 'data-scie-md-export-source';
export const EXPORT_ISSUE_MESSAGE_ATTRIBUTE = 'data-scie-md-export-message';

export function createExportArtifactIssue(code: ExportArtifactIssueCode, source?: string): ExportArtifactIssue {
  switch (code) {
    case 'missing-image':
      return {
        severity: 'warning',
        code,
        source,
        message: source
          ? `Local image "${source}" could not be embedded and was exported as a missing-image placeholder.`
          : 'A local image could not be embedded and was exported as a missing-image placeholder.',
      };
    case 'remote-image-kept':
      return {
        severity: 'warning',
        code,
        source,
        message: source
          ? `Remote image "${source}" could not be embedded; the export keeps its URL and may need network access.`
          : 'A remote image could not be embedded; the export keeps its URL and may need network access.',
      };
  }
}

export function exportIssueAttributes(issue: ExportArtifactIssue): string {
  const attributes = [
    `${EXPORT_ISSUE_ATTRIBUTE}="${escapeHtmlAttribute(issue.code)}"`,
    issue.source ? `${EXPORT_ISSUE_SOURCE_ATTRIBUTE}="${escapeHtmlAttribute(issue.source)}"` : null,
    `${EXPORT_ISSUE_MESSAGE_ATTRIBUTE}="${escapeHtmlAttribute(issue.message)}"`,
  ];
  return attributes.filter(Boolean).join(' ');
}

export function extractExportArtifactIssues(html: string): ExportArtifactIssue[] {
  const issues: ExportArtifactIssue[] = [];
  issues.push(...extractHtmlAttributeIssues(html));
  issues.push(...extractEncodedMissingImageIssues(html));
  return dedupeIssues(issues);
}

export function summarizeExportArtifactIssues(issues: ExportArtifactIssue[]): string[] {
  const missingImages = issues.filter((issue) => issue.code === 'missing-image');
  const remoteImages = issues.filter((issue) => issue.code === 'remote-image-kept');
  return [
    missingImages.length > 0
      ? `${missingImages.length} image${missingImages.length === 1 ? '' : 's'} could not be embedded and were exported as missing-image placeholders.`
      : null,
    remoteImages.length > 0
      ? `${remoteImages.length} remote image${remoteImages.length === 1 ? '' : 's'} could not be embedded; the export keeps their URLs and may need network access.`
      : null,
  ].filter((message): message is string => Boolean(message));
}

function extractHtmlAttributeIssues(html: string): ExportArtifactIssue[] {
  const issues: ExportArtifactIssue[] = [];
  const elementPattern = /<[^>]*\bdata-scie-md-export-issue=(["'])(.*?)\1[^>]*>/gi;
  for (const match of html.matchAll(elementPattern)) {
    const element = match[0];
    const code = normalizeIssueCode(unescapeHtmlAttribute(match[2]));
    if (!code) continue;
    const source = attributeValue(element, EXPORT_ISSUE_SOURCE_ATTRIBUTE);
    const message = attributeValue(element, EXPORT_ISSUE_MESSAGE_ATTRIBUTE);
    issues.push({
      ...createExportArtifactIssue(code, source),
      ...(message ? { message } : {}),
    });
  }
  return issues;
}

function extractEncodedMissingImageIssues(html: string): ExportArtifactIssue[] {
  const issues: ExportArtifactIssue[] = [];
  const marker = encodeURIComponent(`${EXPORT_ISSUE_ATTRIBUTE}="missing-image"`);
  for (const _match of html.matchAll(new RegExp(marker, 'g'))) {
    issues.push(createExportArtifactIssue('missing-image'));
  }
  return issues;
}

function normalizeIssueCode(value: string): ExportArtifactIssueCode | null {
  if (value === 'missing-image' || value === 'remote-image-kept') return value;
  return null;
}

function attributeValue(element: string, attribute: string): string | undefined {
  const pattern = new RegExp(`\\b${attribute}=(["'])(.*?)\\1`, 'i');
  const value = element.match(pattern)?.[2];
  return value ? unescapeHtmlAttribute(value) : undefined;
}

function dedupeIssues(issues: ExportArtifactIssue[]): ExportArtifactIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const signature = `${issue.code}:${issue.source ?? ''}:${issue.message}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function unescapeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
