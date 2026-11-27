import { Component, ErrorInfo, ReactNode } from 'react';
import { ErrorState } from './ui';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  public state: State = { hasError: false, message: '' };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || '视图渲染异常' };
  }

  public componentDidUpdate(prevProps: { children: ReactNode; resetKey?: string }) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, message: '' });
    }
  }

  public componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Error captured in boundary state for user recovery
  }

  public render() {
    if (this.state.hasError) {
      return (
        <ErrorState
          title="界面渲染发生错误"
          message={this.state.message}
          onRetry={() => this.setState({ hasError: false, message: '' })}
        />
      );
    }
    return this.props.children;
  }
}
