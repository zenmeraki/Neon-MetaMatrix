// web/frontend/hooks/useAuthenticatedFetch.js

import { useAppBridge } from '@shopify/app-bridge-react';
import { authenticatedFetch } from '@shopify/app-bridge/utilities';
import { useCallback, useEffect } from 'react';

let registeredAuthenticatedFetch = fetch;

export function getAuthenticatedFetch() {
  return registeredAuthenticatedFetch;
}

/**
 * Returns an authenticated fetch function that includes the session token.
 * Automatically handles Shopify's reauthentication flow.
 */
export function useAuthenticatedFetch() {
  const app = useAppBridge();
  const fetchFunction = authenticatedFetch(app);

  const wrappedFetch = useCallback(async (uri, options = {}) => {
    const response = await fetchFunction(uri, options);

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
  }, [fetchFunction]);

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
