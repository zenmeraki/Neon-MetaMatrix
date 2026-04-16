import { useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Banner, Layout, Page } from "@shopify/polaris";

export default function ExitIframe() {
  const app = useAppBridge();
  const { search } = useLocation();
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      try {
        app.loading(true);

        const params = new URLSearchParams(search);
        const redirectUri = params.get("redirectUri");

        if (!redirectUri) {
          if (mounted) setShowWarning(true);
          return;
        }

        const url = new URL(decodeURIComponent(redirectUri));

        const isAllowedHost =
          [window.location.hostname, "admin.shopify.com"].includes(url.hostname) ||
          url.hostname.endsWith(".myshopify.com");

        if (isAllowedHost) {
          window.open(url.toString(), "_top");
          return;
        }

        if (mounted) setShowWarning(true);
      } catch {
        if (mounted) setShowWarning(true);
      } finally {
        app.loading(false);
      }
    };

    run();

    return () => {
      mounted = false;
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