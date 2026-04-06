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
  Divider,
} from "@shopify/polaris";
import { RefreshIcon, ArrowLeftIcon } from "@shopify/polaris-icons";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

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
      const response = await fetch("/api/sync/sync-status");
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
      const response = await fetch(row.api);
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
        <Card key={item.name} roundedAbove="sm">
          <Box padding="500">
            <InlineStack align="space-between" blockAlign="center" wrap gap="400">
              <BlockStack gap="150">
                <Text as="h3" variant="headingMd">
                  {item.name}
                </Text>

                {dataSources ? (
                  <Text variant="bodyMd" tone="subdued">
                    {t("lastSync")}: {getDate(item.name)}
                  </Text>
                ) : (
                  <SkeletonBodyText lines={1} />
                )}
              </BlockStack>

              <InlineStack gap="300" blockAlign="center">
                {dataSources ? (
                  <Badge
                    tone={getStatus(item.name) === "Synced" ? "success" : "attention"}
                  >
                    {getStatus(item.name)}
                  </Badge>
                ) : null}

                <Button
                  icon={RefreshIcon}
                  variant="primary"
                  loading={syncingItem === item.name}
                  disabled={isAnySyncRunning || Boolean(syncingItem)}
                  onClick={() => handleRefresh(item)}
                >
                  {t("refreshButton",)}
                </Button>
              </InlineStack>
            </InlineStack>
          </Box>
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
          <BlockStack gap="500">
            <Card roundedAbove="sm">
              <Box
                padding="700"
                borderRadius="300"
                overflowX="hidden"
                overflowY="hidden"
                style={{
                  background:
                    "linear-gradient(180deg, #ffffff 0%, #f8f8f8 55%, #f3f4f6 100%)",
                }}
              >
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="start" wrap gap="400">
                    <BlockStack gap="150">
                      <Text as="h2" variant="headingLg">
                        {t("syncHeroTitle",)}
                      </Text>
                      <Box maxWidth="720px">
                        <Text as="p" tone="subdued" variant="bodyMd">
                          {t("syncHeroText",)}
                        </Text>
                      </Box>
                    </BlockStack>

                    <Badge tone={summaryTone}>
                      {isAnySyncRunning || waitingForSync
                        ? t("syncBadgeInProgress",)
                        : t("syncBadgeReady",)}
                    </Badge>
                  </InlineStack>

                  <Box
                    padding="400"
                    borderRadius="300"
                    background="bg-surface"
                    borderWidth="025"
                    borderStyle="solid"
                    borderColor="border-secondary"
                  >
                    <InlineStack align="space-between" blockAlign="center" wrap gap="400">
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingSm">
                          {t("syncGuidanceTitle",)}
                        </Text>
                        <Text as="p" tone="subdued" variant="bodyMd">
                          {t("syncGuidanceText",)}
                        </Text>
                      </BlockStack>

                      <Badge tone="info">
                        {t("syncWorkflowBadge",)}
                      </Badge>
                    </InlineStack>
                  </Box>
                </BlockStack>
              </Box>
            </Card>

            {(waitingForSync || isAnySyncRunning) && (
              <Banner tone="warning">
                {t("syncRunningBanner",)}
              </Banner>
            )}

            <BlockStack gap="300">{syncCards}</BlockStack>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card roundedAbove="sm">
            <Box padding="500">
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  {t("mirrorDetailsTitle",)}
                </Text>

                <Text as="p" tone="subdued" variant="bodyMd">
                  {t("mirrorDetailsText",)}
                </Text>

                <Divider />

                <Box
                  background="bg-surface-secondary"
                  padding="400"
                  borderRadius="300"
                  borderWidth="025"
                  borderStyle="solid"
                  borderColor="border-secondary"
                >
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">
                      {t("syncRefreshHint",)}
                    </Text>
                  </BlockStack>
                </Box>
              </BlockStack>
            </Box>
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