import { describe, expect, it } from 'vitest';
import {
  initialDocumentMarkdownForLaunch,
  initialExplorerFallbackPathForLaunch,
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
      startupDocumentOpenFailed: false,
      filePath: 'C:\\Users\\amin_\\paper.md',
      markdown: '',
    })).toBe(false);
  });

  it('shows automatic onboarding for an empty untitled first-run or failed-startup surface', () => {
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
      startupDocumentOpenFailed: true,
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

  it('does not eagerly load the saved explorer folder while a launched document is opening or active', () => {
    expect(initialExplorerPathForLaunch({
      persistedExplorerRootPath: 'C:\\Users\\amin_\\Downloads',
      startupDocumentOpenPending: true,
      startupDocumentOpenFailed: false,
      startupDocumentOpenFailurePath: null,
      filePath: null,
    })).toBeNull();
    expect(initialExplorerPathForLaunch({
      persistedExplorerRootPath: 'C:\\Users\\amin_\\Downloads',
      startupDocumentOpenPending: false,
      startupDocumentOpenFailed: false,
      startupDocumentOpenFailurePath: null,
      filePath: 'C:\\Users\\amin_\\paper.md',
    })).toBeNull();
  });

  it('prefers the failed startup document folder and keeps the saved folder as fallback', () => {
    expect(initialExplorerPathForLaunch({
      persistedExplorerRootPath: 'C:\\Users\\amin_\\Downloads',
      startupDocumentOpenPending: false,
      startupDocumentOpenFailed: true,
      startupDocumentOpenFailurePath: 'C:\\Users\\amin_\\Research\\missing.md',
      filePath: null,
    })).toBe('C:\\Users\\amin_\\Research');
    expect(initialExplorerFallbackPathForLaunch({
      persistedExplorerRootPath: 'C:\\Users\\amin_\\Downloads',
      startupDocumentOpenPending: false,
      startupDocumentOpenFailed: true,
      startupDocumentOpenFailurePath: 'C:\\Users\\amin_\\Research\\missing.md',
      filePath: null,
    })).toBe('C:\\Users\\amin_\\Downloads');
  });

  it('falls back to the saved explorer folder when a failed startup path has no parent', () => {
    expect(initialExplorerPathForLaunch({
      persistedExplorerRootPath: 'C:\\Users\\amin_\\Downloads',
      startupDocumentOpenPending: false,
      startupDocumentOpenFailed: true,
      startupDocumentOpenFailurePath: 'missing.md',
      filePath: null,
    })).toBe('C:\\Users\\amin_\\Downloads');
    expect(initialExplorerFallbackPathForLaunch({
      persistedExplorerRootPath: 'C:\\Users\\amin_\\Downloads',
      startupDocumentOpenPending: false,
      startupDocumentOpenFailed: true,
      startupDocumentOpenFailurePath: 'missing.md',
      filePath: null,
    })).toBeNull();
  });

  it('loads the saved explorer folder only for normal untitled startup', () => {
    expect(initialExplorerPathForLaunch({
      persistedExplorerRootPath: 'C:\\Users\\amin_\\Downloads',
      startupDocumentOpenPending: false,
      startupDocumentOpenFailed: false,
      startupDocumentOpenFailurePath: null,
      filePath: null,
    })).toBe('C:\\Users\\amin_\\Downloads');
    expect(initialExplorerPathForLaunch({
      persistedExplorerRootPath: '   ',
      startupDocumentOpenPending: false,
      startupDocumentOpenFailed: false,
      startupDocumentOpenFailurePath: null,
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

  it('commits the welcome document after a clean no-file startup or failed startup fallback', () => {
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
    })).toBe(true);
    expect(shouldCommitWelcomeAfterStartup({
      onboardingComplete: true,
      startupDocumentOpenPending: false,
      startupDocumentOpenFailed: false,
      filePath: 'C:\\Users\\amin_\\paper.md',
      markdown: '# Paper',
    })).toBe(false);
  });
});
