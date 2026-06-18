import { readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const port = Number((process.env.SCIEMD_DESKTOP_VALIDATE_CDP_PORT ?? process.env.SCIE_MD_DESKTOP_VALIDATE_CDP_PORT) ?? process.argv[2] ?? 9231);
const documentsDir = resolve(homedir(), 'OneDrive', 'Documents');
const outputPath = resolve(documentsDir, 'ScieMD_desktop_validation.pdf');

if (!existsSync(documentsDir)) {
  throw new Error(`Documents directory not found: ${documentsDir}`);
}

await rm(outputPath, { force: true });

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
if (!target) throw new Error('No debuggable ScieMD WebView page found.');

const page = new CdpPage(target.webSocketDebuggerUrl);
await page.ready;
await page.send('Runtime.enable');

const selectedOutputPath = await page.evaluate(`async () => {
  try {
    const selected = await window.__TAURI_INTERNALS__.invoke('pick_pandoc_export_save_path', ${JSON.stringify({
      defaultPath: outputPath,
      format: 'pdf',
    })});
    return { ok: true, selected };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message ?? error),
      stack: String(error?.stack ?? ''),
    };
  }
}`);
if (!selectedOutputPath?.ok) {
  page.close();
  throw new Error(`Desktop save dialog command failed: ${selectedOutputPath?.error ?? 'unknown error'}\n${selectedOutputPath?.stack ?? ''}`);
}
if (!selectedOutputPath.selected) {
  page.close();
  throw new Error('Desktop save dialog was cancelled.');
}

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>ScieMD Desktop PDF Validation</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 48px; color: #0c2d3a; }
    h1 { font-size: 34px; }
    p { font-size: 18px; line-height: 1.5; }
  </style>
</head>
<body>
  <h1>ScieMD Desktop PDF Validation</h1>
  <p>This PDF was exported by the packaged desktop Tauri command.</p>
</body>
</html>`;

const response = await page.evaluate(`async () => {
  try {
    const response = await window.__TAURI_INTERNALS__.invoke('export_styled_html_to_pdf', ${JSON.stringify({
      html,
      outputPath: selectedOutputPath.selected,
    })});
    return { ok: true, response };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message ?? error),
      stack: String(error?.stack ?? ''),
    };
  }
}`);
page.close();
if (!response?.ok) {
  throw new Error(`Desktop Tauri PDF command failed: ${response?.error ?? 'unknown error'}\n${response?.stack ?? ''}`);
}

const fileStat = await stat(selectedOutputPath.selected);
const bytes = await readFile(selectedOutputPath.selected);
const signature = bytes.subarray(0, 4).toString('ascii');
const text = bytes.toString('latin1');
if (signature !== '%PDF') {
  throw new Error(`Desktop export did not produce a PDF signature. Signature: ${signature}`);
}
if (text.includes('/Title (New tab)') || text.includes('ntp.msn.com')) {
  throw new Error('Desktop export produced the browser New Tab page.');
}
if (!text.includes('ScieMD') && !text.includes('Validation')) {
  throw new Error('Desktop export PDF did not contain the validation document text.');
}

console.log(JSON.stringify({
  ok: true,
  response: response.response,
  outputPath: selectedOutputPath.selected,
  pdfBytes: fileStat.size,
}, null, 2));

function CdpPage(webSocketUrl) {
  this.webSocket = new WebSocket(webSocketUrl);
  this.nextId = 1;
  this.pending = new Map();
  this.ready = new Promise((resolve, reject) => {
    this.webSocket.addEventListener('open', resolve, { once: true });
    this.webSocket.addEventListener('error', () => reject(new Error(`Could not open DevTools WebSocket: ${webSocketUrl}`)), { once: true });
  });
  this.webSocket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (!payload.id) return;
    const pending = this.pending.get(payload.id);
    if (!pending) return;
    this.pending.delete(payload.id);
    if (payload.error) pending.reject(new Error(payload.error.message));
    else pending.resolve(payload.result ?? {});
  });
  this.send = async (method, params = {}) => {
    await this.ready;
    const id = this.nextId;
    this.nextId += 1;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.webSocket.send(JSON.stringify({ id, method, params }));
    return promise;
  };
  this.evaluate = async (functionSource) => {
    const response = await this.send('Runtime.evaluate', {
      expression: `(${functionSource})()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      const details = response.exceptionDetails;
      throw new Error(details.exception?.description ?? details.text ?? 'Runtime evaluation failed.');
    }
    return response.result?.value;
  };
  this.close = () => this.webSocket.close();
}
