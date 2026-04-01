import { useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Banner, Layout, Page } from "@shopify/polaris";
import { openTopLevelUrl } from "../utils/embeddedNavigation";

export default function ExitIframe() {
  const app = useAppBridge();
  const { search } = useLocation();
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    if (!app) {
      return undefined;
    }

    app.loading(true);

    try {
      const params = new URLSearchParams(search);
      const redirectUri = params.get("redirectUri");

      if (!redirectUri) {
        setShowWarning(true);
        return undefined;
      }

      const decodedRedirectUri = decodeURIComponent(redirectUri);
      const url = new URL(decodedRedirectUri, window.location.origin);

      if (
        [window.location.hostname, "admin.shopify.com"].includes(url.hostname) ||
        url.hostname.endsWith(".myshopify.com")
      ) {
        openTopLevelUrl(url.toString());
      } else {
        setShowWarning(true);
      }
    } catch {
      setShowWarning(true);
    } finally {
      app.loading(false);
    }

    return () => {
      app.loading(false);
    };
  }, [app, search]);

  return showWarning ? (
    <Page narrowWidth>
      <Layout>
        <Layout.Section>
          <div style={{ marginTop: "100px" }}>
            <Banner title="Redirecting outside of Shopify" tone="warning">
              Apps can only use /exitiframe to reach Shopify or the app itself.
            </Banner>
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  ) : null;
}
