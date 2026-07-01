export const releaseSizeBudgets = Object.freeze({
  desktopDistTotalBytes: 32 * 1024 * 1024,
  desktopDistJavaScriptBytes: 10 * 1024 * 1024,
  desktopDistLargestJavaScriptBytes: 4 * 1024 * 1024,
  desktopDistCssBytes: 2 * 1024 * 1024,
  desktopDistWorkerJavaScriptBytes: 2 * 1024 * 1024,
  extensionDistTotalBytes: 32 * 1024 * 1024,
  extensionHostJsBytes: 8 * 1024 * 1024,
  extensionWebviewJsBytes: 32 * 1024 * 1024,
  vsixBytes: 64 * 1024 * 1024,
  windowsNsisInstallerBytes: 128 * 1024 * 1024,
  windowsMsiInstallerBytes: 128 * 1024 * 1024,
  desktopBundleTotalBytes: 256 * 1024 * 1024,
});

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
