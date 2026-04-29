import React, { memo } from "react";
import { Box, Button, InlineStack, Text } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

const StickyBulkActionBar = memo(function StickyBulkActionBar({
  selectedCount = 0,
  targetAction = "",
  canUndo = false,
  undoing = false,
  onEditFields,
  onAddTags,
  onExport,
  onClearSelection,
  onUndo,
}) {
  const { t, i18n } = useTranslation();
  const selectedLabel = Number(selectedCount || 0).toLocaleString(
    i18n.language
  );
  const actionLocked = Boolean(targetAction);

  if (selectedCount <= 0) return null;

  return (
    <Box position="sticky" insetBlockEnd="0" zIndex="2">
      <Box
        background="bg-surface"
        borderColor="border"
        borderBlockStartWidth="025"
        shadow="200"
        paddingBlock="300"
        paddingInline="400"
      >
        <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
          <Text as="p" variant="headingSm">
            {t("selectedProductsCount", {
              count: selectedCount,
              defaultValue: `${selectedLabel} selected`,
            })}
          </Text>

          <InlineStack gap="200" wrap>
            <Button
              variant="primary"
              onClick={onEditFields}
              loading={targetAction === "edit"}
              disabled={actionLocked}
              accessibilityLabel={t("editFieldsAccessibilityLabel", {
                defaultValue: "Edit fields for selected products",
              })}
            >
              {t("editFields", { defaultValue: "Edit fields" })}
            </Button>

            <Button
              onClick={onAddTags}
              loading={targetAction === "add_tags"}
              disabled={actionLocked}
              accessibilityLabel={t("addTagsAccessibilityLabel", {
                defaultValue: "Add tags to selected products",
              })}
            >
              {t("addTags", { defaultValue: "Add tags" })}
            </Button>

            <Button
              onClick={onExport}
              loading={targetAction === "export"}
              disabled={actionLocked}
              accessibilityLabel={t("exportSelectedAccessibilityLabel", {
                defaultValue: "Export selected products",
              })}
            >
              {t("export", { defaultValue: "Export" })}
            </Button>

            <Button
              variant="plain"
              onClick={onClearSelection}
              disabled={actionLocked}
              accessibilityLabel={t("clearSelectionAccessibilityLabel", {
                defaultValue: "Clear product selection",
              })}
            >
              {t("clear", { defaultValue: "Clear" })}
            </Button>
          </InlineStack>

          <Button
            variant="plain"
            onClick={onUndo}
            loading={undoing}
            disabled={undoing || !canUndo}
            accessibilityLabel={t("undoLastActionAccessibilityLabel", {
              defaultValue: "Undo last action",
            })}
          >
            {t("undoLastAction", { defaultValue: "Undo last action" })}
          </Button>
        </InlineStack>
      </Box>
    </Box>
  );
});

export default StickyBulkActionBar;
