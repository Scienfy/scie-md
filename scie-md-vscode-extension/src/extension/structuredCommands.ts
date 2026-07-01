import * as vscode from 'vscode';
import type { DocumentFormat, FormatDiagnostic } from '@sciemd/core/formats/documentFormat';
import { JSON_PARSE_BUDGET_BYTES } from '@sciemd/core/formats/json/jsonAdapter';
import { createJsonContent, parseJsonDocument } from '@sciemd/core/formats/json/parseJsonDocument';
import { JSONL_PARSE_BUDGET_BYTES } from '@sciemd/core/formats/jsonl/jsonlAdapter';
import { createJsonlContent, parseJsonlDocument } from '@sciemd/core/formats/jsonl/parseJsonlDocument';
import {
  createStructuredClipboardReplaceReviewPlan,
  resolveStructuredEditReviewApply,
  type StructuredClipboardReplaceFormat,
} from '@sciemd/core/formats/structured/structuredEditReview';
import { structuredPreviewDocumentOperations } from '@sciemd/core/formats/structured/structuredOperations';
import { documentFormatForUri, structuredPreviewFormatList } from './documentFormat';

const JSON_ACTIONS_SETTING_SECTION = 'scieMd.structured';
const JSON_ACTIONS_SETTING_KEY = 'enableJsonActions';

type StructuredJsonActionFormat = StructuredClipboardReplaceFormat;

export async function applyStructuredClipboardToJsonDocument(
  output: vscode.OutputChannel,
  uri?: vscode.Uri,
): Promise<void> {
  if (!structuredJsonActionsEnabled()) {
    vscode.window.showWarningMessage('Enable scieMd.structured.enableJsonActions before applying structured clipboard text to JSON or JSONL documents.');
    return;
  }

  const document = await targetTextDocument(uri);
  if (!document) {
    vscode.window.showWarningMessage(`Open a JSON or JSON Lines document first. Structured preview supports ${structuredPreviewFormatList()} files.`);
    return;
  }

  const format = documentFormatForUri(document.uri, document.fileName);
  if (!isStructuredJsonActionFormat(format)) {
    const label = format === 'yaml' || format === 'toml' || format === 'xml'
      ? `${format.toUpperCase()} is preview-only in ScieMD for VS Code.`
      : 'This command only applies to JSON and JSON Lines documents.';
    vscode.window.showWarningMessage(label);
    return;
  }

  const baseText = stripLeadingBom(document.getText());
  if (exceedsParseBudget(format, baseText)) {
    vscode.window.showWarningMessage(`${formatLabel(format)} document is in source-only mode because it exceeds the ${formatBytes(parseBudgetBytesFor(format))} parse budget.`);
    return;
  }
  const baseEpoch = documentEpoch(document);
  const clipboardOperation = structuredPreviewDocumentOperations({
    canApplyClipboardReplace: true,
    disabledReason: `${formatLabel(format)} clipboard replacement is unavailable.`,
    requiresOptIn: true,
  })[0];
  if (!clipboardOperation?.enabled) {
    vscode.window.showWarningMessage(clipboardOperation?.disabledReason ?? `${formatLabel(format)} clipboard replacement is unavailable.`);
    return;
  }

  const clipboardText = stripLeadingBom(await vscode.env.clipboard.readText());
  if (clipboardText.trim().length === 0) {
    vscode.window.showWarningMessage('Clipboard does not contain structured text to apply.');
    return;
  }
  if (exceedsParseBudget(format, clipboardText)) {
    vscode.window.showWarningMessage(`Clipboard ${formatLabel(format)} exceeds the ${formatBytes(parseBudgetBytesFor(format))} parse budget. Use source editing for this large replacement.`);
    return;
  }

  const diagnostics = validateJsonClipboardText(format, clipboardText, document.uri.toString());
  const firstError = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (firstError) {
    vscode.window.showWarningMessage(`Clipboard ${formatLabel(format)} is invalid: ${firstError.message}`);
    return;
  }
  if (clipboardText === baseText) {
    vscode.window.showInformationMessage(`Clipboard already matches the current ${formatLabel(format)} document. No edit applied.`);
    return;
  }

  const review = createStructuredClipboardReplaceReviewPlan({
    format,
    source: baseText,
    replacement: clipboardText,
    documentEpoch: baseEpoch,
    diagnostics,
    notes: [`VS Code command: ${JSON_ACTIONS_SETTING_SECTION}.${JSON_ACTIONS_SETTING_KEY}`],
  });
  if (!review) {
    vscode.window.showInformationMessage(`Clipboard already matches the current ${formatLabel(format)} document. No edit applied.`);
    return;
  }

  const currentRawText = document.getText();
  const currentText = stripLeadingBom(currentRawText);
  const resolved = resolveStructuredEditReviewApply(currentText, documentEpoch(document), review);
  if (!resolved.ok) {
    vscode.window.showWarningMessage(resolved.reason);
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, fullDocumentRange(document, currentRawText), resolved.nextSource);
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    vscode.window.showWarningMessage('VS Code did not apply the structured clipboard edit. The document may be read-only or controlled by a non-writable file-system provider.');
    return;
  }

  output.appendLine(`[${new Date().toISOString()}] ${review.summary} ${review.riskLabel}; source preview starts at ${review.sourcePreview.range.line}:${review.sourcePreview.range.column} for ${document.uri.toString()}.`);
  vscode.window.showInformationMessage(`Applied reviewed ${formatLabel(format)} clipboard text. Review and save the document in VS Code.`);
}

function structuredJsonActionsEnabled(): boolean {
  return vscode.workspace
    .getConfiguration(JSON_ACTIONS_SETTING_SECTION)
    .get<boolean>(JSON_ACTIONS_SETTING_KEY, false);
}

async function targetTextDocument(uri?: vscode.Uri): Promise<vscode.TextDocument | null> {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!target) return null;
  const activeDocument = vscode.window.activeTextEditor?.document;
  if (activeDocument?.uri.toString() === target.toString()) return activeDocument;
  return vscode.workspace.openTextDocument(target);
}

function isStructuredJsonActionFormat(format: DocumentFormat): format is StructuredJsonActionFormat {
  return format === 'json' || format === 'jsonl';
}

function validateJsonClipboardText(
  format: StructuredJsonActionFormat,
  text: string,
  sourcePath: string,
): FormatDiagnostic[] {
  return format === 'json'
    ? parseJsonDocument(createJsonContent(text, sourcePath)).diagnostics
    : parseJsonlDocument(createJsonlContent(text, sourcePath)).diagnostics;
}

function fullDocumentRange(document: vscode.TextDocument, text: string): vscode.Range {
  return new vscode.Range(document.positionAt(0), document.positionAt(text.length));
}

function documentEpoch(document: vscode.TextDocument): number {
  return Number.isFinite(document.version) ? document.version : 0;
}

function formatLabel(format: StructuredJsonActionFormat): string {
  return format === 'json' ? 'JSON' : 'JSON Lines';
}

function parseBudgetBytesFor(format: StructuredJsonActionFormat): number {
  return format === 'json' ? JSON_PARSE_BUDGET_BYTES : JSONL_PARSE_BUDGET_BYTES;
}

function exceedsParseBudget(format: StructuredJsonActionFormat, text: string): boolean {
  return byteLengthUtf8(text) > parseBudgetBytesFor(format);
}

function byteLengthUtf8(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${Math.round(bytes / 1024 / 1024)} MiB`;
}

function stripLeadingBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
