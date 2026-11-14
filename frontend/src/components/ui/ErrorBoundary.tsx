import React from 'react';
import { ErrorState } from './States';

interface Props {
  children: React.ReactNode;
  message?: string;
  subtext?: string;
  height?: string;
}

interface State {
  error: Error | null;
}

/**
 * Keeps one failing panel (e.g. the map when WebGL is unavailable) from
 * blanking the whole page. Everything outside the boundary keeps rendering.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', error);
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorState
          height={this.props.height}
          message={this.props.message ?? 'This panel failed to load'}
          subtext={this.props.subtext ?? this.state.error.message.slice(0, 160)}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}
