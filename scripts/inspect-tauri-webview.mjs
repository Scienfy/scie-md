const port = Number(process.argv[2] ?? 9231);

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
if (!target) throw new Error('No debuggable WebView page found.');

const page = new CdpPage(target.webSocketDebuggerUrl);
await page.ready;
await page.send('Runtime.enable');
const result = await page.evaluate(`() => ({
  href: location.href,
  title: document.title,
  keys: Object.keys(window).filter((key) => key.includes('TAURI')).sort(),
  internals: typeof window.__TAURI_INTERNALS__,
  tauri: typeof window.__TAURI__,
  invoke: typeof window.__TAURI_INTERNALS__?.invoke,
  ipc: typeof window.__TAURI_INTERNALS__?.ipc,
  body: document.body?.innerText?.slice(0, 120),
})`);
console.log(JSON.stringify(result, null, 2));
page.close();

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
      throw new Error(response.exceptionDetails.text ?? 'Runtime evaluation failed.');
    }
    return response.result?.value;
  };
  this.close = () => this.webSocket.close();
}
