import { authenticatedFetch } from "@shopify/app-bridge/utilities";

const REAUTHORIZE_HEADER = "X-Shopify-API-Request-Failure-Reauthorize";
const REAUTHORIZE_URL_HEADER = "X-Shopify-API-Request-Failure-Reauthorize-Url";

export function shouldAuthenticateRequest(input) {
  if (typeof window === "undefined") return false;

  const url =
    input instanceof Request
      ? input.url
      : typeof input === "string" || input instanceof URL
        ? input.toString()
        : "";

  if (!url) return false;

  const parsedUrl = new URL(url, window.location.href);

  return (
    parsedUrl.origin === window.location.origin &&
    parsedUrl.pathname.startsWith("/api/") &&
    !parsedUrl.pathname.startsWith("/api/auth/") &&
    parsedUrl.pathname !== "/api/auth" &&
    parsedUrl.pathname !== "/api/webhooks"
  );
}

export function hasAuthorizationHeader(input, options = {}) {
  const headers = new Headers(options.headers || input?.headers);
  return headers.has("Authorization");
}

async function getSessionToken(shopify) {
  if (typeof shopify?.idToken === "function") {
    return shopify.idToken();
  }

  return null;
}

function redirectForReauthorization(response) {
  if (response.headers.get(REAUTHORIZE_HEADER) !== "1") return;

  const redirectUrl = response.headers.get(REAUTHORIZE_URL_HEADER);
  if (redirectUrl) {
    window.location.assign(redirectUrl);
  }
}

export function createShopifyAuthenticatedFetch(shopify, fetchOperation = fetch) {
  const legacyAuthenticatedFetch = shopify
    ? authenticatedFetch(shopify, fetchOperation)
    : null;

  return async function shopifyAuthenticatedFetch(input, options = {}) {
    if (
      !shopify ||
      !shouldAuthenticateRequest(input) ||
      hasAuthorizationHeader(input, options)
    ) {
      return fetchOperation(input, options);
    }

    const token = await getSessionToken(shopify);

    if (token) {
      const headers = new Headers(options.headers || input?.headers);
      headers.set("Authorization", `Bearer ${token}`);
      headers.set("X-Requested-With", "XMLHttpRequest");

      const response = await fetchOperation(input, {
        ...options,
        headers,
      });

      redirectForReauthorization(response);
      return response;
    }

    const response = await legacyAuthenticatedFetch(input, options);
    redirectForReauthorization(response);
    return response;
  };
}
