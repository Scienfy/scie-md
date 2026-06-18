import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(repoRoot, 'output', 'export-validation');
const devPort = Number((process.env.SCIEMD_EXPORT_VALIDATE_DEV_PORT ?? process.env.SCIE_MD_EXPORT_VALIDATE_DEV_PORT) ?? 5187);
const cdpPort = Number((process.env.SCIEMD_EXPORT_VALIDATE_CDP_PORT ?? process.env.SCIE_MD_EXPORT_VALIDATE_CDP_PORT) ?? 9227);
const browserPath = resolveBrowserPath();

const artifacts = {
  html: resolve(outputDir, 'welcome-visual-capture.html'),
  pdf: resolve(outputDir, 'welcome-visual-capture.pdf'),
  appPng: resolve(outputDir, 'welcome-app-view.png'),
  htmlPng: resolve(outputDir, 'welcome-export-html.png'),
};

await mkdir(outputDir, { recursive: true });

const vite = spawn(process.execPath, [
  resolve(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
  '--host',
  '127.0.0.1',
  '--port',
  String(devPort),
  '--strictPort',
], {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let viteOutput = '';
vite.stdout.on('data', (chunk) => { viteOutput += chunk.toString(); });
vite.stderr.on('data', (chunk) => { viteOutput += chunk.toString(); });

const browserUserDataDir = resolve(repoRoot, 'tmp', `export-validation-browser-${process.pid}`);
await rm(browserUserDataDir, { recursive: true, force: true });
await mkdir(browserUserDataDir, { recursive: true });

const browser = spawn(browserPath, [
  '--headless=new',
  `--remote-debugging-port=${cdpPort}`,
  '--remote-allow-origins=*',
  `--user-data-dir=${browserUserDataDir}`,
  '--no-first-run',
  '--disable-extensions',
  '--disable-popup-blocking',
  '--window-size=1600,1000',
  'about:blank',
], {
  stdio: ['ignore', 'ignore', 'pipe'],
});
let browserErrorOutput = '';
browser.stderr.on('data', (chunk) => { browserErrorOutput += chunk.toString(); });

try {
  await waitForHttp(`http://127.0.0.1:${devPort}/`, 'Vite dev server');
  const page = await connectToFirstPage(cdpPort, () => browserErrorOutput);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      localStorage.setItem('scienfy.markdown.settings.v1', JSON.stringify({
        recentFiles: [],
        themeMode: 'dark',
        fontScale: 1,
        visualStyle: 'scienfy',
        outlineOpen: true,
        sidebarView: 'outline',
        explorerRootPath: null,
        inspectorOpen: false,
        authorshipVisible: true,
        focusMode: false,
        documentType: 'report',
        onboardingComplete: true,
        inkscapePath: null
      }));
      localStorage.setItem('scienfy.markdown.settings.scieSansDefaultMigrated', 'true');
    `,
  });
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await navigate(page, `http://127.0.0.1:${devPort}/`);
  await waitForExpression(page, `Boolean(document.querySelector('.editor-stage .visual-editor .ProseMirror'))`, 45_000);
  await settle(page);
  await saveScreenshot(page, artifacts.appPng);

  const html = await evaluateValue(page, `async () => {
    const [{ captureEditorHtmlForExport }, { createHtmlDocument, exportedDocumentTitle }] = await Promise.all([
      import('/src/export/renderCapture.ts'),
      import('/src/markdown/htmlExport.ts'),
    ]);
    const welcomeMarkdown = (await import('/src/samples/welcome.md?raw')).default;
    const frame = document.querySelector('.editor-stage');
    const captured = await captureEditorHtmlForExport(frame);
    if (!captured) throw new Error('Visual export capture returned null.');
    const root = document.documentElement;
    const html = createHtmlDocument(captured.bodyHtml, exportedDocumentTitle(welcomeMarkdown, null), {
      themeMode: root.getAttribute('data-theme-mode') || root.getAttribute('data-theme') || 'light',
      resolvedTheme: root.getAttribute('data-theme') || 'light',
      visualStyle: root.getAttribute('data-visual-style') || 'scienfy',
      fontScale: Number.parseFloat(root.style.getPropertyValue('--font-scale')) || 1,
      embedFonts: true,
      bodyIsFullVisualFrame: captured.isFullVisualFrame,
      exportLayout: captured.exportLayout,
    });
    return { html, warnings: captured.warnings, attrs: {
      theme: root.getAttribute('data-theme'),
      themeMode: root.getAttribute('data-theme-mode'),
      visualStyle: root.getAttribute('data-visual-style'),
    } };
  }`);

  if (!html?.html || typeof html.html !== 'string') {
    throw new Error('Validation capture did not return export HTML.');
  }
  if (/<div\s+class=["']export-fallback-frame\b/i.test(html.html)) {
    throw new Error('Export validation produced fallback-frame HTML instead of captured visual-frame HTML.');
  }
  if (html.html.includes('main { max-width: 920px;')) {
    throw new Error('Export validation HTML still includes fallback generic main CSS.');
  }
  if (/<[^>]+\bclass=["'][^"']*\bfocus-(?:dimmed|active)-block\b/i.test(html.html)) {
    throw new Error('Export validation HTML still includes focus-mode classes.');
  }
  await writeFile(artifacts.html, html.html, 'utf8');

  await navigate(page, pathToFileURL(artifacts.html).href);
  await waitForExpression(page, `Boolean(document.querySelector('.editor-stage.export-captured-stage .visual-editor .ProseMirror'))`, 10_000);
  await settle(page);
  await saveScreenshot(page, artifacts.htmlPng);

  const pdfResult = spawnSync(browserPath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `--user-data-dir=${resolve(repoRoot, 'tmp', `export-validation-print-${process.pid}`)}`,
    `--print-to-pdf=${artifacts.pdf}`,
    pathToFileURL(artifacts.html).href,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (pdfResult.status !== 0) {
    throw new Error(`Browser PDF print failed: ${pdfResult.stderr || pdfResult.stdout}`);
  }
  const signature = await readFile(artifacts.pdf);
  if (!signature.subarray(0, 4).equals(Buffer.from('%PDF'))) {
    throw new Error('Generated PDF is not a PDF file.');
  }
  console.log(JSON.stringify({
    ok: true,
    attrs: html.attrs,
    warnings: html.warnings,
    artifacts,
    pdfBytes: signature.byteLength,
  }, null, 2));
} finally {
  browser.kill();
  vite.kill();
  await Promise.allSettled([
    waitForExit(browser, 5_000),
    waitForExit(vite, 5_000),
  ]);
  await rm(browserUserDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(() => undefined);
}

function resolveBrowserPath() {
  const candidates = process.platform === 'win32'
    ? [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
    : ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge'];
  for (const candidate of candidates) {
    if (process.platform === 'win32') {
      if (existsSync(candidate)) return candidate;
    } else {
      const result = spawnSync('which', [candidate], { encoding: 'utf8' });
      if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
    }
  }
  throw new Error('Could not find Edge or Chrome for export validation.');
}

async function waitForHttp(url, label) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`${label} did not become available. ${lastError?.message ?? ''}\n${viteOutput}`);
}

async function connectToFirstPage(port, debugOutput) {
  const deadline = Date.now() + 15_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const pageTarget = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (pageTarget) {
        const page = new CdpPage(pageTarget.webSocketDebuggerUrl);
        await page.ready;
        return page;
      }
    } catch (error) {
      lastError = error;
      // Browser may still be starting.
    }
    await delay(250);
  }
  throw new Error(`Could not connect to browser DevTools page. ${lastError?.message ?? ''}\n${debugOutput?.() ?? ''}`);
}

async function navigate(page, url) {
  await page.send('Page.navigate', { url });
  await waitForExpression(page, `document.readyState === 'complete' || document.readyState === 'interactive'`, 15_000);
}

async function waitForExpression(page, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await evaluateValue(page, `() => (${expression})`);
    if (result) return;
    await delay(150);
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function settle(page) {
  await evaluateValue(page, `async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 350));
    return true;
  }`);
}

async function saveScreenshot(page, path) {
  const screenshot = await page.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true,
  });
  await writeFile(path, Buffer.from(screenshot.data, 'base64'));
}

async function evaluateValue(page, functionSource) {
  const wrapped = `(${functionSource})()`;
  const result = await page.send('Runtime.evaluate', {
    expression: wrapped,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? 'Runtime evaluation failed.');
  }
  return result.result?.value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function CdpPage(webSocketUrl) {
  this.webSocket = new WebSocket(webSocketUrl);
  this.nextId = 1;
  this.pending = new Map();
  this.ready = new Promise((resolve, reject) => {
    this.webSocket.addEventListener('open', resolve, { once: true });
    this.webSocket.addEventListener('error', () => reject(new Error(`Could not open DevTools WebSocket: ${webSocketUrl}`)), { once: true });
  });
  this.ready.catch(() => undefined);
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
}
