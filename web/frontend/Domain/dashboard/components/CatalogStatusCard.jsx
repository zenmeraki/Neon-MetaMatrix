import { memo } from "react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Icon,
  InlineGrid,
  InlineStack,
  Text,
} from "@shopify/polaris";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  RefreshIcon,
} from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";
import { formatDashboardNumber } from "../utils/normalizeStoreAccess";

function CatalogStatusCard({
  status,
  canPreview,
  canExecute,
  disabledReason,
  products,
  variants,
  lastSyncedAt,
  staleReason,
  diagnosticId,
  syncSubmitting,
  onSyncNow,
  onViewProgress,
  onCopyDiagnostic,
}) {
  const { t } = useTranslation();
  const isReady = status === "ready";
  const isSyncing = status === "initial_sync_running" || syncSubmitting;
  const isInconsistent = status === "inconsistent";
  const isFailed = status === "failed";
  const isStale = status === "stale";
  const statusIcon = isReady
    ? CheckCircleIcon
    : isInconsistent || isFailed
      ? AlertCircleIcon
      : RefreshIcon;
  const statusTone =
    isReady || isStale
      ? "success"
      : isInconsistent || isFailed
        ? "critical"
        : "base";
  const statusLabel = isReady
    ? t("ready", "Ready")
    : isSyncing
      ? t("initialSyncRunning", "Initial sync running")
      : isStale
        ? t("stale", "Stale")
        : isFailed
          ? t("failed", "Failed")
          : isInconsistent
            ? t("inconsistent", "Inconsistent")
            : t("notSynced", "Not synced");

  return (
    <Card roundedAbove="sm">
      <Box padding="500">
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="start" gap="400">
            <InlineStack gap="100" blockAlign="start" wrap={false}>
              <Box
                background="bg-surface-secondary"
                borderRadius="300"
                padding="200"
                minWidth="40px"
                minHeight="40px"
                display="flex"
                alignItems="center"
                justifyContent="center"
              >
                <Icon source={statusIcon} tone={statusTone} />
              </Box>
              <BlockStack gap="050">

                <Text as="h2" variant="headingMd">
                  {t("catalogSync", "Catalog sync")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {lastSyncedAt
                    ? t("lastSyncedAt", "Last synced: {{lastSyncedAt}}", {
                      lastSyncedAt,
                    })
                    : t("syncNotCompletedYet", "Sync has not completed yet.")}
                </Text>
              </BlockStack>
            </InlineStack>

            <Text
              as="p"
              variant="bodyMd"
              tone={isInconsistent || isFailed ? "critical" : "subdued"}
            >
              {statusLabel}
            </Text>
          </InlineStack>

          {!canExecute && disabledReason ? (
            <Banner tone={isFailed || isInconsistent ? "critical" : "warning"}>
              <Text as="p" variant="bodyMd">
                {staleReason || disabledReason}
              </Text>
            </Banner>
          ) : null}

          {canPreview && !canExecute ? (
            <Banner tone="info">
              <Text as="p" variant="bodyMd">
                {t(
                  "previewAllowedApplyBlocked",
                  "Preview is available, but applying changes is blocked until catalog sync is ready."
                )}
              </Text>
            </Banner>
          ) : null}

          {isSyncing ? (
            <Banner tone="info">
              <Text as="p" variant="bodyMd">
                {t(
                  "syncStartedViewProgress",
                  "Sync started. You can view progress while the latest snapshot is prepared."
                )}
              </Text>
            </Banner>
          ) : null}

          <Box paddingBlockStart="200">
            <InlineGrid
              columns={{ xs: 1, sm: 2, md: 2, lg: 2, xl: 2 }}
              gap="600"
            >
              <BlockStack gap="050">
                <Box paddingInlineStart="1000">
                  <Text as="p" variant="headingLg">
                    {formatDashboardNumber(products)}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("products", "Products")}
                  </Text></Box>
              </BlockStack>

              <BlockStack gap="050">
                <Text as="p" variant="headingLg">
                  {formatDashboardNumber(variants)}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("variants", "Variants")}
                </Text>
              </BlockStack>
            </InlineGrid>
          </Box>

          <InlineStack gap="200" blockAlign="center" wrap>
            <Box paddingInlineStart="800">
              <Button
                icon={RefreshIcon}
                onClick={onSyncNow}
                loading={syncSubmitting}
                disabled={syncSubmitting}
              >
                {t("syncNow", "Sync now")}
              </Button></Box>

            <Button variant="plain" onClick={onViewProgress}>
              {t("viewProgress", "View progress")}
            </Button>

            {isFailed && diagnosticId ? (
              <Button variant="plain" onClick={onCopyDiagnostic}>
                {t("copyDiagnosticId", "Copy diagnostic ID")}
              </Button>
            ) : null}
          </InlineStack>
        </BlockStack>
      </Box>
    </Card>
  );
}

export default memo(CatalogStatusCard);
