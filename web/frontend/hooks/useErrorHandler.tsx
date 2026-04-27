// web/frontend/hooks/useErrorHandler.tsx
import { useCallback } from 'react';

export function useErrorHandler(showError: (msg: string) => void) {
  return useCallback(
    (error: Error, context?: string) => {
      const errorMessage = context
        ? `Error in ${context}: ${error.message}`
        : error.message;

      console.error(context ? `Error in ${context}:` : 'Error:', error);

      showError(errorMessage);

      if (process.env.NODE_ENV === 'production' && (window as any).Sentry?.captureException) {
        (window as any).Sentry.captureException(error, { tags: { context } });
      }
    },
    [showError]
  );
}
