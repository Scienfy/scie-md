import { Component, type ErrorInfo, type ReactNode } from 'react';
import { exportRawDocumentRescueMarkdown } from '../services/rawDocumentRescue';
import { appendDiagnosticsEvent } from '../services/nativeRecoveryService';

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

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error);
    this.captureError(error);
    void appendDiagnosticsEvent({
      eventType: 'react-error-boundary',
      message: error.message,
      componentStack: info.componentStack,
    });
  }

  private handleWindowError = (event: ErrorEvent) => {
    const error = event.error instanceof Error ? event.error : new Error(event.message || 'Unexpected app error.');
    console.error('Unhandled window error:', error);
    void appendDiagnosticsEvent({
      eventType: 'window-error',
      message: error.message,
      componentStack: error.stack ?? null,
    });
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const error = reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'Unexpected async app error.');
    console.error('Unhandled promise rejection:', error);
    void appendDiagnosticsEvent({
      eventType: 'unhandled-rejection',
      message: error.message,
      componentStack: error.stack ?? null,
    });
    event.preventDefault();
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

  private exportRawMarkdown = () => {
    void exportRawDocumentRescueMarkdown().then((exported) => {
      if (!exported) {
        window.alert('No raw Markdown recovery snapshot is available.');
      }
    });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-error-screen">
        <section>
          <h1>ScieMD recovered an app error</h1>
          <p>
            The editor hit an unexpected error. Your saved files are still on disk. You can return to the visual editor or export the latest raw Markdown snapshot before reloading.
          </p>
          <pre>{this.state.error.message}</pre>
          <div className="app-error-actions">
            <button type="button" onClick={this.reset}>Return to visual editor</button>
            <button type="button" onClick={this.exportRawMarkdown}>Export raw markdown</button>
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
