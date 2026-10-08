import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { en } from "../i18n/en";

interface State {
  error: Error | null;
}

/** Last line of defence: a bug in one page shows a message and a way out, not a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("render error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-box" role="alert">
        <h1>{en.errors.crashTitle}</h1>
        <p>{en.errors.crashHelp}</p>
        <p>
          <button type="button" className="btn" onClick={() => location.reload()}>{en.errors.reload}</button>
        </p>
        <details>
          <summary>{en.errors.details}</summary>
          <pre style={{ whiteSpace: "pre-wrap" }}>{error.message}</pre>
        </details>
      </div>
    );
  }
}
