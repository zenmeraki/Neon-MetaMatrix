import { useAppBridge } from '@shopify/app-bridge-react';

async function appBridgeFetch(shopify, uri, options = {}) {
  const token = await shopify.idToken();
  const headers = new Headers(options.headers || {});

  headers.set('Authorization', `Bearer ${token}`);
  headers.set('X-Requested-With', 'XMLHttpRequest');

  const response = await fetch(uri, {
    ...options,
    headers,
  });

  if (
    response.headers.get('X-Shopify-API-Request-Failure-Reauthorize') === '1'
  ) {
    const redirectUrl = response.headers.get(
      'X-Shopify-API-Request-Failure-Reauthorize-Url'
    );

    if (redirectUrl) {
      window.top.location.href = redirectUrl;
      return null;
    }
  }

  return response;
}

export function createAuthenticatedFetch(shopify) {
  return (uri, options = {}) => appBridgeFetch(shopify, uri, options);
}

/**
 * Returns an authenticated fetch function that includes the session token.
 * Automatically handles Shopify's reauthentication flow.
 */
export function useAuthenticatedFetch() {
  const shopify = useAppBridge();

  return (uri, options = {}) => appBridgeFetch(shopify, uri, options);
}
