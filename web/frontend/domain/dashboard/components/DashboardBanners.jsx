import { memo } from "react";
import { Banner, BlockStack, Text } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

function DashboardBanners({
  showFreeAccessBanner,
  isCreditAvailable,
  isSyncing,
  syncFeedback,
  onDismissFreeAccess,
  onRequestExtension,
  onViewProgress,
}) {
  const { t } = useTranslation();
  const shouldRender =
    (showFreeAccessBanner && isCreditAvailable) || isSyncing || syncFeedback;

  if (!shouldRender) return null;

  return (
    <BlockStack gap="300">
      {showFreeAccessBanner && isCreditAvailable ? (
        <Banner
          tone="success"
          title={t("freeAccessActive", "Free access active")}
          onDismiss={onDismissFreeAccess}
          action={{
            content: t("requestExtension", "Request extension"),
            onAction: onRequestExtension,
          }}
        >
          <Text as="p" variant="bodyMd">
            {t("freeAccessMessage", "Free access is currently active.")}
          </Text>
        </Banner>
      ) : null}

      {isSyncing ? (
        <Banner
          tone="info"
          title={t("productSyncInProgress", "Product sync in progress")}
          action={{
            content: t("viewProgress", "View progress"),
            onAction: onViewProgress,
          }}
        >
          <Text as="p" variant="bodyMd">
            {t(
              "productSyncMessage",
              "Product data is syncing. Editing is disabled until the latest snapshot is ready."
            )}
          </Text>
        </Banner>
      ) : null}

      {syncFeedback === "failed" ? (
        <Banner tone="critical">
          <Text as="p" variant="bodyMd">
            {t(
              "syncStartFailed",
              "Unable to start product sync. Open sync status and try again."
            )}
          </Text>
        </Banner>
      ) : null}
    </BlockStack>
  );
}

export default memo(DashboardBanners);
