import { useAppBridge } from "@shopify/app-bridge-react";

function resolveAppBridgeInstance(shopify) {
  if (shopify) return shopify;
  if (typeof window !== "undefined" && window.shopify) return window.shopify;
  return null;
}

function isSameOriginRequest(uri) {
  if (typeof window === "undefined") return false;

  try {
    const url = new URL(uri, window.location.origin);
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
}

function getCurrentReturnTo() {
  if (typeof window === "undefined") {
    return "/";
  }

  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (!currentPath.startsWith("/") || currentPath.startsWith("//")) {
    return "/";
  }

  return currentPath;
}

export function buildAuthEntryUrl({ shop, host, returnTo } = {}) {
  if (typeof window === "undefined") {
    return "/api/auth";
  }

  const url = new URL("/api/auth", window.location.origin);
  const shopParam =
    typeof shop === "string" && shop.trim()
      ? shop.trim()
      : new URLSearchParams(window.location.search).get("shop");
  const hostParam =
    typeof host === "string" && host.trim()
      ? host.trim()
      : new URLSearchParams(window.location.search).get("host");
  const returnToParam =
    typeof returnTo === "string" && returnTo.trim()
      ? returnTo.trim()
      : getCurrentReturnTo();

  if (shopParam) {
    url.searchParams.set("shop", shopParam);
  }

  if (hostParam) {
    url.searchParams.set("host", hostParam);
  }

  if (returnToParam) {
    url.searchParams.set("returnTo", returnToParam);
  }

  return url.toString();
}

export function redirectToAuthWithReturnTo(options = {}) {
  redirectToTopLevel(buildAuthEntryUrl(options));
}

function buildTopLevelRedirectUrl(url, { preserveReturnTo = false } = {}) {
  if (!url || typeof window === "undefined") {
    return url;
  }

  try {
    const resolved = new URL(url, window.location.origin);
    const isAuthRedirect =
      resolved.origin === window.location.origin &&
      resolved.pathname.startsWith("/api/auth");

    if (preserveReturnTo && isAuthRedirect && !resolved.searchParams.has("returnTo")) {
      resolved.searchParams.set("returnTo", getCurrentReturnTo());
    }

    return resolved.toString();
  } catch {
    return url;
  }
}

export function redirectToTopLevel(url, options = {}) {
  if (!url || typeof window === "undefined") {
    return;
  }

  window.open(buildTopLevelRedirectUrl(url, options), "_top");
}

async function appBridgeFetch(shopify, uri, options = {}) {
  const app = resolveAppBridgeInstance(shopify);
  const headers = new Headers(options.headers || {});

  if (app && isSameOriginRequest(uri) && typeof app.idToken === "function") {
    const token = await app.idToken();
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("X-Requested-With", "XMLHttpRequest");
  }

  const response = await fetch(uri, {
    ...options,
    headers,
  });

  if (
    response.headers.get("X-Shopify-API-Request-Failure-Reauthorize") === "1"
  ) {
    const redirectUrl = response.headers.get(
      "X-Shopify-API-Request-Failure-Reauthorize-Url",
    );

    if (redirectUrl) {
      redirectToTopLevel(redirectUrl, { preserveReturnTo: true });
      return null;
    }
  }

  return response;
}

export function authenticatedFetch(uri, options = {}) {
  return appBridgeFetch(null, uri, options);
}

export function createAuthenticatedFetch(shopify) {
  return (uri, options = {}) => appBridgeFetch(shopify, uri, options);
}

export function useAuthenticatedFetch() {
  const shopify = useAppBridge();
  return (uri, options = {}) => appBridgeFetch(shopify, uri, options);
}
