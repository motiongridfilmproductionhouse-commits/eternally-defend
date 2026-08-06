import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallback: ReactNode;
  label?: string;
  /** Change this (e.g. scanId) to clear a previous child failure. */
  resetKey?: string | number | null;
};

type State = {
  hasError: boolean;
  resetKey: string | number | null | undefined;
};

/**
 * Keeps the intelligence console mounted when a child visualization throws
 * (e.g. chart measurement). Never logs raw provider/finding payloads.
 */
export class ResultsConsoleErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    resetKey: this.props.resetKey,
  };

  static getDerivedStateFromError(): Pick<State, "hasError"> {
    return { hasError: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) {
      return { hasError: false, resetKey: props.resetKey };
    }
    return null;
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
