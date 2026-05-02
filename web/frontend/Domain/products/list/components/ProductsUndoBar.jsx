import React, { memo } from "react";
import { Box, Button, Card, Icon, InlineStack, Text } from "@shopify/polaris";
import { CheckCircleIcon } from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";

const ProductsUndoBar = memo(function ProductsUndoBar({
  count = 0,
  canUndo = false,
  undoing = false,
  onUndo,
  onViewChanges,
}) {
  const { t, i18n } = useTranslation();
  const countLabel = Number(count || 0).toLocaleString(i18n.language);

  return (
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
  );
});

export default ProductsUndoBar;
