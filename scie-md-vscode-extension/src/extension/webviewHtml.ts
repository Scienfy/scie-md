import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'assets', 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'assets', 'main.css'));
  const nonce = createNonce();
  const scriptUriJson = JSON.stringify(scriptUri.toString());
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
      window.addEventListener('error', (event) => {
        setBoot('ScieMD webview error: ' + (event.message || 'unknown script error'));
      });
      window.addEventListener('unhandledrejection', (event) => {
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
