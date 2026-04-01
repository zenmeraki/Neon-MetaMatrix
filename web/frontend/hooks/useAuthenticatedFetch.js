// web/frontend/hooks/useAuthenticatedFetch.js

import { useAppBridge } from '@shopify/app-bridge-react';
import { authenticatedFetch } from '@shopify/app-bridge/utilities';
import { useCallback, useMemo } from "react";
import { openTopLevelUrl } from "../utils/embeddedNavigation";

/**
 * Returns an authenticated fetch function that includes the session token.
 * Automatically handles Shopify's reauthentication flow.
 */
export function useAuthenticatedFetch() {
  const app = useAppBridge();

  const fetchFunction = useMemo(() => authenticatedFetch(app), [app]);

  return useCallback(async (uri, options = {}) => {
    const response = await fetchFunction(uri, options);

    // Check for reauthentication header
    if (
      response.headers.get('X-Shopify-API-Request-Failure-Reauthorize') === '1'
    ) {
      const redirectUrl = response.headers.get(
        'X-Shopify-API-Request-Failure-Reauthorize-Url'
      );

      if (redirectUrl) {
        openTopLevelUrl(redirectUrl);
        return null;
      }
    }

    return response;
  }, [fetchFunction]);
}
