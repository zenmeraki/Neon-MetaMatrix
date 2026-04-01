import { useAppBridge } from "@shopify/app-bridge-react";
import { useMemo } from "react";
import { openTopLevelUrl } from "../utils/embeddedNavigation";

async function resolveSessionToken(app) {
  if (!app) {
    return null;
  }

  const tokenSources = [
    () => (typeof app.idToken === "function" ? app.idToken() : null),
    () =>
      typeof app.sessionToken === "function" ? app.sessionToken() : null,
    () =>
      typeof app.sessionToken?.get === "function"
        ? app.sessionToken.get()
        : null,
  ];

  for (const getToken of tokenSources) {
    try {
      const result = await getToken();

      if (typeof result === "string" && result) {
        return result;
      }

      if (typeof result?.idToken === "string" && result.idToken) {
        return result.idToken;
      }

      if (typeof result?.sessionToken === "string" && result.sessionToken) {
        return result.sessionToken;
      }
    } catch {
      // Try the next token strategy.
    }
  }

  return null;
}

function handleReauthorization(response) {
  if (
    response?.headers?.get("X-Shopify-API-Request-Failure-Reauthorize") !== "1"
  ) {
    return false;
  }

  const redirectUrl = response.headers.get(
    "X-Shopify-API-Request-Failure-Reauthorize-Url",
  );

  if (redirectUrl) {
    openTopLevelUrl(redirectUrl);
  }

  return true;
}

export function createAuthenticatedFetch(app) {
  return async function authenticatedAppFetch(uri, options = {}) {
    const headers = new Headers(options.headers || {});
    const sessionToken = await resolveSessionToken(app);

    if (sessionToken && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${sessionToken}`);
    }

    const response = await fetch(uri, {
      ...options,
      headers,
      credentials: options.credentials ?? "same-origin",
    });

    handleReauthorization(response);

    return response;
  };
}

export function useAuthenticatedFetch() {
  const app = useAppBridge();

  return useMemo(() => createAuthenticatedFetch(app), [app]);
}
