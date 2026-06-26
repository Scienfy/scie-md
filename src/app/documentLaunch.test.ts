import { describe, expect, it } from 'vitest';
import {
  initialDocumentMarkdownForLaunch,
  initialExplorerPathForLaunch,
  parentDirectoryForDocument,
  shouldCommitWelcomeAfterStartup,
  shouldShowAutomaticOnboardingDialog,
} from './documentLaunch';

describe('document launch helpers', () => {
  it('resolves Windows, UNC, and POSIX document parent folders', () => {
    expect(parentDirectoryForDocument('C:\\Users\\amin_\\paper.md')).toBe('C:\\Users\\amin_');
    expect(parentDirectoryForDocument('C:\\paper.md')).toBe('C:\\');
    expect(parentDirectoryForDocument('\\\\server\\share\\paper.markdown')).toBe('\\\\server\\share');
    expect(parentDirectoryForDocument('/home/amin/paper.md')).toBe('/home/amin');
    expect(parentDirectoryForDocument('/paper.md')).toBe('/');
  });

  it('suppresses automatic onboarding while a launch document is pending or active', () => {
    expect(shouldShowAutomaticOnboardingDialog({
      onboardingComplete: false,
      startupDocumentOpenPending: true,
      startupDocumentOpenFailed: false,
      filePath: null,
      markdown: '',
    })).toBe(false);
    expect(shouldShowAutomaticOnboardingDialog({
      onboardingComplete: false,
      startupDocumentOpenPending: false,
      startupDocumentOpenFailed: false,
      filePath: 'C:\\Users\\amin_\\paper.md',
      markdown: '# Paper',
    })).toBe(false);
    expect(shouldShowAutomaticOnboardingDialog({
      onboardingComplete: false,
      startupDocumentOpenPending: false,
      startupDocumentOpenFailed: true,
      filePath: null,
      markdown: '',
    })).toBe(false);
  });

  it('shows automatic onboarding only for an empty untitled first-run surface', () => {
    expect(shouldShowAutomaticOnboardingDialog({
      onboardingComplete: false,
      startupDocumentOpenPending: false,
      startupDocumentOpenFailed: false,
      filePath: null,
      markdown: '',
    })).toBe(true);
    expect(shouldShowAutomaticOnboardingDialog({
      onboardingComplete: false,
      startupDocumentOpenPending: false,
      startupDocumentOpenFailed: false,
      filePath: null,
      markdown: '# Draft',
    })).toBe(false);
    expect(shouldShowAutomaticOnboardingDialog({
      onboardingComplete: true,
      startupDocumentOpenPending: false,
      startupDocumentOpenFailed: false,
      filePath: null,
      markdown: '',
    })).toBe(false);
  });

  it('does not eagerly load the saved explorer folder while a launched document is opening', () => {
    expect(initialExplorerPathForLaunch({
      persistedExplorerRootPath: 'C:\\Users\\amin_\\Downloads',
      startupDocumentOpenPending: true,
      startupDocumentOpenFailed: false,
      filePath: null,
    })).toBeNull();
    expect(initialExplorerPathForLaunch({
      persistedExplorerRootPath: 'C:\\Users\\amin_\\Downloads',
      startupDocumentOpenPending: false,
      startupDocumentOpenFailed: false,
      filePath: 'C:\\Users\\amin_\\paper.md',
    })).toBeNull();
    expect(initialExplorerPathForLaunch({
      persistedExplorerRootPath: 'C:\\Users\\amin_\\Downloads',
      startupDocumentOpenPending: false,
      startupDocumentOpenFailed: true,
      filePath: null,
    })).toBeNull();
  });

  it('loads the saved explorer folder only for normal untitled startup', () => {
    expect(initialExplorerPathForLaunch({
      persistedExplorerRootPath: 'C:\\Users\\amin_\\Downloads',
      startupDocumentOpenPending: false,
      startupDocumentOpenFailed: false,
      filePath: null,
    })).toBe('C:\\Users\\amin_\\Downloads');
    expect(initialExplorerPathForLaunch({
      persistedExplorerRootPath: '   ',
      startupDocumentOpenPending: false,
      startupDocumentOpenFailed: false,
      filePath: null,
    })).toBeNull();
  });

  it('starts native launches blank until the startup file decision is settled', () => {
    expect(initialDocumentMarkdownForLaunch({
      onboardingComplete: true,
      nativeRuntime: true,
      welcomeMarkdown: '# Welcome',
    })).toBe('');
    expect(initialDocumentMarkdownForLaunch({
      onboardingComplete: true,
      nativeRuntime: false,
      welcomeMarkdown: '# Welcome',
    })).toBe('# Welcome');
  });

  it('commits the welcome document only after a clean no-file startup', () => {
    expect(shouldCommitWelcomeAfterStartup({
      onboardingComplete: true,
      startupDocumentOpenPending: false,
      startupDocumentOpenFailed: false,
      filePath: null,
      markdown: '',
    })).toBe(true);
    expect(shouldCommitWelcomeAfterStartup({
      onboardingComplete: true,
      startupDocumentOpenPending: true,
      startupDocumentOpenFailed: false,
      filePath: null,
      markdown: '',
    })).toBe(false);
    expect(shouldCommitWelcomeAfterStartup({
      onboardingComplete: true,
      startupDocumentOpenPending: false,
      startupDocumentOpenFailed: true,
      filePath: null,
      markdown: '',
    })).toBe(false);
    expect(shouldCommitWelcomeAfterStartup({
      onboardingComplete: true,
      startupDocumentOpenPending: false,
      startupDocumentOpenFailed: false,
      filePath: 'C:\\Users\\amin_\\paper.md',
      markdown: '# Paper',
    })).toBe(false);
  });
});
