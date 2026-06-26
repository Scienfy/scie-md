import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import * as path from 'node:path';

export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, documentUri?: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'assets', 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'assets', 'main.css'));
  const documentParent = documentUri ? documentParentUri(documentUri) : null;
  const documentResourceBaseUri = documentParent
    ? webview.asWebviewUri(documentParent).toString()
    : '';
  const nonce = createNonce();
  const scriptUriJson = JSON.stringify(scriptUri.toString());
  const documentResourceBaseJson = JSON.stringify(documentResourceBaseUri);
  const nonceJson = JSON.stringify(nonce);
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} https: data:`,
    `font-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `worker-src ${webview.cspSource} blob:`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>ScieMD Markdown Editor</title>
</head>
<body>
  <div id="scie-md-boot" class="boot-banner">Starting ScieMD webview...</div>
  <div id="root">
    <div>
      Loading ScieMD editor...
    </div>
  </div>
  <script nonce="${nonce}">
    (() => {
      const boot = document.getElementById('scie-md-boot');
      const setBoot = (message) => {
        if (boot) boot.textContent = message;
      };
      window.__SCIE_MD_VSCODE_DOCUMENT_RESOURCE_BASE__ = ${documentResourceBaseJson};
      window.addEventListener('error', (event) => {
        setBoot('ScieMD webview error: ' + (event.message || 'unknown script error'));
      });
      window.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled ScieMD webview promise rejection:', event.reason);
        event.preventDefault();
        if (document.documentElement.dataset.scieMdBoot === 'mounted') return;
        const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
        setBoot('ScieMD webview error: ' + reason);
      });
      const script = document.createElement('script');
      script.type = 'module';
      script.nonce = ${nonceJson};
      script.src = ${scriptUriJson};
      script.onload = () => setBoot('ScieMD webview bundle loaded. Mounting editor...');
      script.onerror = () => setBoot('ScieMD could not load its bundled webview script.');
      document.head.appendChild(script);
    })();
  </script>
</body>
</html>`;
}

function createNonce(): string {
  return randomBytes(24).toString('base64');
}

export function documentParentUri(uri: vscode.Uri): vscode.Uri | null {
  if (uri.scheme === 'untitled') return null;
  if (uri.scheme === 'file') return vscode.Uri.file(path.dirname(uri.fsPath));
  const parentPath = path.posix.dirname(uri.path);
  if (!parentPath || parentPath === '.' || parentPath === uri.path) return null;
  return uri.with({ path: parentPath, query: '', fragment: '' });
}
