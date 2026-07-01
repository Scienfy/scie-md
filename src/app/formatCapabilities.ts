import {
  formatRuntimePolicyFor,
  sourceEditorCapabilitiesFor,
  type DocumentFormat,
  type SourceEditorCapabilities,
} from '@sciemd/core';

export type SourceEditorLanguage = DocumentFormat;

export interface FormatUiCapabilities {
  canUseMarkdownToolbar: boolean;
  canUseVisualMarkdown: boolean;
  canUseReadonlyTree: boolean;
  canUseStructuredVisualMode: boolean;
  canEditJsonVisualTree: boolean;
  canUseRecordList: boolean;
  canUseTablePreview: boolean;
  canUseManuscriptReadiness: boolean;
  canUseCitations: boolean;
  canUseVariablesPanel: boolean;
  canUseMarkdownExports: boolean;
  canUseImageInsertion: boolean;
  canUseLLMMarkdownMarkers: boolean;
  sourceLanguage: SourceEditorLanguage;
  sourceEditor: SourceEditorCapabilities;
}

export const MARKDOWN_UI_CAPABILITIES: FormatUiCapabilities = {
  canUseMarkdownToolbar: true,
  canUseVisualMarkdown: true,
  canUseReadonlyTree: false,
  canUseStructuredVisualMode: false,
  canEditJsonVisualTree: false,
  canUseRecordList: false,
  canUseTablePreview: false,
  canUseManuscriptReadiness: true,
  canUseCitations: true,
  canUseVariablesPanel: true,
  canUseMarkdownExports: true,
  canUseImageInsertion: true,
  canUseLLMMarkdownMarkers: true,
  sourceLanguage: 'markdown',
  sourceEditor: sourceEditorCapabilitiesFor('markdown'),
};

export function formatCapabilitiesFor(format: DocumentFormat): FormatUiCapabilities {
  if (format === 'markdown') return MARKDOWN_UI_CAPABILITIES;
  const policy = formatRuntimePolicyFor(format);
  return policy.canOpenAsDocument || policy.canPreview
    ? uiCapabilitiesFromCore(format)
    : sourceOnlyCapabilities(format);
}

function sourceOnlyCapabilities(sourceLanguage: SourceEditorLanguage): FormatUiCapabilities {
  return {
    canUseMarkdownToolbar: false,
    canUseVisualMarkdown: false,
    canUseReadonlyTree: false,
    canUseStructuredVisualMode: false,
    canEditJsonVisualTree: false,
    canUseRecordList: false,
    canUseTablePreview: false,
    canUseManuscriptReadiness: false,
    canUseCitations: false,
    canUseVariablesPanel: false,
    canUseMarkdownExports: false,
    canUseImageInsertion: false,
    canUseLLMMarkdownMarkers: false,
    sourceLanguage,
    sourceEditor: sourceEditorCapabilitiesFor(sourceLanguage),
  };
}

function uiCapabilitiesFromCore(format: DocumentFormat): FormatUiCapabilities {
  const policy = formatRuntimePolicyFor(format);
  return {
    ...sourceOnlyCapabilities(format),
    canUseReadonlyTree: policy.canUseVisualTree,
    canUseStructuredVisualMode: policy.canUseVisualTree,
    canEditJsonVisualTree: policy.canEditVisually && format === 'json',
    canUseRecordList: policy.canUseRecordList,
    canUseTablePreview: policy.canUseTablePreview,
  };
}
