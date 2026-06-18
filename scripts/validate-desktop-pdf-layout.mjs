import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const port = Number((process.env.SCIEMD_DESKTOP_VALIDATE_CDP_PORT ?? process.env.SCIE_MD_DESKTOP_VALIDATE_CDP_PORT) ?? process.argv[2] ?? 9231);
const htmlPath = resolve(process.argv[3] ?? 'output/export-validation/welcome-visual-capture.html');
const outputPath = process.argv[4]
  ? resolve(process.argv[4])
  : resolve(
    process.env.USERPROFILE ?? process.env.HOME ?? '.',
    'OneDrive',
    'Documents',
    `ScieMD_desktop_layout_validation-${Date.now()}-${process.pid}.pdf`,
  );

const html = await readFile(htmlPath, 'utf8');
const targetList = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targetList.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
if (!target) throw new Error('No debuggable ScieMD WebView page found.');

const page = new CdpPage(target.webSocketDebuggerUrl);
await page.ready;
await page.send('Runtime.enable');

const response = await page.evaluate(`async () => {
  try {
    const response = await window.__TAURI_INTERNALS__.invoke('export_styled_html_to_pdf', ${JSON.stringify({
      html,
      outputPath,
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

const actualOutputPath = response.response?.outputPath ?? outputPath;
const pdfBytes = await readFile(actualOutputPath);
const fileStat = await stat(actualOutputPath);
if (pdfBytes.subarray(0, 4).toString('ascii') !== '%PDF') {
  throw new Error('Desktop layout validation did not produce a PDF signature.');
}
const pdfText = pdfBytes.toString('latin1');
if (pdfText.includes('/Title (New tab)') || pdfText.includes('ntp.msn.com')) {
  throw new Error('Desktop layout validation produced the browser New Tab page.');
}

console.log(JSON.stringify({
  ok: true,
  response: response.response,
  requestedOutputPath: outputPath,
  outputPath: actualOutputPath,
  pdfBytes: fileStat.size,
}, null, 2));

function CdpPage(webSocketUrl) {
  this.webSocket = new WebSocket(webSocketUrl);
  this.nextId = 1;
  this.pending = new Map();
  this.ready = new Promise((resolveReady, rejectReady) => {
    this.webSocket.addEventListener('open', resolveReady, { once: true });
    this.webSocket.addEventListener('error', () => rejectReady(new Error(`Could not open DevTools WebSocket: ${webSocketUrl}`)), { once: true });
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
    const promise = new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend });
    });
    this.webSocket.send(JSON.stringify({ id, method, params }));
    return promise;
  };
  this.evaluate = async (functionSource) => {
    const result = await this.send('Runtime.evaluate', {
      expression: `(${functionSource})()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Runtime evaluation failed.');
    }
    return result.result?.value;
  };
  this.close = () => this.webSocket.close();
}
