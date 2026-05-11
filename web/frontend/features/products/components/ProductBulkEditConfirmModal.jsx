import { Banner, BlockStack, List, Modal, Text } from "@shopify/polaris";

export default function ProductBulkEditConfirmModal({
  open,
  onClose,
  onConfirm,
  targetAction,
  t,
  selection,
  bulkEditTargetCount,
  bulkEditTargetLabel,
}) {
  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("confirmBulkEdit", { defaultValue: "Confirm bulk edit" })}
      primaryAction={{
        content: t("continue", { defaultValue: "Continue" }),
        onAction: onConfirm,
        loading: targetAction === "edit",
        disabled: Boolean(targetAction),
      }}
      secondaryActions={[
        {
          content: t("cancel", { defaultValue: "Cancel" }),
          onAction: onClose,
          disabled: Boolean(targetAction),
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <Text as="p">
            {t("bulkEditConfirmIntro", {
              defaultValue: "You are about to edit:",
            })}
          </Text>

          <List>
            <List.Item>
              {t("bulkEditConfirmProducts", {
                count: bulkEditTargetCount,
                defaultValue: `${bulkEditTargetLabel} products`,
              })}
            </List.Item>
            <List.Item>
              {t("bulkEditConfirmFields", {
                defaultValue: "Fields: choose in the next step",
              })}
            </List.Item>
          </List>

          <Banner tone="warning">
            <Text as="p">
              {selection.mode === "query"
                ? t("bulkEditConfirmAllMatchingWarning", {
                    defaultValue: "Changes will apply to all matching products.",
                  })
                : t("bulkEditConfirmSelectedWarning", {
                    defaultValue: "Changes will apply to selected products.",
                  })}
            </Text>
          </Banner>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
