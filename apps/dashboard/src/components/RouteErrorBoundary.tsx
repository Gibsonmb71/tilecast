import { Component, type ReactNode } from "react";

type State = { error?: Error };

/**
 * Catches render errors from the routed page so a crash shows an inline
 * notice instead of unmounting the whole app. Remount with a location key
 * so navigating away (including the browser back button) recovers.
 */
export class RouteErrorBoundary extends Component<
  { children: ReactNode },
  State
> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="notice notice--error" role="alert">
          <strong>This page could not be displayed.</strong>
          <p>
            {this.state.error.message ||
              "An unexpected error occurred while rendering this page."}
          </p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => this.setState({ error: undefined })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
