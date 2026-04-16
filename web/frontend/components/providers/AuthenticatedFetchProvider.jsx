import { useLayoutEffect, useState } from "react";
import LoadingPage from "../LoadingPage";
import { createShopifyAuthenticatedFetch } from "../../utils/shopifyAuthenticatedFetch";

export function AuthenticatedFetchProvider({ children }) {
  const [isReady, setIsReady] = useState(false);
  const [isUnavailable, setIsUnavailable] = useState(false);

  useLayoutEffect(() => {
    const originalFetch = window.fetch.bind(window);
    let cancelled = false;
    let retryId;
    let attempts = 0;

    const installAuthenticatedFetch = () => {
      if (cancelled) return;

      if (!window.shopify || typeof window.shopify.idToken !== "function") {
        attempts += 1;

        if (attempts >= 100) {
          setIsUnavailable(true);
          return;
        }

        retryId = window.setTimeout(installAuthenticatedFetch, 100);
        return;
      }

      window.fetch = createShopifyAuthenticatedFetch(window.shopify, originalFetch);
      setIsReady(true);
    };

    installAuthenticatedFetch();

    return () => {
      cancelled = true;
      window.clearTimeout(retryId);
      window.fetch = originalFetch;
    };
  }, []);

  if (isReady) return children;

  if (isUnavailable) {
    return (
      <div style={{ padding: 24 }}>
        Open this app from Shopify admin so App Bridge can create a session.
      </div>
    );
  }

  return <LoadingPage />;
}
