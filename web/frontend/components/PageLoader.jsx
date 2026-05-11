import { Page, Card, BlockStack, SkeletonBodyText, SkeletonDisplayText } from "@shopify/polaris";

export default function PageLoader() {
  return (
    <Page>
      <Card>
        <BlockStack gap="400">
          <SkeletonDisplayText size="small" />
          <SkeletonBodyText lines={6} />
        </BlockStack>
      </Card>
    </Page>
  );
}