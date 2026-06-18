import { Component, type ReactNode } from 'react';

interface EditorErrorBoundaryProps {
  children: ReactNode;
  resetKey: string;
  fallback: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error) => void;
}

interface EditorErrorBoundaryState {
  error: Error | null;
}

export class EditorErrorBoundary extends Component<EditorErrorBoundaryProps, EditorErrorBoundaryState> {
  state: EditorErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): EditorErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
    this.props.onError?.(error);
  }

  componentDidUpdate(previousProps: EditorErrorBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error, this.reset);
    }

    return this.props.children;
  }
}
