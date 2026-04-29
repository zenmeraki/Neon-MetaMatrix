import React, { memo } from "react";
import { Badge, Box, Card, InlineGrid, Text, BlockStack } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

const SUMMARY_COLUMNS = { xs: 1, sm: 3, md: 3, lg: 3, xl: 3 };

const ProductsSummaryStrip = memo(function ProductsSummaryStrip({
  selectedCount = 0,
  totalCount = 0,
  loading = false,
  queryCost,
  streamingState,
}) {
  const { t, i18n } = useTranslation();
  const selectedLabel = Number(selectedCount || 0).toLocaleString(
    i18n.language
  );
  const totalLabel = Number(totalCount || 0).toLocaleString(i18n.language);

  return (
    <Card roundedAbove="sm">
      <Box padding="400">
        <InlineGrid columns={SUMMARY_COLUMNS} gap="400">
          <Box minHeight="72px">
            <BlockStack gap="100">
              <Text as="p" variant="bodyMd" tone="subdued">
                {t("productsSelected", { defaultValue: "Products selected" })}
              </Text>
              <Text as="p" variant="headingLg">
                {loading
                  ? t("checking", { defaultValue: "Checking" })
                  : selectedCount > 0
                  ? selectedLabel
                  : totalLabel}
              </Text>
              {streamingState?.phase && streamingState.phase !== "idle" ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  {streamingState.phase === "first_page"
                    ? t("progressiveLoadingFirstPage", {
                        defaultValue: "Loading first 20 instantly",
                      })
                    : streamingState.phase === "streaming"
                    ? t("progressiveLoadingStreaming", {
                        count: Number(streamingState.loaded || 0).toLocaleString(
                          i18n.language
                        ),
                        defaultValue: `Streaming next ${Number(
                          streamingState.loaded || 0
                        ).toLocaleString(i18n.language)}`,
                      })
                    : t("progressiveLoadingBackground", {
                        defaultValue: "Background loading rest",
                      })}
                </Text>
              ) : null}
            </BlockStack>
          </Box>

          <Box
            minHeight="72px"
            borderInlineStartWidth="025"
            borderColor="border"
            paddingInlineStart="400"
          >
            <BlockStack gap="100">
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                {t("queryCostIndicatorTitle", {
                  defaultValue: "Query cost",
                })}
              </Text>
              <BlockStack gap="050">
                <Badge tone={queryCost?.tone || "success"}>
                  {queryCost?.level ||
                    t("queryCostLow", { defaultValue: "LOW" })}
                </Badge>
                <Text as="p" variant="bodyMd" tone="subdued">
                  {t("queryCostEstimatedScan", {
                    count: queryCost?.estimatedScanLabel || "0",
                    defaultValue: `Estimated scan: ${
                      queryCost?.estimatedScanLabel || "0"
                    } rows`,
                  })}
                </Text>
              </BlockStack>
            </BlockStack>
          </Box>

          <Box
            minHeight="72px"
            borderInlineStartWidth="025"
            borderColor="border"
            paddingInlineStart="400"
          >
            <BlockStack gap="100">
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                {t("searchTips", { defaultValue: "Search tips" })}
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                {t("searchTipsHint", {
                  defaultValue: "Learn how to find the products to edit",
                })}
              </Text>
            </BlockStack>
          </Box>
        </InlineGrid>
      </Box>
    </Card>
  );
});

export default ProductsSummaryStrip;
