import { Page, Spinner } from "@shopify/polaris";

export default function PageLoader() {
  return (
    <Page>
      <div style={{ padding: "40px", textAlign: "center" }}>
        <Spinner accessibilityLabel="Loading page" size="large" />
      </div>
    </Page>
  );
}
