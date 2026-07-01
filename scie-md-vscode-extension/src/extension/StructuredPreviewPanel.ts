import * as vscode from 'vscode';
import type { DocumentFormat } from '@sciemd/core/formats/documentFormat';
import { formatByteLengthUtf8, formatBytes, formatParseBudgetBytes } from '@sciemd/core/formats/formatPolicy';
import type { ScieMDDocumentSnapshot, WebviewToExtensionMessage } from '../shared/webviewProtocol';
import { validateWebviewToExtensionMessage } from '../shared/webviewProtocol';
import {
  documentFormatForUri,
  isStructuredPreviewFormat,
  structuredPreviewFormatList,
} from './documentFormat';
import { documentParentUri, getWebviewHtml } from './webviewHtml';

export const VSCODE_STRUCTURED_PREVIEW_SOURCE_EXCERPT_BYTES = 1 * 1024 * 1024;

export class StructuredPreviewPanel {
  static readonly viewType = 'scieMd.structuredPreview';

  private readonly panelId = `structured-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  private readonly subscriptions: vscode.Disposable[] = [];

  private constructor(
    private readonly document: vscode.TextDocument,
    private readonly format: DocumentFormat,
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly output: vscode.OutputChannel,
  ) {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: webviewLocalResourceRoots(document.uri, extensionUri),
    };
    panel.webview.html = getWebviewHtml(panel.webview, extensionUri, document.uri);
    this.registerListeners();
    this.postDocumentUpdate('initial');
  }

  static async open(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    uri?: vscode.Uri,
  ): Promise<void> {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) {
      vscode.window.showWarningMessage(`Open a ${structuredPreviewFormatList()} file first.`);
      return;
    }

    const document = vscode.window.activeTextEditor?.document.uri.toString() === target.toString()
      ? vscode.window.activeTextEditor.document
      : await vscode.workspace.openTextDocument(target);
    const format = documentFormatForUri(document.uri, document.fileName);
    if (!isStructuredPreviewFormat(format)) {
      vscode.window.showWarningMessage(`ScieMD structured preview supports ${structuredPreviewFormatList()} files.`);
      return;
    }

    const title = `ScieMD ${formatLabel(format)} Preview: ${document.fileName.split(/[\\/]/).pop() || 'Untitled'}`;
    const panel = vscode.window.createWebviewPanel(
      StructuredPreviewPanel.viewType,
      title,
      vscode.ViewColumn.Beside,
      { enableScripts: true },
    );
    new StructuredPreviewPanel(document, format, panel, context.extensionUri, output);
  }

  private registerListeners(): void {
    this.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== this.document.uri.toString()) return;
      this.postDocumentUpdate('changed');
    }));
    this.subscriptions.push(vscode.workspace.onDidSaveTextDocument((savedDocument) => {
      if (savedDocument.uri.toString() !== this.document.uri.toString()) return;
      this.postDocumentUpdate('saved');
    }));
    this.subscriptions.push(this.panel.webview.onDidReceiveMessage((message: unknown) => {
      this.log(`structured webview message: ${webviewMessageTypeLabel(message)}`);
      void this.handleMessage(message);
    }));
    this.panel.onDidDispose(() => {
      for (const subscription of this.subscriptions) subscription.dispose();
    });
  }

  private async handleMessage(rawMessage: unknown): Promise<void> {
    const validation = validateWebviewToExtensionMessage(rawMessage);
    if (!validation.ok) {
      this.postOperationResult({
        id: validation.invalid.id,
        editChainId: validation.invalid.editChainId,
        ok: false,
        result: 'failed',
        message: `ScieMD ignored a malformed webview message: ${validation.invalid.reason}`,
      });
      return;
    }

    const message: WebviewToExtensionMessage = validation.message;
    switch (message.type) {
      case 'ready':
        this.postDocumentUpdate('initial');
        return;
      case 'copyText':
        await vscode.env.clipboard.writeText(message.text);
        vscode.window.showInformationMessage(`Copied ${message.label ?? 'text'}.`);
        return;
      case 'showMessage':
        showMessage(message.severity, message.message);
        return;
      default:
        this.postOperationResult({
          id: 'editId' in message ? message.editId : undefined,
          editChainId: 'editChainId' in message ? message.editChainId : undefined,
          ok: false,
          result: 'readonly',
          message: 'ScieMD structured preview is read-only in VS Code.',
        });
    }
  }

  private postDocumentUpdate(reason: 'initial' | 'changed' | 'saved'): void {
    const textForWebview = structuredPreviewTextForWebview(
      this.format,
      stripLeadingBom(this.document.getText()),
    );
    const readonlyReason = textForWebview.truncated
      ? `ScieMD ${formatLabel(this.format)} preview is read-only in VS Code. The file is ${formatBytes(textForWebview.totalBytes)}, above the ${formatBytes(textForWebview.limitBytes)} preview message budget, so ScieMD shows a source excerpt only. Edit the file in the normal VS Code text editor.`
      : `ScieMD ${formatLabel(this.format)} preview is read-only in VS Code. Edit the file in the normal VS Code text editor.`;
    const snapshot: ScieMDDocumentSnapshot = {
      uri: this.document.uri.toString(),
      fileName: this.document.fileName.split(/[\\/]/).pop() || 'Untitled',
      format: this.format,
      text: textForWebview.text,
      version: this.document.version,
      isDirty: this.document.isDirty,
      isReadonly: true,
      readonlyReason,
      sourceTextTruncated: textForWebview.truncated,
      sourceTotalBytes: textForWebview.totalBytes,
      sourceLimitBytes: textForWebview.limitBytes,
    };
    void Promise.resolve(this.panel.webview.postMessage({
      type: 'documentUpdate',
      panelId: this.panelId,
      reason,
      snapshot,
      sourceEditId: null,
    }));
  }

  private postOperationResult(result: {
    id?: string;
    editChainId?: string;
    ok: boolean;
    result: 'applied' | 'noop' | 'skipped' | 'failed' | 'readonly' | 'saved' | 'command';
    message: string;
  }): void {
    void Promise.resolve(this.panel.webview.postMessage({
      type: 'operationResult',
      panelId: this.panelId,
      ...result,
    }));
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}

export async function openStructuredPreview(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  uri?: vscode.Uri,
): Promise<void> {
  await StructuredPreviewPanel.open(context, output, uri);
}

function webviewLocalResourceRoots(documentUri: vscode.Uri, extensionUri: vscode.Uri): vscode.Uri[] {
  const roots = [
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
  ];
  const parent = documentParentUri(documentUri);
  if (parent) roots.push(parent);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
  if (workspaceFolder) roots.push(workspaceFolder.uri);
  return uniqueUris(roots);
}

function uniqueUris(uris: vscode.Uri[]): vscode.Uri[] {
  const seen = new Set<string>();
  return uris.filter((uri) => {
    const key = uri.toString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatLabel(format: DocumentFormat): string {
  if (format === 'jsonl') return 'JSON Lines';
  return format.toUpperCase();
}

export function structuredPreviewTextForWebview(
  format: DocumentFormat,
  text: string,
): {
  text: string;
  truncated: boolean;
  totalBytes: number;
  limitBytes: number;
} {
  const parseBudget = formatParseBudgetBytes(format);
  const limitBytes = parseBudget === null
    ? VSCODE_STRUCTURED_PREVIEW_SOURCE_EXCERPT_BYTES
    : Math.min(parseBudget, VSCODE_STRUCTURED_PREVIEW_SOURCE_EXCERPT_BYTES);
  const totalBytes = formatByteLengthUtf8(text);
  if (totalBytes <= limitBytes) {
    return {
      text,
      truncated: false,
      totalBytes,
      limitBytes,
    };
  }

  return {
    text: truncateUtf8(text, limitBytes),
    truncated: true,
    totalBytes,
    limitBytes,
  };
}

function truncateUtf8(text: string, limitBytes: number): string {
  if (limitBytes <= 0) return '';
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    const nextBytes = formatByteLengthUtf8(character);
    if (bytes + nextBytes > limitBytes) break;
    bytes += nextBytes;
    end += character.length;
  }
  return text.slice(0, end);
}

function showMessage(severity: 'info' | 'warning' | 'error', message: string): void {
  if (severity === 'error') {
    vscode.window.showErrorMessage(message);
  } else if (severity === 'warning') {
    vscode.window.showWarningMessage(message);
  } else {
    vscode.window.showInformationMessage(message);
  }
}

function webviewMessageTypeLabel(message: unknown): string {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return '<malformed>';
  const type = (message as { type?: unknown }).type;
  return typeof type === 'string' && type.trim() !== '' ? type : '<malformed>';
}

function stripLeadingBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
