import type { WebviewToExtensionMessage } from '../shared/webviewProtocol';

interface VsCodeWebviewApi {
  postMessage(message: WebviewToExtensionMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeWebviewApi;
  }
}

export const vscodeApi: VsCodeWebviewApi = window.acquireVsCodeApi
  ? window.acquireVsCodeApi()
  : {
      postMessage(message: WebviewToExtensionMessage) {
        console.log('VS Code API unavailable; message ignored', message);
      },
      getState() {
        return undefined;
      },
      setState() {
        return undefined;
      },
    };
