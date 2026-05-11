import { memo } from "react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
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
  trustState,
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
      ? t("initialSyncRunning", "Syncing")
      : isStale
        ? t("stale", "Stale")
        : isFailed
          ? t("failed", "Failed")
          : isInconsistent
            ? t("inconsistent", "Inconsistent")
            : t("notSynced", "Not synced");

  return (
    <Card roundedAbove="sm">
      <Box padding="400">
        <BlockStack gap="300">
          {/* Row 1: icon + title + status + actions all inline */}
          <InlineStack align="space-between" blockAlign="center" gap="300" wrap={false}>
            <InlineStack gap="200" blockAlign="center" wrap={false}>
              <Icon source={statusIcon} tone={statusTone} />
              <BlockStack gap="0">
                <Text as="h2" variant="headingMd">
                  {t("catalogSync", "Catalog sync")}
                </Text>
                <Text as="p" variant="bodySm" >
                  {lastSyncedAt
                    ? t("lastSyncedAt", "Last synced: {{lastSyncedAt}}", { lastSyncedAt })
                    : t("syncNotCompletedYet", "Never synced")}
                </Text>
              </BlockStack>
            </InlineStack>

            <InlineStack gap="200" blockAlign="center" wrap={false}>
              <Text as="p" variant="bodySm" tone={isInconsistent || isFailed ? "critical" : "subdued"}>
                {statusLabel}
              </Text>
              <Button
                icon={RefreshIcon}
                size="slim"
                onClick={onSyncNow}
                loading={syncSubmitting}
                disabled={syncSubmitting}
              >
                {t("syncNow", "Sync now")}
              </Button>
              <Button variant="plain" size="slim" onClick={onViewProgress}>
                {t("viewProgress", "View progress")}
              </Button>
              {isFailed && diagnosticId ? (
                <Button variant="plain" size="slim" onClick={onCopyDiagnostic}>
                  {t("copyDiagnosticId", "Copy ID")}
                </Button>
              ) : null}
            </InlineStack>
          </InlineStack>

          {/* Banners */}
          {!canExecute && disabledReason ? (
            <Banner tone={isFailed || isInconsistent ? "critical" : "warning"}>
              <Text as="p" variant="bodyMd">{staleReason || disabledReason}</Text>
            </Banner>
          ) : null}

          {canPreview && !canExecute ? (
            <Banner tone="info">
              <Text as="p" variant="bodyMd">
                {t("previewAllowedApplyBlocked", "Preview available. Applying changes is blocked until sync is ready.")}
              </Text>
            </Banner>
          ) : null}

          {isSyncing ? (
            <Banner tone="info">
              <Text as="p" variant="bodyMd">
                {t("syncStartedViewProgress", "Sync started. View progress for the latest snapshot.")}
              </Text>
            </Banner>
          ) : null}

          <Divider />
          <BlockStack gap="050">
            <Text as="p" variant="bodySm" tone="subdued">
              {t("mirrorBatchId", "Mirror batch")}: {trustState?.mirrorBatchId || t("unknown", "Unknown")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("variantBatchStatus", "Variant batch")}: {trustState?.variantBatchStatus || t("unknown", "Unknown")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("collectionBatchStatus", "Collection batch")}: {trustState?.collectionBatchStatus || t("unknown", "Unknown")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("metafieldBatchStatus", "Metafield batch")}: {trustState?.metafieldBatchStatus || t("unknown", "Unknown")}
            </Text>
            {trustState?.batchObservedAt ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {t("batchObservedAt", "Observed at")}: {trustState.batchObservedAt}
              </Text>
            ) : null}
          </BlockStack>

          <Divider />

          {/* Row 2: counts */}
          <InlineGrid columns={2} gap="400">
            <BlockStack gap="0">
              <Text as="p" variant="headingLg">
                {formatDashboardNumber(products)}
              </Text>
              <Text as="p" variant="bodySm" >
                {t("products", "Products")}
              </Text>
            </BlockStack>

            <BlockStack gap="0">
              <Text as="p" variant="headingLg">
                {formatDashboardNumber(variants)}
              </Text>
              <Text as="p" variant="bodySm" >
                {t("variants", "Variants")}
              </Text>
            </BlockStack>
          </InlineGrid>
        </BlockStack>
      </Box>
    </Card>
  );
}

export default memo(CatalogStatusCard);
