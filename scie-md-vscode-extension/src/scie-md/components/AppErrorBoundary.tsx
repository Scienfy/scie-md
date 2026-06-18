import { Component, type ReactNode } from 'react';
import {
  exportRawDocumentRescueMarkdown,
  hasRawDocumentRescueMarkdown,
  requestPlainSourceMode,
} from '../services/rawDocumentRescue';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
  repeatedErrorCount: number;
  lastErrorSignature: string;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null, repeatedErrorCount: 0, lastErrorSignature: '' };

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error };
  }

  componentDidMount() {
    window.addEventListener('error', this.handleWindowError);
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  componentWillUnmount() {
    window.removeEventListener('error', this.handleWindowError);
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  componentDidCatch(error: Error) {
    console.error(error);
    this.captureError(error);
  }

  private handleWindowError = (event: ErrorEvent) => {
    const error = event.error instanceof Error ? event.error : new Error(event.message || 'Unexpected app error.');
    console.error('Unhandled window error:', error);
    this.captureError(error);
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const error = reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'Unexpected async app error.');
    console.error('Unhandled promise rejection:', error);
    this.captureError(error);
  };

  private captureError(error: Error) {
    const signature = errorSignature(error);
    this.setState((state) => ({
      error,
      lastErrorSignature: signature,
      repeatedErrorCount: state.lastErrorSignature === signature
        ? state.repeatedErrorCount + 1
        : 1,
    }));
  };

  private reset = () => {
    this.setState({ error: null });
  };

  private openPlainSourceMode = () => {
    requestPlainSourceMode();
    this.reset();
  };

  private exportRawMarkdown = () => {
    if (!exportRawDocumentRescueMarkdown()) {
      window.alert('No raw Markdown recovery snapshot is available.');
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    const canReturnToApp = this.state.repeatedErrorCount < 2;
    const canExportRawMarkdown = hasRawDocumentRescueMarkdown();

    return (
      <main className="app-error-screen">
        <section>
          <h1>ScieMD recovered an app error</h1>
          <p>
            The editor hit an unexpected error. Your saved files are still on disk. You can return in source mode or export the latest raw Markdown snapshot before reloading.
          </p>
          <pre>{this.state.error.message}</pre>
          <div className="app-error-actions">
            <button type="button" onClick={this.openPlainSourceMode}>Open plain source mode</button>
            <button type="button" onClick={this.exportRawMarkdown} disabled={!canExportRawMarkdown}>Export raw markdown</button>
            {canReturnToApp ? <button type="button" onClick={this.reset}>Return to app</button> : null}
            <button type="button" className="primary" onClick={() => window.location.reload()}>Reload app</button>
          </div>
        </section>
      </main>
    );
  }
}

function errorSignature(error: Error): string {
  return `${error.name}:${error.message}:${(error.stack ?? '').split('\n').slice(0, 3).join('\n')}`;
}
