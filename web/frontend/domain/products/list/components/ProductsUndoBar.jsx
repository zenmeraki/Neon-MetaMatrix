import React, { memo } from "react";
import { BlockStack, Box, Button, Card, Icon, InlineStack, Text } from "@shopify/polaris";
import { CheckCircleIcon } from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";
import PipelineTelemetryCard from "../../../../components/PipelineTelemetryCard";

const ProductsUndoBar = memo(function ProductsUndoBar({
  count = 0,
  progressPercent = null,
  progressStatus = null,
  telemetry = null,
  canUndo = false,
  undoing = false,
  onUndo,
  onViewChanges,
}) {
  const { t, i18n } = useTranslation();
  const countLabel = Number(count || 0).toLocaleString(i18n.language);

  return (
    <BlockStack gap="300">
      <Card roundedAbove="sm">
        <Box paddingBlock="300" paddingInline="400">
          <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
            <InlineStack gap="200" blockAlign="center" wrap={false}>
              <Box color="text-success">
                <Icon source={CheckCircleIcon} tone="success" />
              </Box>

              <Text as="p" variant="bodyMd" fontWeight="medium">
                {t("updatedProductsCount", {
                  count,
                  defaultValue: `Updated ${countLabel} products`,
                })}
              </Text>
              {typeof progressPercent === "number" ? (
                <Text as="span" variant="bodySm" tone="subdued">
                  {`${progressPercent}%${progressStatus ? ` • ${progressStatus}` : ""}`}
                </Text>
              ) : null}
            </InlineStack>

            <InlineStack gap="200" wrap>
              <Button
                onClick={onUndo}
                loading={undoing}
                disabled={undoing || !canUndo}
                accessibilityLabel={t("undoLastActionAccessibilityLabel", {
                  defaultValue: "Undo last action",
                })}
              >
                {t("undo", { defaultValue: "Undo" })}
              </Button>

              <Button
                variant="plain"
                onClick={onViewChanges}
                accessibilityLabel={t("viewChangesAccessibilityLabel", {
                  defaultValue: "View changes from the last action",
                })}
              >
                {t("viewChanges", { defaultValue: "View changes" })}
              </Button>
            </InlineStack>
          </InlineStack>
        </Box>
      </Card>

      {telemetry ? <PipelineTelemetryCard telemetry={telemetry} title="Live Pipeline Telemetry" /> : null}
    </BlockStack>
  );
});

export default ProductsUndoBar;
