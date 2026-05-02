// web/frontend/components/skeletons/DashboardSkeleton.jsx
import React from "react";
import {
  Layout,
  Card,
  Box,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  SkeletonDisplayText,
  SkeletonBodyText,
} from "@shopify/polaris";

const SUMMARY_KEYS = ["bulk-edits", "exports", "imports"];
const ACTION_KEYS = ["products", "bulk-edit", "export", "snippet-studio"];

function SkeletonLine({ width = "100%" }) {
  return (
    <Box width={width}>
      <SkeletonBodyText lines={1} />
    </Box>
  );
}

function MetricCardSkeleton() {
  return (
    <Card roundedAbove="sm">
      <Box padding="500" minHeight="140px">
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="start" wrap={false}>
            <InlineStack gap="300" blockAlign="center" wrap={false}>
              <Box
                background="bg-surface-secondary"
                borderRadius="200"
                padding="300"
              >
                <Box width="20px">
                  <SkeletonBodyText lines={1} />
                </Box>
              </Box>

              <BlockStack gap="100">
                <SkeletonLine width="88px" />
                <SkeletonLine width="56px" />
              </BlockStack>
            </InlineStack>

            <SkeletonLine width="72px" />
          </InlineStack>
          <SkeletonLine width="120px" />
        </BlockStack>
      </Box>
    </Card>
  );
}

function ActionCardSkeleton() {
  return (
    <Card roundedAbove="sm">
      <Box padding="500">
        <BlockStack gap="400">
          <Box minHeight="90px">
            <BlockStack gap="100">
              <SkeletonLine width="112px" />
              <SkeletonBodyText lines={2} />
            </BlockStack>
          </Box>
          <SkeletonLine width="100%" />
        </BlockStack>
      </Box>
    </Card>
  );
}

function PromoCardSkeleton() {
  return (
    <Card roundedAbove="sm">
      <Box padding="500">
        <BlockStack gap="400">
          <BlockStack gap="100">
            <Box maxWidth="180px">
              <SkeletonDisplayText size="small" />
            </Box>
            <SkeletonBodyText lines={2} />
          </BlockStack>
          <Box minHeight="320px">
            <SkeletonBodyText lines={8} />
          </Box>
        </BlockStack>
      </Box>
    </Card>
  );
}

const DashboardSkeleton = ({ loadingLabel }) => {
  if (!loadingLabel) {
    throw new Error("DashboardSkeleton requires translated loadingLabel");
  }

  return (
    <Box as="section" aria-label={loadingLabel} aria-busy="true" role="status">
      <Text as="span" visuallyHidden>
        {loadingLabel}
      </Text>

      <Box aria-hidden="true">
        <Layout>
          <Layout.Section>
            <Card roundedAbove="sm">
              <Box padding="500">
                <BlockStack gap="300">
                  <Box maxWidth="220px">
                    <SkeletonDisplayText size="large" />
                  </Box>
                  <SkeletonBodyText lines={2} />
                </BlockStack>
              </Box>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <InlineGrid
              columns={{ xs: 1, sm: 2, md: 3, lg: 3, xl: 3 }}
              gap="400"
            >
              {SUMMARY_KEYS.map((key) => (
                <MetricCardSkeleton key={key} />
              ))}
            </InlineGrid>
          </Layout.Section>

          <Layout.Section>
            <Card roundedAbove="sm">
              <Box padding="500">
                <BlockStack gap="400">
                  <BlockStack gap="100">
                    <Box maxWidth="160px">
                      <SkeletonDisplayText size="medium" />
                    </Box>
                    <SkeletonBodyText lines={2} />
                  </BlockStack>

                  <InlineGrid
                    columns={{ xs: 1, sm: 2, md: 4, lg: 4, xl: 4 }}
                    gap="400"
                  >
                    {ACTION_KEYS.map((key) => (
                      <ActionCardSkeleton key={key} />
                    ))}
                  </InlineGrid>
                </BlockStack>
              </Box>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <PromoCardSkeleton />
          </Layout.Section>
        </Layout>
      </Box>
    </Box>
  );
};

export default DashboardSkeleton;
