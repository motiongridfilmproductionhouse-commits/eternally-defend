import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallback: ReactNode;
  label?: string;
};

type State = {
  hasError: boolean;
};

/**
 * Keeps the intelligence console mounted when a child visualization throws
 * (e.g. chart measurement). Never logs raw provider/finding payloads.
 */
export class ResultsConsoleErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.warn(
        `[deepfake-intel] ${this.props.label ?? "ResultsIntelligenceConsole"} child failed:`,
        error?.name || "Error",
        error?.message || "unknown",
      );
    }
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}
