import * as vscode from 'vscode';
import {
  ScieMDCustomEditorProvider,
  copyScieMDLlmSkill,
  generateSkillFileBesideActiveDocument,
  openWithScieMDVisualEditor,
} from './ScieMdCustomEditorProvider';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('ScieMD');
  output.appendLine(`[${new Date().toISOString()}] Activating ScieMD VS Code extension.`);
  context.subscriptions.push(output);

  const provider = new ScieMDCustomEditorProvider(context, output);

  context.subscriptions.push(vscode.window.registerCustomEditorProvider(
    ScieMDCustomEditorProvider.viewType,
    provider,
    {
      supportsMultipleEditorsPerDocument: true,
    },
  ));

  context.subscriptions.push(
    vscode.commands.registerCommand('scieMd.openWithVisualEditor', openWithScieMDVisualEditor),
    vscode.commands.registerCommand('scieMd.copyLlmSkill', copyScieMDLlmSkill),
    vscode.commands.registerCommand('scieMd.generateLlmSkillFile', generateSkillFileBesideActiveDocument),
  );
}

export function deactivate(): void {}
