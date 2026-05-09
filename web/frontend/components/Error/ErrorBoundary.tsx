// web/frontend/components/ErrorBoundary.tsx
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Banner, InlineStack, Text } from '@shopify/polaris';
import { getAuthenticatedFetch } from '../../hooks/useAuthenticatedFetch';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  context?: string; // e.g. "Export Table" or "Dashboard" for a more descriptive message
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  retryCount: number;
  reported: boolean;
}

const MAX_RETRY = 3;

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: undefined,
    retryCount: 0,
    reported: false,
  };

  // Called when a child throws—sets the error state
  public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  // Called after the error is thrown; we log/report once here
  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in ErrorBoundary:', error, errorInfo);

    // Only report once per error instance
    if (
      process.env.NODE_ENV === 'production' &&
      this.state.hasError &&
      !this.state.reported
    ) {
      this.reportError(error, errorInfo);
      this.setState({ reported: true });
    }
  }

  // Retry button handler
  public retry = () => {
    this.setState((prev: ErrorBoundaryState): ErrorBoundaryState => {
      const nextCount = prev.retryCount + 1;
      if (nextCount >= MAX_RETRY) {
        // If they've hit the limit, keep hasError true so banner stays up with "Multiple attempts failed" text
        return { 
          ...prev,
          retryCount: nextCount 
        };
      }
      // Clear the error and keep going
      return { 
        hasError: false, 
        error: undefined, 
        retryCount: nextCount, 
        reported: false 
      };
    });
  };

  // Report to your own logging endpoint
  private async reportError(error: Error, errorInfo: ErrorInfo) {
    try {
      await getAuthenticatedFetch()('/api/log-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: error.message,
          stack: error.stack,
          componentInlineStack: errorInfo.componentInlineStack,
          context: this.props.context || 'Unknown context',
          retryCount: this.state.retryCount,
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
        }),
      });
    } catch (e) {
      // Never throw from within componentDidCatch
      console.warn('Failed to report error:', e);
    }
  }

  public render() {
    const { children, fallback, context } = this.props;
    const { hasError, error, retryCount } = this.state;
    const isDev = process.env.NODE_ENV === 'development';

    if (hasError) {
      // If a custom fallback is provided, render it (no retry button shown)
      if (fallback) {
        return <>{fallback}</>;
      }

      // Determine if we can still retry
      const canRetry = retryCount < MAX_RETRY;

      // Build a clear context message
      const contextMsg = context
        ? `An error occurred in "${context}". Please try again.`
        : 'An unexpected error occurred. Please try again.';

      return (
        <Banner
          status="critical"
          action={
            canRetry
              ? {
                  content: `Try Again (${retryCount + 1}/${MAX_RETRY})`,
                  onAction: this.retry,
                }
              : undefined
          }
        >
          <InlineStack vertical spacing="tight">
            <Text variant="bodyMd" as="p">{contextMsg}</Text>

            {!canRetry && (
              <Text variant="bodySm" as="p" color="subdued">
                You've reached the maximum retry attempts. Please refresh the page or contact
                support.
              </Text>
            )}

            {isDev && error && (
              <details>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                  Error Details (Dev Only)
                </summary>
                <pre
                  style={{
                    fontSize: '0.8rem',
                    padding: '1rem',
                    backgroundColor: '#f6f6f7',
                    borderRadius: '4px',
                    overflow: 'auto',
                  }}
                >
                  {error.stack}
                </pre>
              </details>
            )}
          </InlineStack>
        </Banner>
      );
    }

    return <>{children}</>;
  }
}

export default ErrorBoundary;
