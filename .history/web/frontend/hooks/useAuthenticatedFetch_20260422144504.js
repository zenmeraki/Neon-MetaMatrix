import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticatedFetch } from "@shopify/app-bridge/utilities";

export function useAuthenticatedFetch() {
  const app = useAppBridge();
  const fetchFunction = authenticatedFetch(app);

  return async (uri, options = {}) => {
    const response = await fetchFunction(uri, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });

    if (!response) return null;

    if (
      response.headers.get("X-Shopify-API-Request-Failure-Reauthorize") === "1"
    ) {
      const redirectUrl = response.headers.get(
        "X-Shopify-API-Request-Failure-Reauthorize-Url"
      );

      if (redirectUrl) {
        window.location.assign(redirectUrl);
        return null;
      }
    }

    return response;
  };
}