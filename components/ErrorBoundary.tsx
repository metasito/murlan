import React, { Component, PropsWithChildren } from "react";
import { ErrorFallback } from "@/components/ErrorFallback";
import { reportError } from "@/lib/errorReporting";

type ErrorBoundaryState = { error: Error | null };

/**
 * This is a special case for for using the class components. Error boundaries must be class components because React only provides error boundary functionality through lifecycle methods (componentDidCatch and getDerivedStateFromError) which are not available in functional components.
 * https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
 */

export class ErrorBoundary extends Component<PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    console.error(
      "[ErrorBoundary] Caught render error:",
      error.message,
      "\n",
      error.stack ?? "(no stack)",
      "\nComponent stack:",
      info.componentStack
    );
    // Reported from here rather than the fallback because this is the only
    // place that has the component stack. Deduplicated against the global
    // handlers, which see the same Error object first.
    reportError(error, info.componentStack);
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  render() {
    return this.state.error ? (
      <ErrorFallback error={this.state.error} resetError={this.resetError} />
    ) : (
      this.props.children
    );
  }
}
