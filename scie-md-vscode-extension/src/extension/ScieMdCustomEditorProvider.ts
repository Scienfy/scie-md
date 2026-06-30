import * as vscode from 'vscode';
import * as path from 'node:path';
import { createScieMDLlmSkill } from '@sciemd/core';
import type { WebviewToExtensionMessage } from '../shared/webviewProtocol';
import type { OperationResultKind } from '../shared/webviewProtocol';
import { validateWebviewToExtensionMessage } from '../shared/webviewProtocol';
import { createDocumentReplacementPlan } from './documentMerge';
import { documentParentUri, getWebviewHtml } from './webviewHtml';

export type ReplaceDocumentTextResult = 'applied' | 'noop' | 'skipped' | 'failed' | 'readonly';

export class ScieMDCustomEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'scieMd.visualMarkdown';

  private readonly panelsByDocument = new Map<string, Set<vscode.WebviewPanel>>();
  private readonly panelIdByPanel = new WeakMap<vscode.WebviewPanel, string>();
  private readonly pendingEditEchoByDocument = new Map<string, Array<{ id: string; text: string }>>();
  private readonly lastAppliedWebviewTextByDocument = new Map<string, string>();
  private readonly readonlyReasonByDocument = new Map<string, string>();
  private readonly lastWarningAtByDocument = new Map<string, number>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const documentKey = document.uri.toString();
    this.log(`resolveCustomTextEditor: ${documentKey}`);
    const panelId = this.trackPanel(documentKey, webviewPanel);

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: webviewLocalResourceRoots(this.context.extensionUri, document),
    };
    webviewPanel.webview.html = getWebviewHtml(webviewPanel.webview, this.context.extensionUri, document.uri);
    this.log(`webview HTML assigned for ${documentKey}`);

    const subscriptions: vscode.Disposable[] = [];
    subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== documentKey) return;
      const sourceEditId = this.consumePendingEditId(documentKey, event.document.getText());
      if (!sourceEditId) this.lastAppliedWebviewTextByDocument.delete(documentKey);
      this.postDocumentUpdate(event.document, 'changed', sourceEditId);
    }));

    subscriptions.push(vscode.workspace.onDidSaveTextDocument((savedDocument) => {
      if (savedDocument.uri.toString() === documentKey) {
        this.postDocumentUpdate(savedDocument, 'saved');
      }
    }));

    subscriptions.push(vscode.workspace.onDidDeleteFiles((event) => {
      if (!event.files.some((uri) => uri.toString() === documentKey)) return;
      this.markDocumentReadonly(document, 'This Markdown file was deleted on disk. The ScieMD panel is read-only to avoid recreating it accidentally.');
    }));

    subscriptions.push(vscode.workspace.onDidRenameFiles((event) => {
      if (!event.files.some((file) => file.oldUri.toString() === documentKey)) return;
      this.markDocumentReadonly(document, 'This Markdown file was renamed or moved on disk. Reopen the new path to continue editing in ScieMD.');
    }));

    const fileWatcher = this.createDocumentFileWatcher(document);
    if (fileWatcher) subscriptions.push(fileWatcher);

    subscriptions.push(webviewPanel.webview.onDidReceiveMessage((message: unknown) => {
      this.log(`webview message from ${documentKey} panel=${panelId}: ${webviewMessageTypeLabel(message)}`);
      void this.handleMessage(document, webviewPanel, message);
    }));

    webviewPanel.onDidDispose(() => {
      for (const subscription of subscriptions) subscription.dispose();
      this.untrackPanel(documentKey, webviewPanel);
    });

    if (!token.isCancellationRequested) {
      this.log(`posting initial snapshot from resolver for ${documentKey}`);
      this.postToPanel(webviewPanel, document, 'initial');
    }
  }

  private async handleMessage(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    rawMessage: unknown,
  ): Promise<void> {
    const validation = validateWebviewToExtensionMessage(rawMessage);
    if (!validation.ok) {
      this.log(`invalid webview message from ${document.uri.toString()}: ${validation.invalid.reason}`);
      this.postMalformedWebviewMessageResult(webviewPanel, validation.invalid);
      return;
    }

    const message: WebviewToExtensionMessage = validation.message;
    switch (message.type) {
      case 'ready':
        this.log(`webview ready: ${document.uri.toString()}`);
        this.postToPanel(webviewPanel, document, 'initial');
        return;
      case 'replaceDocument':
        if (!this.acceptsPanelMessage(webviewPanel, message)) return;
        this.postEditOperationResult(
          webviewPanel,
          message.editId,
          await this.replaceDocumentText(document, message.text, message.editId, message.baseText, message.baseVersion, message.rejectedHunkIds),
          message.editChainId,
        );
        return;
      case 'save':
        if (!this.acceptsPanelMessage(webviewPanel, message)) return;
        if (!(await this.ensureDocumentWritable(document))) {
          if (message.editId) this.postEditOperationResult(webviewPanel, message.editId, 'readonly', message.editChainId);
          return;
        }
        if (message.pendingText !== undefined && message.editId) {
          const result = await this.replaceDocumentText(document, message.pendingText, message.editId, message.baseText, message.baseVersion, message.rejectedHunkIds);
          this.postEditOperationResult(webviewPanel, message.editId, result, message.editChainId);
          if (!canSaveAfterPendingEdit(result)) return;
        }
        await document.save();
        return;
      case 'undo':
        if (!this.acceptsPanelMessage(webviewPanel, message)) return;
        if (!(await this.ensureDocumentWritable(document))) {
          if (message.editId) this.postEditOperationResult(webviewPanel, message.editId, 'readonly', message.editChainId);
          return;
        }
        if (message.pendingText !== undefined && message.editId) {
          const result = await this.replaceDocumentText(document, message.pendingText, message.editId, message.baseText, message.baseVersion, message.rejectedHunkIds);
          this.postEditOperationResult(webviewPanel, message.editId, result, message.editChainId);
          if (!canSaveAfterPendingEdit(result)) return;
        }
        await vscode.commands.executeCommand('undo');
        return;
      case 'redo':
        if (!this.acceptsPanelMessage(webviewPanel, message)) return;
        if (!(await this.ensureDocumentWritable(document))) {
          if (message.editId) this.postEditOperationResult(webviewPanel, message.editId, 'readonly', message.editChainId);
          return;
        }
        if (message.pendingText !== undefined && message.editId) {
          const result = await this.replaceDocumentText(document, message.pendingText, message.editId, message.baseText, message.baseVersion, message.rejectedHunkIds);
          this.postEditOperationResult(webviewPanel, message.editId, result, message.editChainId);
          if (!canSaveAfterPendingEdit(result)) return;
        }
        await vscode.commands.executeCommand('redo');
        return;
      case 'copyLlmSkill':
        await vscode.env.clipboard.writeText(createScieMDLlmSkill());
        vscode.window.showInformationMessage('Copied ScieMD LLM skill.');
        return;
      case 'generateLlmSkillFile':
        await generateSkillFileBesideDocument(document.uri);
        return;
      case 'copyText':
        await vscode.env.clipboard.writeText(message.text);
        vscode.window.showInformationMessage(`Copied ${message.label ?? 'text'}.`);
        return;
      case 'showMessage':
        showMessage(message.severity, message.message);
        return;
    }
  }

  private async replaceDocumentText(
    document: vscode.TextDocument,
    nextText: string,
    editId: string,
    baseText?: string,
    baseVersion?: number,
    rejectedHunkIds: string[] = [],
  ): Promise<ReplaceDocumentTextResult> {
    if (!(await this.ensureDocumentWritable(document))) return 'readonly';
    const documentKey = document.uri.toString();
    const planCurrentVersion = document.version;
    const currentText = document.getText();
    if (baseVersion !== undefined && baseVersion !== document.version && baseText === undefined) {
      this.showCoalescedWarning(documentKey, 'stale-skip', 'ScieMD skipped a stale webview edit because the document changed before the edit arrived.');
      this.postDocumentUpdate(document, 'changed');
      return 'skipped';
    }
    const plan = createDocumentReplacementPlan({
      currentText,
      currentVersion: planCurrentVersion,
      requestedText: nextText,
      baseText,
      baseVersion,
      lastAppliedWebviewText: this.lastAppliedWebviewTextByDocument.get(documentKey),
      rejectedHunkIds: new Set(rejectedHunkIds),
    });
    const { replacement } = plan;
    if (!replacement) return 'noop';
    if (document.version !== planCurrentVersion || document.getText() !== currentText) {
      this.showCoalescedWarning(documentKey, 'stale-retry', 'ScieMD skipped an edit because the VS Code document changed during merge planning. The webview was refreshed with the latest Markdown.');
      this.postDocumentUpdate(document, 'changed');
      return 'skipped';
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(document.positionAt(replacement.start), document.positionAt(replacement.end)),
      replacement.text,
    );
    this.enqueuePendingEditId(documentKey, editId, plan.text);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      this.removePendingEditId(documentKey, editId);
      vscode.window.showErrorMessage('ScieMD could not apply the document edit.');
      this.postDocumentUpdate(document, 'changed');
      return 'failed';
    }
    if (document.getText() !== plan.text) {
      this.removePendingEditId(documentKey, editId);
      this.showCoalescedWarning(documentKey, 'post-apply-mismatch', 'ScieMD applied an edit, but VS Code reported different Markdown afterward. The webview was refreshed to avoid overwriting newer content.');
      this.postDocumentUpdate(document, 'changed');
      return 'failed';
    }

    this.lastAppliedWebviewTextByDocument.set(documentKey, plan.text);
    if (plan.mergedStaleBase) {
      this.showCoalescedWarning(documentKey, 'stale-merge', 'ScieMD merged webview edits with newer Markdown already present in VS Code.');
    }
    return 'applied';
  }

  private createDocumentFileWatcher(document: vscode.TextDocument): vscode.Disposable | null {
    if (document.uri.scheme !== 'file') return null;
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(
      vscode.Uri.file(path.dirname(document.uri.fsPath)),
      path.basename(document.uri.fsPath),
    ));
    const disposables: vscode.Disposable[] = [
      watcher,
      watcher.onDidDelete((uri) => {
        if (uri.toString() !== document.uri.toString()) return;
        this.markDocumentReadonly(document, 'This Markdown file was deleted on disk. The ScieMD panel is read-only to avoid recreating it accidentally.');
      }),
    ];
    return vscode.Disposable.from(...disposables);
  }

  private markDocumentReadonly(document: vscode.TextDocument, reason: string): void {
    const documentKey = document.uri.toString();
    const previous = this.readonlyReasonByDocument.get(documentKey);
    this.readonlyReasonByDocument.set(documentKey, reason);
    if (previous !== reason) this.showCoalescedWarning(documentKey, 'readonly', reason, 30_000);
    this.postDocumentUpdate(document, 'changed');
  }

  private async ensureDocumentWritable(document: vscode.TextDocument): Promise<boolean> {
    const documentKey = document.uri.toString();
    if (this.readonlyReasonByDocument.has(documentKey)) {
      this.showCoalescedWarning(documentKey, 'readonly-edit', this.readonlyReasonByDocument.get(documentKey) ?? 'This ScieMD document is read-only.');
      this.postDocumentUpdate(document, 'changed');
      return false;
    }

    if (document.uri.scheme !== 'file') return true;
    try {
      await vscode.workspace.fs.stat(document.uri);
      return true;
    } catch {
      this.markDocumentReadonly(document, 'This Markdown file is no longer available on disk. The ScieMD panel is read-only to avoid recreating it accidentally.');
      return false;
    }
  }

  private showCoalescedWarning(documentKey: string, warningKey: string, message: string, intervalMs = 10_000): void {
    const key = `${documentKey}:${warningKey}`;
    const now = Date.now();
    const lastShownAt = this.lastWarningAtByDocument.get(key) ?? 0;
    if (now - lastShownAt < intervalMs) return;
    this.lastWarningAtByDocument.set(key, now);
    vscode.window.showWarningMessage(message);
  }

  private clearWarningTimestamps(documentKey: string): void {
    for (const key of Array.from(this.lastWarningAtByDocument.keys())) {
      if (key.startsWith(`${documentKey}:`)) this.lastWarningAtByDocument.delete(key);
    }
  }

  private trackPanel(documentKey: string, panel: vscode.WebviewPanel): string {
    const panelId = `panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    this.panelIdByPanel.set(panel, panelId);
    const panels = this.panelsByDocument.get(documentKey) ?? new Set<vscode.WebviewPanel>();
    panels.add(panel);
    this.panelsByDocument.set(documentKey, panels);
    return panelId;
  }

  private untrackPanel(documentKey: string, panel: vscode.WebviewPanel): void {
    this.panelIdByPanel.delete(panel);
    const panels = this.panelsByDocument.get(documentKey);
    if (!panels) return;
    panels.delete(panel);
    if (panels.size === 0) {
      this.panelsByDocument.delete(documentKey);
      this.pendingEditEchoByDocument.delete(documentKey);
      this.lastAppliedWebviewTextByDocument.delete(documentKey);
      this.readonlyReasonByDocument.delete(documentKey);
      this.clearWarningTimestamps(documentKey);
    }
  }

  private postDocumentUpdate(
    document: vscode.TextDocument,
    reason: 'initial' | 'changed' | 'saved',
    sourceEditId: string | null = null,
  ): void {
    const panels = this.panelsByDocument.get(document.uri.toString());
    if (!panels) return;
    for (const panel of panels) {
      this.postToPanel(panel, document, reason, sourceEditId);
    }
  }

  private postToPanel(
    panel: vscode.WebviewPanel,
    document: vscode.TextDocument,
    reason: 'initial' | 'changed' | 'saved',
    sourceEditId: string | null = null,
  ): void {
    const readonlyReason = this.readonlyReasonByDocument.get(document.uri.toString());
    const documentText = document.getText();
    const panelId = this.panelIdByPanel.get(panel) ?? 'unknown-panel';
    const message = {
      type: 'documentUpdate',
      panelId,
      reason,
      snapshot: {
        uri: document.uri.toString(),
        fileName: document.fileName.split(/[\\/]/).pop() || 'Untitled.md',
        text: documentText,
        version: document.version,
        isDirty: document.isDirty,
        isReadonly: Boolean(readonlyReason),
        readonlyReason,
      },
      sourceEditId,
    } as const;
    this.log(`postMessage queued: ${reason} ${document.uri.toString()} v${document.version} chars=${documentText.length}`);
    void Promise.resolve(panel.webview.postMessage(message))
      .then((ok) => {
        this.log(`postMessage ${ok ? 'ok' : 'failed'}: ${reason} ${document.uri.toString()} v${document.version} chars=${documentText.length}`);
      })
      .catch((error: unknown) => {
        const messageText = error instanceof Error ? error.message : String(error);
        this.log(`postMessage error: ${reason} ${document.uri.toString()} ${messageText}`);
      });
  }

  private acceptsPanelMessage(webviewPanel: vscode.WebviewPanel, message: { panelId?: string; editId?: string; editChainId?: string }): boolean {
    const expectedPanelId = this.panelIdByPanel.get(webviewPanel);
    if (!expectedPanelId || message.panelId === undefined || message.panelId === expectedPanelId) return true;
    this.postOperationResult(webviewPanel, {
      id: message.editId,
      editChainId: message.editChainId,
      ok: false,
      result: 'skipped',
      message: 'ScieMD ignored a stale edit from another webview panel.',
    });
    return false;
  }

  private postEditOperationResult(
    panel: vscode.WebviewPanel,
    id: string,
    result: ReplaceDocumentTextResult,
    editChainId?: string,
  ): void {
    this.postOperationResult(panel, {
      id,
      editChainId,
      ok: canSaveAfterPendingEdit(result),
      result,
      message: operationResultMessage(result),
    });
  }

  private postOperationResult(
    panel: vscode.WebviewPanel,
    result: { id?: string; editChainId?: string; ok: boolean; result: OperationResultKind; message: string },
  ): void {
    const panelId = this.panelIdByPanel.get(panel);
    void Promise.resolve(panel.webview.postMessage({
      type: 'operationResult',
      panelId,
      ...result,
    }));
  }

  private postMalformedWebviewMessageResult(
    panel: vscode.WebviewPanel,
    invalid: { id?: string; editChainId?: string; reason: string },
  ): void {
    this.postOperationResult(panel, {
      id: invalid.id,
      editChainId: invalid.editChainId,
      ok: false,
      result: 'failed',
      message: `ScieMD ignored a malformed webview message: ${invalid.reason}`,
    });
  }

  private enqueuePendingEditId(documentKey: string, editId: string, expectedText: string): void {
    const pending = this.pendingEditEchoByDocument.get(documentKey) ?? [];
    pending.push({ id: editId, text: expectedText });
    this.pendingEditEchoByDocument.set(documentKey, pending);
  }

  private consumePendingEditId(documentKey: string, changedText: string): string | null {
    const pending = this.pendingEditEchoByDocument.get(documentKey);
    if (!pending || pending.length === 0) return null;
    const index = pending.findIndex((entry) => entry.text === changedText);
    if (index < 0) return null;
    const [entry] = pending.splice(index, 1);
    if (pending.length === 0) this.pendingEditEchoByDocument.delete(documentKey);
    return entry?.id ?? null;
  }

  private removePendingEditId(documentKey: string, editId: string): void {
    const pending = this.pendingEditEchoByDocument.get(documentKey);
    if (!pending) return;
    const next = pending.filter((pendingEdit) => pendingEdit.id !== editId);
    if (next.length === 0) this.pendingEditEchoByDocument.delete(documentKey);
    else this.pendingEditEchoByDocument.set(documentKey, next);
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}

export function canSaveAfterPendingEdit(result: ReplaceDocumentTextResult): boolean {
  return result === 'applied' || result === 'noop';
}

function operationResultMessage(result: ReplaceDocumentTextResult): string {
  switch (result) {
    case 'applied':
      return 'ScieMD edit applied.';
    case 'noop':
      return 'ScieMD edit did not change the document.';
    case 'skipped':
      return 'ScieMD skipped a stale edit and refreshed the webview.';
    case 'readonly':
      return 'ScieMD could not edit this read-only document.';
    case 'failed':
      return 'ScieMD could not apply the document edit.';
  }
}

export async function openWithScieMDVisualEditor(uri?: vscode.Uri): Promise<void> {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!target) {
    vscode.window.showWarningMessage('Open a Markdown document first.');
    return;
  }
  await vscode.commands.executeCommand('vscode.openWith', target, ScieMDCustomEditorProvider.viewType);
}

export async function copyScieMDLlmSkill(): Promise<void> {
  await vscode.env.clipboard.writeText(createScieMDLlmSkill());
  vscode.window.showInformationMessage('Copied ScieMD LLM skill.');
}

export async function generateSkillFileBesideActiveDocument(uri?: vscode.Uri): Promise<void> {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!target) {
    vscode.window.showWarningMessage('Open a Markdown document first.');
    return;
  }
  await generateSkillFileBesideDocument(target);
}

async function generateSkillFileBesideDocument(documentUri: vscode.Uri): Promise<void> {
  if (documentUri.scheme === 'untitled') {
    vscode.window.showWarningMessage('Save the Markdown document before generating ScieMD_LLM_skill.md beside it.');
    return;
  }
  const parent = documentParentUri(documentUri);
  if (!parent) {
    vscode.window.showWarningMessage('ScieMD could not resolve the parent folder for this Markdown document.');
    return;
  }
  const target = vscode.Uri.joinPath(parent, 'ScieMD_LLM_skill.md');
  const content = Buffer.from(createScieMDLlmSkill(), 'utf8');
  try {
    await vscode.workspace.fs.stat(target);
    const overwrite = await vscode.window.showWarningMessage(
      'ScieMD_LLM_skill.md already exists beside this document. Overwrite it?',
      { modal: true },
      'Overwrite',
    );
    if (overwrite !== 'Overwrite') return;
  } catch {
    // Missing file is expected for first generation.
  }
  try {
    await vscode.workspace.fs.writeFile(target, content);
    vscode.window.showInformationMessage('Generated ScieMD_LLM_skill.md beside the document.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown file-system error.';
    vscode.window.showErrorMessage(`Could not generate ScieMD_LLM_skill.md: ${message}`);
  }
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

function webviewLocalResourceRoots(extensionUri: vscode.Uri, document: vscode.TextDocument): vscode.Uri[] {
  const roots = [
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
  ];
  const parent = documentParentUri(document.uri);
  if (parent) roots.push(parent);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
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
