import { useCallback, useEffect } from 'react';

let registeredAuthenticatedFetch = fetch;

export function getAuthenticatedFetch() {
  return registeredAuthenticatedFetch;
}

/**
 * Returns the app fetch wrapper for Shopify-authenticated API routes.
 * The backend validates the embedded app session and this wrapper handles
 * Shopify's reauthentication response headers.
 */
export function useAuthenticatedFetch() {
  const wrappedFetch = useCallback(async (uri, options = {}) => {
    const response = await fetch(uri, options);

    // Check for reauthentication header
    if (
      response.headers.get('X-Shopify-API-Request-Failure-Reauthorize') === '1'
    ) {
      const redirectUrl = response.headers.get(
        'X-Shopify-API-Request-Failure-Reauthorize-Url'
      );

      if (redirectUrl) {
        // Force redirect to re-auth flow
        window.location.assign(redirectUrl);
        return null;
      }
    }

    return response;
  }, []);

  useEffect(() => {
    registeredAuthenticatedFetch = wrappedFetch;

    return () => {
      if (registeredAuthenticatedFetch === wrappedFetch) {
        registeredAuthenticatedFetch = fetch;
      }
    };
  }, [wrappedFetch]);

  return wrappedFetch;
}
