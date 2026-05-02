import {
  Page,
  Text,
  Banner,
  Card,
  Button,
  List,
  InlineStack,
  Layout,
  Modal,
  Box,
  BlockStack,
  SkeletonBodyText,
  Badge,
} from "@shopify/polaris";
import { useMemo, useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import { useTranslation } from "react-i18next";
import { getTranslatedOperatorLabel } from "../utils/filterUtils";
import ProductsFilters from "../components/ProductsFilters";
import ProductsTable from "../components/ProductsTable";
import useProducts from "../hooks/useProducts";
import { useBulkTargetSelection } from "../hooks/useBulkTargetSelection";
import { getFilterByKey } from "../constants";
import { useAuthenticatedFetch } from "../../../../hooks/useAuthenticatedFetch";

import {
  selectProducts,
  selectFilters,
  selectSearch,
  selectProductCount,
  selectPagination,
  selectPage,
  setFilters,
  setSearch,
  clearFilters,
  setFrozenTarget,
} from "../../../../store/slices/productSlice";

const PRODUCT_SORT_KEY = "TITLE";
const PRODUCT_SORT_ORDER = "asc";
const PRODUCT_LIST_SORT = {
  sortKey: PRODUCT_SORT_KEY,
  sortOrder: PRODUCT_SORT_ORDER,
};

function getSyncState({ syncStatus, loading }) {
  if (loading) {
    return "checking";
  }

  if (!syncStatus) {
    return "unknown";
  }

  if (
    syncStatus.isCurrentlyRunning ||
    syncStatus.isProductSyncing ||
    syncStatus.isProductInitialySyning
  ) {
    return "syncing";
  }

  const latestStatus = String(
    syncStatus.latestSync?.status || ""
  ).toLowerCase();
  if (
    syncStatus.repairRequired ||
    syncStatus.lastSyncErrorSummary ||
    latestStatus === "failed" ||
    latestStatus === "error"
  ) {
    return "failed";
  }

  const healthState = String(syncStatus.mirrorHealthState || "").toLowerCase();
  if (healthState === "stale" || syncStatus.staleReason) {
    return "stale";
  }

  if (
    healthState === "healthy" ||
    healthState === "ready" ||
    syncStatus.shopifyBulkJobCompleted
  ) {
    return "ready";
  }

  return "unknown";
}

function getSyncBannerView({ state, t }) {
  switch (state) {
    case "checking":
      return {
        tone: "info",
        message: t("syncCheckingMessage", {
          defaultValue: "Checking catalog sync status.",
        }),
      };
    case "syncing":
      return {
        tone: "info",
        message: t("syncRunningMessage", {
          defaultValue:
            "Catalog sync is running. Bulk targets will update when syncing completes.",
        }),
      };
    case "stale":
      return {
        tone: "warning",
        message: t("syncStaleMessage", {
          defaultValue:
            "Catalog data may be stale. Sync before large edits or exports.",
        }),
      };
    case "failed":
      return {
        tone: "critical",
        message: t("syncFailedMessage", {
          defaultValue:
            "The last catalog sync failed. Retry before running bulk actions.",
        }),
      };
    case "ready":
      return {
        tone: "success",
        message: t("syncReadyMessage", {
          defaultValue: "Catalog data is ready for targeting.",
        }),
      };
    default:
      return {
        tone: "warning",
        message: t("syncUnknownMessage", {
          defaultValue:
            "Catalog consistency is unknown. Sync before destructive changes.",
        }),
      };
  }
}

function Metric({ label, value }) {
  return (
    <BlockStack gap="050">
      <Text as="span" tone="subdued" variant="bodySm">
        {label}
      </Text>
      <Text as="span" variant="headingMd">
        {value}
      </Text>
    </BlockStack>
  );
}

function getUndoState(action) {
  return String(
    action?.undo?.status ?? action?.undoStatusSummary?.key ?? "idle"
  )
    .trim()
    .toLowerCase();
}

function canUndoLastAction(action) {
  const status = String(action?.status || "")
    .trim()
    .toLowerCase();
  const executionState = String(action?.executionState || "")
    .trim()
    .toLowerCase();
  const undoState = getUndoState(action);
  const undoAllowed =
    action?.undo == null ? true : action.undo.allowed === true;

  return (
    undoAllowed &&
    (status === "completed" || executionState === "completed") &&
    ["idle", "failed", "undo_failed"].includes(undoState)
  );
}

export default function ProductsPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const fetchWithAuth = useAuthenticatedFetch();

  const products = useSelector(selectProducts);
  const filterState = useSelector(selectFilters);
  const totalCount = useSelector(selectProductCount);
  const pagination = useSelector(selectPagination);
  const page = useSelector(selectPage);
  const search = useSelector(selectSearch);
  const { i18n, t } = useTranslation();

  const { loading, error, hasFetched, fetchProducts } = useProducts();

  const [syncStatus, setSyncStatus] = useState(null);
  const [syncStatusLoading, setSyncStatusLoading] = useState(true);
  const [syncActionLoading, setSyncActionLoading] = useState(false);
  const [targetAction, setTargetAction] = useState("");
  const [targetActionError, setTargetActionError] = useState("");
  const [showBulkEditConfirm, setShowBulkEditConfirm] = useState(false);
  const [targetPreview, setTargetPreview] = useState(null);
  const [targetPreviewLoading, setTargetPreviewLoading] = useState(false);
  const [lastAction, setLastAction] = useState(null);
  const [undoingLastAction, setUndoingLastAction] = useState(false);

  const [syncCompleted, setSyncCompleted] = useState(false);
  const wasSyncingRef = useRef(false);
  const previousQuerySignatureRef = useRef("");

  const fetchSyncStatus = useCallback(async () => {
    try {
      const response = await fetchWithAuth("/api/sync/sync-status");
      const result = await response.json();

      if (response.ok && result?.syncStatus) {
        setSyncStatus(result.syncStatus);
        return result.syncStatus;
      }
    } catch {
      // Keep the page usable if the sync-status call fails.
    } finally {
      setSyncStatusLoading(false);
    }
  }, [fetchWithAuth]);

  const fetchLastAction = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        limit: "1",
        lang: i18n.language || "en",
      });
      const response = await fetchWithAuth(
        `/api/history/get-shop-edithistory?${params.toString()}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
        }
      );
      const result = await response.json();

      if (response.ok && Array.isArray(result?.data)) {
        setLastAction(result.data[0] || null);
      }
    } catch {
      setLastAction(null);
    }
  }, [fetchWithAuth, i18n.language]);

  const effectiveFilters = useMemo(() => {
    const baseFilters = filterState.filter((f) => f.field !== "search");

    if (!search?.trim()) {
      return baseFilters;
    }

    return [
      ...baseFilters,
      {
        field: "search",
        operator: "contains",
        value: search.trim(),
      },
    ];
  }, [filterState, search]);

  const querySignature = useMemo(
    () =>
      JSON.stringify({
        search: search?.trim() || "",
        filters: effectiveFilters,
        sort: null,
      }),
    [effectiveFilters, search]
  );

  useEffect(() => {
    fetchProducts(1, effectiveFilters, PRODUCT_LIST_SORT);
  }, [effectiveFilters, fetchProducts]);

  useEffect(() => {
    fetchLastAction();
  }, [fetchLastAction]);

  useEffect(() => {
    let cancelled = false;

    const fetchTargetPreview = async () => {
      setTargetPreviewLoading(true);

      try {
        const response = await fetchWithAuth("/api/products/targets/count", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            filters: effectiveFilters,
            search: search?.trim() || "",
            sort: null,
          }),
        });
        const result = await response.json();

        if (!cancelled && response.ok) {
          setTargetPreview(result);
        }
      } catch {
        if (!cancelled) {
          setTargetPreview(null);
        }
      } finally {
        if (!cancelled) {
          setTargetPreviewLoading(false);
        }
      }
    };

    fetchTargetPreview();

    return () => {
      cancelled = true;
    };
  }, [effectiveFilters, fetchWithAuth, querySignature, search]);

  useEffect(() => {
    const run = async () => {
      try {
        const status = await fetchSyncStatus();

        const neverSynced =
          !status?.shopifyBulkJobCompleted &&
          !status?.isProductSyncing &&
          !status?.isProductInitialySyning;

        if (neverSynced) {
          await fetchWithAuth("/api/sync/products");
        }
      } catch (e) {
        console.error("AUTO SYNC FAILED", e);
      }
    };

    run();
  }, [fetchSyncStatus, fetchWithAuth]);

  useEffect(() => {
    const isSyncRunning =
      syncStatus?.isProductSyncing || syncStatus?.isProductInitialySyning;

    if (!isSyncRunning) {
      return undefined;
    }

    const interval = setInterval(fetchSyncStatus, 4000);
    return () => clearInterval(interval);
  }, [
    syncStatus?.isProductSyncing,
    syncStatus?.isProductInitialySyning,
    fetchSyncStatus,
  ]);

  useEffect(() => {
    const isSyncing =
      Boolean(syncStatus?.isProductSyncing) ||
      Boolean(syncStatus?.isProductInitialySyning);

    const justCompleted =
      wasSyncingRef.current &&
      !isSyncing &&
      Boolean(syncStatus?.shopifyBulkJobCompleted) &&
      Boolean(syncStatus?.activeMirrorBatchId);

    if (justCompleted) {
      setSyncCompleted(true);
      fetchProducts(1, effectiveFilters, PRODUCT_LIST_SORT);
    }

    wasSyncingRef.current = isSyncing;
  }, [
    syncStatus?.isProductSyncing,
    syncStatus?.isProductInitialySyning,
    syncStatus?.shopifyBulkJobCompleted,
    syncStatus?.activeMirrorBatchId,
    fetchProducts,
    effectiveFilters,
  ]);

  const onFilterChange = useCallback(
    (field, nextFilter) => {
      const updated = (() => {
        const index = filterState.findIndex((f) => f.field === field);
        if (index !== -1) {
          const copy = [...filterState];
          copy[index] = { field, ...nextFilter };
          return copy;
        }
        return [...filterState, { field, ...nextFilter }];
      })();

      dispatch(setFilters(updated));
    },
    [filterState, dispatch]
  );

  const onClearAll = useCallback(() => {
    dispatch(clearFilters());
    fetchProducts(1, [], PRODUCT_LIST_SORT);
  }, [dispatch, fetchProducts]);

  const handleSearchChange = useCallback(
    (value) => {
      dispatch(setSearch(value));
    },
    [dispatch]
  );

  const handleSearchClear = useCallback(() => {
    dispatch(setSearch(""));
  }, [dispatch]);

  const appliedFilters = useMemo(
    () =>
      filterState
        .filter((f) => f.field !== "search")
        .map(({ field, operator, value }) => {
          const filter = getFilterByKey(field);

          const translatedFieldLabel = t(
            `fieldLabels.${field}`,
            filter?.label || field
          );

          const translatedOperator = getTranslatedOperatorLabel(t, operator);

          const translatedValue =
            filter?.type === "enum"
              ? t(`filterValueLabels.${value}`, value)
              : value;

          return {
            key: field,
            label: `${translatedFieldLabel} ${translatedOperator} ${translatedValue}`,
            operator,
            value,
            onRemove: () =>
              dispatch(
                setFilters(filterState.filter((f) => f.field !== field))
              ),
          };
        }),
    [filterState, dispatch, t]
  );

  const selection = useBulkTargetSelection({
    products,
    totalMatching: totalCount,
    querySignature,
    filters: effectiveFilters,
    search: search?.trim() || "",
    sort: null,
  });

  useEffect(() => {
    if (previousQuerySignatureRef.current === querySignature) return;

    previousQuerySignatureRef.current = querySignature;
    selection.clearSelection();
  }, [querySignature, selection.clearSelection]);

  const handleRetryProducts = useCallback(() => {
    fetchProducts(page, effectiveFilters, PRODUCT_LIST_SORT);
  }, [effectiveFilters, fetchProducts, page]);

  const handleNextPage = useCallback(() => {
    fetchProducts(page + 1, effectiveFilters, PRODUCT_LIST_SORT);
  }, [effectiveFilters, fetchProducts, page]);

  const handlePreviousPage = useCallback(() => {
    fetchProducts(page - 1, effectiveFilters, PRODUCT_LIST_SORT);
  }, [effectiveFilters, fetchProducts, page]);

  const goRefresh = useCallback(() => {
    navigate("/refresh");
  }, [navigate]);

  const isSyncInProgress =
    Boolean(syncStatus?.isProductSyncing) ||
    Boolean(syncStatus?.isProductInitialySyning);
  const syncState = getSyncState({
    syncStatus,
    loading: syncStatusLoading,
  });
  const syncBannerView = getSyncBannerView({ state: syncState, t });

  const runSync = useCallback(async () => {
    if (syncActionLoading) return;

    setSyncActionLoading(true);

    try {
      await fetchWithAuth("/api/sync/products");
      await fetchSyncStatus();
    } finally {
      setSyncActionLoading(false);
    }
  }, [fetchSyncStatus, fetchWithAuth, syncActionLoading]);

  const shouldShowLoadingState =
    loading ||
    !hasFetched ||
    (!products.length && (syncStatusLoading || isSyncInProgress));

  const freezeTarget = useCallback(async () => {
    const selectionPayload = selection.buildTargetPayload();
    const payload =
      selectionPayload.mode === "ids" && selectionPayload.ids.length === 0
        ? {
            mode: "query",
            querySignature,
            filters: effectiveFilters,
            search: search?.trim() || "",
            sort: null,
            excludedIds: [],
          }
        : selectionPayload;

    const response = await fetchWithAuth("/api/products/targets/freeze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    if (!response.ok || !result?.targetSnapshotId) {
      throw new Error(
        result?.message || result?.error || "TARGET_FREEZE_FAILED"
      );
    }

    return {
      ...result,
      payload,
    };
  }, [effectiveFilters, fetchWithAuth, querySignature, search, selection]);

  const navigateWithFrozenTarget = useCallback(
    (destination, frozenTarget, actionKey) => {
      dispatch(
        setFrozenTarget({
          targetSnapshotId: frozenTarget.targetSnapshotId,
          count: frozenTarget.count,
          payload: frozenTarget.payload,
          action: actionKey,
        })
      );

      navigate(
        `${destination}?targetSnapshotId=${encodeURIComponent(
          frozenTarget.targetSnapshotId
        )}`,
        {
          state: {
            targetSnapshotId: frozenTarget.targetSnapshotId,
            targetCount: frozenTarget.count,
            targetPayload: frozenTarget.payload,
          },
        }
      );
    },
    [dispatch, navigate]
  );

  const handleBulkEdit = useCallback(async () => {
    if (targetAction || shouldShowLoadingState || totalCount <= 0) return;

    setTargetAction("edit");
    setTargetActionError("");

    try {
      const frozenTarget = await freezeTarget();
      navigateWithFrozenTarget("/edit", frozenTarget, "edit");
    } catch (error) {
      setTargetActionError(
        error.message || "Could not prepare the selected product target."
      );
    } finally {
      setTargetAction("");
    }
  }, [
    freezeTarget,
    navigateWithFrozenTarget,
    shouldShowLoadingState,
    targetAction,
    totalCount,
  ]);

  const handleUndoLastAction = useCallback(async () => {
    if (!lastAction?.id || !canUndoLastAction(lastAction)) return;

    setUndoingLastAction(true);

    try {
      const response = await fetchWithAuth(
        `/api/products/undo-edit/${lastAction.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
        }
      );

      if (response.ok) {
        setLastAction((current) =>
          current?.id === lastAction.id
            ? {
                ...current,
                undo: {
                  ...current.undo,
                  status: "processing",
                  state: "queued",
                  startedAt: new Date().toISOString(),
                },
                undoStatusSummary: {
                  key: "undo_queued",
                  tone: "attention",
                  isTerminal: false,
                },
              }
            : current
        );
      }
    } finally {
      setUndoingLastAction(false);
    }
  }, [fetchWithAuth, lastAction]);

  const openBulkEditConfirm = useCallback(() => {
    if (targetAction || shouldShowLoadingState || totalCount <= 0) return;

    setTargetActionError("");
    setShowBulkEditConfirm(true);
  }, [shouldShowLoadingState, targetAction, totalCount]);

  const closeBulkEditConfirm = useCallback(() => {
    if (targetAction) return;

    setShowBulkEditConfirm(false);
  }, [targetAction]);

  const confirmBulkEdit = useCallback(async () => {
    await handleBulkEdit();
    setShowBulkEditConfirm(false);
  }, [handleBulkEdit]);

  const handleBulkExport = useCallback(async () => {
    if (targetAction || shouldShowLoadingState || totalCount <= 0) return;

    setTargetAction("export");
    setTargetActionError("");

    try {
      const frozenTarget = await freezeTarget();
      navigateWithFrozenTarget("/exportdata", frozenTarget, "export");
    } catch (error) {
      setTargetActionError(
        error.message || "Could not prepare the selected product target."
      );
    } finally {
      setTargetAction("");
    }
  }, [
    freezeTarget,
    navigateWithFrozenTarget,
    shouldShowLoadingState,
    targetAction,
    totalCount,
  ]);

  const shouldShowEmptyState =
    !shouldShowLoadingState &&
    !error &&
    hasFetched &&
    !isSyncInProgress &&
    totalCount === 0;

  const resultSummary = useMemo(() => {
    if (shouldShowLoadingState) {
      return <SkeletonBodyText lines={1} />;
    }

    if (totalCount > 0) {
      return (
        <InlineStack gap="200" blockAlign="center">
          <Badge tone="info">{totalCount}</Badge>
          <Text variant="bodySm" tone="subdued">
            {t("productsMatch")}
          </Text>
        </InlineStack>
      );
    }

    if (shouldShowEmptyState) {
      return (
        <Text variant="bodySm" tone="subdued">
          {t("noProductsMatch")}
        </Text>
      );
    }

    if (isSyncInProgress) {
      return (
        <Text variant="bodySm" tone="subdued">
          {t("productsSyncingInBackground", {
            defaultValue: "Products are syncing in the background.",
          })}
        </Text>
      );
    }

    return null;
  }, [
    isSyncInProgress,
    shouldShowEmptyState,
    shouldShowLoadingState,
    t,
    totalCount,
  ]);

  const formatMetric = useCallback(
    (value) => Number(value || 0).toLocaleString(i18n.language),
    [i18n.language]
  );
  const bulkEditTargetCount =
    selection.selectedCount > 0
      ? selection.selectedCount
      : targetPreview?.total ?? totalCount;
  const bulkEditTargetLabel = formatMetric(bulkEditTargetCount);
  const hasSelection = selection.selectedCount > 0;
  const targetActionDisabled =
    Boolean(targetAction) || shouldShowLoadingState || totalCount <= 0;
  const pagePrimaryAction = hasSelection
    ? undefined
    : {
        content: t("edit", { defaultValue: "Edit" }),
        accessibilityLabel: t("editMatchingProductsAccessibilityLabel", {
          defaultValue: "Edit matching products",
        }),
        onAction: openBulkEditConfirm,
        loading: targetAction === "edit",
        disabled: targetActionDisabled,
      };
  const pageSecondaryActions = hasSelection
    ? []
    : [
        {
          content: t("export", { defaultValue: "Export" }),
          accessibilityLabel: t("exportMatchingProductsAccessibilityLabel", {
            defaultValue: "Export matching products",
          }),
          onAction: handleBulkExport,
          loading: targetAction === "export",
          disabled: targetActionDisabled,
        },
      ];

  return (
    <Page
      title={t("pageTitle")}
      subtitle={t("pageSubtitle")}
      fullWidth
      primaryAction={pagePrimaryAction}
      secondaryActions={pageSecondaryActions}
    >
      <Layout>
        <Layout.Section>
          <Banner tone={syncBannerView.tone}>
            <InlineStack
              align="space-between"
              blockAlign="center"
              gap="300"
              wrap
            >
              <Text as="p">{syncBannerView.message}</Text>

              <InlineStack gap="200">
                {syncState === "stale" ? (
                  <Button
                    onClick={runSync}
                    loading={syncActionLoading}
                    disabled={syncActionLoading}
                    accessibilityLabel={t("syncNowAccessibilityLabel", {
                      defaultValue: "Sync catalog now",
                    })}
                  >
                    {t("syncNow", { defaultValue: "Sync now" })}
                  </Button>
                ) : null}

                {syncState === "failed" ? (
                  <Button
                    onClick={runSync}
                    loading={syncActionLoading}
                    disabled={syncActionLoading}
                    accessibilityLabel={t("retrySyncAccessibilityLabel", {
                      defaultValue: "Retry catalog sync",
                    })}
                  >
                    {t("retry", { defaultValue: "Retry" })}
                  </Button>
                ) : null}
              </InlineStack>
            </InlineStack>
          </Banner>
        </Layout.Section>

        {targetActionError ? (
          <Layout.Section>
            <Banner
              tone="critical"
              title={t("targetFreezeFailed", {
                defaultValue: "Could not prepare product target",
              })}
              onDismiss={() => setTargetActionError("")}
            >
              <Text as="p">{targetActionError}</Text>
            </Banner>
          </Layout.Section>
        ) : null}

        {lastAction ? (
          <Layout.Section>
            <Card>
              <Box padding="500">
                <InlineStack
                  align="space-between"
                  blockAlign="center"
                  gap="300"
                  wrap
                >
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      {t("lastAction", { defaultValue: "Last action" })}
                    </Text>
                    <Text as="p" variant="bodyMd">
                      {t("lastActionEditedProducts", {
                        count:
                          lastAction.targetSnapshotCount ||
                          lastAction.totalItems ||
                          lastAction.processedCount ||
                          0,
                        defaultValue: `Edited ${formatMetric(
                          lastAction.targetSnapshotCount ||
                            lastAction.totalItems ||
                            lastAction.processedCount ||
                            0
                        )} products`,
                      })}
                    </Text>
                  </BlockStack>

                  <Button
                    tone="critical"
                    onClick={handleUndoLastAction}
                    loading={undoingLastAction}
                    accessibilityLabel={t("undoLastActionAccessibilityLabel", {
                      defaultValue: "Undo last action",
                    })}
                    disabled={
                      undoingLastAction || !canUndoLastAction(lastAction)
                    }
                  >
                    {t("undo", { defaultValue: "Undo" })}
                  </Button>
                </InlineStack>
              </Box>
            </Card>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <Card>
            <Box padding="500">
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    {t("targetPreview", { defaultValue: "Target preview" })}
                  </Text>
                  <Badge tone="info">
                    {targetPreviewLoading
                      ? t("checking", { defaultValue: "Checking" })
                      : formatMetric(targetPreview?.total ?? totalCount)}
                  </Badge>
                </InlineStack>

                <InlineStack gap="600" wrap>
                  <Metric
                    label={t("products", { defaultValue: "Products" })}
                    value={formatMetric(targetPreview?.total ?? totalCount)}
                  />
                  <Metric
                    label={t("vendors", { defaultValue: "Vendors" })}
                    value={formatMetric(targetPreview?.vendorsCount)}
                  />
                  <Metric
                    label={t("types", { defaultValue: "Types" })}
                    value={formatMetric(targetPreview?.typesCount)}
                  />
                  <Metric
                    label={t("inStock", { defaultValue: "In stock" })}
                    value={formatMetric(targetPreview?.inStockCount)}
                  />
                </InlineStack>

                <Text as="p" tone="subdued" variant="bodySm">
                  {t("targetPreviewDescription", {
                    defaultValue:
                      "Based on current filters - updates instantly",
                  })}
                </Text>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <Box padding="500">
              <InlineStack
                align="space-between"
                blockAlign="center"
                gap="300"
                wrap
              >
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    {t("productTargeting")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("productTargetingDescription")}
                  </Text>
                </BlockStack>
                <InlineStack gap="200" blockAlign="center">
                  {resultSummary}
                  <Button
                    variant="plain"
                    onClick={goRefresh}
                    accessibilityLabel={t("viewSyncStatusAccessibilityLabel", {
                      defaultValue: "View product sync status",
                    })}
                  >
                    {t("Syncyourproducts")}
                  </Button>
                </InlineStack>
              </InlineStack>
            </Box>
          </Card>
        </Layout.Section>
        {syncCompleted && (
          <Layout.Section>
            <Banner
              tone="success"
              title={t("syncComplete", { defaultValue: "Sync complete" })}
              onDismiss={() => setSyncCompleted(false)}
            >
              <Text as="p">
                {t("productsSyncCompletedMessage", {
                  defaultValue: "Products have been synced successfully.",
                })}
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {hasSelection && (
          <Layout.Section>
            <Box position="sticky" insetBlockStart="0" zIndex="1">
              <Banner tone={selection.mode === "query" ? "success" : "info"}>
                <InlineStack
                  align="space-between"
                  blockAlign="center"
                  gap="300"
                  wrap
                >
                  <Box minWidth="0">
                    <Text as="p">
                      {selection.mode === "query"
                        ? t("allMatchingProductsSelected", {
                            count: selection.selectedCount,
                            excluded: selection.excludedCount,
                            defaultValue: `${selection.selectedCount.toLocaleString(
                              i18n.language
                            )} selected${
                              selection.excludedCount > 0
                                ? ` (${selection.excludedCount.toLocaleString(
                                    i18n.language
                                  )} excluded)`
                                : ""
                            }`,
                          })
                        : t("pageProductsSelected", {
                            count: selection.selectedCount,
                            defaultValue: `${selection.selectedCount.toLocaleString(
                              i18n.language
                            )} selected`,
                          })}
                    </Text>
                  </Box>

                  <InlineStack gap="200" wrap>
                    {selection.mode !== "query" &&
                    selection.pageCount > 0 &&
                    totalCount > selection.pageCount ? (
                      <Button
                        type="button"
                        onClick={selection.selectAllMatching}
                        disabled={Boolean(targetAction)}
                        accessibilityLabel={t(
                          "selectAllMatchingProductsAccessibilityLabel",
                          {
                            count: totalCount,
                            defaultValue: `Select all ${Number(
                              totalCount
                            ).toLocaleString(i18n.language)} matching products`,
                          }
                        )}
                      >
                        {t("selectAllMatchingProducts", {
                          count: totalCount,
                          defaultValue: `Select all ${Number(
                            totalCount
                          ).toLocaleString(i18n.language)}`,
                        })}
                      </Button>
                    ) : null}

                    <Button
                      type="button"
                      onClick={openBulkEditConfirm}
                      loading={targetAction === "edit"}
                      disabled={Boolean(targetAction)}
                      accessibilityLabel={t("editSelectedAccessibilityLabel", {
                        defaultValue: "Edit selected products",
                      })}
                    >
                      {t("edit", { defaultValue: "Edit" })}
                    </Button>

                    <Button
                      type="button"
                      onClick={handleBulkExport}
                      loading={targetAction === "export"}
                      disabled={Boolean(targetAction)}
                      accessibilityLabel={t(
                        "exportSelectedAccessibilityLabel",
                        {
                          defaultValue: "Export selected products",
                        }
                      )}
                    >
                      {t("export", { defaultValue: "Export" })}
                    </Button>

                    <Button
                      type="button"
                      variant="plain"
                      onClick={selection.clearSelection}
                      disabled={Boolean(targetAction)}
                      accessibilityLabel={t(
                        "clearSelectionAccessibilityLabel",
                        {
                          defaultValue: "Clear product selection",
                        }
                      )}
                    >
                      {t("clearSelection", {
                        defaultValue: "Clear selection",
                      })}
                    </Button>
                  </InlineStack>
                </InlineStack>
              </Banner>
            </Box>
          </Layout.Section>
        )}
        <Layout.Section>
          <Card>
            <Box padding="400">
              <ProductsFilters
                queryValue={search}
                appliedFilters={appliedFilters}
                onFilterChange={onFilterChange}
                onQueryChange={handleSearchChange}
                onQueryClear={handleSearchClear}
                onClearAll={onClearAll}
              />
            </Box>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            <ProductsTable
              products={products}
              loading={shouldShowLoadingState}
              pagination={pagination}
              error={error}
              onRetry={handleRetryProducts}
              onClearAll={onClearAll}
              onNext={handleNextPage}
              onPrev={handlePreviousPage}
              selectedSet={selection.selectedSet}
              selectedCount={selection.selectedCount}
              allMatchingSelected={selection.mode === "query"}
              onToggleRow={selection.toggleRow}
              onTogglePage={selection.togglePage}
            />
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={showBulkEditConfirm}
        onClose={closeBulkEditConfirm}
        title={t("confirmBulkEdit", { defaultValue: "Confirm bulk edit" })}
        primaryAction={{
          content: t("continue", { defaultValue: "Continue" }),
          onAction: confirmBulkEdit,
          loading: targetAction === "edit",
          disabled: Boolean(targetAction),
        }}
        secondaryActions={[
          {
            content: t("cancel", { defaultValue: "Cancel" }),
            onAction: closeBulkEditConfirm,
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
                      defaultValue:
                        "Changes will apply to all matching products.",
                    })
                  : t("bulkEditConfirmSelectedWarning", {
                      defaultValue: "Changes will apply to selected products.",
                    })}
              </Text>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
