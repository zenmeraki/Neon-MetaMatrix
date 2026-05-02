import { memo } from "react";
import {
  Card,
  Box,
  Text,
  BlockStack,
  InlineStack,
  Icon,
  SkeletonBodyText,
} from "@shopify/polaris";
import { formatDashboardNumber } from "../utils/normalizeStoreAccess";

function formatMetricValue(value) {
  return typeof value === "number" ? formatDashboardNumber(value) : value;
}

function MetricCard({ icon, label, value, context, loading = false }) {
  return (
    <Card>
      <Box padding="400" height="100%">
        {loading ? (
          <BlockStack gap="400">
            <SkeletonBodyText lines={1} />
            <SkeletonBodyText lines={2} />
          </BlockStack>
        ) : (
          <BlockStack gap="400">
            <InlineStack gap="300" blockAlign="center" wrap={false}>
              <Box
                background="bg-surface-secondary"
                borderRadius="200"
                padding="300"
              >
                <Icon source={icon} tone="base" />
              </Box>

              <BlockStack gap="100">
                <Text as="span" variant="bodyLg" fontWeight="semibold">
                  {label}
                </Text>
                <Text as="p" variant="heading2xl">
                  {formatMetricValue(value)}
                </Text>
                {context ? (
                  <Text as="span" variant="bodySm" tone="subdued">
                    {context}
                  </Text>
                ) : null}
              </BlockStack>
            </InlineStack>
          </BlockStack>
        )}
      </Box>
    </Card>
  );
}

export default memo(MetricCard);
