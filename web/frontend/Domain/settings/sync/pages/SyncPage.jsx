import React, { useState, useEffect, useCallback } from "react";
import {
  Page,
  Layout,
  Card,
  ResourceList,
  ResourceItem,
  Text,
  Button,
  Badge,
  Frame,
  Box,
  BlockStack,
  InlineStack,
  Toast,
  Spinner,
} from "@shopify/polaris";
import { RefreshIcon, ArrowLeftIcon } from "@shopify/polaris-icons";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

const rows = [
  { name: "Products", api: "/api/sync/products" },
  // { name: "Product Types", api: "/api/products/product-type-refresh" },
  // { name: "Collections", api: "/api/collection/collections-refresh" },
];

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
  const [waitingForSync, setWaitingForSync] = useState(false); // ✅ NEW: waiting for background job to start

  const showToast = (message, error = false) =>
    setToast({ active: true, message, error });

  const hideToast = () => setToast({ ...toast, active: false });

  const fetchSyncStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/sync/sync-status");
      const result = await response.json();

      if (response.ok && result?.syncStatus) {
        const ds = result.syncStatus;
        setDataSources(ds);

        // ✅ Check if anything is syncing OR we're waiting for sync to start
        const anyRunning =
          ds.isProductSyncing ||
          ds.isProductTypeSyncing ||
          ds.isCollectionSyncing;

        // If we were waiting and sync started, clear waiting flag
        if (waitingForSync && anyRunning) {
          setWaitingForSync(false);
        }

        // Keep polling if syncing OR waiting for sync to start
        setShouldPoll(anyRunning || waitingForSync);
      }
    } catch {
      showToast("Failed to load sync status", true);
    }
  }, [waitingForSync]);

  // ✅ POLL ONLY WHEN shouldPoll == true
  useEffect(() => {
    fetchSyncStatus(); // Always fetch 1 time immediately

    if (!shouldPoll) return; // ❌ If no sync running, NO POLLING

    const interval = setInterval(fetchSyncStatus, 4000);

    return () => clearInterval(interval);
  }, [shouldPoll, fetchSyncStatus]);

  // ✅ Clear syncingItem when sync completes
  useEffect(() => {
    if (dataSources && syncingItem && !isAnySyncRunning) {
      setSyncingItem("");
    }
  }, [dataSources, syncingItem]);

  const isAnySyncRunning =
    dataSources?.isProductSyncing ||
    dataSources?.isProductTypeSyncing ||
    dataSources?.isCollectionSyncing;

  const handleRefresh = async (row) => {
    if (isAnySyncRunning || syncingItem)
      return showToast("Another sync is running...", true);

    setSyncingItem(row.name); // ✅ Set IMMEDIATELY to disable button
    setWaitingForSync(true); // ✅ Start waiting for background job
    setShouldPoll(true); // ✅ Force polling to start immediately

    try {
      const response = await fetch(row.api);
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error);
      showToast(`${row.name} sync started`);
      // Don't clear syncingItem here - let polling handle it
    } catch {
      showToast(`Failed to sync ${row.name}`, true);
      setSyncingItem(""); // Only clear on error
      setWaitingForSync(false);
      setShouldPoll(false);
    }
  };

  const getDate = (name) => {
    if (!dataSources) return null;
    const map = {
      Products: dataSources.lastProductSyncAt,
      "Product Types": dataSources.lastProductTypeSyncAt,
      Collections: dataSources.lastCollectionSyncAt,
    };
    return map[name] ? new Date(map[name]).toDateString() : "Never synced";
  };

  const getStatus = (name) => {
    if (!dataSources) return null;
    const map = {
      Products: dataSources.isProductSyncing,
      "Product Types": dataSources.isProductTypeSyncing,
      Collections: dataSources.isCollectionSyncing,
    };
    return map[name] ? "Syncing..." : "Synced";
  };

  return (
    <Frame>
      <Page
        backAction={{
          content: "Back",
          icon: ArrowLeftIcon,
          onAction: () => navigate("/products"),
        }}
        title={t("ShopifyData")}
      >
        <Layout>
          <Layout.Section>
            <Card padding="base">
              <Box paddingInline="500" paddingBlock="400">
                <Text variant="bodyMd" color="subdued">
                  {t("SyncProducts")}
                </Text>
              </Box>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card padding="base">
              <ResourceList
                resourceName={{ singular: "source", plural: "sources" }}
                items={rows}
                renderItem={(item) => (
                  <ResourceItem>
                    <InlineStack align="space-between" blockAlign="center">
                      {/* LEFT */}
                      <InlineStack gap="300" blockAlign="center">
                        <Box
                          width="8px"
                          height="8px"
                          borderRadius="full"
                          background="bg-fill-success"
                        />
                        <Box>
                          <BlockStack gap="100">
                            <Text fontWeight="semibold">{item.name}</Text>

                            {/* Last Sync Field */}
                            {dataSources ? (
                              <Text variant="bodySm" color="subdued">
                                {t("lastSync")}: {getDate(item.name)}
                              </Text>
                            ) : (
                              <InlineStack gap="100" blockAlign="center">
                                <Spinner size="small" />
                                <Text variant="bodySm" color="subdued">
                                  Fetching...
                                </Text>
                              </InlineStack>
                            )}
                          </BlockStack>
                        </Box>
                      </InlineStack>

                      {/* RIGHT */}
                      <InlineStack gap="200" blockAlign="center">
                        {/* Status Badge */}
                        {dataSources ? (
                          <Badge
                            tone={
                              getStatus(item.name) === "Synced"
                                ? "success"
                                : "attention"
                            }
                          >
                            {getStatus(item.name)}
                          </Badge>
                        ) : (
                          <Spinner size="small" />
                        )}

                        {/* Refresh Button */}
                        <Button
                          icon={RefreshIcon}
                          variant="tertiary"
                          size="slim"
                          loading={syncingItem === item.name}
                          disabled={isAnySyncRunning || !!syncingItem}
                          onClick={() => handleRefresh(item)}
                        />
                      </InlineStack>
                    </InlineStack>
                  </ResourceItem>
                )}
              />
            </Card>
          </Layout.Section>
        </Layout>
      </Page>

      {toast.active && (
        <Toast
          content={toast.message}
          error={toast.error}
          onDismiss={hideToast}
        />
      )}
    </Frame>
  );
}
