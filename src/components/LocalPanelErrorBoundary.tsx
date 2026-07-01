import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface LocalPanelErrorBoundaryProps {
  children: ReactNode;
  label: string;
  resetKey: string;
  onError?: (error: Error) => void;
}

interface LocalPanelErrorBoundaryState {
  error: Error | null;
}

export class LocalPanelErrorBoundary extends Component<LocalPanelErrorBoundaryProps, LocalPanelErrorBoundaryState> {
  state: LocalPanelErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): LocalPanelErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
    this.props.onError?.(error);
  }

  componentDidUpdate(previousProps: LocalPanelErrorBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="local-panel-error" role="alert" aria-live="polite">
        <div>
          <AlertTriangle size={16} />
          <strong>{this.props.label} could not render.</strong>
        </div>
        <p>{this.state.error.message || 'This panel failed locally. The editor and source text remain available.'}</p>
        <button type="button" onClick={this.reset}>Retry panel</button>
      </section>
    );
  }
}
