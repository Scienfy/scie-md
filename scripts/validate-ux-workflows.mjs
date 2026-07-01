import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const devPort = Number((process.env.SCIEMD_UX_VALIDATE_DEV_PORT ?? process.env.SCIE_MD_UX_VALIDATE_DEV_PORT) ?? 5192);
const cdpPort = Number((process.env.SCIEMD_UX_VALIDATE_CDP_PORT ?? process.env.SCIE_MD_UX_VALIDATE_CDP_PORT) ?? 9332);
const browserPath = resolveBrowserPath();
const browserUserDataDir = resolve('tmp', `ux-validation-browser-${process.pid}`);

const vite = spawn(process.execPath, [
  resolve('node_modules', 'vite', 'bin', 'vite.js'),
  'preview',
  '--host',
  '127.0.0.1',
  '--port',
  String(devPort),
  '--strictPort',
], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let viteOutput = '';
vite.stdout.on('data', (chunk) => { viteOutput += chunk.toString(); });
vite.stderr.on('data', (chunk) => { viteOutput += chunk.toString(); });

rmSync(browserUserDataDir, { recursive: true, force: true });
mkdirSync(browserUserDataDir, { recursive: true });

const browser = spawn(browserPath, [
  '--headless=new',
  `--remote-debugging-port=${cdpPort}`,
  '--remote-allow-origins=*',
  `--user-data-dir=${browserUserDataDir}`,
  '--no-first-run',
  '--disable-extensions',
  '--window-size=1440,1000',
  'about:blank',
], {
  stdio: ['ignore', 'ignore', 'pipe'],
});

let browserErrorOutput = '';
browser.stderr.on('data', (chunk) => { browserErrorOutput += chunk.toString(); });

try {
  await waitForHttp(`http://127.0.0.1:${devPort}/`, 'Vite preview server');
  const page = await connectToFirstPage(cdpPort);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      localStorage.setItem('scienfy.markdown.settings.v1', JSON.stringify({
        recentFiles: [],
        themeMode: 'light',
        fontScale: 1,
        visualStyle: 'scienfy',
        outlineOpen: true,
        sidebarView: 'outline',
        explorerRootPath: null,
        inspectorOpen: false,
        authorshipVisible: true,
        focusMode: false,
        documentType: 'paper',
        onboardingComplete: true,
        inkscapePath: null
      }));
      localStorage.setItem('scienfy.markdown.settings.scieSansDefaultMigrated', 'true');
    `,
  });
  await page.send('Page.navigate', { url: `http://127.0.0.1:${devPort}/` });
  await waitForExpression(page, `Boolean(document.querySelector('.editor-stage') && document.querySelector('.app-menubar'))`, 15_000);
  await delay(750);

  const paletteResult = await evaluate(page, `(() => {
    const commandButton = Array.from(document.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === 'Command Palette');
    commandButton?.click();
    return Boolean(commandButton);
  })()`);
  if (!paletteResult) throw new Error('Command palette quick action was not found.');
  await waitForExpression(page, `Boolean(document.querySelector('.command-palette'))`, 5_000);
  if (!await commandPaletteHas(page, 'Open insert menu')) {
    const createdMarkdown = await runCommandPaletteCommand(page, 'New Markdown');
    if (!createdMarkdown) throw new Error('Could not create a Markdown document before command-palette validation.');
    await waitForExpression(page, `!document.querySelector('.command-palette')`, 5_000);
    await delay(500);
    const reopenedPalette = await evaluate(page, `(() => {
      const commandButton = Array.from(document.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === 'Command Palette');
      commandButton?.click();
      return Boolean(commandButton);
    })()`);
    if (!reopenedPalette) throw new Error('Command palette quick action was not found after creating Markdown document.');
    await waitForExpression(page, `Boolean(document.querySelector('.command-palette'))`, 5_000);
  }
  for (const expected of ['Open insert menu', 'New document', 'Open settings', 'Open quick tour', 'Open full tutorial', 'Check external tools']) {
    if (!await commandPaletteHas(page, expected)) throw new Error(`Command palette is missing "${expected}".`);
  }

  const readinessOpened = await evaluate(page, `(() => {
    document.querySelector('[aria-label="Close command palette"]')?.click();
    const readiness = document.querySelector('.status-readiness');
    readiness?.click();
    return Boolean(readiness);
  })()`);
  if (!readinessOpened) throw new Error('Readiness indicator was not found.');
  await waitForExpression(page, `Boolean(document.querySelector('.inspector-pane'))`, 5_000);

  const insertMenuOpened = await evaluate(page, `(() => {
    const insertButton = Array.from(document.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === 'Insert menu');
    insertButton?.click();
    return Boolean(insertButton);
  })()`);
  if (!insertMenuOpened) throw new Error('Insert quick action was not found.');
  await waitForExpression(page, `Boolean(document.querySelector('.slash-menu'))`, 5_000);
  const slashText = await evaluate(page, `document.querySelector('.slash-menu')?.textContent ?? ''`);
  if (!slashText.includes('Block') || slashText.includes('Callout block')) {
    throw new Error('Slash menu root should expose Block but keep individual block types nested.');
  }

  console.log(JSON.stringify({
    ok: true,
    commandPalette: ['Open insert menu', 'New document', 'Open settings', 'Open quick tour', 'Open full tutorial', 'Check external tools'],
    readinessOpensInspector: readinessOpened,
    slashRootKeepsBlocksNested: true,
  }, null, 2));
} finally {
  browser.kill();
  vite.kill();
  await Promise.allSettled([
    waitForExit(browser, 5_000),
    waitForExit(vite, 5_000),
  ]);
  rmSync(browserUserDataDir, { recursive: true, force: true });
}

function resolveBrowserPath() {
  const candidates = process.platform === 'win32'
    ? [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
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
  throw new Error('Could not find Edge or Chrome for UX validation.');
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

async function connectToFirstPage(port) {
  const deadline = Date.now() + 15_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const target = targets.find((item) => item.type === 'page') ?? targets[0];
      if (target?.webSocketDebuggerUrl) return createCdpClient(target.webSocketDebuggerUrl);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Could not connect to browser CDP. ${lastError?.message ?? ''}\n${browserErrorOutput}`);
}

async function createCdpClient(url) {
  const socket = new WebSocket(url);
  await new Promise((resolveSocket, rejectSocket) => {
    socket.addEventListener('open', resolveSocket, { once: true });
    socket.addEventListener('error', rejectSocket, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolveCommand, rejectCommand } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) rejectCommand(new Error(JSON.stringify(message.error)));
    else resolveCommand(message.result);
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolveCommand, rejectCommand) => {
        pending.set(id, { resolveCommand, rejectCommand });
      });
    },
  };
}

async function waitForExpression(page, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(page, expression)) return;
    await delay(200);
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function evaluate(page, expression) {
  const result = await page.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'Browser evaluation failed.');
  return result.result.value;
}

async function commandPaletteHas(page, label) {
  const query = JSON.stringify(label);
  await evaluate(page, `(() => {
    const input = document.querySelector('.command-palette input[aria-label="Search commands"]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${query});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await delay(150);
  return evaluate(page, `Array.from(document.querySelectorAll('.command-palette button')).some((button) => button.textContent?.includes(${query}))`);
}

async function runCommandPaletteCommand(page, label) {
  if (!await commandPaletteHas(page, label)) return false;
  const query = JSON.stringify(label);
  return evaluate(page, `(() => {
    const command = Array.from(document.querySelectorAll('.command-palette button')).find((button) => button.textContent?.includes(${query}));
    command?.click();
    return Boolean(command);
  })()`);
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => rejectExit(new Error('Timed out waiting for process exit.')), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
