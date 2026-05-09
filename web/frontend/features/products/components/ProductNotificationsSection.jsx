import { Banner, BlockStack, Box, Layout, Text } from "@shopify/polaris";

export default function ProductNotificationsSection({
  syncCompleted,
  targetActionError,
  selectionCommandNotice,
  segmentNotice,
  dismissSyncCompleted,
  dismissTargetActionError,
  dismissSelectionCommandNotice,
  dismissSegmentNotice,
  t,
}) {
  return (
    <Layout.Section>
      <Box minHeight="132px">
        <BlockStack gap="300">
          {syncCompleted ? (
            <Banner
              tone="success"
              title={t("syncComplete", { defaultValue: "Sync complete" })}
              onDismiss={dismissSyncCompleted}
            >
              <Text as="p">
                {t("productsSyncCompletedMessage", {
                  defaultValue: "Products have been synced successfully.",
                })}
              </Text>
            </Banner>
          ) : null}
          {targetActionError ? (
            <Banner
              tone="critical"
              title={t("targetFreezeFailed", {
                defaultValue: "Could not prepare product target",
              })}
              onDismiss={dismissTargetActionError}
            >
              <Text as="p">{targetActionError}</Text>
            </Banner>
          ) : null}
          {selectionCommandNotice ? (
            <Banner tone="success" onDismiss={dismissSelectionCommandNotice}>
              <Text as="p">{selectionCommandNotice}</Text>
            </Banner>
          ) : null}
          {segmentNotice ? (
            <Banner tone="success" onDismiss={dismissSegmentNotice}>
              <Text as="p">{segmentNotice}</Text>
            </Banner>
          ) : null}
        </BlockStack>
      </Box>
    </Layout.Section>
  );
}
