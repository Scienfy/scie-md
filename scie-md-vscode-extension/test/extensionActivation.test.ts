import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activate } from '../src/extension/extension';

const vscodeMock = vi.hoisted(() => ({
  createOutputChannel: vi.fn(),
  registerCommand: vi.fn(),
  registerCustomEditorProvider: vi.fn(),
}));

vi.mock('vscode', () => ({
  commands: {
    registerCommand: vscodeMock.registerCommand,
  },
  window: {
    activeTextEditor: undefined,
    createOutputChannel: vscodeMock.createOutputChannel,
    registerCustomEditorProvider: vscodeMock.registerCustomEditorProvider,
  },
}));

describe('extension activation contract', () => {
  beforeEach(() => {
    vscodeMock.createOutputChannel.mockReset();
    vscodeMock.registerCommand.mockReset();
    vscodeMock.registerCustomEditorProvider.mockReset();

    vscodeMock.createOutputChannel.mockReturnValue({
      appendLine: vi.fn(),
      dispose: vi.fn(),
    });
    vscodeMock.registerCommand.mockReturnValue({ dispose: vi.fn() });
    vscodeMock.registerCustomEditorProvider.mockReturnValue({ dispose: vi.fn() });
  });

  it('registers the ScieMD custom editor and host commands declared by the package manifest', () => {
    const manifest = readExtensionManifest();
    const expectedCommands = manifest.contributes.commands.map((command) => command.command);
    const customEditor = manifest.contributes.customEditors.find((editor) => editor.viewType === 'scieMd.visualMarkdown');
    const context = {
      extensionUri: { toString: () => 'file:///extension' },
      subscriptions: [] as unknown[],
    };

    activate(context as never);

    expect(vscodeMock.createOutputChannel).toHaveBeenCalledWith('ScieMD');
    expect(vscodeMock.registerCustomEditorProvider).toHaveBeenCalledWith(
      customEditor?.viewType,
      expect.any(Object),
      { supportsMultipleEditorsPerDocument: true },
    );
    expect(vscodeMock.registerCommand.mock.calls.map((call) => call[0])).toEqual(expectedCommands);
    expect(context.subscriptions).toHaveLength(2 + expectedCommands.length);
  });
});

describe('package host contract', () => {
  it('keeps activation events aligned with contributed commands and the custom editor', () => {
    const manifest = readExtensionManifest();
    const commandIds = manifest.contributes.commands.map((command) => command.command);
    const customEditor = manifest.contributes.customEditors.find((editor) => editor.viewType === 'scieMd.visualMarkdown');

    expect(customEditor).toBeDefined();
    expect(manifest.main).toBe('./dist/extension/extension.js');
    expect(manifest.activationEvents).toContain(`onCustomEditor:${customEditor?.viewType}`);
    expect(manifest.activationEvents).toContain('onLanguage:markdown');
    for (const commandId of commandIds) {
      expect(manifest.activationEvents).toContain(`onCommand:${commandId}`);
    }
  });

  it('keeps the ScieMD custom editor discoverable for supported Markdown files', () => {
    const manifest = readExtensionManifest();
    const customEditor = manifest.contributes.customEditors.find((editor) => editor.viewType === 'scieMd.visualMarkdown');
    const filenamePatterns = customEditor?.selector.map((selector) => selector.filenamePattern) ?? [];
    const commandPaletteCommands = manifest.contributes.menus.commandPalette.map((item) => item.command);
    const editorAssociations = manifest.contributes.configurationDefaults['workbench.editorAssociations'];

    expect(customEditor?.priority).toBe('default');
    expect(filenamePatterns).toEqual(expect.arrayContaining(['*.md', '*.markdown', '*.scie.md', '*.sciemd.md']));
    expect(editorAssociations).toMatchObject({
      '*.md': 'scieMd.visualMarkdown',
      '*.markdown': 'scieMd.visualMarkdown',
      '*.scie.md': 'scieMd.visualMarkdown',
      '*.sciemd.md': 'scieMd.visualMarkdown',
    });
    expect(commandPaletteCommands).toEqual(expect.arrayContaining([
      'scieMd.openWithVisualEditor',
      'scieMd.copyLlmSkill',
      'scieMd.generateLlmSkillFile',
    ]));
    expect(manifest.capabilities.virtualWorkspaces.supported).toBe('limited');
    expect(manifest.capabilities.untrustedWorkspaces.supported).toBe('limited');
  });
});

type ExtensionManifest = {
  main: string;
  activationEvents: string[];
  capabilities: {
    virtualWorkspaces: { supported: string };
    untrustedWorkspaces: { supported: string };
  };
  contributes: {
    commands: Array<{ command: string }>;
    configurationDefaults: {
      'workbench.editorAssociations': Record<string, string>;
    };
    customEditors: Array<{
      viewType: string;
      selector: Array<{ filenamePattern: string }>;
      priority: string;
    }>;
    menus: {
      commandPalette: Array<{ command: string }>;
    };
  };
};

function readExtensionManifest(): ExtensionManifest {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as ExtensionManifest;
}
