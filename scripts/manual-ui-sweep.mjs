import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const devPort = Number((process.env.SCIEMD_SWEEP_DEV_PORT ?? process.env.SCIE_MD_SWEEP_DEV_PORT) ?? 5193);
const cdpPort = Number((process.env.SCIEMD_SWEEP_CDP_PORT ?? process.env.SCIE_MD_SWEEP_CDP_PORT) ?? 9333);
const outputDir = resolve('output', 'ui-sweep');
const browserPath = resolveBrowserPath();
const browserUserDataDir = resolve('tmp', `ui-sweep-browser-${process.pid}`);
const screenshots = [];

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

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
  await waitForHttp(`http://127.0.0.1:${devPort}/`, 'Vite dev server');
  const page = await connectToFirstPage(cdpPort);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Page.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
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
  await waitForExpression(page, `Boolean(document.querySelector('.editor-stage'))`, 15_000);
  await delay(750);
  await capture(page, '01-start-editor', 'Initial editor with topbar, toolbar, sidebar, visual page, status bar');

  await clickButtonText(page, 'File');
  await waitForExpression(page, `Boolean(document.querySelector('.app-menu-file'))`, 5_000);
  await capture(page, '02-file-menu', 'File menu: document lifecycle, recent files, export, print');

  await clickButtonText(page, 'View');
  await waitForExpression(page, `Boolean(document.querySelector('.app-menu-view'))`, 5_000);
  await capture(page, '03-view-menu', 'View menu: modes, panels, theme, visual style, width, font controls');

  await pressEscape(page);
  await clickAria(page, 'Command Palette');
  await waitForExpression(page, `Boolean(document.querySelector('.command-palette'))`, 5_000);
  await assertText(page, '.command-palette', ['Open insert menu', 'Open templates', 'Open settings', 'Open quick tour']);
  await capture(page, '04-command-palette', 'Command palette discovery layer');

  await clickAria(page, 'Close command palette');
  await waitForExpression(page, `!document.querySelector('.command-palette')`, 5_000);
  await clickAria(page, 'Insert menu');
  await waitForExpression(page, `Boolean(document.querySelector('.slash-menu'))`, 5_000);
  await assertText(page, '.slash-menu', ['Block', 'Table', 'Citation', 'Variable']);
  await assertNotText(page, '.slash-menu', ['Callout block']);
  await capture(page, '05-slash-root', 'Slash menu root keeps block types nested');

  await clickButtonStartingWith(page, 'Block');
  await waitForExpression(page, `(document.querySelector('.slash-menu')?.textContent ?? '').includes('Callout block')`, 5_000);
  await assertText(page, '.slash-menu', ['Callout block', 'Tip block', 'Important block', 'Warning block']);
  await capture(page, '06-slash-block-gallery', 'Nested block gallery with preview rows');

  await pressEscape(page);
  await clickButtonText(page, 'Tools');
  await clickButtonText(page, 'Settings...');
  await waitForExpression(page, `Boolean(document.querySelector('.settings-dialog'))`, 5_000);
  await capture(page, '07-settings-dialog', 'Settings dialog: appearance, writing defaults, local tools');

  await pressEscape(page);
  await clickButtonText(page, 'File');
  await clickButtonText(page, 'New from Template...');
  await waitForExpression(page, `Boolean(document.querySelector('.template-dialog'))`, 5_000);
  await assertText(page, '.template-dialog', ['Scientific paper', 'Research statement', 'Lab note']);
  await capture(page, '08-template-dialog', 'Template gallery with preview cards');

  await pressEscape(page);
  await clickButtonText(page, 'File');
  await clickButtonText(page, 'PDF...');
  await waitForExpression(page, `Boolean(document.querySelector('.export-dialog'))`, 5_000);
  await assertText(page, '.export-dialog', ['Export PDF', 'Paper size', 'Margins', 'Page numbers']);
  await capture(page, '09-export-pdf-dialog', 'PDF export options');

  await pressEscape(page);
  await clickSelector(page, '.status-readiness');
  await waitForExpression(page, `Boolean(document.querySelector('.inspector-pane'))`, 5_000);
  await capture(page, '10-inspector-readiness', 'Status readiness opens the inspector at review context');

  await clickButtonText(page, 'Source');
  await waitForExpression(page, `Boolean(document.querySelector('.cm-editor'))`, 5_000);
  await capture(page, '11-source-mode', 'Source mode switch preserves app shell and editing surface');

  await clickButtonText(page, 'Visual');
  await waitForExpression(page, `Boolean(document.querySelector('.visual-editor .ProseMirror'))`, 5_000);
  await clickButtonText(page, 'References');
  await clickButtonText(page, 'Manage Citations...');
  await waitForExpression(page, `Boolean(document.querySelector('.citation-dialog'))`, 5_000);
  await capture(page, '12-citation-dialog', 'Citation manager opens from References');

  await pressEscape(page);
  await clickAria(page, 'Variable');
  await waitForExpression(page, `Boolean(document.querySelector('.variable-dialog'))`, 5_000);
  await capture(page, '13-variable-dialog', 'Variable create/insert workflow');

  await pressEscape(page);
  await clickAria(page, 'LLM note');
  await waitForExpression(page, `Boolean(document.querySelector('.dialog'))`, 5_000);
  await assertText(page, '.dialog', ['Insert LLM note', 'Note for the LLM']);
  await capture(page, '14-llm-note-prompt', 'LLM note prompt workflow');

  const summary = {
    ok: true,
    screenshotDir: outputDir,
    screenshots,
    checks: {
      editorMounted: await evaluate(page, `Boolean(document.querySelector('.editor-stage .visual-editor .ProseMirror, .cm-editor'))`),
      commandPalette: true,
      slashNestedBlocks: true,
      settingsDialog: true,
      templatesDialog: true,
      exportDialog: true,
      inspectorStatusRoute: true,
      sourceMode: true,
      citationDialog: true,
      variableDialog: true,
      llmNotePrompt: true,
    },
  };
  writeFileSync(join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  browser.kill();
  vite.kill();
  await Promise.allSettled([
    waitForExit(browser, 5_000),
    waitForExit(vite, 5_000),
  ]);
  rmSync(browserUserDataDir, { recursive: true, force: true });
}

