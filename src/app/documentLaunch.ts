interface AutomaticOnboardingDialogParams {
  onboardingComplete: boolean;
  startupDocumentOpenPending: boolean;
  startupDocumentOpenFailed: boolean;
  filePath: string | null;
  markdown: string;
}

interface InitialExplorerPathParams {
  persistedExplorerRootPath: string | null;
  startupDocumentOpenPending: boolean;
  startupDocumentOpenFailed: boolean;
  filePath: string | null;
}

interface InitialDocumentMarkdownParams {
  onboardingComplete: boolean;
  nativeRuntime: boolean;
  welcomeMarkdown: string;
}

interface WelcomeFallbackParams {
  onboardingComplete: boolean;
  startupDocumentOpenPending: boolean;
  startupDocumentOpenFailed: boolean;
  filePath: string | null;
  markdown: string;
}

export function parentDirectoryForDocument(path: string | null): string | null {
  const trimmed = path?.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/[\\/]+$/, '');
  const separatorIndex = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
  if (separatorIndex < 0) return null;
  if (separatorIndex === 0) return normalized[0] === '/' ? '/' : null;

  const parent = normalized.slice(0, separatorIndex);
  if (/^[A-Za-z]:$/.test(parent)) {
    return `${parent}${normalized[separatorIndex]}`;
  }
  return parent || null;
}

export function shouldShowAutomaticOnboardingDialog({
  onboardingComplete,
  startupDocumentOpenPending,
  startupDocumentOpenFailed,
  filePath,
  markdown,
}: AutomaticOnboardingDialogParams): boolean {
  return !onboardingComplete
    && !startupDocumentOpenPending
    && !startupDocumentOpenFailed
    && !filePath
    && markdown.trim().length === 0;
}

export function initialExplorerPathForLaunch({
  persistedExplorerRootPath,
  startupDocumentOpenPending,
  startupDocumentOpenFailed,
  filePath,
}: InitialExplorerPathParams): string | null {
  if (startupDocumentOpenPending || startupDocumentOpenFailed || filePath) return null;
  return persistedExplorerRootPath?.trim() ? persistedExplorerRootPath : null;
}

export function initialDocumentMarkdownForLaunch({
  onboardingComplete,
  nativeRuntime,
  welcomeMarkdown,
}: InitialDocumentMarkdownParams): string {
  if (nativeRuntime) return '';
  return onboardingComplete ? welcomeMarkdown : '';
}

export function shouldCommitWelcomeAfterStartup({
  onboardingComplete,
  startupDocumentOpenPending,
  startupDocumentOpenFailed,
  filePath,
  markdown,
}: WelcomeFallbackParams): boolean {
  return onboardingComplete
    && !startupDocumentOpenPending
    && !startupDocumentOpenFailed
    && !filePath
    && markdown.trim().length === 0;
}
