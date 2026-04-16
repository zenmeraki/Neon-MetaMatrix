// web/frontend/components/skeletons/DashboardSkeleton.jsx
import React from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  SkeletonDisplayText,
  SkeletonBodyText,
  SkeletonThumbnail,
} from "@shopify/polaris";

const DashboardSkeleton = () => (
  <Page title="">
    <Layout>
      {/* Overview Section */}
     <Layout.Section>
  <BlockStack gap="400">
    <SkeletonDisplayText size="large" />

    <InlineStack gap="400" wrap={false}>
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <BlockStack padding="400" gap="300">
            <SkeletonThumbnail size="small" />
            <SkeletonBodyText lines={2} />
          </BlockStack>
        </Card>
      ))}
    </InlineStack>

  </BlockStack>
</Layout.Section>


      {/* Divider */}
      <Layout.Section>
        <SkeletonBodyText lines={1} />
      </Layout.Section>

      {/* Things To Do Section */}
      <Layout.Section>
        <BlockStack gap="400">
          <SkeletonDisplayText size="medium" />
          <InlineStack gap="300">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <BlockStack padding="400" gap="200">
                  <SkeletonBodyText lines={1} />
                </BlockStack>
              </Card>
            ))}
          </InlineStack>
        </BlockStack>
      </Layout.Section>

      {/* Promotional Content Placeholder */}
      <Layout.Section>
        <Card>
          <BlockStack padding="400">
            <SkeletonDisplayText size="small" />
            <SkeletonBodyText lines={2} />
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  </Page>
);

export default DashboardSkeleton;