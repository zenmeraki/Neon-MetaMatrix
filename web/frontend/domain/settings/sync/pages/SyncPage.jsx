import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  InlineStack,
  Layout,
  Page,
  SkeletonBodyText,
  Text,
  Toast,
} from "@shopify/polaris";
import { ArrowLeftIcon } from "@shopify/polaris-icons";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthenticatedFetch } from "../../../../hooks/useAuthenticatedFetch";

const PRODUCT_SYNC_ROW = { key: "products", api: "/api/sync/products" };

const STALE_SYNC_MS = 24 * 60 * 60 * 1000;
const WAITING_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 4_000;
const STALE_CLOCK_TICK_MS = 60_000;

function stableStringifySyncStatus(ds) {
  return JSON.stringify({
    isProductSyncing: Boolean(ds?.isProductSyncing),
    isProductTypeSyncing: Boolean(ds?.isProductTypeSyncing),
    isCollectionSyncing: Boolean(ds?.isCollectionSyncing),
    lastProductSyncAt: ds?.lastProductSyncAt || null,
    snapshotConsistent:
      typeof ds?.snapshotConsistent === "boolean"
        ? ds.snapshotConsistent
        : null,
    syncFailedAt: ds?.syncFailedAt || null,
    lastProductSyncError: ds?.lastProductSyncError || null,
    activeMirrorBatchId: ds?.activeMirrorBatchId || null,
    activeCatalogBatchId: ds?.activeCatalogBatchId || null,
  });
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const SyncSourceCard = memo(function SyncSourceCard({
  label,
  status,
  lastSyncText,
}) {
  return (
    <Card roundedAbove="sm">
      <Box padding="400">
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center" gap="400" wrap>
            <BlockStack gap="100">
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="h3" variant="headingSm">
                  {label}
                </Text>
                <Badge tone={status.tone}>{status.label}</Badge>
              </InlineStack>

              <Text variant="bodySm" tone="subdued">
                {lastSyncText}
              </Text>
            </BlockStack>
          </InlineStack>
        </BlockStack>
      </Box>
    </Card>
  );
});

export default function DataSyncPage() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const fetchWithAuth = useAuthenticatedFetch();

  const [dataSources, setDataSources] = useState(null);
  const [toast, setToast] = useState({
    active: false,
    message: "",
    error: false,
  });
  const [syncingItem, setSyncingItem] = useState("");
  const [shouldPoll, setShouldPoll] = useState(false);
  const [waitingForSync, setWaitingForSync] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const wasSyncingRef = useRef(false);
  const waitingForSyncRef = useRef(false);
  const lastSyncStatusJsonRef = useRef("");
  const hasShownStatusErrorRef = useRef(false);

  useEffect(() => {
    waitingForSyncRef.current = waitingForSync;
  }, [waitingForSync]);

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, STALE_CLOCK_TICK_MS);

    return () => clearInterval(interval);
  }, []);

  const showToast = useCallback((message, error = false) => {
    setToast({ active: true, message, error });
  }, []);

  const hideToast = useCallback(() => {
    setToast((current) => ({ ...current, active: false }));
  }, []);

  const goToProducts = useCallback(() => {
    navigate("/products");
  }, [navigate]);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [i18n.language]
  );

  const formatDateSafe = useCallback(
    (value) => {
      const date = new Date(value);

      if (Number.isNaN(date.getTime())) {
        return t("unknown", { defaultValue: "Unknown" });
      }

      return dateFormatter.format(date);
    },
    [dateFormatter, t]
  );

  const getMerchantSyncError = useCallback(
    (error) => {
      const map = {
        SHOPIFY_BULK_RUNNING: t("shopifyBulkAlreadyRunning", {
          defaultValue: "Shopify is already processing a catalog sync.",
        }),
        SHOPIFY_TIMEOUT: t("shopifySyncTimeout", {
          defaultValue: "Shopify took too long to return catalog data.",
        }),
        ACCESS_SCOPE_MISSING: t("syncAccessScopeMissing", {
          defaultValue:
            "Required Shopify access is missing. Reinstall the app or contact support.",
        }),
        SNAPSHOT_INCONSISTENT: t("snapshotInconsistentError", {
          defaultValue: "Synced catalog data could not be verified.",
        }),
        SYNC_START_FAILED: t("syncStartFailed", {
          defaultValue: "Catalog sync could not be started.",
        }),
      };

      return (
        map[error] ||
        t("syncGenericFailure", {
          defaultValue: "The last sync did not complete. Try again.",
        })
      );
    },
    [t]
  );

  const getRowLabel = useCallback(
    (key) => {
      const map = {
        products: t("products", { defaultValue: "Products" }),
      };

      return map[key] || key;
    },
    [t]
  );

  const fetchSyncStatus = useCallback(async () => {
    try {
      const response = await fetchWithAuth("/api/sync/sync-status");
      const result = await readJsonResponse(response);

      if (!response.ok || !result?.syncStatus) {
        throw new Error(result?.error || "SYNC_STATUS_INVALID");
      }

      hasShownStatusErrorRef.current = false;

      const ds = result.syncStatus;
      const nextStatusJson = stableStringifySyncStatus(ds);

      if (nextStatusJson !== lastSyncStatusJsonRef.current) {
        lastSyncStatusJsonRef.current = nextStatusJson;
        setDataSources(ds);
      }

      const anyRunning =
        Boolean(ds.isProductSyncing) ||
        Boolean(ds.isProductTypeSyncing) ||
        Boolean(ds.isCollectionSyncing);

      if (waitingForSyncRef.current && anyRunning) {
        setWaitingForSync(false);
      }

      setShouldPoll(anyRunning || waitingForSyncRef.current);
    } catch {
      if (!hasShownStatusErrorRef.current) {
        showToast(
          t("syncStatusLoadFailed", {
            defaultValue: "Could not load sync status.",
          }),
          true
        );
        hasShownStatusErrorRef.current = true;
      }
    } finally {
      setInitialLoading(false);
    }
  }, [fetchWithAuth, showToast, t]);

  useEffect(() => {
    fetchSyncStatus();
  }, [fetchSyncStatus]);

  useEffect(() => {
    if (!shouldPoll) return undefined;

    const interval = setInterval(fetchSyncStatus, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchSyncStatus, shouldPoll]);

  useEffect(() => {
    if (!waitingForSync) return undefined;

    const timeout = setTimeout(() => {
      if (!waitingForSyncRef.current) return;

      setWaitingForSync(false);
      setSyncingItem("");
      setShouldPoll(true);

      fetchSyncStatus();

      showToast(
        t("syncStartTimeout", {
          defaultValue: "Sync did not start. Checking latest sync status.",
        }),
        true
      );
    }, WAITING_TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [fetchSyncStatus, showToast, t, waitingForSync]);

  const isAnySyncRunning =
    Boolean(dataSources?.isProductSyncing) ||
    Boolean(dataSources?.isProductTypeSyncing) ||
    Boolean(dataSources?.isCollectionSyncing);

  const runningSyncLabel = useMemo(() => {
    if (dataSources?.isProductSyncing) {
      return t("products", { defaultValue: "Products" });
    }

    if (dataSources?.isCollectionSyncing) {
      return t("collections", { defaultValue: "Collections" });
    }

    if (dataSources?.isProductTypeSyncing) {
      return t("productTypes", { defaultValue: "Product types" });
    }

    return null;
  }, [
    dataSources?.isCollectionSyncing,
    dataSources?.isProductSyncing,
    dataSources?.isProductTypeSyncing,
    t,
  ]);

  const hasProductSync = Boolean(dataSources?.lastProductSyncAt);

  const lastProductSyncLabel = useMemo(() => {
    if (!dataSources?.lastProductSyncAt) {
      return t("neverSynced", { defaultValue: "Never synced" });
    }

    return formatDateSafe(dataSources.lastProductSyncAt);
  }, [dataSources?.lastProductSyncAt, formatDateSafe, t]);

  const isCatalogStale = useMemo(() => {
    if (!dataSources?.lastProductSyncAt) return false;

    const lastSyncTime = new Date(dataSources.lastProductSyncAt).getTime();
    if (Number.isNaN(lastSyncTime)) return true;

    return now - lastSyncTime > STALE_SYNC_MS;
  }, [dataSources?.lastProductSyncAt, now]);

  const syncDisplayState = useMemo(() => {
    if (!dataSources) return "checking";

    const hasKnownSnapshotConsistency =
      typeof dataSources.snapshotConsistent === "boolean";

    if (waitingForSync || isAnySyncRunning) return "syncing";

    if (dataSources.snapshotConsistent === false) return "inconsistent";

    if (dataSources.syncFailedAt || dataSources.lastProductSyncError) {
      return "failed";
    }

    if (hasProductSync && !hasKnownSnapshotConsistency) {
      return "unknown";
    }

    if (!dataSources.lastProductSyncAt) return "notSynced";

    if (isCatalogStale) return "stale";

    return "ready";
  }, [
    dataSources,
    hasProductSync,
    isAnySyncRunning,
    isCatalogStale,
    waitingForSync,
  ]);

  const syncStateView = useMemo(() => {
    switch (syncDisplayState) {
      case "checking":
        return {
          tone: "info",
          title: t("checkingSyncStatus", {
            defaultValue: "Checking catalog sync status",
          }),
          message: t("checkingSyncStatusMessage", {
            defaultValue: "Checking whether your synced product data is ready.",
          }),
          badge: t("checking", { defaultValue: "Checking" }),
        };

      case "syncing":
        return {
          tone: "warning",
          title: t("catalogSyncRunning", {
            defaultValue: "Catalog sync is running",
          }),
          message: t("catalogSyncRunningMessage", {
            defaultValue:
              "We are updating synced product data. You can keep using the app while this finishes.",
          }),
          badge: t("syncing", { defaultValue: "Syncing" }),
        };

      case "failed":
        return {
          tone: "critical",
          title: t("catalogSyncFailed", {
            defaultValue: "Catalog sync failed",
          }),
          message: getMerchantSyncError(dataSources?.lastProductSyncError),
          badge: t("failed", { defaultValue: "Failed" }),
        };

      case "inconsistent":
        return {
          tone: "critical",
          title: t("catalogDataUnsafe", {
            defaultValue: "Catalog data needs repair",
          }),
          message: t("catalogDataUnsafeMessage", {
            defaultValue:
              "Synced product data is inconsistent. Sync again before bulk editing.",
          }),
          badge: t("unsafe", { defaultValue: "Unsafe" }),
        };

      case "unknown":
        return {
          tone: "attention",
          title: t("catalogSafetyUnknown", {
            defaultValue: "Catalog safety unknown",
          }),
          message: t("catalogSafetyUnknownMessage", {
            defaultValue:
              "Sync status is available, but catalog consistency was not verified. Avoid destructive edits until verification is available.",
          }),
          badge: t("needsVerification", {
            defaultValue: "Needs verification",
          }),
        };

      case "notSynced":
        return {
          tone: "attention",
          title: t("catalogNotSynced", {
            defaultValue: "Run your first catalog sync",
          }),
          message: t("catalogNotSyncedMessage", {
            defaultValue:
              "Sync products before running bulk edits, exports, scheduled jobs, or automatic rules.",
          }),
          badge: t("setupRequired", { defaultValue: "Setup required" }),
        };

      case "stale":
        return {
          tone: "warning",
          title: t("catalogDataStale", {
            defaultValue: "Catalog data is stale",
          }),
          message: t("catalogDataStaleMessage", {
            defaultValue:
              "Your synced product data may be outdated. Sync again before large or destructive edits.",
          }),
          badge: t("stale", { defaultValue: "Stale" }),
        };

      default:
        return {
          tone: "success",
          title: t("catalogReadyForEditing", {
            defaultValue: "Catalog ready for bulk editing",
          }),
          message: t("catalogReadyForEditingMessage", {
            defaultValue:
              "Your synced product data is ready for edits, exports, rules, and undo protection.",
          }),
          badge: t("readyForBulkEditing", {
            defaultValue: "Ready for bulk editing",
          }),
        };
    }
  }, [
    dataSources?.lastProductSyncError,
    getMerchantSyncError,
    syncDisplayState,
    t,
  ]);

  useEffect(() => {
    if (dataSources && syncingItem && !isAnySyncRunning && !waitingForSync) {
      setSyncingItem("");
    }
  }, [dataSources, isAnySyncRunning, syncingItem, waitingForSync]);

  useEffect(() => {
    const didCompleteSuccessfully =
      wasSyncingRef.current &&
      !isAnySyncRunning &&
      !waitingForSync &&
      dataSources &&
      !dataSources.syncFailedAt &&
      !dataSources.lastProductSyncError &&
      dataSources.snapshotConsistent !== false;

    if (didCompleteSuccessfully) {
      showToast(
        t("syncCompletedSuccess", {
          defaultValue: "Catalog sync completed.",
        })
      );
    }

    wasSyncingRef.current = Boolean(isAnySyncRunning || waitingForSync);
  }, [dataSources, isAnySyncRunning, showToast, t, waitingForSync]);

  const getStatus = useCallback(
    (key) => {
      const isRunning =
        Boolean(dataSources?.isProductSyncing) ||
        waitingForSync ||
        syncingItem === key;

      if (isRunning) {
        return {
          label: t("syncing", { defaultValue: "Syncing" }),
          tone: "warning",
        };
      }

      if (dataSources?.snapshotConsistent === false) {
        return {
          label: t("unsafe", { defaultValue: "Unsafe" }),
          tone: "critical",
        };
      }

      if (dataSources?.syncFailedAt || dataSources?.lastProductSyncError) {
        return {
          label: t("failed", { defaultValue: "Failed" }),
          tone: "critical",
        };
      }

      if (
        hasProductSync &&
        typeof dataSources?.snapshotConsistent !== "boolean"
      ) {
        return {
          label: t("needsVerification", {
            defaultValue: "Needs verification",
          }),
          tone: "attention",
        };
      }

      if (!dataSources?.lastProductSyncAt) {
        return {
          label: t("notSyncedYet", { defaultValue: "Not synced yet" }),
          tone: "attention",
        };
      }

      if (isCatalogStale) {
        return {
          label: t("stale", { defaultValue: "Stale" }),
          tone: "warning",
        };
      }

      return {
        label: t("synced", { defaultValue: "Synced" }),
        tone: "success",
      };
    },
    [
      dataSources?.isProductSyncing,
      dataSources?.lastProductSyncAt,
      dataSources?.lastProductSyncError,
      dataSources?.snapshotConsistent,
      dataSources?.syncFailedAt,
      hasProductSync,
      isCatalogStale,
      syncingItem,
      t,
      waitingForSync,
    ]
  );

  const syncButtonLabel = useMemo(() => {
    if (isAnySyncRunning || waitingForSync) {
      return t("syncingCatalog", { defaultValue: "Syncing catalog" });
    }

    if (!hasProductSync) {
      return t("runFirstCatalogSync", {
        defaultValue: "Run first catalog sync",
      });
    }

    if (syncDisplayState === "failed" || syncDisplayState === "inconsistent") {
      return t("retryCatalogSync", { defaultValue: "Retry catalog sync" });
    }

    return t("syncCatalogNow", { defaultValue: "Sync catalog now" });
  }, [hasProductSync, isAnySyncRunning, syncDisplayState, t, waitingForSync]);

  const handleRefresh = useCallback(
    async (row) => {
      hasShownStatusErrorRef.current = false;

      if (isAnySyncRunning || syncingItem) {
        showToast(
          runningSyncLabel
            ? t("syncBlockedByRunningSource", {
                source: runningSyncLabel,
                defaultValue: `${runningSyncLabel} sync is already running.`,
              })
            : t("syncAlreadyRunning", {
                defaultValue: "A catalog sync is already running.",
              }),
          true
        );
        return;
      }

      setSyncingItem(row.key);
      setWaitingForSync(true);
      setShouldPoll(true);

      try {
       const response = await fetchWithAuth(row.api, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const result = await readJsonResponse(response);

        if (!response.ok) {
          throw new Error(result?.error || "SYNC_START_FAILED");
        }

        showToast(
          t("syncStarted", {
            item: getRowLabel(row.key),
            defaultValue: `${getRowLabel(row.key)} sync started.`,
          })
        );

        fetchSyncStatus();
      } catch (error) {
        showToast(getMerchantSyncError(error.message), true);
        setSyncingItem("");
        setWaitingForSync(false);
        setShouldPoll(false);
      }
    },
    [
      fetchWithAuth,
      fetchSyncStatus,
      getMerchantSyncError,
      getRowLabel,
      isAnySyncRunning,
      runningSyncLabel,
      showToast,
      syncingItem,
      t,
    ]
  );

  const handleSyncProducts = useCallback(() => {
    handleRefresh(PRODUCT_SYNC_ROW);
  }, [handleRefresh]);

  const productStatus = useMemo(() => getStatus("products"), [getStatus]);

  const productLastSyncText = hasProductSync
    ? `${t("lastSync", { defaultValue: "Last sync" })}: ${lastProductSyncLabel}`
    : t("initialSyncHint", {
        defaultValue:
          "Run your first sync to make products available for bulk editing.",
      });

  const syncDisabled = isAnySyncRunning || Boolean(syncingItem);
  const syncLoading = syncingItem === "products" || waitingForSync;

  const disabledReason =
    syncDisabled && !syncLoading
      ? runningSyncLabel
        ? t("syncBlockedByRunningSource", {
            source: runningSyncLabel,
            defaultValue: `${runningSyncLabel} sync is already running.`,
          })
        : t("syncActionDisabledReason", {
            defaultValue: "Another sync is already running.",
          })
      : "";

  const syncButtonAccessibilityLabel = disabledReason
    ? `${syncButtonLabel}. ${disabledReason}`
    : syncButtonLabel;

  const metrics = useMemo(
    () => [
      {
        key: "status",
        label: t("status", { defaultValue: "Status" }),
        value: syncStateView.badge,
      },
      {
        key: "lastSync",
        label: t("lastSync", { defaultValue: "Last sync" }),
        value: lastProductSyncLabel,
      },
      {
        key: "source",
        label: t("source", { defaultValue: "Source" }),
        value: t("products", { defaultValue: "Products" }),
      },
    ],
    [lastProductSyncLabel, syncStateView.badge, t]
  );

  return (
    <Page
      backAction={{
        content: t("back", { defaultValue: "Back" }),
        icon: ArrowLeftIcon,
        onAction: goToProducts,
      }}
      title={t("productCatalogSync", {
        defaultValue: "Product catalog sync",
      })}
      subtitle={t("productCatalogSyncSubtitle", {
        defaultValue:
          "Keep synced product data ready for bulk edits, exports, scheduled jobs, rules, and undo protection.",
      })}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card roundedAbove="sm">
              <Box padding="500" minHeight="220px">
                {initialLoading ? (
                  <BlockStack gap="400">
                    <SkeletonBodyText lines={2} />
                    <InlineStack gap="600" wrap>
                      <SkeletonBodyText lines={2} />
                      <SkeletonBodyText lines={2} />
                      <SkeletonBodyText lines={2} />
                    </InlineStack>
                    <SkeletonBodyText lines={1} />
                  </BlockStack>
                ) : (
                  <BlockStack gap="400">
                    <InlineStack
                      align="space-between"
                      blockAlign="start"
                      gap="400"
                      wrap
                    >
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center" wrap>
                          <Text as="h2" variant="headingMd">
                            {syncStateView.title}
                          </Text>
                          <Badge tone={syncStateView.tone}>
                            {syncStateView.badge}
                          </Badge>
                        </InlineStack>

                        <Text as="p" tone="subdued" variant="bodyMd">
                          {syncStateView.message}
                        </Text>
                      </BlockStack>

                      <Button
                        type="button"
                        variant="primary"
                        loading={syncLoading}
                        disabled={syncDisabled}
                        accessibilityLabel={syncButtonAccessibilityLabel}
                        onClick={handleSyncProducts}
                      >
                        {syncButtonLabel}
                      </Button>
                    </InlineStack>

                    <InlineStack gap="600" wrap>
                      {metrics.map((metric) => (
                        <BlockStack key={metric.key} gap="050">
                          <Text as="span" tone="subdued" variant="bodySm">
                            {metric.label}
                          </Text>
                          <Text as="span" variant="bodyMd">
                            {metric.value}
                          </Text>
                        </BlockStack>
                      ))}
                    </InlineStack>

                    {disabledReason ? (
                      <Text as="p" variant="bodySm" tone="subdued">
                        {disabledReason}
                      </Text>
                    ) : null}

                    {syncDisplayState === "syncing" ? (
                      <Banner tone="warning">
                        {t("syncBackgroundMessage", {
                          defaultValue:
                            "Sync continues in the background. This page updates automatically.",
                        })}
                      </Banner>
                    ) : null}

                    {syncDisplayState === "failed" ||
                    syncDisplayState === "inconsistent" ||
                    syncDisplayState === "unknown" ? (
                      <Banner
                        tone={
                          syncDisplayState === "unknown"
                            ? "warning"
                            : "critical"
                        }
                      >
                        <BlockStack gap="200">
                          <Text as="p">{syncStateView.message}</Text>
                          <InlineStack gap="200">
                            <Button onClick={handleSyncProducts}>
                              {syncDisplayState === "unknown"
                                ? t("verifyCatalogData", {
                                    defaultValue: "Verify catalog data",
                                  })
                                : t("retrySync", {
                                    defaultValue: "Retry sync",
                                  })}
                            </Button>
                          </InlineStack>
                        </BlockStack>
                      </Banner>
                    ) : null}

                    {syncDisplayState === "stale" ? (
                      <Banner tone="warning">
                        {t("staleSyncWarning", {
                          defaultValue:
                            "Sync before large or destructive edits to avoid applying changes from outdated catalog data.",
                        })}
                      </Banner>
                    ) : null}

                    {syncDisplayState === "ready" ? (
                      <InlineStack gap="200" wrap>
                        <Button variant="primary" onClick={goToProducts}>
                          {t("startBulkEditing", {
                            defaultValue: "Start bulk editing",
                          })}
                        </Button>
                        <Button onClick={handleSyncProducts}>
                          {t("syncAgain", { defaultValue: "Sync again" })}
                        </Button>
                      </InlineStack>
                    ) : null}
                  </BlockStack>
                )}
              </Box>
            </Card>

            <SyncSourceCard
              label={getRowLabel("products")}
              status={productStatus}
              lastSyncText={productLastSyncText}
            />

            <Card roundedAbove="sm">
              <Box padding="500">
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    {t("syncedCatalogData", {
                      defaultValue: "Synced catalog data",
                    })}
                  </Text>

                  <Text as="p" tone="subdued" variant="bodyMd">
                    {t("syncedCatalogDataText", {
                      defaultValue:
                        "This data powers previews, targeting, exports, scheduled jobs, automatic rules, and undo protection.",
                    })}
                  </Text>

                  <Divider />

                  <Box
                    background="bg-surface-secondary"
                    padding="300"
                    borderRadius="300"
                    borderWidth="025"
                    borderStyle="solid"
                    borderColor="border-secondary"
                  >
                    <Text as="p" variant="bodySm">
                      {t("syncRefreshHint", {
                        defaultValue:
                          "Large catalogs can take several minutes. You can leave this page while sync continues.",
                      })}
                    </Text>
                  </Box>
                </BlockStack>
              </Box>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      {toast.active ? (
        <Toast
          content={toast.message}
          error={toast.error}
          onDismiss={hideToast}
        />
      ) : null}
    </Page>
  );
}