async function capture(page, name, description) {
  await delay(250);
  const result = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = join(outputDir, `${name}.png`);
  writeFileSync(file, Buffer.from(result.data, 'base64'));
  screenshots.push({ name, description, file });
}

async function clickAria(page, ariaLabel) {
  const clicked = await evaluate(page, `(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) => item.getAttribute('aria-label') === ${JSON.stringify(ariaLabel)});
    button?.click();
    return Boolean(button);
  })()`);
  if (!clicked) throw new Error(`Could not find button with aria-label "${ariaLabel}".`);
}

async function clickButtonText(page, text) {
  const clicked = await evaluate(page, `(() => {
    const target = ${JSON.stringify(text)};
    const button = Array.from(document.querySelectorAll('button')).find((item) => (item.textContent ?? '').trim() === target);
    button?.click();
    return Boolean(button);
  })()`);
  if (!clicked) throw new Error(`Could not find button text "${text}".`);
  await delay(200);
}

async function clickButtonStartingWith(page, text) {
  const clicked = await evaluate(page, `(() => {
    const target = ${JSON.stringify(text)};
    const button = Array.from(document.querySelectorAll('button')).find((item) => (item.textContent ?? '').trim().startsWith(target));
    button?.click();
    return Boolean(button);
  })()`);
  if (!clicked) throw new Error(`Could not find button starting with "${text}".`);
  await delay(200);
}

async function clickSelector(page, selector) {
  const clicked = await evaluate(page, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element?.click();
    return Boolean(element);
  })()`);
  if (!clicked) throw new Error(`Could not click selector ${selector}.`);
}

async function pressEscape(page) {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await delay(250);
}

async function assertText(page, selector, expectedTexts) {
  const text = await evaluate(page, `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);
  for (const expected of expectedTexts) {
    if (!text.includes(expected)) throw new Error(`${selector} is missing expected text "${expected}". Actual text: ${text.slice(0, 500)}`);
  }
}

async function assertNotText(page, selector, blockedTexts) {
  const text = await evaluate(page, `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);
  for (const blocked of blockedTexts) {
    if (text.includes(blocked)) throw new Error(`${selector} unexpectedly includes "${blocked}".`);
  }
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
  throw new Error('Could not find Edge or Chrome for UI sweep.');
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
  const debug = await evaluate(page, `JSON.stringify({
    href: location.href,
    title: document.title,
    body: document.body?.innerText?.slice(0, 500) ?? '',
    root: document.querySelector('#root')?.innerHTML?.slice(0, 500) ?? ''
  })`);
  throw new Error(`Timed out waiting for expression: ${expression}\n${debug}`);
}

async function evaluate(page, expression) {
  const result = await page.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'Browser evaluation failed.');
  return result.result.value;
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
