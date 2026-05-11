import { Layout, Page } from "@shopify/polaris";

export default function ProductsPage({
  title,
  subtitle,
  primaryAction,
  secondaryActions,
  children,
  modal,
}) {
  return (
    <Page
      title={title}
      subtitle={subtitle}
      fullWidth
      primaryAction={primaryAction}
      secondaryActions={secondaryActions}
    >
      <Layout>{children}</Layout>
      {modal}
    </Page>
  );
}
