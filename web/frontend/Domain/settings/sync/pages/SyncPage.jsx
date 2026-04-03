import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Layout,
  Page,
  SkeletonBodyText,
  Text,
  Toast,
} from "@shopify/polaris";
import { RefreshIcon, ArrowLeftIcon } from "@shopify/polaris-icons";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authenticatedFetch } from "../../../../hooks/useAuthenticatedFetch";

const rows = [{ name: "Products", api: "/api/sync/products" }];

export default function DataSyncPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [dataSources, setDataSources] = useState(null);
  const [toast, setToast] = useState({
    active: false,
    message: "",
    error: false,
  });
  const [syncingItem, setSyncingItem] = useState("");
  const [shouldPoll, setShouldPoll] = useState(false);
  const [waitingForSync, setWaitingForSync] = useState(false);

  const showToast = (message, error = false) =>
    setToast({ active: true, message, error });

  const hideToast = () => setToast((current) => ({ ...current, active: false }));

  const fetchSyncStatus = useCallback(async () => {
    try {
      const response = await authenticatedFetch("/api/sync/sync-status");
      const result = await response.json();

      if (response.ok && result?.syncStatus) {
        const ds = result.syncStatus;
        setDataSources(ds);

        const anyRunning =
          ds.isProductSyncing ||
          ds.isProductTypeSyncing ||
          ds.isCollectionSyncing;

        if (waitingForSync && anyRunning) {
          setWaitingForSync(false);
        }

        setShouldPoll(anyRunning || waitingForSync);
      }
    } catch {
      showToast("Failed to load sync status", true);
    }
  }, [waitingForSync]);

  useEffect(() => {
    fetchSyncStatus();

    if (!shouldPoll) return undefined;

    const interval = setInterval(fetchSyncStatus, 4000);
    return () => clearInterval(interval);
  }, [fetchSyncStatus, shouldPoll]);

  const isAnySyncRunning =
    dataSources?.isProductSyncing ||
    dataSources?.isProductTypeSyncing ||
    dataSources?.isCollectionSyncing;

  useEffect(() => {
    if (dataSources && syncingItem && !isAnySyncRunning) {
      setSyncingItem("");
    }
  }, [dataSources, isAnySyncRunning, syncingItem]);

  const handleRefresh = async (row) => {
    if (isAnySyncRunning || syncingItem) {
      showToast("Another sync is running...", true);
      return;
    }

    setSyncingItem(row.name);
    setWaitingForSync(true);
    setShouldPoll(true);

    try {
      const response = await authenticatedFetch(row.api);
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error);
      showToast(`${row.name} sync started`);
    } catch {
      showToast(`Failed to sync ${row.name}`, true);
      setSyncingItem("");
      setWaitingForSync(false);
      setShouldPoll(false);
    }
  };

  const getDate = useCallback(
    (name) => {
      if (!dataSources) return null;
      const map = {
        Products: dataSources.lastProductSyncAt,
        "Product Types": dataSources.lastProductTypeSyncAt,
        Collections: dataSources.lastCollectionSyncAt,
      };

      return map[name] ? new Date(map[name]).toLocaleString() : "Never synced";
    },
    [dataSources],
  );

  const getStatus = useCallback(
    (name) => {
      if (!dataSources) return null;
      const map = {
        Products: dataSources.isProductSyncing,
        "Product Types": dataSources.isProductTypeSyncing,
        Collections: dataSources.isCollectionSyncing,
      };
      return map[name] ? "Syncing" : "Synced";
    },
    [dataSources],
  );

  const summaryTone = isAnySyncRunning || waitingForSync ? "warning" : "success";

  const syncCards = useMemo(
    () =>
      rows.map((item) => (
        <Card key={item.name}>
          <InlineStack align="space-between" blockAlign="center" wrap gap="400">
            <BlockStack gap="100">
              <Text as="h3" variant="headingSm">
                {item.name}
              </Text>
              {dataSources ? (
                <Text variant="bodySm" tone="subdued">
                  {t("lastSync")}: {getDate(item.name)}
                </Text>
              ) : (
                <SkeletonBodyText lines={1} />
              )}
            </BlockStack>

            <InlineStack gap="200" blockAlign="center">
              {dataSources ? (
                <Badge tone={getStatus(item.name) === "Synced" ? "success" : "attention"}>
                  {getStatus(item.name)}
                </Badge>
              ) : null}
              <Button
                icon={RefreshIcon}
                variant="secondary"
                loading={syncingItem === item.name}
                disabled={isAnySyncRunning || Boolean(syncingItem)}
                onClick={() => handleRefresh(item)}
              >
                Refresh
              </Button>
            </InlineStack>
          </InlineStack>
        </Card>
      )),
    [dataSources, getDate, getStatus, isAnySyncRunning, syncingItem, t],
  );

  return (
    <Page
      backAction={{
        content: "Back",
        icon: ArrowLeftIcon,
        onAction: () => navigate("/products"),
      }}
      title={t("ShopifyData")}
      subtitle={t("SyncProducts")}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <InlineStack align="space-between" blockAlign="center" wrap gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Catalog sync status
                  </Text>
                  <Text as="p" tone="subdued" variant="bodyMd">
                    Refresh mirrored catalog data when you need targeting, previews, and exports to reflect the latest Shopify state.
                  </Text>
                </BlockStack>
                <Badge tone={summaryTone}>
                  {isAnySyncRunning || waitingForSync ? "Sync in progress" : "Mirror ready"}
                </Badge>
              </InlineStack>
            </Card>

            {(waitingForSync || isAnySyncRunning) && (
              <Banner tone="warning">
                A sync is running in the background. Keep this page open to monitor status updates.
              </Banner>
            )}

            {syncCards}
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                Sync guidance
              </Text>
              <Text as="p" tone="subdued" variant="bodyMd">
                Start one sync at a time to avoid unnecessary queue pressure and keep the mirror state predictable.
              </Text>
              <Box
                background="bg-surface-secondary"
                padding="300"
                borderRadius="300"
                borderWidth="1"
                borderColor="border"
              >
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd">
                    Product sync refreshes the mirrored catalog used for filtering, previews, exports, and edit planning.
                  </Text>
                </BlockStack>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {toast.active && (
        <Toast
          content={toast.message}
          error={toast.error}
          onDismiss={hideToast}
        />
      )}
    </Page>
  );
}
