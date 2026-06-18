import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const devPort = Number((process.env.SCIEMD_STYLE_VALIDATE_DEV_PORT ?? process.env.SCIE_MD_STYLE_VALIDATE_DEV_PORT) ?? 5191);
const cdpPort = Number((process.env.SCIEMD_STYLE_VALIDATE_CDP_PORT ?? process.env.SCIE_MD_STYLE_VALIDATE_CDP_PORT) ?? 9331);
const browserPath = resolveBrowserPath();
const browserUserDataDir = resolve('tmp', `style-validation-browser-${process.pid}`);

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
vite.stdout.on('data', (chunk) => {
  viteOutput += chunk.toString();
});
vite.stderr.on('data', (chunk) => {
  viteOutput += chunk.toString();
});

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
browser.stderr.on('data', (chunk) => {
  browserErrorOutput += chunk.toString();
});

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
        documentType: 'report',
        onboardingComplete: true,
        inkscapePath: null
      }));
      localStorage.setItem('scienfy.markdown.settings.scieSansDefaultMigrated', 'true');
    `,
  });
  await page.send('Page.navigate', { url: `http://127.0.0.1:${devPort}/` });
  await waitForExpression(page, `Boolean(document.querySelector('.editor-stage'))`, 15_000);
  await delay(500);

  const samples = [];
  for (const style of ['scienfy', 'science', 'nature']) {
    samples.push(await sampleStyle(page, style));
  }

  assertStyle(samples, 'science', {
    contentWidth: '980px',
    bodySize: '19.25px',
    h1: '48px',
    h2: '29px',
    lineHeight: '1.5',
    accent: '#b82024',
  });
  assertStyle(samples, 'nature', {
    contentWidth: '920px',
    bodySize: '18.5px',
    h1: '42px',
    h2: '25px',
    lineHeight: '1.6',
    accent: '#006f9f',
  });

  console.log(JSON.stringify({ ok: true, samples }, null, 2));
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
  throw new Error('Could not find Edge or Chrome for style validation.');
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
    const result = await page.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
    });
    if (result.result.value) return;
    await delay(200);
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function sampleStyle(page, style) {
  const result = await page.send('Runtime.evaluate', {
    expression: `(() => {
      document.documentElement.setAttribute('data-visual-style', ${JSON.stringify(style)});
      document.documentElement.setAttribute('data-theme', 'light');
      const root = getComputedStyle(document.documentElement);
      return {
        style: document.documentElement.getAttribute('data-visual-style'),
        contentWidth: root.getPropertyValue('--content-width').trim(),
        bodySize: root.getPropertyValue('--document-body-size').trim(),
        h1: root.getPropertyValue('--document-h1-size').trim(),
        h2: root.getPropertyValue('--document-h2-size').trim(),
        lineHeight: root.getPropertyValue('--editor-line-height').trim(),
        accent: root.getPropertyValue('--accent').trim(),
        bg: root.getPropertyValue('--bg').trim()
      };
    })()`,
    returnByValue: true,
  });
  return result.result.value;
}

function assertStyle(samples, style, expected) {
  const sample = samples.find((item) => item.style === style);
  if (!sample) throw new Error(`Missing ${style} style sample.`);
  for (const [key, value] of Object.entries(expected)) {
    if (sample[key].toLowerCase() !== value.toLowerCase()) {
      throw new Error(`${style} ${key} expected ${value}, got ${sample[key]}`);
    }
  }
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
