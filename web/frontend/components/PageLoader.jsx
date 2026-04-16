import { Page, Card, BlockStack, SkeletonBodyText, SkeletonDisplayText } from "@shopify/polaris";

export default function PageLoader() {
  return (
    <Page fullWidth>
      <Card>
        <div className="page-loader-panel">
          <BlockStack gap="400">
            <SkeletonDisplayText size="small" />
            <SkeletonBodyText lines={8} />
          </BlockStack>
        </div>
      </Card>
    </Page>
  );
}
